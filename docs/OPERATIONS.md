# 運用手順

サーバー: `em105-mktoho`（ハウス内 Ubuntu 24.04、NAT 配下）
公開URL: https://signboard.emaker.dev
配置先: `~/apps/signboard`

コード化できる部分は `infra/` にあり、`setup.sh` が流します。
このファイルには **手作業が必要な部分**と、困ったときの手順を書きます。

## 1. 初回の導入

### 1.1 必要なパッケージ（要 sudo）

```bash
sudo apt update
sudo apt install -y sqlite3
```

cloudflared は Ubuntu の標準リポジトリに無い。どちらかの方法で入れる。

**方法A: Cloudflare のリポジトリを追加（要 sudo）**

sources.list は1行でなければならない。`echo` だと端末で折り返されて壊れることがあるため
`printf` を使い、1コマンドずつ実行する。

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
```
```bash
printf 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main\n' | sudo tee /etc/apt/sources.list.d/cloudflared.list
```
```bash
sudo apt update && sudo apt install -y cloudflared
```

`Malformed entry ... (URI)` が出たら、リスト行が改行で割れている。
`sudo rm /etc/apt/sources.list.d/cloudflared.list` して上記をやり直す。

**方法B: 公式バイナリを置く（sudo 不要）**

```bash
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/.local/bin/cloudflared
~/.local/bin/cloudflared --version
```

unit ファイルは PATH から `cloudflared` を探すので、どちらでも動く。

### 1.2 リポジトリの配置

```bash
mkdir -p ~/apps
git clone https://github.com/EngineMaker/signboard.git ~/apps/signboard
cd ~/apps/signboard
```

### 1.3 .env の作成

```bash
cp .env.example .env
vi .env
```

`BASE_URL` は本番の値にする:

```
BASE_URL=https://signboard.emaker.dev
```

Discord の各値は Developer Portal から。`SESSION_SECRET` は `openssl rand -hex 32`。

### 1.4 Cloudflare Tunnel の作成（手作業）

ブラウザ操作が要るためコード化していない。

```bash
# 1. Cloudflare にログイン（ブラウザが開く）
cloudflared tunnel login

# 2. トンネルを作る。認証情報が ~/.cloudflared/<UUID>.json に出る
cloudflared tunnel create signboard

# 3. 設定ファイルが参照する名前に合わせる
mv ~/.cloudflared/<出力されたUUID>.json ~/.cloudflared/signboard.json

# 4. DNS レコードを作る
cloudflared tunnel route dns signboard signboard.emaker.dev
```

### 1.5 Discord の Redirect URI を追加（手作業）

Developer Portal → OAuth2 → Redirects に追加:

```
https://signboard.emaker.dev/auth/callback
```

開発用の `http://localhost:3100/auth/callback` は残しておいてよい。

### 1.6 導入

```bash
cd ~/apps/signboard
bash infra/preflight.sh   # 前提チェック。NG があれば解消する
bash infra/setup.sh       # 導入・起動
```

### 1.7 スラッシュコマンドの登録

```bash
npm run bot:register
```

サーバーを変えたときや、コマンド定義を変えたときだけ実行する。

## 2. 更新

```bash
cd ~/apps/signboard
git pull
bash infra/setup.sh
```

`setup.sh` は冪等なので、変更がなければ何もしない。

## 3. 日常の操作

```bash
# 状態
systemctl --user status signboard
systemctl --user status signboard-tunnel

# ログ（追尾）
journalctl --user -u signboard -f

# 再起動
systemctl --user restart signboard

# バックアップの状況
systemctl --user list-timers signboard-backup
ls -lh ~/backups/signboard/
```

## 4. バックアップと復元

毎日 04:30 に `~/backups/signboard/` へ取る（30日分保持）。
`Persistent=true` なので、その時刻にサーバーが落ちていても次の起動時に取り返す。

### 手動でバックアップ

```bash
bash ~/apps/signboard/infra/backup/backup.sh
```

### 復元

```bash
systemctl --user stop signboard
cd ~/apps/signboard
cp data/signboard.sqlite data/signboard.sqlite.bak   # 念のため今のものを退避
gunzip -c ~/backups/signboard/signboard-YYYYMMDD-HHMMSS.sqlite.gz > data/signboard.sqlite
systemctl --user start signboard
curl -sf http://localhost:3100/healthz && echo OK
```

## 5. 困ったとき

### 掲示板が更新されない

iPad はオフラインでも最後の内容を流し続ける（SPEC §2.4）。
画面の隅に「オフライン」と出ていたら、この順に確認する。

```bash
# 1. アプリは動いているか
systemctl --user status signboard

# 2. Tunnel は繋がっているか
systemctl --user status signboard-tunnel

# 3. 外から見えるか
curl -sf https://signboard.emaker.dev/healthz
```

### 起動に失敗する

```bash
journalctl --user -u signboard -n 50 --no-pager
```

よくある原因:

- `.env` の項目が足りない → 起動時に「環境変数 X が設定されていません」と出る
- ポート 3100 が塞がっている → `ss -tlnp | grep 3100`
- **TypeScript の構文が型除去モードで扱えない** → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
  `tsc --noEmit` は通ってしまうので、変更後は必ず起動確認すること（D-014）

### Bot だけ動かない

掲示板と管理画面は動き続ける設計（D-023）。ログに `[警告] Discord Bot の起動に失敗` が出る。
Bot を止めて Web だけ動かしたいときは `.env` に `DISABLE_BOT=1`。

### サーバーが再起動した

lingering が有効なので、ログインしなくても自動で復帰する。
確認: `systemctl --user is-active signboard`

このマシンは GUI デスクトップ兼用で、unattended-upgrades による自動再起動があり得る（SPEC §2.8）。
掲示板が数分止まっても iPad はキャッシュを流し続けるため、実害は出にくい。

## 6. 退去した住人の後始末

1. Discord の EM住民ロールを外す → 最大7日でセッションが切れ、Web から書けなくなる（D-013）
2. **API キーは自動では止まらない**（D-025）。管理画面の「APIキー」タブで、
   その人が発行したキーを失効させる

## 7. 秘密情報の扱い

- `.env` はコミットしない（`.gitignore` 済み）
- `~/.cloudflared/signboard.json` も秘密。バックアップ対象外
- API キーの平文は DB に無い。紛失したら再発行する（D-024）

### .env を人に見せない

`cat .env` や `vi .env` の画面を共有・貼り付けしないこと。
中身を確認したいときは、値を伏せてキー名だけ見る:

```bash
grep -oE '^[A-Z_]+' .env | sort
```

項目の過不足だけ調べたいときは `bash infra/preflight.sh` を使う。

### 漏れてしまったときの再発行

| 値 | 再発行の方法 |
|---|---|
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot → Reset Token |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 → Reset Secret |
| `SESSION_SECRET` | `openssl rand -hex 32`（全員が再ログインになる） |
| API キー | 管理画面で失効させ、発行し直す |

`DISCORD_CLIENT_ID` / `GUILD_ID` / `RESIDENT_ROLE_ID` は公開値なので再発行は不要。

再発行したらローカルとサーバーの両方の `.env` を更新し、
`systemctl --user restart signboard` する。

### .env をサーバーへ送る

中身を端末に表示せずに転送する:

```bash
scp ~/work/ai/signboard/.env em105-mktoho:~/apps/signboard/.env
ssh em105-mktoho 'sed -i "s#^BASE_URL=.*#BASE_URL=https://signboard.emaker.dev#" ~/apps/signboard/.env'
```
