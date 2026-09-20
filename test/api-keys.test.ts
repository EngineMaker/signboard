import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthConfig } from '../src/config.ts';
import type { DB } from '../src/db/index.ts';
import { SESSION_COOKIE } from '../src/auth/middleware.ts';
import { encodeSession } from '../src/auth/session.ts';
import { findByPlaintext, issueApiKey, listApiKeys, revokeApiKey } from '../src/repo/api-keys.ts';
import { listAuditLogs } from '../src/repo/audit.ts';
import { listActiveNotices } from '../src/repo/notices.ts';
import { T0, testDb } from './helpers.ts';

const auth: AuthConfig = {
  clientId: 'c',
  clientSecret: 's',
  botToken: 'b',
  guildId: 'g',
  residentRoleId: 'r',
  sessionSecret: 'session-secret',
  redirectUri: 'http://localhost:3100/auth/callback',
};

let db: DB;
let app: ReturnType<typeof createApp>;
let cookie: string;

beforeEach(() => {
  db = testDb();
  app = createApp(db, { auth, baseUrl: 'http://localhost:3100' });
  const token = encodeSession(
    { userId: '111', userName: 'けーえむ', issuedAt: Date.now() },
    auth.sessionSecret,
  );
  cookie = `${SESSION_COOKIE}=${token}`;
});

const owner = { label: 'ゴミ出し通知スクリプト', ownerId: '111', ownerName: 'けーえむ' };

describe('キーの保存方式', () => {
  it('DB に平文キーが存在しない', () => {
    const { plaintext } = issueApiKey(db, owner, T0);

    // 全テーブルの全列を走査して平文が混ざっていないか確認する
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);

    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === 'string') {
            expect(value).not.toContain(plaintext);
          }
        }
      }
    }
  });

  it('保存されるのは SHA-256 ハッシュ（16進64文字）', () => {
    const { row, plaintext } = issueApiKey(db, owner, T0);
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toBe(plaintext);
  });

  it('識別用の接頭辞だけ保存する', () => {
    const { row, plaintext } = issueApiKey(db, owner, T0);
    expect(plaintext.startsWith('sb_')).toBe(true);
    expect(plaintext.startsWith(row.key_prefix)).toBe(true);
    expect(row.key_prefix.length).toBeLessThan(plaintext.length);
  });

  it('毎回異なるキーが出る', () => {
    const a = issueApiKey(db, owner, T0).plaintext;
    const b = issueApiKey(db, owner, T0).plaintext;
    expect(a).not.toBe(b);
  });

  it('十分な長さがある', () => {
    expect(issueApiKey(db, owner, T0).plaintext.length).toBeGreaterThanOrEqual(32);
  });
});

describe('キーの照合', () => {
  it('正しいキーで引ける', () => {
    const { row, plaintext } = issueApiKey(db, owner, T0);
    expect(findByPlaintext(db, plaintext)?.id).toBe(row.id);
  });

  it('誤ったキーでは引けない', () => {
    issueApiKey(db, owner, T0);
    expect(findByPlaintext(db, 'sb_wrongkey')).toBeUndefined();
    expect(findByPlaintext(db, '')).toBeUndefined();
  });

  it('失効済みのキーでは引けない', () => {
    const { row, plaintext } = issueApiKey(db, owner, T0);
    revokeApiKey(db, row.id, T0 + 1000);
    expect(findByPlaintext(db, plaintext)).toBeUndefined();
  });

  it('二重失効は undefined', () => {
    const { row } = issueApiKey(db, owner, T0);
    revokeApiKey(db, row.id, T0 + 1000);
    expect(revokeApiKey(db, row.id, T0 + 2000)).toBeUndefined();
  });
});

describe('公開 API の認証', () => {
  const issue = () => issueApiKey(db, owner, T0).plaintext;
  const withKey = (key: string, path = '/api/v1/notices', init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

  it('キーなしは 401', async () => {
    expect((await app.request('/api/v1/notices')).status).toBe(401);
  });

  it('Bearer 以外の形式は 401', async () => {
    const res = await app.request('/api/v1/notices', {
      headers: { Authorization: `Basic ${issue()}` },
    });
    expect(res.status).toBe(401);
  });

  it('無効なキーは 401', async () => {
    expect((await withKey('sb_invalid')).status).toBe(401);
  });

  it('失効したキーは 401', async () => {
    const { row, plaintext } = issueApiKey(db, owner, T0);
    revokeApiKey(db, row.id);
    expect((await withKey(plaintext)).status).toBe(401);
  });

  it('有効なキーで一覧が取れる', async () => {
    const res = await withKey(issue());
    expect(res.status).toBe(200);
  });

  it('使用すると last_used_at が記録される', async () => {
    const key = issue();
    expect(listApiKeys(db)[0]!.last_used_at).toBeNull();
    await withKey(key);
    expect(listApiKeys(db)[0]!.last_used_at).not.toBeNull();
  });
});

describe('公開 API の操作', () => {
  let key: string;
  beforeEach(() => {
    key = issueApiKey(db, owner, T0).plaintext;
  });

  const call = (path: string, init: RequestInit = {}) =>
    app.request(`/api/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  it('投稿でき、監査ログに source: api で残る', async () => {
    const res = await call('/notices', {
      method: 'POST',
      body: JSON.stringify({ body: 'スクリプトからの投稿' }),
    });
    expect(res.status).toBe(201);

    expect(listActiveNotices(db).map((n) => n.body)).toEqual(['スクリプトからの投稿']);

    const log = listAuditLogs(db, { action: 'notice.create' })[0]!;
    expect(log.source).toBe('api');
    expect(log.actor_name).toBe('けーえむ'); // キーの持ち主が実行者になる
  });

  it('編集・削除できる', async () => {
    await call('/notices', { method: 'POST', body: JSON.stringify({ body: '元の本文' }) });
    const id = listActiveNotices(db)[0]!.id;

    expect((await call(`/notices/${id}`, { method: 'PATCH', body: JSON.stringify({ body: '新しい本文' }) })).status).toBe(200);
    expect(listActiveNotices(db)[0]!.body).toBe('新しい本文');

    expect((await call(`/notices/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(listActiveNotices(db)).toHaveLength(0);
  });

  it('本文の検証は管理画面と同じ', async () => {
    expect((await call('/notices', { method: 'POST', body: JSON.stringify({ body: '  ' }) })).status).toBe(400);
    expect((await call('/notices', { method: 'POST', body: JSON.stringify({ body: 'あ'.repeat(201) }) })).status).toBe(400);
    expect((await call('/notices', { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
  });

  it('存在しないIDは 404', async () => {
    expect((await call('/notices/9999', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('管理画面のキー管理', () => {
  const admin = (path: string, init: RequestInit = {}) =>
    app.request(`/api/admin${path}`, {
      ...init,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  it('発行でき、平文は1回だけ返る', async () => {
    const res = await admin('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ label: 'テスト用' }),
    });
    expect(res.status).toBe(201);

    const json = (await res.json()) as { plaintext: string; key: { id: number } };
    expect(json.plaintext.startsWith('sb_')).toBe(true);

    // 一覧には平文が含まれない
    const list = (await (await admin('/api-keys')).json()) as { keys: Record<string, unknown>[] };
    expect(JSON.stringify(list)).not.toContain(json.plaintext);
  });

  it('発行と失効が監査ログに残る', async () => {
    const res = await admin('/api-keys', { method: 'POST', body: JSON.stringify({ label: 'test' }) });
    const { key } = (await res.json()) as { key: { id: number } };

    await admin(`/api-keys/${key.id}`, { method: 'DELETE' });

    expect(listAuditLogs(db, { action: 'apikey.create' })).toHaveLength(1);
    expect(listAuditLogs(db, { action: 'apikey.revoke' })).toHaveLength(1);
  });

  it('監査ログに平文もハッシュも載らない', async () => {
    const res = await admin('/api-keys', { method: 'POST', body: JSON.stringify({ label: 'test' }) });
    const { plaintext } = (await res.json()) as { plaintext: string };

    const logs = JSON.stringify(listAuditLogs(db));
    expect(logs).not.toContain(plaintext);
    expect(logs).not.toContain(listApiKeys(db)[0]!.key_hash);
  });

  it('名前が空なら 400', async () => {
    expect((await admin('/api-keys', { method: 'POST', body: JSON.stringify({ label: '  ' }) })).status).toBe(400);
  });

  it('未ログインでは触れない', async () => {
    expect((await app.request('/api/admin/api-keys')).status).toBe(401);
  });
});
