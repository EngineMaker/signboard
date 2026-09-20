#!/usr/bin/env bash
#
# SQLite のバックアップを取る。
#
# 稼働中のDBを cp すると WAL の途中を掴んで壊れたコピーになりうるため、
# sqlite3 の VACUUM INTO を使う。単一ファイルの整合したスナップショットが得られる。
#
# 使い方: bash infra/backup/backup.sh [保存先ディレクトリ]

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/signboard}"
DB_PATH="${DB_PATH:-$APP_DIR/data/signboard.sqlite}"
BACKUP_DIR="${1:-${BACKUP_DIR:-$HOME/backups/signboard}}"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "DB が見つかりません: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/signboard-$timestamp.sqlite"

# VACUUM INTO は書き込みロックを取らず、整合したコピーを作る
sqlite3 "$DB_PATH" "VACUUM INTO '$dest'"

gzip -f "$dest"
echo "バックアップ: $dest.gz ($(du -h "$dest.gz" | cut -f1))"

# 古い世代を消す
deleted=$(find "$BACKUP_DIR" -name 'signboard-*.sqlite.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
if [[ "$deleted" -gt 0 ]]; then
  echo "$deleted 件の古いバックアップを削除しました（${KEEP_DAYS}日より前）"
fi

# 直近のバックアップが読めることを確かめる。取れているつもりで壊れていた、を防ぐ。
if ! gzip -t "$dest.gz"; then
  echo "警告: バックアップファイルが壊れています" >&2
  exit 1
fi

echo "現在の世代数: $(find "$BACKUP_DIR" -name 'signboard-*.sqlite.gz' | wc -l)"
