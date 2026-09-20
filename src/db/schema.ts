/** DB の行に対応する型。SQLite の値をそのまま写したもの。 */

/** 書き込みの経路。監査ログの source と揃える。 */
export type Source = 'web' | 'bot' | 'api';

export interface NoticeRow {
  id: number;
  body: string;
  expires_at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  author_id: string;
  author_name: string;
  source: Source;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export type AuditAction =
  | 'notice.create'
  | 'notice.update'
  | 'notice.delete'
  | 'settings.update'
  | 'apikey.create'
  | 'apikey.revoke';

export interface AuditLogRow {
  id: number;
  created_at: number;
  actor_id: string;
  actor_name: string;
  action: AuditAction;
  target_type: string;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  source: Source;
  ip: string | null;
}

export interface ApiKeyRow {
  id: number;
  key_hash: string;
  key_prefix: string;
  label: string;
  owner_id: string;
  owner_name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}
