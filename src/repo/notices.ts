import type { DB } from '../db/index.ts';
import type { NoticeRow, Source } from '../db/schema.ts';

/** 期限を指定せずに投稿されたお知らせの寿命（SPEC §2.2）。 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateNoticeInput {
  body: string;
  /** 未指定なら now + DEFAULT_TTL_MS */
  expiresAt?: number;
  authorId: string;
  authorName: string;
  source: Source;
}

export interface UpdateNoticeInput {
  body?: string;
  expiresAt?: number;
}

export function createNotice(db: DB, input: CreateNoticeInput, now = Date.now()): NoticeRow {
  const expiresAt = input.expiresAt ?? now + DEFAULT_TTL_MS;

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO notices (body, expires_at, created_at, updated_at, author_id, author_name, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.body, expiresAt, now, now, input.authorId, input.authorName, input.source);

  return getNotice(db, Number(lastInsertRowid))!;
}

/** ID で1件取得。論理削除済みも返す（監査ログからの追跡に使うため）。 */
export function getNotice(db: DB, id: number): NoticeRow | undefined {
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(id) as NoticeRow | undefined;
}

/**
 * 掲示板に今流すべきお知らせ。
 * 論理削除済みと期限切れを除き、古いものから順に返す（投稿順にローテーションする）。
 */
export function listActiveNotices(db: DB, now = Date.now()): NoticeRow[] {
  return db
    .prepare(
      `SELECT * FROM notices
       WHERE deleted_at IS NULL AND expires_at > ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(now) as NoticeRow[];
}

/**
 * 管理画面用の一覧。期限切れも含めるが、論理削除済みは既定で除く。
 * 新しいものから順に返す。
 */
export function listNotices(
  db: DB,
  opts: { includeDeleted?: boolean; limit?: number; offset?: number } = {},
): NoticeRow[] {
  const { includeDeleted = false, limit = 100, offset = 0 } = opts;
  const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
  return db
    .prepare(`SELECT * FROM notices ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as NoticeRow[];
}

/**
 * 本文・期限を更新する。論理削除済みの行は更新しない。
 * 存在しない・削除済みの場合は undefined。
 */
export function updateNotice(
  db: DB,
  id: number,
  input: UpdateNoticeInput,
  now = Date.now(),
): NoticeRow | undefined {
  const current = getNotice(db, id);
  if (!current || current.deleted_at !== null) return undefined;

  const body = input.body ?? current.body;
  const expiresAt = input.expiresAt ?? current.expires_at;

  db.prepare('UPDATE notices SET body = ?, expires_at = ?, updated_at = ? WHERE id = ?')
    .run(body, expiresAt, now, id);

  return getNotice(db, id);
}

/**
 * 論理削除する。行は消さない（SPEC §2.7: 削除後も監査ログから本文を追える）。
 * 既に削除済み・存在しない場合は undefined。
 */
export function deleteNotice(db: DB, id: number, now = Date.now()): NoticeRow | undefined {
  const current = getNotice(db, id);
  if (!current || current.deleted_at !== null) return undefined;

  db.prepare('UPDATE notices SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  return getNotice(db, id);
}
