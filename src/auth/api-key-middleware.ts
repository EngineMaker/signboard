import { createMiddleware } from 'hono/factory';
import type { DB } from '../db/index.ts';
import { findByPlaintext, touchApiKey } from '../repo/api-keys.ts';
import type { Actor } from '../repo/audit.ts';

export type ApiKeyVars = { actor: Actor; apiKeyId: number };

/**
 * `Authorization: Bearer <key>` を検証する。
 *
 * キーの持ち主は発行時に EM住民ロールを持っていた人。
 * 失効させない限り有効で、ロールを失っても使える点は
 * セッション（7日で切れる）と違う。住人が書いたスクリプトが
 * 突然止まらないようにするため、失効は明示的な操作に限る。
 */
export function requireApiKey(db: DB) {
  return createMiddleware<{ Variables: ApiKeyVars }>(async (c, next) => {
    const header = c.req.header('authorization');

    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization: Bearer <APIキー> が必要です' }, 401);
    }

    const key = findByPlaintext(db, header.slice('Bearer '.length).trim());
    if (!key) {
      return c.json({ error: 'APIキーが無効です' }, 401);
    }

    touchApiKey(db, key.id);

    c.set('actor', { id: key.owner_id, name: key.owner_name });
    c.set('apiKeyId', key.id);
    await next();
  });
}
