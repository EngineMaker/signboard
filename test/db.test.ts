import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.ts';
import { T0, testDb } from './helpers.ts';

describe('migrate', () => {
  it('必要なテーブルを作る', () => {
    const db = testDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual(expect.arrayContaining(['notices', 'settings', 'audit_logs', 'api_keys']));
  });

  it('二度目の実行では何も適用しない（冪等）', () => {
    const db = testDb();
    expect(migrate(db)).toEqual([]);
  });
});

describe('audit_logs は追記専用', () => {
  const insert = (db: ReturnType<typeof testDb>) =>
    db
      .prepare(
        `INSERT INTO audit_logs (created_at, actor_id, actor_name, action, target_type, target_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(T0, '111', 'けーえむ', 'notice.create', 'notice', '1', 'web');

  it('UPDATE はトリガーで拒否される', () => {
    const db = testDb();
    insert(db);
    expect(() => db.prepare('UPDATE audit_logs SET actor_name = ?').run('別人')).toThrow(
      /append-only/,
    );
  });

  it('DELETE はトリガーで拒否される', () => {
    const db = testDb();
    insert(db);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) c FROM audit_logs').get()).toEqual({ c: 1 });
  });

  it('不正な経路は拒否される', () => {
    const db = testDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO audit_logs (created_at, actor_id, actor_name, action, target_type, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(T0, '111', 'x', 'notice.create', 'notice', 'carrier-pigeon'),
    ).toThrow();
  });
});
