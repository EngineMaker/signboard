# signboard

シェアハウスのリビング用「電光掲示板」Webアプリ。

リビングに置いた iPad に、お知らせを横スクロールで表示する。内容は Discord Bot / Web管理画面 / API からリモート更新できる。

**稼働中**: https://signboard.emaker.dev

| | |
|---|---|
| 掲示板 | https://signboard.emaker.dev/ （iPad で「ホーム画面に追加」して全画面表示） |
| 管理画面 | https://signboard.emaker.dev/admin/ （Discord でログイン、EM住民ロールが必要） |
| Discord | `/signboard post` `/signboard list` `/signboard delete` |
| API | `POST /api/v1/notices` （`Authorization: Bearer <APIキー>`） |

## ドキュメント

- 仕様: [docs/SPEC.md](docs/SPEC.md)
- 開発計画・進捗: [docs/PLAN.md](docs/PLAN.md)
- 実装中に決めたこと: [docs/DECISIONS.md](docs/DECISIONS.md)
- 運用手順: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## 使い方

### お知らせを出す

Discord で:

```
/signboard post text:土曜に共用部の大掃除やります。10時集合
/signboard post text:明日は断水します hours:12
```

期限を指定しなければ 24 時間で自動的に消える。

スクリプトから:

```bash
curl -X POST https://signboard.emaker.dev/api/v1/notices \
  -H "Authorization: Bearer <管理画面で発行したキー>" \
  -H "Content-Type: application/json" \
  -d '{"body":"お知らせの本文"}'
```

### 表示を調整する

管理画面の「表示設定」から、スクロール速度・文字サイズ・
お知らせが無いときの文言を変えられる。変更は iPad に即座に反映される。

## 必要なもの

- Node.js >= 22（開発・本番とも v24 で確認）

## セットアップ

```bash
npm ci
cp .env.example .env   # 必要に応じて編集
```

## 開発

```bash
npm run dev        # 開発サーバー (http://localhost:3100)
npm test           # テスト
npm run typecheck  # 型チェック
```

## 構成

| パス | 内容 |
|---|---|
| `src/` | アプリ本体 |
| `test/` | テスト |
| `docs/` | 仕様・計画・決定事項 |
| `infra/` | インフラ定義（systemd unit・Tunnel 設定・バックアップ） |
| `assets/` | Discord アプリのアイコンと生成スクリプト |

## デプロイ

```bash
ssh em105-mktoho
cd ~/apps/signboard
git pull
bash infra/setup.sh
```

`setup.sh` は冪等なので、変更がなければ何もしない。
詳細と障害時の対処は [docs/OPERATIONS.md](docs/OPERATIONS.md)。
