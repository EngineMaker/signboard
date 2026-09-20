import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthConfig } from '../src/config.ts';
import { SESSION_COOKIE } from '../src/auth/middleware.ts';
import { encodeSession } from '../src/auth/session.ts';
import { testDb } from './helpers.ts';

const auth: AuthConfig = {
  clientId: 'client-1',
  clientSecret: 'secret-1',
  botToken: 'bot-token',
  guildId: 'guild-1',
  residentRoleId: 'role-resident',
  sessionSecret: 'session-secret',
  redirectUri: 'http://localhost:3100/auth/callback',
};

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp(testDb(), { auth, baseUrl: 'http://localhost:3100' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** OAuth の一連の通信をモックする。roles を null にするとサーバー未参加。 */
function mockDiscord(roles: string[] | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(json({ access_token: 'at', token_type: 'Bearer', expires_in: 604800, scope: 'identify' }));
      }
      if (url.includes('/users/@me')) {
        return Promise.resolve(json({ id: '111', username: 'mktoho', global_name: 'けーえむ' }));
      }
      if (url.includes('/members/')) {
        return roles === null
          ? Promise.resolve(json({ message: 'Unknown Member' }, 404))
          : Promise.resolve(json({ roles }));
      }
      return Promise.resolve(json({}, 404));
    }),
  );
}

/** /auth/login を踏んで state と Cookie を得る。 */
async function startLogin() {
  const res = await app.request('/auth/login');
  const location = res.headers.get('location')!;
  const state = new URL(location).searchParams.get('state')!;
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { state, cookie, location };
}

describe('GET /auth/login', () => {
  it('Discord の認可画面へリダイレクトする', async () => {
    const { location } = await startLogin();
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('scope')).toBe('identify');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('state を HttpOnly Cookie に保存する', async () => {
    const res = await app.request('/auth/login');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });
});

describe('GET /auth/callback', () => {
  it('ロールを持っていればセッションを発行して /admin へ', async () => {
    mockDiscord(['role-other', 'role-resident']);
    const { state, cookie } = await startLogin();

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');

    const session = res.headers.get('set-cookie')!;
    expect(session).toContain(SESSION_COOKIE);
    expect(session).toContain('HttpOnly');
  });

  it('ロールが無ければ 403、セッションを発行しない', async () => {
    mockDiscord(['role-other']);
    const { state, cookie } = await startLogin();

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie') ?? '').not.toContain(SESSION_COOKIE);
  });

  it('サーバーに居なければ 403', async () => {
    mockDiscord(null);
    const { state, cookie } = await startLogin();

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  it('state が一致しなければ 400（CSRF 対策）', async () => {
    mockDiscord(['role-resident']);
    const { cookie } = await startLogin();

    const res = await app.request('/auth/callback?code=abc&state=forged', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  it('state Cookie が無ければ 400', async () => {
    mockDiscord(['role-resident']);
    const { state } = await startLogin();

    const res = await app.request(`/auth/callback?code=abc&state=${state}`);
    expect(res.status).toBe(400);
  });

  it('code が無ければ 400', async () => {
    const { state, cookie } = await startLogin();
    const res = await app.request(`/auth/callback?state=${state}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it('Discord との通信に失敗したら 502', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { state, cookie } = await startLogin();

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(502);
  });
});

describe('GET /api/me', () => {
  it('未ログインなら 401', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  it('有効なセッションがあればユーザー情報を返す', async () => {
    const token = encodeSession(
      { userId: '111', userName: 'けーえむ', issuedAt: Date.now() },
      auth.sessionSecret,
    );
    const res = await app.request('/api/me', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: '111', userName: 'けーえむ' });
  });

  it('改竄されたセッションは 401', async () => {
    const token = encodeSession(
      { userId: '111', userName: 'けーえむ', issuedAt: Date.now() },
      'wrong-secret',
    );
    const res = await app.request('/api/me', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/logout', () => {
  it('セッションを消して / へ', async () => {
    const res = await app.request('/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });
});

describe('認証なしで起動した場合', () => {
  it('掲示板は見えるが /auth/login は存在しない', async () => {
    const noAuth = createApp(testDb());
    expect((await noAuth.request('/api/notices')).status).toBe(200);
    expect((await noAuth.request('/auth/login')).status).toBe(404);
  });
});
