import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthConfig } from '../src/config.ts';
import type { DB } from '../src/db/index.ts';
import { SESSION_COOKIE } from '../src/auth/middleware.ts';
import { encodeSession } from '../src/auth/session.ts';
import { isCrawler } from '../src/routes/og-card.ts';
import { issueApiKey } from '../src/repo/api-keys.ts';
import { createNotice } from '../src/service/notices.ts';
import { testDb } from './helpers.ts';

const auth: AuthConfig = {
  clientId: 'c',
  clientSecret: 's',
  botToken: 'b',
  guildId: 'g',
  residentRoleId: 'r',
  sessionSecret: 'session-secret',
  redirectUri: 'http://localhost:3100/auth/callback',
};

const DISCORD_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = testDb();
  app = createApp(db, { auth, baseUrl: 'https://signboard.emaker.dev' });
});

describe('isCrawler', () => {
  it('リンクプレビューを取りに来る相手を見分ける', () => {
    expect(isCrawler(DISCORD_UA)).toBe(true);
    expect(isCrawler('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isCrawler('Twitterbot/1.0')).toBe(true);
    expect(isCrawler('facebookexternalhit/1.1')).toBe(true);
  });

  it('普通のブラウザは対象外', () => {
    expect(isCrawler(BROWSER_UA)).toBe(false);
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler('')).toBe(false);
  });
});

describe('掲示板 / の OGP', () => {
  it('メタタグが入っている', async () => {
    const html = await (await app.request('/')).text();
    expect(html).toContain('og:title');
    expect(html).toContain('og:image');
    expect(html).toContain('https://signboard.emaker.dev/ogp.png');
  });
});

describe('管理画面 /admin/ の OGP', () => {
  it('クローラーにはカードを返す', async () => {
    const res = await app.request('/admin/', { headers: { 'User-Agent': DISCORD_UA } });
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="掲示板の管理">');
    expect(html).toContain('https://signboard.emaker.dev/admin/ogp.png');
  });

  it('未ログインのブラウザはログインへ送る', async () => {
    const res = await app.request('/admin/', { headers: { 'User-Agent': BROWSER_UA } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/login');
  });

  it('ログイン済みなら管理画面そのものを返す', async () => {
    const token = encodeSession(
      { userId: '111', userName: 'けーえむ', issuedAt: Date.now() },
      auth.sessionSecret,
    );
    const res = await app.request('/admin/', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
  });
});

describe('クローラーに中身が漏れないこと', () => {
  beforeEach(() => {
    createNotice(
      db,
      { body: '秘密のお知らせ' },
      { actor: { id: '111', name: 'けーえむ' }, source: 'web' },
    );
    issueApiKey(db, { label: '秘密のキー', ownerId: '111', ownerName: 'けーえむ' });
  });

  it('カードにお知らせの本文が含まれない', async () => {
    const html = await (await app.request('/admin/', { headers: { 'User-Agent': DISCORD_UA } })).text();
    expect(html).not.toContain('秘密のお知らせ');
  });

  it('カードにAPIキーの情報が含まれない', async () => {
    const html = await (await app.request('/admin/', { headers: { 'User-Agent': DISCORD_UA } })).text();
    expect(html).not.toContain('秘密のキー');
    expect(html).not.toContain('sb_');
  });

  it('管理APIはクローラーでも 401', async () => {
    for (const path of ['/api/admin/notices', '/api/admin/api-keys', '/api/admin/audit-logs']) {
      const res = await app.request(path, { headers: { 'User-Agent': DISCORD_UA } });
      expect(res.status).toBe(401);
    }
  });

  it('管理画面のJSやCSSはクローラーに返さない', async () => {
    const res = await app.request('/admin/admin.js', { headers: { 'User-Agent': DISCORD_UA } });
    // カードHTMLが返るだけで、スクリプトの中身は出ない
    expect(await res.text()).not.toContain('function loadApiKeys');
  });
});

describe('OGP 画像', () => {
  it('管理画面の画像は認証なしで取れる', async () => {
    const res = await app.request('/admin/ogp.png');
    expect(res.status).toBe(200);
  });
});
