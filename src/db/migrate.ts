import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * 未適用のマイグレーションをファイル名順に適用する。
 * 適用済みは schema_migrations で管理し、何度呼んでも同じ状態になる（冪等）。
 */
export function migrate(db: Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name),
  );

  const pending = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  for (const name of pending) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    // 1つのマイグレーションは全適用か全ロールバック。中途半端な状態を残さない。
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    })();
  }

  return pending;
}
