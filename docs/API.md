# API

自分のスクリプトから掲示板に書き込むための API です。

ゴミ出しの日に自動でお知らせを流したり、何かの監視結果を掲示板に出したり、
といった使い方ができます。

- ベースURL: `https://signboard.emaker.dev`
- 認証: APIキー（管理画面で発行）
- 形式: JSON

## まず動かしてみる

### 1. キーを発行する

https://signboard.emaker.dev/admin/ を開いて「APIキー」タブへ。
用途がわかる名前を付けて発行します。

**キーが表示されるのは発行したときの1回だけ**です。閉じると二度と見られないので、
その場でコピーしてください。忘れたら作り直します。

### 2. 投稿してみる

```bash
curl -X POST https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer sb_あなたのキー" \
  -H "Content-Type: application/json" \
  -d '{"body":"スクリプトから投稿しました"}'
```

うまくいくとリビングの iPad にすぐ出ます。

```json
{
  "notice": {
    "id": 12,
    "body": "スクリプトから投稿しました",
    "expiresAt": 1789970298024
  }
}
```

期限を指定しなければ **24時間**で自動的に消えます。

## 使いそうな例

### 毎週のゴミ出しを流す

```bash
#!/usr/bin/env bash
# cron や systemd timer から呼ぶ。収集日の朝に実行する想定。
set -euo pipefail

KEY="${SIGNBOARD_KEY:?環境変数 SIGNBOARD_KEY にAPIキーを入れてください}"

# 今日の曜日で出し分ける
case "$(date +%u)" in
  1|4) text="今日は燃えるゴミの日です" ;;
  3)   text="今日はプラの日です" ;;
  *)   exit 0 ;;   # 収集がない日は何もしない
esac

curl -sf -X POST https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg b "$text" '{body:$b, expiresAt:($ENV.EXPIRES|tonumber)}' \
        EXPIRES="$(( ($(date +%s) + 12*3600) * 1000 ))")"
```

期限を12時間にしているので、夜には消えます。

### 古いお知らせを消す

```bash
#!/usr/bin/env bash
# 自分のスクリプトが出したものだけ消したいとき
set -euo pipefail
KEY="${SIGNBOARD_KEY:?}"

curl -sf https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer $KEY" \
| jq -r '.notices[] | select(.source == "api") | .id' \
| while read -r id; do
    curl -sf -X DELETE "https://signboard.emaker.dev/api/v1/notices/$id" \
      -H "Authorization: Bearer $KEY"
  done
```

### Python から

```python
import os
import time
import urllib.request
import json

KEY = os.environ["SIGNBOARD_KEY"]
BASE = "https://signboard.emaker.dev/api/v1"


def post(text, hours=None):
    payload = {"body": text}
    if hours:
        payload["expiresAt"] = int((time.time() + hours * 3600) * 1000)

    req = urllib.request.Request(
        f"{BASE}/notices",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        return json.load(res)


post("ビルドが失敗しました", hours=3)
```

## リファレンス

### 認証

すべてのリクエストに APIキーが必要です。

```
Authorization: Bearer sb_xxxxxxxxxxxxxxxx
```

付いていない、または無効なキーの場合は `401` が返ります。

```json
{ "error": "Authorization: Bearer <APIキー> が必要です" }
```

キーは**失効させるまでずっと有効**です。セッション（Web のログイン）と違い、
EM住民ロールを外しても自動では止まりません。不要になったら管理画面で失効させてください。

### GET /api/v1/notices

いま流れているお知らせを返します。

| クエリ | 内容 |
|---|---|
| `all=true` | 期限切れのものも含める（省略時は有効なものだけ） |

```bash
curl https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer $KEY"
```

```json
{
  "notices": [
    {
      "id": 6,
      "body": "AIもくもく勉強会 13時から",
      "expiresAt": 1789959981168,
      "createdAt": 1789873581168,
      "authorName": "えむけー",
      "source": "web"
    }
  ]
}
```

`source` は投稿元です。`web`（管理画面）/ `bot`（Discord）/ `api`（このAPI）のいずれか。

### POST /api/v1/notices

お知らせを投稿します。

| 項目 | 必須 | 内容 |
|---|---|---|
| `body` | ○ | 本文。200文字まで。前後の空白は取り除かれる |
| `expiresAt` | | 表示期限。UNIX時刻のミリ秒。省略すると24時間後 |

```bash
curl -X POST https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"明日は断水します","expiresAt":1789970298024}'
```

成功すると `201` が返ります。

```json
{ "notice": { "id": 12, "body": "明日は断水します", "expiresAt": 1789970298024 } }
```

### PATCH /api/v1/notices/:id

本文や期限を変更します。変えたい項目だけ送れば足ります。

```bash
curl -X PATCH https://signboard.emaker.dev/api/v1/notices/12 \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"書き換えた本文"}'
```

```json
{ "notice": { "id": 12, "body": "書き換えた本文", "expiresAt": 1789970298024 } }
```

### DELETE /api/v1/notices/:id

お知らせを消します。誰が投稿したものでも消せます。

```bash
curl -X DELETE https://signboard.emaker.dev/api/v1/notices/12 \
  -H "Authorization: Bearer $KEY"
```

```json
{ "deleted": { "id": 12, "body": "書き換えた本文" } }
```

消したあとも記録は残るので、あとから本文を追えます。

## エラー

| コード | 意味 |
|---|---|
| `400` | リクエストの内容がおかしい |
| `401` | キーが無い、無効、または失効している |
| `404` | そのIDのお知らせが無い（すでに消した場合も含む） |

返ってくる形は共通です。

```json
{ "error": "本文が空です" }
```

`400` になるのは次の場合です。

| メッセージ | 原因 |
|---|---|
| `body（本文）は必須です` | `body` が無い、または文字列でない |
| `本文が空です` | 空文字、または空白だけ |
| `本文は200文字以内にしてください` | 長すぎる |
| `expiresAt は UNIX 時刻（ミリ秒）で指定してください` | 数値でない |
| `expiresAt が過去です` | すでに過ぎた時刻 |
| `expiresAt が遠すぎます（1年以内）` | 1年より先 |
| `変更する項目がありません` | PATCH で `body` も `expiresAt` も無い |
| `ID が不正です` | URL の ID が整数でない |
| `JSON が不正です` | ボディが JSON として読めない |

## 気をつけること

**期限は必ず指定したほうがいい**です。省略すると24時間で消えますが、
定期実行するスクリプトなら、次の実行までに消えるよう短めにしておくと
同じ内容が積み重なりません。

**時刻はミリ秒**です。UNIX 時刻の秒を渡すと「過去です」と怒られます。

```bash
# 正しい（ミリ秒）
echo $(( ($(date +%s) + 3600) * 1000 ))

# 間違い（秒）
echo $(( $(date +%s) + 3600 ))
```

**操作はすべて記録されます。** 誰のキーで何をしたかが管理画面の「操作履歴」に残ります。
キーを他の人に渡すと、その人の操作が自分の名前で記録されるので気をつけてください。

## 認証がいらないもの

掲示板の画面が使っているエンドポイントは、キーなしで読めます。

```bash
curl https://signboard.emaker.dev/api/notices
```

```json
{
  "notices": [{ "id": 6, "body": "AIもくもく勉強会 13時から", "authorName": "えむけー" }],
  "settings": {
    "scrollSpeed": 220,
    "fontScale": 24,
    "theme": "dark",
    "fallbackText": "お知らせ募集中"
  },
  "serverTime": 1789883898024
}
```

変更の通知を受け取りたい場合は `GET /api/stream`（Server-Sent Events）もあります。
お知らせや設定が変わると `notices-changed` / `settings-changed` が流れてきます。

```bash
curl -N https://signboard.emaker.dev/api/stream
```

```
event: connected
data: 1789876681067

event: notices-changed
data: 1789876712043
```

中身は送られてこないので、受け取ったら `/api/notices` を取り直してください。
