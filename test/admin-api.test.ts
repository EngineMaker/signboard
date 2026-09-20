import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthConfig } from '../src/config.ts';
import type { DB } from '../src/db/index.ts';
import { SESSION_COOKIE } from '../src/auth/middleware.ts';
import { encodeSession } from '../src/auth/session.ts';
import { countAuditLogs, listAuditLogs } from '../src/repo/audit.ts';
import { listActiveNotices } from '../src/repo/notices.ts';
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

const send = (path: string, init: RequestInit = {}) =>
  app.request(`/api/admin${path}`, {
    ...init,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const post = (body: unknown) => send('/notices', { method: 'POST', body: JSON.stringify(body) });

describe('認証', () => {
  it('未ログインではすべて 401', async () => {
    for (const path of ['/notices', '/settings', '/audit-logs']) {
      expect((await app.request(`/api/admin${path}`)).status).toBe(401);
    }
  });

  it('未ログインで /admin はログインへリダイレクト', async () => {
    const res = await app.request('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/login');
  });
});

describe('POST /api/admin/notices', () => {
  it('投稿でき、監査ログが1件残る', async () => {
    const res = await post({ body: 'ゴミ出し当番' });
    expect(res.status).toBe(201);

    expect(listActiveNotices(db)).toHaveLength(1);
    const logs = listAuditLogs(db);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('notice.create');
    expect(logs[0]!.actor_name).toBe('けーえむ');
    expect(logs[0]!.source).toBe('web');
  });

  it('期限を指定できる', async () => {
    const expiresAt = Date.now() + 3 * 3600000;
    const res = await post({ body: 'test', expiresAt });
    const json = (await res.json()) as { notice: { expires_at: number } };
    expect(json.notice.expires_at).toBe(expiresAt);
  });

  it('本文が空なら 400、ログも残らない', async () => {
    expect((await post({ body: '   ' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(countAuditLogs(db)).toBe(0);
  });

  it('本文が長すぎれば 400', async () => {
    expect((await post({ body: 'あ'.repeat(201) })).status).toBe(400);
    expect((await post({ body: 'あ'.repeat(200) })).status).toBe(201);
  });

  it('過去の期限は 400', async () => {
    expect((await post({ body: 'test', expiresAt: Date.now() - 1000 })).status).toBe(400);
  });

  it('遠すぎる期限は 400', async () => {
    const twoYears = Date.now() + 2 * 365 * 24 * 3600000;
    expect((await post({ body: 'test', expiresAt: twoYears })).status).toBe(400);
  });

  it('前後の空白は取り除かれる', async () => {
    await post({ body: '  余白あり  ' });
    expect(listActiveNotices(db)[0]!.body).toBe('余白あり');
  });
});

describe('PATCH /api/admin/notices/:id', () => {
  it('編集でき、監査ログに変更前後が残る', async () => {
    await post({ body: '旧' });
    const id = listActiveNotices(db)[0]!.id;

    const res = await send(`/notices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: '新' }),
    });
    expect(res.status).toBe(200);

    const log = listAuditLogs(db, { action: 'notice.update' })[0]!;
    expect(JSON.parse(log.before_json!).body).toBe('旧');
    expect(JSON.parse(log.after_json!).body).toBe('新');
  });

  it('存在しないIDは 404', async () => {
    const res = await send('/notices/9999', {
      method: 'PATCH',
      body: JSON.stringify({ body: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('変更項目が無ければ 400', async () => {
    await post({ body: 'test' });
    const id = listActiveNotices(db)[0]!.id;
    const res = await send(`/notices/${id}`, { method: 'PATCH', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/notices/:id', () => {
  it('削除でき、本文が監査ログから追える', async () => {
    await post({ body: '消される内容' });
    const id = listActiveNotices(db)[0]!.id;

    expect((await send(`/notices/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(listActiveNotices(db)).toHaveLength(0);

    const log = listAuditLogs(db, { action: 'notice.delete' })[0]!;
    expect(JSON.parse(log.before_json!).body).toBe('消される内容');
  });

  it('二重削除は 404', async () => {
    await post({ body: 'test' });
    const id = listActiveNotices(db)[0]!.id;
    await send(`/notices/${id}`, { method: 'DELETE' });
    expect((await send(`/notices/${id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('PATCH /api/admin/settings', () => {
  it('変更でき、監査ログが残る', async () => {
    const res = await send('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ scrollSpeed: 300 }),
    });
    expect(res.status).toBe(200);
    expect(listAuditLogs(db, { action: 'settings.update' })).toHaveLength(1);
  });

  it('範囲外の値は 400', async () => {
    for (const patch of [{ scrollSpeed: 5 }, { scrollSpeed: 2000 }, { fontScale: 1 }, { fontScale: 99 }]) {
      expect((await send('/settings', { method: 'PATCH', body: JSON.stringify(patch) })).status).toBe(400);
    }
    expect(countAuditLogs(db)).toBe(0);
  });

  it('空のフォールバック文言は 400（0件時に何も出なくなるため）', async () => {
    const res = await send('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ fallbackText: '  ' }),
    });
    expect(res.status).toBe(400);
  });

  it('掲示板 API に反映される', async () => {
    await send('/settings', { method: 'PATCH', body: JSON.stringify({ fallbackText: '平和です' }) });
    const res = await app.request('/api/notices');
    const json = (await res.json()) as { settings: { fallbackText: string } };
    expect(json.settings.fallbackText).toBe('平和です');
  });
});

describe('GET /api/admin/audit-logs', () => {
  it('新しい順に返し、種別で絞れる', async () => {
    await post({ body: '1' });
    await send('/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'led' }) });

    const all = (await (await send('/audit-logs')).json()) as { logs: unknown[]; total: number };
    expect(all.total).toBe(2);

    const filtered = (await (await send('/audit-logs?action=notice.create')).json()) as {
      logs: { action: string }[];
    };
    expect(filtered.logs).toHaveLength(1);
    expect(filtered.logs[0]!.action).toBe('notice.create');
  });

  it('不正な種別は無視して全件返す', async () => {
    await post({ body: '1' });
    const res = (await (await send('/audit-logs?action=drop-table')).json()) as { total: number };
    expect(res.total).toBe(1);
  });
});

describe('送信元IP の記録', () => {
  it('X-Forwarded-For の先頭を記録する', async () => {
    await send('/notices', {
      method: 'POST',
      body: JSON.stringify({ body: 'test' }),
      headers: { 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' },
    });
    expect(listAuditLogs(db)[0]!.ip).toBe('203.0.113.9');
  });
});
