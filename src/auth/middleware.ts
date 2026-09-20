import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AuthConfig } from '../config.ts';
import { decodeSession, type SessionData } from './session.ts';

export const SESSION_COOKIE = 'signboard_session';

export type AuthVars = { session: SessionData };

/**
 * ログイン必須のルートに付ける。
 * セッションが無い・壊れている・期限切れなら 401。
 *
 * ロールの確認はログイン時に行い、セッションの有効期限（7日）で再確認される。
 * 毎リクエスト Discord に問い合わせると遅く、API 制限にも当たるため。
 */
export function requireAuth(auth: AuthConfig) {
  return createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const session = decodeSession(getCookie(c, SESSION_COOKIE), auth.sessionSecret);

    if (!session) {
      return c.json({ error: 'ログインが必要です' }, 401);
    }

    c.set('session', session);
    await next();
  });
}
