import { Hono, type Context as HonoContext } from 'hono';
import type { DB } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import { requireApiKey, type ApiKeyVars } from '../auth/api-key-middleware.ts';
import { listActiveNotices, listNotices } from '../repo/notices.ts';
import { createNotice, deleteNotice, updateNotice } from '../service/notices.ts';

/**
 * APIキーで叩ける公開 API（SPEC §2.1）。
 * 住人が自分のスクリプトから掲示板を操作するためのもの。
 */

export const MAX_BODY_LENGTH = 200;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

type Ctx = HonoContext<{ Variables: ApiKeyVars }>;

function clientIp(c: Ctx): string | null {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? null;
}

function context(c: Ctx, events?: EventBus) {
  return { actor: c.get('actor'), source: 'api' as const, ip: clientIp(c), events };
}

export function publicApiRoutes(db: DB, events?: EventBus) {
  const app = new Hono<{ Variables: ApiKeyVars }>();

  app.use('*', requireApiKey(db));

  /** いま流れているお知らせ。 */
  app.get('/notices', (c) => {
    const all = c.req.query('all') === 'true';
    const notices = all ? listNotices(db, { limit: 200 }) : listActiveNotices(db);

    return c.json({
      notices: notices.map((n) => ({
        id: n.id,
        body: n.body,
        expiresAt: n.expires_at,
        createdAt: n.created_at,
        authorName: n.author_name,
        source: n.source,
      })),
    });
  });

  app.post('/notices', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.body !== 'string') {
      return c.json({ error: 'body（本文）は必須です' }, 400);
    }

    const text = body.body.trim();
    if (text === '') return c.json({ error: '本文が空です' }, 400);
    if (text.length > MAX_BODY_LENGTH) {
      return c.json({ error: `本文は${MAX_BODY_LENGTH}文字以内にしてください` }, 400);
    }

    let expiresAt: number | undefined;
    if (body.expiresAt !== undefined) {
      if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
        return c.json({ error: 'expiresAt は UNIX 時刻（ミリ秒）で指定してください' }, 400);
      }
      if (body.expiresAt <= Date.now()) return c.json({ error: 'expiresAt が過去です' }, 400);
      if (body.expiresAt > Date.now() + MAX_EXPIRY_MS) {
        return c.json({ error: 'expiresAt が遠すぎます（1年以内）' }, 400);
      }
      expiresAt = body.expiresAt;
    }

    const notice = createNotice(db, { body: text, expiresAt }, context(c, events));
    return c.json({ notice: { id: notice.id, body: notice.body, expiresAt: notice.expires_at } }, 201);
  });

  app.patch('/notices/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'ID が不正です' }, 400);

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'JSON が不正です' }, 400);

    const patch: { body?: string; expiresAt?: number } = {};

    if (body.body !== undefined) {
      if (typeof body.body !== 'string' || body.body.trim() === '') {
        return c.json({ error: '本文が空です' }, 400);
      }
      if (body.body.length > MAX_BODY_LENGTH) {
        return c.json({ error: `本文は${MAX_BODY_LENGTH}文字以内にしてください` }, 400);
      }
      patch.body = body.body.trim();
    }

    if (body.expiresAt !== undefined) {
      if (typeof body.expiresAt !== 'number' || body.expiresAt <= Date.now()) {
        return c.json({ error: 'expiresAt が不正です' }, 400);
      }
      patch.expiresAt = body.expiresAt;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: '変更する項目がありません' }, 400);
    }

    const notice = updateNotice(db, id, patch, context(c, events));
    if (!notice) return c.json({ error: 'お知らせが見つかりません' }, 404);

    return c.json({ notice: { id: notice.id, body: notice.body, expiresAt: notice.expires_at } });
  });

  app.delete('/notices/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'ID が不正です' }, 400);

    const notice = deleteNotice(db, id, context(c, events));
    if (!notice) return c.json({ error: 'お知らせが見つかりません' }, 404);

    return c.json({ deleted: { id: notice.id, body: notice.body } });
  });

  return app;
}
