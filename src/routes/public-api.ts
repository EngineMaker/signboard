import { Hono, type Context as HonoContext } from 'hono';
import type { DB } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import { requireApiKey, type ApiKeyVars } from '../auth/api-key-middleware.ts';
import { getNotice, listActiveNotices, listNotices } from '../repo/notices.ts';
import { createNotice, deleteNotice, updateNotice } from '../service/notices.ts';

/**
 * APIキーで叩ける公開 API（SPEC §2.1）。
 * 住人が自分のスクリプトから掲示板を操作するためのもの。
 */

export const MAX_BODY_LENGTH = 200;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

/** expiresAt の検証。POST と PATCH で同じ規則を使う。問題なければ null。 */
function validateExpiresAt(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return 'expiresAt は UNIX 時刻（ミリ秒）で指定してください';
  }
  if (v <= Date.now()) return 'expiresAt が過去です';
  if (v > Date.now() + MAX_EXPIRY_MS) return 'expiresAt が遠すぎます（1年以内）';
  return null;
}

/**
 * 404 の理由。スクリプトが文言に頼らず見分けられるよう、変えない値として返す（D-037）。
 * 期限切れ（expired）は PATCH のときだけ返す。DELETE は期限切れでも消せる。
 */
type NotFoundCode = 'not_found' | 'deleted' | 'expired';

const NOT_FOUND_MESSAGES: Record<NotFoundCode, string> = {
  not_found: 'お知らせが見つかりません',
  deleted: 'お知らせは削除済みです',
  expired: 'お知らせは期限切れです',
};

function notFound(c: Ctx, code: NotFoundCode) {
  return c.json({ error: NOT_FOUND_MESSAGES[code], code }, 404);
}

/** PATCH・DELETE の対象が無いときの理由。対象があれば null。 */
function missingReason(db: DB, id: number, opts: { rejectExpired: boolean }): NotFoundCode | null {
  const current = getNotice(db, id);
  if (!current) return 'not_found';
  if (current.deleted_at !== null) return 'deleted';
  if (opts.rejectExpired && current.expires_at <= Date.now()) return 'expired';
  return null;
}

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
      const err = validateExpiresAt(body.expiresAt);
      if (err) return c.json({ error: err }, 400);
      expiresAt = body.expiresAt as number;
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
      const err = validateExpiresAt(body.expiresAt);
      if (err) return c.json({ error: err }, 400);
      patch.expiresAt = body.expiresAt as number;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: '変更する項目がありません' }, 400);
    }

    // 期限切れは「もう無いもの」として扱う。GET の既定と揃え、
    // 期限の延長で消えたお知らせが復活しないようにする（D-036）
    const missing = missingReason(db, id, { rejectExpired: true });
    if (missing) return notFound(c, missing);

    const notice = updateNotice(db, id, patch, context(c, events));
    if (!notice) return notFound(c, 'not_found');

    return c.json({ notice: { id: notice.id, body: notice.body, expiresAt: notice.expires_at } });
  });

  app.delete('/notices/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'ID が不正です' }, 400);

    const missing = missingReason(db, id, { rejectExpired: false });
    if (missing) return notFound(c, missing);

    const notice = deleteNotice(db, id, context(c, events));
    if (!notice) return notFound(c, 'not_found');

    return c.json({ deleted: { id: notice.id, body: notice.body } });
  });

  return app;
}
