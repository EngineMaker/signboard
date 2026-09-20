/** `npm run migrate` から呼ばれる。DBファイルを作成し未適用のマイグレーションを流す。 */
import { openDb } from './index.ts';
import { config } from '../config.ts';

const db = openDb(config.dbPath);
const applied = db
  .prepare('SELECT name FROM schema_migrations ORDER BY name')
  .all() as { name: string }[];

console.log(`db: ${config.dbPath}`);
console.log(`applied migrations: ${applied.map((r) => r.name).join(', ') || '(none)'}`);
