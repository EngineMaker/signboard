import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate.ts';

export type DB = Database.Database;

/**
 * DB を開いてマイグレーションを適用する。
 * `:memory:` を渡すとインメモリDBになる（テスト用）。
 */
export function openDb(path: string): DB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // WAL: 読み取り（掲示板のポーリング）と書き込み（投稿）が互いをブロックしない。
  db.pragma('journal_mode = WAL');
  // 外部キー制約を有効化（SQLite は既定で無効）。
  db.pragma('foreign_keys = ON');
  // 書き込み中に一瞬ロックされていても即エラーにせず待つ。
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}
