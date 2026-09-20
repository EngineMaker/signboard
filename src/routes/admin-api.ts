import { Hono, type Context as HonoContext } from 'hono';
import type { DB } from '../db/index.ts';
import type { AuthConfig } from '../config.ts';
import { requireAuth, type AuthVars } from '../auth/middleware.ts';
import { listAuditLogs, countAuditLogs } from '../repo/audit.ts';
import { getNotice, listNotices } from '../repo/notices.ts';
import { getSettings, DEFAULT_SETTINGS, type Settings } from '../repo/settings.ts';
import { createNotice, deleteNotice, updateNotice } from '../service/notices.ts';
import { updateSettings } from '../service/settings.ts';
import type { AuditAction } from '../db/schema.ts';
import type { EventBus } from '../events/bus.ts';

/** 本文の上限（TBD-4）。電光掲示板を一周するのに長すぎない範囲。 */
export const MAX_BODY_LENGTH = 200;

/** 期限として受け付ける最長。これ以上先は入力ミスとみなす。 */
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

const AUDIT_ACTIONS = [
  'notice.create',
  'notice.update',
  'notice.delete',
  'settings.update',
  'apikey.create',
  'apikey.revoke',
] as const;

type Ctx = HonoContext<{ Variables: AuthVars }>;

/** 送信元IP。リバースプロキシ配下では X-Forwarded-For の先頭を使う。 */
function clientIp(c: Ctx): string | null {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? null;
}

/** 操作の文脈（誰が・どこから）。監査ログに載り、変更は SSE で配られる。 */
function context(c: Ctx, events?: EventBus) {
  const session = c.get('session');
  return {
    actor: { id: session.userId, name: session.userName },
    source: 'web' as const,
    ip: clientIp(c),
    events,
  };
}

export function adminApiRoutes(db: DB, auth: AuthConfig, events?: EventBus) {
  const app = new Hono<{ Variables: AuthVars }>();

  // 以降すべてログイン必須
  app.use('*', requireAuth(auth));

  // ---- お知らせ ----

  app.get('/notices', (c) => {
    const includeDeleted = c.req.query('includeDeleted') === 'true';
    const notices = listNotices(db, { includeDeleted, limit: 200 });
    return c.json({ notices, now: Date.now() });
  });

  app.post('/notices', async (c) => {
    const body = await c.req.json().catch(() => null);
    const err = validateNoticeInput(body, { requireBody: true });
    if (err) return c.json({ error: err }, 400);

    const notice = createNotice(
      db,
      { body: (body as { body: string }).body.trim(), expiresAt: (body as { expiresAt?: number }).expiresAt },
      context(c, events),
    );
    return c.json({ notice }, 201);
  });

  app.patch('/notices/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'ID が不正です' }, 400);

    const body = await c.req.json().catch(() => null);
    const err = validateNoticeInput(body, { requireBody: false });
    if (err) return c.json({ error: err }, 400);

    const input = body as { body?: string; expiresAt?: number };
    const notice = updateNotice(
      db,
      id,
      { body: input.body?.trim(), expiresAt: input.expiresAt },
      context(c, events),
    );
    if (!notice) return c.json({ error: 'お知らせが見つかりません' }, 404);

    return c.json({ notice });
  });

  app.delete('/notices/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'ID が不正です' }, 400);

    const notice = deleteNotice(db, id, context(c, events));
    if (!notice) return c.json({ error: 'お知らせが見つかりません' }, 404);

    return c.json({ notice });
  });

  // ---- 設定 ----

  app.get('/settings', (c) => c.json({ settings: getSettings(db) }));

  app.patch('/settings', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'JSON が不正です' }, 400);

    const patch: Partial<Settings> = {};
    const input = body as Record<string, unknown>;

    if ('scrollSpeed' in input) {
      const v = input.scrollSpeed;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 10 || v > 1000) {
        return c.json({ error: 'スクロール速度は 10〜1000 の数値で指定してください' }, 400);
      }
      patch.scrollSpeed = v;
    }
    if ('fontScale' in input) {
      const v = input.fontScale;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 4 || v > 40) {
        return c.json({ error: '文字サイズは 4〜40 の数値で指定してください' }, 400);
      }
      patch.fontScale = v;
    }
    if ('theme' in input) {
      const v = input.theme;
      if (typeof v !== 'string' || v.length > 32) {
        return c.json({ error: 'テーマ名が不正です' }, 400);
      }
      patch.theme = v;
    }
    if ('fallbackText' in input) {
      const v = input.fallbackText;
      if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_BODY_LENGTH) {
        return c.json(
          { error: `フォールバック文言は1〜${MAX_BODY_LENGTH}文字で指定してください` },
          400,
        );
      }
      patch.fallbackText = v.trim();
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: '変更する項目がありません' }, 400);
    }

    return c.json({ settings: updateSettings(db, patch, context(c, events)) });
  });

  app.get('/settings/defaults', (c) => c.json({ defaults: DEFAULT_SETTINGS }));

  // ---- 監査ログ ----

  app.get('/audit-logs', (c) => {
    const actionParam = c.req.query('action');
    const action = AUDIT_ACTIONS.includes(actionParam as AuditAction)
      ? (actionParam as AuditAction)
      : undefined;

    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

    return c.json({
      logs: listAuditLogs(db, { action, limit, offset }),
      total: countAuditLogs(db, action),
      actions: AUDIT_ACTIONS,
    });
  });

  return app;
}

/** お知らせの入力検証。エラーメッセージを返し、問題なければ null。 */
function validateNoticeInput(body: unknown, opts: { requireBody: boolean }): string | null {
  if (!body || typeof body !== 'object') return 'JSON が不正です';
  const input = body as Record<string, unknown>;

  const hasBody = 'body' in input;
  if (opts.requireBody && !hasBody) return '本文は必須です';

  if (hasBody) {
    const v = input.body;
    if (typeof v !== 'string' || v.trim() === '') return '本文を入力してください';
    if (v.length > MAX_BODY_LENGTH) return `本文は${MAX_BODY_LENGTH}文字以内にしてください`;
  }

  if ('expiresAt' in input && input.expiresAt !== undefined) {
    const v = input.expiresAt;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '期限が不正です';
    if (v <= Date.now()) return '期限は現在より後にしてください';
    if (v > Date.now() + MAX_EXPIRY_MS) return '期限が遠すぎます（1年以内）';
  }

  if (!opts.requireBody && !hasBody && !('expiresAt' in input)) {
    return '変更する項目がありません';
  }

  return null;
}

export { getNotice };
