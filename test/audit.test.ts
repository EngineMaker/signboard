import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db/index.ts';
import { countAuditLogs, listAuditLogs } from '../src/repo/audit.ts';
import { getSettings } from '../src/repo/settings.ts';
import { createNotice, deleteNotice, updateNotice } from '../src/service/notices.ts';
import { updateSettings } from '../src/service/settings.ts';
import { T0, testDb } from './helpers.ts';

let db: DB;
beforeEach(() => {
  db = testDb();
});

const ctx = {
  actor: { id: '111', name: 'けーえむ' },
  source: 'web' as const,
  ip: '192.168.1.5',
};

const parse = (s: string | null) => (s === null ? null : JSON.parse(s));

describe('お知らせの操作が監査ログに残る', () => {
  it('作成 → notice.create が1件', () => {
    const n = createNotice(db, { body: 'ゴミ出し当番' }, ctx, T0);
    const logs = listAuditLogs(db);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('notice.create');
    expect(logs[0]!.target_id).toBe(String(n.id));
    expect(logs[0]!.actor_id).toBe('111');
    expect(logs[0]!.actor_name).toBe('けーえむ');
    expect(logs[0]!.source).toBe('web');
    expect(logs[0]!.ip).toBe('192.168.1.5');
    expect(parse(logs[0]!.before_json)).toBeNull();
    expect(parse(logs[0]!.after_json)).toMatchObject({ body: 'ゴミ出し当番' });
  });

  it('更新 → 変更前後が両方残る', () => {
    const n = createNotice(db, { body: '旧' }, ctx, T0);
    updateNotice(db, n.id, { body: '新' }, ctx, T0 + 1000);

    const log = listAuditLogs(db, { action: 'notice.update' })[0]!;
    expect(parse(log.before_json)).toMatchObject({ body: '旧' });
    expect(parse(log.after_json)).toMatchObject({ body: '新' });
  });

  it('削除 → 削除されたお知らせの本文が追跡できる（SPEC §2.7）', () => {
    const n = createNotice(db, { body: '消される内容' }, ctx, T0);
    deleteNotice(db, n.id, ctx, T0 + 1000);

    const log = listAuditLogs(db, { action: 'notice.delete' })[0]!;
    expect(parse(log.before_json)).toMatchObject({ body: '消される内容' });
  });

  it('経路ごとに source が記録される', () => {
    createNotice(db, { body: 'web から' }, { ...ctx, source: 'web' }, T0);
    createNotice(db, { body: 'bot から' }, { ...ctx, source: 'bot' }, T0 + 1);
    createNotice(db, { body: 'api から' }, { ...ctx, source: 'api' }, T0 + 2);

    expect(listAuditLogs(db).map((l) => l.source)).toEqual(['api', 'bot', 'web']);
  });

  it('失敗した操作はログを残さない', () => {
    expect(updateNotice(db, 9999, { body: 'x' }, ctx, T0)).toBeUndefined();
    expect(deleteNotice(db, 9999, ctx, T0)).toBeUndefined();
    expect(countAuditLogs(db)).toBe(0);
  });

  it('二重削除は2件目のログを残さない', () => {
    const n = createNotice(db, { body: 'test' }, ctx, T0);
    deleteNotice(db, n.id, ctx, T0 + 1000);
    deleteNotice(db, n.id, ctx, T0 + 2000);

    expect(countAuditLogs(db, 'notice.delete')).toBe(1);
  });
});

describe('設定変更が監査ログに残る', () => {
  it('変更した項目だけ記録する', () => {
    updateSettings(db, { scrollSpeed: 300 }, ctx, T0);

    const log = listAuditLogs(db, { action: 'settings.update' })[0]!;
    expect(parse(log.before_json)).toEqual({ scrollSpeed: 220 });
    expect(parse(log.after_json)).toEqual({ scrollSpeed: 300 });
  });

  it('複数項目の変更をまとめて記録する', () => {
    updateSettings(db, { scrollSpeed: 300, fallbackText: '平和です' }, ctx, T0);

    const log = listAuditLogs(db, { action: 'settings.update' })[0]!;
    expect(parse(log.after_json)).toEqual({ scrollSpeed: 300, fallbackText: '平和です' });
    expect(log.target_id).toContain('scrollSpeed');
  });

  it('値が変わらなければログを残さない（ノイズを増やさない）', () => {
    const current = getSettings(db);
    updateSettings(db, { scrollSpeed: current.scrollSpeed }, ctx, T0);
    expect(countAuditLogs(db)).toBe(0);
  });
});

describe('監査ログの一覧', () => {
  it('新しい順に返す', () => {
    createNotice(db, { body: '1' }, ctx, T0);
    createNotice(db, { body: '2' }, ctx, T0 + 1000);
    createNotice(db, { body: '3' }, ctx, T0 + 2000);

    const logs = listAuditLogs(db);
    expect(logs.map((l) => l.created_at)).toEqual([T0 + 2000, T0 + 1000, T0]);
  });

  it('操作種別で絞り込める', () => {
    const n = createNotice(db, { body: 'test' }, ctx, T0);
    updateNotice(db, n.id, { body: 'updated' }, ctx, T0 + 1000);
    updateSettings(db, { theme: 'led' }, ctx, T0 + 2000);

    expect(listAuditLogs(db, { action: 'notice.create' })).toHaveLength(1);
    expect(listAuditLogs(db, { action: 'settings.update' })).toHaveLength(1);
    expect(listAuditLogs(db)).toHaveLength(3);
  });

  it('ページングできる', () => {
    for (let i = 0; i < 5; i++) createNotice(db, { body: `n${i}` }, ctx, T0 + i);
    expect(listAuditLogs(db, { limit: 2 })).toHaveLength(2);
    expect(listAuditLogs(db, { limit: 2, offset: 4 })).toHaveLength(1);
  });
});

describe('監査ログは改竄できない', () => {
  it('サービス層を通した操作でも、ログ自体は更新・削除できない', () => {
    createNotice(db, { body: 'test' }, ctx, T0);

    expect(() => db.prepare('UPDATE audit_logs SET actor_name = ?').run('別人')).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(countAuditLogs(db)).toBe(1);
  });
});
