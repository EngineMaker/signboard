#!/usr/bin/env bash
#
# signboard をサーバーに導入する。何度実行しても同じ状態になる（冪等）。
#
# sudo は使わない。systemd の user unit と ~/.config 配下だけで完結する。
# 事前に infra/preflight.sh で前提を確認すること。
#
# 使い方:
#   bash infra/setup.sh            # 導入・更新
#   bash infra/setup.sh --no-start # ファイル配置のみ（起動しない）

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/signboard}"
UNIT_DIR="$HOME/.config/systemd/user"
CF_DIR="$HOME/.cloudflared"
START=1

for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    *) echo "不明な引数: $arg" >&2; exit 1 ;;
  esac
done

# スクリプト自身の位置からリポジトリのルートを求める
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '  %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 内容が変わったときだけ書き、変わらなければ触らない（冪等性の要）
install_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    log "変更なし: $dest"
    return 1
  fi
  cp "$src" "$dest"
  log "配置: $dest"
  return 0
}

step "1. アプリの配置"

if [[ "$REPO_DIR" != "$APP_DIR" ]]; then
  log "リポジトリ: $REPO_DIR"
  log "配置先とは別の場所で実行されています。"
  log "サーバーでは $APP_DIR に clone して、その中の infra/setup.sh を実行してください。"
  exit 1
fi
log "$APP_DIR"

step "2. 依存パッケージ"

cd "$APP_DIR"
if [[ -d node_modules ]] && [[ package-lock.json -ot node_modules ]]; then
  log "変更なし（package-lock.json より node_modules が新しい）"
else
  npm ci --omit=dev 2>&1 | tail -3 | sed 's/^/  /'
fi

step "3. データベース"

npm run migrate 2>&1 | tail -2 | sed 's/^/  /'

step "4. Node の場所を記録"

# systemd は対話シェルの PATH を引き継がない。mise や nvm で入れた node は
# /usr/bin/node（古いことがある）に隠されるため、絶対パスを unit に渡す。
NODE_BIN="$(command -v node)"
node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"

if (( node_major < 22 )); then
  echo "Node.js 22 以上が必要です（現在: $(node --version) at $NODE_BIN）" >&2
  exit 1
fi

log "$NODE_BIN ($(node --version))"

node_env="$UNIT_DIR/signboard.env"
mkdir -p "$UNIT_DIR"
tmp_env="$(mktemp)"
printf 'NODE_BIN=%s\n' "$NODE_BIN" > "$tmp_env"
if [[ -f "$node_env" ]] && cmp -s "$tmp_env" "$node_env"; then
  log "変更なし: $node_env"
  rm -f "$tmp_env"
else
  mv "$tmp_env" "$node_env"
  log "記録: $node_env"
  changed_node=1
fi

step "5. systemd unit"

changed=${changed_node:-0}
install_file "$APP_DIR/infra/systemd/signboard.service" "$UNIT_DIR/signboard.service" && changed=1
install_file "$APP_DIR/infra/backup/signboard-backup.service" "$UNIT_DIR/signboard-backup.service" && changed=1
install_file "$APP_DIR/infra/backup/signboard-backup.timer" "$UNIT_DIR/signboard-backup.timer" && changed=1

if [[ -f "$CF_DIR/signboard.json" ]]; then
  install_file "$APP_DIR/infra/cloudflared/signboard-tunnel.service" "$UNIT_DIR/signboard-tunnel.service" && changed=1
  install_file "$APP_DIR/infra/cloudflared/config.yml" "$CF_DIR/config.yml" && changed=1
else
  log "Tunnel の認証情報が無いため cloudflared の設定は飛ばします"
  log "（docs/OPERATIONS.md の手順で取得してから再実行してください）"
fi

if (( changed )); then
  systemctl --user daemon-reload
  log "daemon-reload 実行"
fi

step "6. 有効化"

enable_unit() {
  local unit="$1"
  if systemctl --user is-enabled "$unit" >/dev/null 2>&1; then
    log "有効済み: $unit"
  else
    systemctl --user enable "$unit" >/dev/null 2>&1
    log "有効化: $unit"
  fi
}

enable_unit signboard.service
enable_unit signboard-backup.timer
[[ -f "$UNIT_DIR/signboard-tunnel.service" ]] && enable_unit signboard-tunnel.service

if (( START )); then
  step "7. 起動"

  systemctl --user restart signboard
  log "signboard を再起動しました"

  systemctl --user start signboard-backup.timer
  log "バックアップタイマーを開始しました"

  if [[ -f "$UNIT_DIR/signboard-tunnel.service" ]]; then
    systemctl --user restart signboard-tunnel
    log "Tunnel を再起動しました"
  fi

  # 起動を待って健全性を確かめる
  port="${PORT:-3100}"
  for _ in $(seq 1 30); do
    if curl -sf "http://localhost:$port/healthz" >/dev/null 2>&1; then
      log "起動確認: http://localhost:$port/healthz が応答しました"
      break
    fi
    sleep 1
  done

  if ! curl -sf "http://localhost:$port/healthz" >/dev/null 2>&1; then
    echo
    echo "起動を確認できませんでした。ログを見てください:" >&2
    echo "  journalctl --user -u signboard -n 50 --no-pager" >&2
    exit 1
  fi
fi

step "完了"
log "状態:   systemctl --user status signboard"
log "ログ:   journalctl --user -u signboard -f"
log "更新:   cd $APP_DIR && git pull && bash infra/setup.sh"
