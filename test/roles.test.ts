import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasResidentRole } from '../src/auth/roles.ts';

const opts = { botToken: 'bot-token', guildId: 'guild-1', residentRoleId: 'role-resident' };

/** fetch をモックしてレスポンスを差し込む。 */
function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(impl(url))));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hasResidentRole', () => {
  it('EM住民ロールを持っていれば true', async () => {
    mockFetch(() => json({ roles: ['role-other', 'role-resident'] }));
    expect(await hasResidentRole('111', opts)).toBe(true);
  });

  it('別のロールしか持っていなければ false', async () => {
    mockFetch(() => json({ roles: ['role-other'] }));
    expect(await hasResidentRole('111', opts)).toBe(false);
  });

  it('ロールが空なら false', async () => {
    mockFetch(() => json({ roles: [] }));
    expect(await hasResidentRole('111', opts)).toBe(false);
  });

  it('サーバーに居なければ（404）false', async () => {
    mockFetch(() => json({ message: 'Unknown Member' }, 404));
    expect(await hasResidentRole('111', opts)).toBe(false);
  });

  it('Discord API がエラーでも false（通信できないときに通さない）', async () => {
    mockFetch(() => json({ message: 'Internal Server Error' }, 500));
    expect(await hasResidentRole('111', opts)).toBe(false);
  });

  it('ネットワーク例外でも false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    expect(await hasResidentRole('111', opts)).toBe(false);
  });

  it('Bot トークンで正しいエンドポイントを叩く', async () => {
    const spy = vi.fn(() => Promise.resolve(json({ roles: ['role-resident'] })));
    vi.stubGlobal('fetch', spy);

    await hasResidentRole('user-42', opts);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/v10/guilds/guild-1/members/user-42');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bot bot-token');
  });
});
