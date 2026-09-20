import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db/index.ts';
import {
  DEFAULT_TTL_MS,
  createNotice,
  deleteNotice,
  getNotice,
  listActiveNotices,
  listNotices,
  updateNotice,
} from '../src/repo/notices.ts';
import { HOUR, T0, testDb } from './helpers.ts';

let db: DB;
beforeEach(() => {
  db = testDb();
});

const base = { authorId: '111', authorName: 'けーえむ', source: 'web' as const };

describe('createNotice', () => {
  it('期限未指定なら24時間後になる', () => {
    const n = createNotice(db, { ...base, body: 'ゴミ出し当番よろしく' }, T0);
    expect(n.expires_at).toBe(T0 + DEFAULT_TTL_MS);
    expect(n.expires_at - n.created_at).toBe(24 * HOUR);
  });

  it('期限を指定すればその値が入る', () => {
    const n = createNotice(db, { ...base, body: '明日は停電', expiresAt: T0 + 3 * HOUR }, T0);
    expect(n.expires_at).toBe(T0 + 3 * HOUR);
  });

  it('作成直後は削除されていない', () => {
    const n = createNotice(db, { ...base, body: 'test' }, T0);
    expect(n.deleted_at).toBeNull();
  });

  it('投稿経路を記録する', () => {
    const n = createNotice(db, { ...base, body: 'test', source: 'bot' }, T0);
    expect(n.source).toBe('bot');
  });

  it('不正な投稿経路はDBが拒否する', () => {
    expect(() =>
      createNotice(db, { ...base, body: 'test', source: 'telepathy' as never }, T0),
    ).toThrow();
  });
});

describe('listActiveNotices', () => {
  it('期限切れを除外する', () => {
    createNotice(db, { ...base, body: '生きてる', expiresAt: T0 + HOUR }, T0);
    createNotice(db, { ...base, body: '切れてる', expiresAt: T0 - HOUR }, T0 - 2 * HOUR);

    const active = listActiveNotices(db, T0);
    expect(active.map((n) => n.body)).toEqual(['生きてる']);
  });

  it('期限ちょうどの時刻では表示しない', () => {
    createNotice(db, { ...base, body: 'ぴったり', expiresAt: T0 + HOUR }, T0);
    expect(listActiveNotices(db, T0 + HOUR)).toHaveLength(0);
    expect(listActiveNotices(db, T0 + HOUR - 1)).toHaveLength(1);
  });

  it('論理削除済みを除外する', () => {
    const n = createNotice(db, { ...base, body: '消される' }, T0);
    createNotice(db, { ...base, body: '残る' }, T0);
    deleteNotice(db, n.id, T0);

    expect(listActiveNotices(db, T0).map((x) => x.body)).toEqual(['残る']);
  });

  it('投稿順（古い順）に返す', () => {
    createNotice(db, { ...base, body: '1番目' }, T0);
    createNotice(db, { ...base, body: '2番目' }, T0 + 1000);
    createNotice(db, { ...base, body: '3番目' }, T0 + 2000);

    expect(listActiveNotices(db, T0 + 3000).map((n) => n.body)).toEqual(['1番目', '2番目', '3番目']);
  });

  it('何もなければ空配列', () => {
    expect(listActiveNotices(db, T0)).toEqual([]);
  });
});

describe('updateNotice', () => {
  it('本文を更新し updated_at が進む', () => {
    const n = createNotice(db, { ...base, body: '旧' }, T0);
    const updated = updateNotice(db, n.id, { body: '新' }, T0 + 1000);

    expect(updated?.body).toBe('新');
    expect(updated?.updated_at).toBe(T0 + 1000);
    expect(updated?.created_at).toBe(T0);
  });

  it('期限だけ延長できる', () => {
    const n = createNotice(db, { ...base, body: 'そのまま', expiresAt: T0 + HOUR }, T0);
    const updated = updateNotice(db, n.id, { expiresAt: T0 + 5 * HOUR }, T0);

    expect(updated?.body).toBe('そのまま');
    expect(updated?.expires_at).toBe(T0 + 5 * HOUR);
  });

  it('論理削除済みは更新できない', () => {
    const n = createNotice(db, { ...base, body: 'test' }, T0);
    deleteNotice(db, n.id, T0);

    expect(updateNotice(db, n.id, { body: '復活' }, T0 + 1000)).toBeUndefined();
    expect(getNotice(db, n.id)?.body).toBe('test');
  });

  it('存在しないIDは undefined', () => {
    expect(updateNotice(db, 9999, { body: 'x' }, T0)).toBeUndefined();
  });
});

describe('deleteNotice', () => {
  it('論理削除で行は残り、本文も追跡できる', () => {
    const n = createNotice(db, { ...base, body: '消す内容' }, T0);
    deleteNotice(db, n.id, T0 + 1000);

    const row = getNotice(db, n.id);
    expect(row).toBeDefined();
    expect(row?.deleted_at).toBe(T0 + 1000);
    expect(row?.body).toBe('消す内容');
  });

  it('二重削除は undefined', () => {
    const n = createNotice(db, { ...base, body: 'test' }, T0);
    deleteNotice(db, n.id, T0);
    expect(deleteNotice(db, n.id, T0 + 1000)).toBeUndefined();
  });
});

describe('listNotices', () => {
  it('期限切れも含むが論理削除は除く', () => {
    createNotice(db, { ...base, body: '有効' }, T0);
    createNotice(db, { ...base, body: '期限切れ', expiresAt: T0 - HOUR }, T0 - 2 * HOUR);
    const d = createNotice(db, { ...base, body: '削除済み' }, T0);
    deleteNotice(db, d.id, T0);

    const bodies = listNotices(db).map((n) => n.body);
    expect(bodies).toContain('有効');
    expect(bodies).toContain('期限切れ');
    expect(bodies).not.toContain('削除済み');
  });

  it('includeDeleted で削除済みも返す', () => {
    const d = createNotice(db, { ...base, body: '削除済み' }, T0);
    deleteNotice(db, d.id, T0);
    expect(listNotices(db, { includeDeleted: true }).map((n) => n.body)).toContain('削除済み');
  });
});
