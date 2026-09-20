import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { DB } from '../src/db/index.ts';
import { createNotice, deleteNotice } from '../src/repo/notices.ts';
import { DEFAULT_SETTINGS, updateSettings } from '../src/repo/settings.ts';
import { HOUR, testDb } from './helpers.ts';

let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = testDb();
  app = createApp(db);
});

const base = { authorId: '111', authorName: 'けーえむ', source: 'web' as const };

interface NoticesResponse {
  notices: { id: number; body: string; authorName: string }[];
  settings: typeof DEFAULT_SETTINGS;
  serverTime: number;
}

const get = async (): Promise<NoticesResponse> => {
  const res = await app.request('/api/notices');
  expect(res.status).toBe(200);
  return (await res.json()) as NoticesResponse;
};

describe('GET /api/notices', () => {
  it('お知らせが無ければ空配列と既定設定を返す', async () => {
    const body = await get();
    expect(body.notices).toEqual([]);
    expect(body.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('有効なお知らせを投稿順に返す', async () => {
    const now = Date.now();
    createNotice(db, { ...base, body: '1番目' }, now - 2000);
    createNotice(db, { ...base, body: '2番目' }, now - 1000);

    expect((await get()).notices.map((n) => n.body)).toEqual(['1番目', '2番目']);
  });

  it('期限切れを返さない', async () => {
    const now = Date.now();
    createNotice(db, { ...base, body: '有効' }, now);
    createNotice(db, { ...base, body: '期限切れ', expiresAt: now - HOUR }, now - 2 * HOUR);

    expect((await get()).notices.map((n) => n.body)).toEqual(['有効']);
  });

  it('削除済みを返さない', async () => {
    const n = createNotice(db, { ...base, body: '消す' });
    createNotice(db, { ...base, body: '残る' });
    deleteNotice(db, n.id);

    expect((await get()).notices.map((n) => n.body)).toEqual(['残る']);
  });

  it('設定の変更が反映される', async () => {
    updateSettings(db, { scrollSpeed: 200, fallbackText: '平和です' });
    const body = await get();
    expect(body.settings.scrollSpeed).toBe(200);
    expect(body.settings.fallbackText).toBe('平和です');
  });

  it('サーバー時刻を含む（端末の時計ずれ検出用）', async () => {
    const body = await get();
    expect(body.serverTime).toBeGreaterThan(1_700_000_000_000);
  });

  it('投稿者名を含むが、内部IDは漏らさない', async () => {
    createNotice(db, { ...base, body: 'test' });
    const notice = (await get()).notices[0]!;
    expect(notice.authorName).toBe('けーえむ');
    expect(notice).not.toHaveProperty('author_id');
  });
});
