import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthConfig } from '../src/config.ts';
import type { DB } from '../src/db/index.ts';
import { EventBus } from '../src/events/bus.ts';
import { SESSION_COOKIE } from '../src/auth/middleware.ts';
import { encodeSession } from '../src/auth/session.ts';
import { createNotice, deleteNotice, updateNotice } from '../src/service/notices.ts';
import { updateSettings } from '../src/service/settings.ts';
import { T0, testDb } from './helpers.ts';

describe('EventBus', () => {
  it('購読者にイベントを配る', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.name));

    bus.emit('notices-changed');
    bus.emit('settings-changed');

    expect(seen).toEqual(['notices-changed', 'settings-changed']);
  });

  it('複数の購読者すべてに配る', () => {
    const bus = new EventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.name));
    bus.subscribe((e) => b.push(e.name));

    bus.emit('notices-changed');

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('解除すると届かなくなる', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.name));

    bus.emit('notices-changed');
    off();
    bus.emit('notices-changed');

    expect(seen).toHaveLength(1);
    expect(bus.size).toBe(0);
  });

  it('1つの購読者が例外を投げても他に配る', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('切断済み');
    });
    bus.subscribe((e) => seen.push(e.name));

    expect(() => bus.emit('notices-changed')).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('サービス層がイベントを発行する', () => {
  let db: DB;
  let bus: EventBus;
  let seen: string[];

  beforeEach(() => {
    db = testDb();
    bus = new EventBus();
    seen = [];
    bus.subscribe((e) => seen.push(e.name));
  });

  const ctx = () => ({
    actor: { id: '111', name: 'けーえむ' },
    source: 'web' as const,
    events: bus,
  });

  it('投稿で notices-changed', () => {
    createNotice(db, { body: 'test' }, ctx(), T0);
    expect(seen).toEqual(['notices-changed']);
  });

  it('編集で notices-changed', () => {
    const n = createNotice(db, { body: 'old' }, ctx(), T0);
    seen.length = 0;
    updateNotice(db, n.id, { body: 'new' }, ctx(), T0 + 1000);
    expect(seen).toEqual(['notices-changed']);
  });

  it('削除で notices-changed', () => {
    const n = createNotice(db, { body: 'test' }, ctx(), T0);
    seen.length = 0;
    deleteNotice(db, n.id, ctx(), T0 + 1000);
    expect(seen).toEqual(['notices-changed']);
  });

  it('設定変更で settings-changed', () => {
    updateSettings(db, { scrollSpeed: 300 }, ctx(), T0);
    expect(seen).toEqual(['settings-changed']);
  });

  it('失敗した操作では発行しない', () => {
    updateNotice(db, 9999, { body: 'x' }, ctx(), T0);
    deleteNotice(db, 9999, ctx(), T0);
    expect(seen).toEqual([]);
  });

  it('二重削除の2回目は発行しない', () => {
    const n = createNotice(db, { body: 'test' }, ctx(), T0);
    deleteNotice(db, n.id, ctx(), T0 + 1000);
    seen.length = 0;
    deleteNotice(db, n.id, ctx(), T0 + 2000);
    expect(seen).toEqual([]);
  });

  it('値が変わらない設定更新では発行しない', () => {
    updateSettings(db, { scrollSpeed: 220 }, ctx(), T0); // 既定値と同じ
    expect(seen).toEqual([]);
  });

  it('events を渡さなければ発行しない（CLI やテスト用）', () => {
    createNotice(db, { body: 'test' }, { actor: { id: '1', name: 'x' }, source: 'bot' }, T0);
    expect(seen).toEqual([]);
  });
});

describe('GET /api/stream', () => {
  const auth: AuthConfig = {
    clientId: 'c',
    clientSecret: 's',
    botToken: 'b',
    guildId: 'g',
    residentRoleId: 'r',
    sessionSecret: 'session-secret',
    redirectUri: 'http://localhost:3100/auth/callback',
  };

  it('SSE のヘッダを返す', async () => {
    const app = createApp(testDb());
    const res = await app.request('/api/stream');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('接続直後に connected を送る', async () => {
    const app = createApp(testDb());
    const res = await app.request('/api/stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('event: connected');
    await reader.cancel();
  });

  it('書き込みが起きると通知が流れる', async () => {
    const db = testDb();
    const events = new EventBus();
    const app = createApp(db, { auth, baseUrl: 'http://localhost:3100', events });

    const res = await app.request('/api/stream');
    const reader = res.body!.getReader();
    await reader.read(); // connected

    // 管理APIから投稿する
    const token = encodeSession(
      { userId: '111', userName: 'けーえむ', issuedAt: Date.now() },
      auth.sessionSecret,
    );
    void app.request('/api/admin/notices', {
      method: 'POST',
      body: JSON.stringify({ body: 'リアルタイムのテスト' }),
      headers: { Cookie: `${SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json' },
    });

    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('event: notices-changed');
    await reader.cancel();
  });

  it('切断すると購読が解除される', async () => {
    const events = new EventBus();
    const app = createApp(testDb(), { events });

    const res = await app.request('/api/stream');
    const reader = res.body!.getReader();
    await reader.read();
    expect(events.size).toBe(1);

    await reader.cancel();
    // 解除は非同期に走るため少し待つ
    await vi.waitFor(() => expect(events.size).toBe(0), { timeout: 2000 });
  });
});
