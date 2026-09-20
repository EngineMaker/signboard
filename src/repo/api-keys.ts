import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db/index.ts';
import type { ApiKeyRow } from '../db/schema.ts';

/**
 * API キー（SPEC §2.1）。
 *
 * 平文は保存しない。発行時に一度だけ返し、DB には SHA-256 ハッシュのみ置く。
 * 漏れても DB から元のキーは復元できない。
 */

/** キーの見た目の接頭辞。ログや一覧で「これは signboard のキーだ」と分かるように。 */
const PREFIX = 'sb_';

/** 一覧表示でどのキーか見分けるために保存する先頭部分の長さ。 */
const DISPLAY_PREFIX_LENGTH = PREFIX.length + 6;

export interface IssuedKey {
  row: ApiKeyRow;
  /** 平文。この瞬間しか取得できない。 */
  plaintext: string;
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** 新しいキーを発行する。 */
export function issueApiKey(
  db: DB,
  input: { label: string; ownerId: string; ownerName: string },
  now = Date.now(),
): IssuedKey {
  const plaintext = PREFIX + randomBytes(24).toString('base64url');

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, label, owner_id, owner_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashKey(plaintext),
      plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
      input.label,
      input.ownerId,
      input.ownerName,
      now,
    );

  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(lastInsertRowid)) as ApiKeyRow;
  return { row, plaintext };
}

/**
 * 平文のキーから有効なレコードを引く。
 * 失効済み・存在しない場合は undefined。
 */
export function findByPlaintext(db: DB, plaintext: string): ApiKeyRow | undefined {
  // ハッシュは固定長なので、文字列比較でもタイミングの手がかりにはなりにくいが、
  // 念のため定数時間比較を使う。
  const target = hashKey(plaintext);

  const rows = db.prepare('SELECT * FROM api_keys WHERE revoked_at IS NULL').all() as ApiKeyRow[];
  const targetBuf = Buffer.from(target);

  for (const row of rows) {
    const candidate = Buffer.from(row.key_hash);
    if (candidate.length !== targetBuf.length) continue;
    if (timingSafeEqual(candidate, targetBuf)) return row;
  }
  return undefined;
}

/** 最終使用日時を更新する。失敗しても呼び出し側は止めない。 */
export function touchApiKey(db: DB, id: number, now = Date.now()): void {
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now, id);
}

export function listApiKeys(db: DB, opts: { ownerId?: string } = {}): ApiKeyRow[] {
  if (opts.ownerId) {
    return db
      .prepare('SELECT * FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC')
      .all(opts.ownerId) as ApiKeyRow[];
  }
  return db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as ApiKeyRow[];
}

export function getApiKey(db: DB, id: number): ApiKeyRow | undefined {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow | undefined;
}

/** 失効させる。既に失効済みなら undefined。 */
export function revokeApiKey(db: DB, id: number, now = Date.now()): ApiKeyRow | undefined {
  const current = getApiKey(db, id);
  if (!current || current.revoked_at !== null) return undefined;

  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(now, id);
  return getApiKey(db, id);
}
