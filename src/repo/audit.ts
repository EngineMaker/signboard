import type { DB } from '../db/index.ts';
import type { AuditAction, AuditLogRow, Source } from '../db/schema.ts';

export interface Actor {
  id: string;
  name: string;
}

export interface RecordAuditInput {
  actor: Actor;
  action: AuditAction;
  targetType: string;
  targetId?: string | number | null;
  /** 変更前の状態。作成時は undefined。 */
  before?: unknown;
  /** 変更後の状態。削除時は undefined。 */
  after?: unknown;
  source: Source;
  ip?: string | null;
}

/**
 * 監査ログを1件記録する（SPEC §2.7）。
 *
 * この関数を直接呼ぶのではなく、`src/service/` 経由で書き込むこと。
 * サービス層が「操作」と「記録」を1トランザクションにまとめており、
 * 記録漏れが起きないようにしている。
 */
export function recordAudit(db: DB, input: RecordAuditInput, now = Date.now()): void {
  db.prepare(
    `INSERT INTO audit_logs
       (created_at, actor_id, actor_name, action, target_type, target_id, before_json, after_json, source, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    now,
    input.actor.id,
    input.actor.name,
    input.action,
    input.targetType,
    input.targetId == null ? null : String(input.targetId),
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.source,
    input.ip ?? null,
  );
}

export interface ListAuditOptions {
  /** 操作種別で絞る */
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

/** 監査ログを新しい順に返す（SPEC §2.7: 閲覧は新しい順、種別で絞り込み）。 */
export function listAuditLogs(db: DB, opts: ListAuditOptions = {}): AuditLogRow[] {
  const { action, limit = 100, offset = 0 } = opts;

  if (action) {
    return db
      .prepare(
        'SELECT * FROM audit_logs WHERE action = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      )
      .all(action, limit, offset) as AuditLogRow[];
  }

  return db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as AuditLogRow[];
}

export function countAuditLogs(db: DB, action?: AuditAction): number {
  const row = action
    ? db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE action = ?').get(action)
    : db.prepare('SELECT COUNT(*) c FROM audit_logs').get();
  return (row as { c: number }).c;
}
