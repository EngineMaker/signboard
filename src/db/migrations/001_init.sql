-- 掲示板の初期スキーマ
-- 方針:
--  * 時刻はすべて UNIX epoch ミリ秒の INTEGER。SQLite に日時型はなく、
--    文字列だと比較とタイムゾーンで事故るため統一する。
--  * 削除は論理削除。SPEC §2.7 で「削除されたお知らせの本文も監査ログから追跡できること」
--    が要件のため、行を物理削除しない。

-- お知らせ
CREATE TABLE notices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  body          TEXT    NOT NULL,

  -- 表示期限。この時刻を過ぎたら掲示板に出さない。
  -- 投稿時に未指定なら作成時刻 + 24時間（SPEC §2.2）。アプリ側で埋めるため NOT NULL。
  expires_at    INTEGER NOT NULL,

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  -- 論理削除。NULL なら生きている。
  deleted_at    INTEGER,

  -- 投稿者（Discord）。表示名は当時の値のスナップショットとして持つ
  -- （後から改名されても「誰が出したか」の記録が壊れないように）。
  author_id     TEXT    NOT NULL,
  author_name   TEXT    NOT NULL,

  -- 投稿経路: 'web' | 'bot' | 'api'
  source        TEXT    NOT NULL CHECK (source IN ('web', 'bot', 'api'))
);

-- 掲示板が毎秒引く「今生きているお知らせ」のための索引。
-- deleted_at IS NULL の部分索引にして、消えた行を索引から外す。
CREATE INDEX idx_notices_active
  ON notices (expires_at, created_at)
  WHERE deleted_at IS NULL;

-- 設定（key-value 1行1項目）
-- 項目が少なく、追加のたびに ALTER TABLE したくないため KVS 形式にする。
-- 値は JSON テキストで保存し、アプリ側で型付けする。
CREATE TABLE settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 監査ログ（SPEC §2.7）
-- 追記のみ。アプリの UI・API からは UPDATE / DELETE しない。
CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    INTEGER NOT NULL,

  -- 実行者
  actor_id      TEXT    NOT NULL,
  actor_name    TEXT    NOT NULL,

  -- 操作種別: notice.create / notice.update / notice.delete
  --           settings.update / apikey.create / apikey.revoke
  action        TEXT    NOT NULL,

  -- 対象の種類と ID（settings なら key、notice なら notices.id）
  target_type   TEXT    NOT NULL,
  target_id     TEXT,

  -- 変更前後のスナップショット（JSON）。作成時は before が NULL、削除時は after が NULL。
  before_json   TEXT,
  after_json    TEXT,

  -- 経路と送信元
  source        TEXT    NOT NULL CHECK (source IN ('web', 'bot', 'api')),
  ip            TEXT
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_action     ON audit_logs (action, created_at DESC);

-- 監査ログの改竄防止をDBレベルでも担保する。
-- アプリのバグや手違いで更新・削除が走っても、ここで止まる。
CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- API キー（SPEC §2.1）
-- 平文は保存しない。発行時に一度だけ表示し、DB には SHA-256 ハッシュのみ置く。
CREATE TABLE api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash    TEXT    NOT NULL UNIQUE,

  -- 判別用の先頭数文字（例 "sb_a1b2"）。一覧で「どのキーか」を示すためだけに使う。
  key_prefix  TEXT    NOT NULL,

  -- 人が付ける名前（例: "ゴミ出し通知スクリプト"）
  label       TEXT    NOT NULL,

  owner_id    TEXT    NOT NULL,
  owner_name  TEXT    NOT NULL,

  created_at  INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at  INTEGER
);

CREATE INDEX idx_api_keys_owner ON api_keys (owner_id) WHERE revoked_at IS NULL;
