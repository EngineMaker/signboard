# signboard

シェアハウスのリビング用「電光掲示板」Webアプリ。

リビングに置いた iPad に、お知らせを横スクロールで表示する。内容は Discord Bot / Web管理画面 / API からリモート更新できる。

- 仕様: [docs/SPEC.md](docs/SPEC.md)
- 開発計画・進捗: [docs/PLAN.md](docs/PLAN.md)

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
| `infra/` | インフラ定義（Step 9 で追加） |
