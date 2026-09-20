import { openDb, type DB } from '../src/db/index.ts';

/** テスト用のインメモリDB。マイグレーション適用済み。 */
export function testDb(): DB {
  return openDb(':memory:');
}

/** 時刻を固定してテストの再現性を保つ。2026-09-20 12:00:00 JST 相当。 */
export const T0 = 1_789_000_000_000;
export const HOUR = 60 * 60 * 1000;
