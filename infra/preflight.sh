#!/usr/bin/env bash
#
# デプロイ前の前提チェック。setup.sh を流す前に実行する。
# 何も変更しない。足りないものを一覧するだけ。
#
# 使い方: bash infra/preflight.sh

set -uo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/signboard}"
PORT="${PORT:-3100}"

pass=0
fail=0

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \033[32mOK\033[0m   %s\n' "$label"
    pass=$((pass + 1))
  else
    printf '  \033[31mNG\033[0m   %s\n' "$label"
    fail=$((fail + 1))
  fi
}

# 値も見せたいものはこちら
report() {
  local label="$1" value="$2" ok="$3"
  if [[ "$ok" == "yes" ]]; then
    printf '  \033[32mOK\033[0m   %-36s %s\n' "$label" "$value"
    pass=$((pass + 1))
  else
    printf '  \033[31mNG\033[0m   %-36s %s\n' "$label" "$value"
    fail=$((fail + 1))
  fi
}

echo "signboard デプロイ前チェック"
echo

echo "[実行環境]"
node_version="$(node --version 2>/dev/null || echo なし)"
node_major="$(printf '%s' "$node_version" | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 22 )); then
  report "Node.js (>= 22)" "$node_version" yes
else
  report "Node.js (>= 22)" "$node_version" no
fi

# systemd は対話シェルの PATH を引き継がない。mise/nvm の node が
# /usr/bin の古い node に隠れると、起動時に --experimental-strip-types で落ちる。
# setup.sh は絶対パスを unit に渡すので実害は無いが、状況を見せておく。
node_path="$(command -v node 2>/dev/null || echo なし)"
systemd_node="$(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  bash -c 'command -v node >/dev/null 2>&1 && node --version' 2>/dev/null || echo なし)"
if [[ "$systemd_node" != "$node_version" ]]; then
  printf '  \033[33m--\033[0m   %-36s %s\n' "systemd の PATH で見える node" "$systemd_node（setup.sh が $node_path を使うよう設定します）"
else
  printf '  \033[32mOK\033[0m   %-36s %s\n' "systemd の PATH で見える node" "$systemd_node"
fi

check "npm" command -v npm
check "git" command -v git
check "sqlite3（バックアップに必要）" command -v sqlite3
check "cloudflared（外部公開に必要）" command -v cloudflared

echo
echo "[systemd]"
check "systemctl --user が使える" systemctl --user show-environment

linger="$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || echo unknown)"
if [[ "$linger" == "yes" ]]; then
  report "lingering（ログアウト後も常駐）" "$linger" yes
else
  report "lingering（ログアウト後も常駐）" "$linger（要: loginctl enable-linger $(id -un)）" no
fi

echo
echo "[配置]"
if [[ -d "$APP_DIR" ]]; then
  report "アプリの配置先" "$APP_DIR" yes
else
  report "アプリの配置先" "$APP_DIR（未作成。setup.sh が作ります）" yes
fi

if [[ -f "$APP_DIR/.env" ]]; then
  missing=""
  for key in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN \
             DISCORD_GUILD_ID DISCORD_RESIDENT_ROLE_ID SESSION_SECRET BASE_URL; do
    grep -qE "^${key}=.+" "$APP_DIR/.env" || missing="$missing $key"
  done
  if [[ -z "$missing" ]]; then
    report ".env の必須項目" "すべて設定済み" yes
  else
    report ".env の必須項目" "不足:$missing" no
  fi
else
  report ".env" "未作成（$APP_DIR/.env が必要）" no
fi

echo
echo "[ネットワーク]"
if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  # 自分自身が動いている場合は問題ない
  if systemctl --user is-active signboard >/dev/null 2>&1; then
    report "ポート $PORT" "signboard が使用中（更新時は正常）" yes
  else
    report "ポート $PORT" "別のプロセスが使用中" no
  fi
else
  report "ポート $PORT" "空き" yes
fi

if [[ -f "$HOME/.cloudflared/signboard.json" ]]; then
  report "Tunnel の認証情報" "$HOME/.cloudflared/signboard.json" yes
else
  report "Tunnel の認証情報" "未取得（docs/OPERATIONS.md 参照）" no
fi

echo
printf 'OK: %d / NG: %d\n' "$pass" "$fail"

if (( fail > 0 )); then
  echo
  echo "NG の項目を解消してから setup.sh を実行してください。"
  exit 1
fi

echo "すべて満たしています。setup.sh を実行できます。"
