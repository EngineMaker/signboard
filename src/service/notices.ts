import type { DB } from '../db/index.ts';
import type { NoticeRow, Source } from '../db/schema.ts';
import type { EventBus } from '../events/bus.ts';
import { recordAudit, type Actor } from '../repo/audit.ts';
import {
  createNotice as repoCreate,
  deleteNotice as repoDelete,
  getNotice,
  updateNotice as repoUpdate,
  type UpdateNoticeInput,
} from '../repo/notices.ts';

/**
 * お知らせの書き込み操作。
 *
 * **すべての書き込みはこの層を通すこと。** repo を直接呼ぶと監査ログが残らない。
 * 操作と記録は同一トランザクションで行い、「操作は成功したがログが無い」状態を作らない。
 */

export interface Context {
  actor: Actor;
  source: Source;
  ip?: string | null;
  /** 変更を SSE で配るためのバス。省略時は配信しない（テストや CLI 用）。 */
  events?: EventBus;
}

/** 監査ログに載せるお知らせのスナップショット。 */
function snapshot(n: NoticeRow) {
  return {
    id: n.id,
    body: n.body,
    expiresAt: n.expires_at,
    authorName: n.author_name,
    deletedAt: n.deleted_at,
  };
}

export interface CreateInput {
  body: string;
  expiresAt?: number;
}

export function createNotice(
  db: DB,
  input: CreateInput,
  ctx: Context,
  now = Date.now(),
): NoticeRow {
  const notice = db.transaction(() => {
    const notice = repoCreate(
      db,
      {
        body: input.body,
        expiresAt: input.expiresAt,
        authorId: ctx.actor.id,
        authorName: ctx.actor.name,
        source: ctx.source,
      },
      now,
    );

    recordAudit(
      db,
      {
        actor: ctx.actor,
        action: 'notice.create',
        targetType: 'notice',
        targetId: notice.id,
        after: snapshot(notice),
        source: ctx.source,
        ip: ctx.ip,
      },
      now,
    );

    return notice;
  })();

  notify(ctx);
  return notice;
}

/**
 * 変更をリアルタイムに配る。トランザクションの外で呼ぶこと
 * （コミット前に通知すると、受け手が古い内容を読んでしまう）。
 */
function notify(ctx: Context): void {
  ctx.events?.emit('notices-changed');
}

export function updateNotice(
  db: DB,
  id: number,
  input: UpdateNoticeInput,
  ctx: Context,
  now = Date.now(),
): NoticeRow | undefined {
  const result = db.transaction(() => {
    const before = getNotice(db, id);
    if (!before || before.deleted_at !== null) return undefined;

    const after = repoUpdate(db, id, input, now);
    if (!after) return undefined;

    recordAudit(
      db,
      {
        actor: ctx.actor,
        action: 'notice.update',
        targetType: 'notice',
        targetId: id,
        before: snapshot(before),
        after: snapshot(after),
        source: ctx.source,
        ip: ctx.ip,
      },
      now,
    );

    return after;
  })();

  if (result) notify(ctx);
  return result;
}

export function deleteNotice(
  db: DB,
  id: number,
  ctx: Context,
  now = Date.now(),
): NoticeRow | undefined {
  const result = db.transaction(() => {
    const before = getNotice(db, id);
    if (!before || before.deleted_at !== null) return undefined;

    const after = repoDelete(db, id, now);
    if (!after) return undefined;

    recordAudit(
      db,
      {
        actor: ctx.actor,
        action: 'notice.delete',
        targetType: 'notice',
        targetId: id,
        // 削除されたお知らせの本文を後から追えるようにする（SPEC §2.7）
        before: snapshot(before),
        source: ctx.source,
        ip: ctx.ip,
      },
      now,
    );

    return after;
  })();

  if (result) notify(ctx);
  return result;
}
