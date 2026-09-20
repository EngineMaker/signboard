import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AuthConfig } from '../config.ts';
import { authorizeUrl, displayName, exchangeCode, fetchCurrentUser } from '../auth/discord.ts';
import { hasResidentRole } from '../auth/roles.ts';
import { SESSION_COOKIE } from '../auth/middleware.ts';
import { encodeSession, randomState, SESSION_TTL_MS } from '../auth/session.ts';

const STATE_COOKIE = 'signboard_oauth_state';

/** 本番(https)かどうか。Secure 属性の切り替えに使う。 */
const isSecure = (baseUrl: string) => baseUrl.startsWith('https://');

export function authRoutes(auth: AuthConfig, baseUrl: string) {
  const app = new Hono();

  /** Discord の認可画面へ送る。 */
  app.get('/login', (c) => {
    const state = randomState();

    // state は Cookie に控えてコールバックで突き合わせる（CSRF 対策）
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: isSecure(baseUrl),
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    });

    return c.redirect(
      authorizeUrl({ clientId: auth.clientId, redirectUri: auth.redirectUri, state }),
    );
  });

  /** Discord からの戻り。ロールを検証してセッションを発行する。 */
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const expectedState = getCookie(c, STATE_COOKIE);

    deleteCookie(c, STATE_COOKIE, { path: '/' });

    if (!code) {
      return c.json({ error: '認可コードがありません' }, 400);
    }
    if (!state || !expectedState || state !== expectedState) {
      return c.json({ error: 'state が一致しません' }, 400);
    }

    let userId: string;
    let userName: string;
    try {
      const token = await exchangeCode(code, {
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        redirectUri: auth.redirectUri,
      });
      const user = await fetchCurrentUser(token.access_token);
      userId = user.id;
      userName = displayName(user);
    } catch {
      return c.json({ error: 'Discord との通信に失敗しました' }, 502);
    }

    // ここが要。ロールを持っていることが確認できた場合だけ通す。
    const allowed = await hasResidentRole(userId, auth);
    if (!allowed) {
      return c.json({ error: 'EM住民ロールが必要です' }, 403);
    }

    const session = encodeSession({ userId, userName, issuedAt: Date.now() }, auth.sessionSecret);

    setCookie(c, SESSION_COOKIE, session, {
      httpOnly: true,
      secure: isSecure(baseUrl),
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return c.redirect('/admin');
  });

  app.get('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/');
  });

  return app;
}
