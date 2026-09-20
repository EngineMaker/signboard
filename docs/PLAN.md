# PLAN: 開発手法と技術選定

> ステータス: **フェーズ2 承認済み (2026-09-20)**
> 最終更新: 2026-09-20
> 前提: [SPEC.md](./SPEC.md) フェーズ1承認済み

## 1. 技術選定

### 1.1 案の比較

前提条件が効いてくるのは次の3点:

- 表示端末が **Safari 16 (iPad Pro 9.7 / A9X / RAM 2GB)** — 新しいフレームワークのビルド出力が動かない可能性がある
- ホストが **GUI兼用の家庭内サーバー** — 落ちる前提。運用の手間は最小にしたい
- **1プロセス**に Web + Bot + SSE を同居させる

| | 案A: Node + Hono + SQLite | 案B: Next.js + Postgres | 案C: Cloudflare Workers + D1 |
|---|---|---|---|
| ランタイム | Node v24（サーバーに導入済み） | Node v24 | Cloudflare edge |
| DB | SQLite (better-sqlite3) 単一ファイル | Postgres（別途コンテナ） | D1 |
| 掲示板画面 | **素のHTML + CSS + 最小JS** | React (Next) | 素のHTML |
| Bot同居 | ○ 同一プロセスで discord.js | △ Next と常駐Botは相性が悪い | ✗ 常駐接続不可、Webhook必須 |
| SSE | ○ | △ Next の SSE は癖がある | ○ |
| サーバー要件 | Node だけ。Docker 不要 | Docker + compose v2 が必要 | サーバー不要 |
| バックアップ | ファイル1個コピー | pg_dump | 要 export |
| 月額 | 0円 | 0円 | 0円（無料枠内） |
| 懸念 | なし | **compose v2 未導入・dockerグループ未所属・sudo要パスワード**（SPEC §2.8）で導入コストが高い | ハウス内サーバーを使う方針(§2.6)と外れる。Bot常駐不可 |

### 1.2 推奨: 案A

理由:

- サーバーに **Node が既にある**。Docker グループ・sudo・compose v2 の問題を全部回避できる
- SQLite なら**バックアップがファイルコピー1回**。家庭内サーバーの運用としてこれが一番現実的
- 掲示板画面をフレームワークなしで書けば、**Safari 16 の互換性問題が原理的に起きない**。ビルド出力の transpile ターゲットに悩まなくて済む
- 規模が小さい（お知らせ数十件、閲覧者 iPad 1台＋住人のスマホ数台）。Postgres も edge も過剰

**確定スタック**

- サーバー: Node v24 + **Hono** + TypeScript
- DB: **SQLite** (better-sqlite3) + マイグレーションは素のSQLファイル
- 掲示板画面: **素の HTML/CSS/JS**（ビルドなし）。CSS変数でテーマ化
- 管理画面: 同じく素のHTML + 最小JS（サーバーサイドレンダリング）
- Bot: **discord.js**（同一プロセス）
- 認証: Discord OAuth2 (Web) / Bearer APIキー (API) / ロール検証は Discord API
- リアルタイム: **SSE**（`/api/stream`）
- テスト: **vitest** + supertest 相当（Hono の `app.request()`）
- 公開: **Cloudflare Tunnel** → `signboard.emaker.dev`
- プロセス管理: **systemd user unit**（sudo不要で `systemctl --user` で完結、lingering有効化のみ要確認）

### 1.3 インフラのコード化

インフラもリポジトリで管理する。ただし1台に1アプリの規模なので Terraform / Ansible は過剰。
**宣言的な設定ファイル + 冪等な bash スクリプト**で揃える。

`infra/` に置くもの:

| ファイル | 内容 | 適用方法 |
|---|---|---|
| `infra/systemd/signboard.service` | systemd **user** unit（自動起動・異常時再起動） | `infra/setup.sh` が配置 |
| `infra/cloudflared/config.yml` | Tunnel のルーティング定義（`signboard.emaker.dev` → `localhost:3100`） | 同上 |
| `infra/cloudflared/signboard-tunnel.service` | cloudflared の user unit | 同上 |
| `infra/backup/backup.sh` | SQLite の日次バックアップ（`VACUUM INTO` で安全に取得、世代管理） | cron から実行 |
| `infra/backup/signboard-backup.{service,timer}` | バックアップ用 systemd timer（cron より時刻が正確） | `infra/setup.sh` が配置 |
| `infra/setup.sh` | 上記を配置して有効化する**冪等**なスクリプト。何度流しても同じ状態になる | `bash infra/setup.sh` |
| `infra/preflight.sh` | 適用前の前提チェック（Node版・ポート空き・lingering有効・cloudflared有無） | `bash infra/preflight.sh` |
| `.env.example` | 必要な環境変数の一覧（実値はコミットしない） | 手動コピー |

方針:

- **sudo を要求しない**構成にする（systemd **user** unit + `loginctl enable-linger`）。SPEC §2.8 の「sudo はパスワード必須」を回避できる
- スクリプトは `set -euo pipefail` + 冪等。既に正しい状態なら何もしない
- シークレット（Discord トークン・Tunnel 認証情報）は**コミットしない**。`.env.example` に名前だけ置く
- 手順書 `docs/OPERATIONS.md` は「スクリプトが何をするか」と**手動介入が必要な部分だけ**を記す（Cloudflare 側のトークン発行など、どうしてもブラウザ操作が要る箇所）

**コード化できない残り**: Cloudflare ダッシュボードでの Tunnel 作成とトークン発行、Discord Developer Portal での Bot 登録。これらは `docs/OPERATIONS.md` に手順として残す。

## 2. 開発手法

### 2.1 原則

- **縦切り**: 各ステップは単体で動作確認できる。DBだけ・UIだけ、のような横切りにしない
- **受け入れ条件は機械的に検証**: 各ステップに `npm test` または具体的な curl コマンドを添える
- **記録を残す**: 決定は `docs/DECISIONS.md` に追記。進捗は本ファイルのチェックボックスを更新
- **1ステップ = 1コミット以上**。突然の停止に備えてこまめにコミット・push する
- 計画から外れる判断が必要になったら**実装を止めて相談**する

### 2.2 ドキュメント構成

| ファイル | 役割 |
|---|---|
| `docs/SPEC.md` | 何を作るか（フェーズ1成果物・確定済み） |
| `docs/PLAN.md` | どう作るか・進捗（本ファイル） |
| `docs/DECISIONS.md` | 実装中に決めたことの記録（ADR形式の軽量版） |
| `docs/OPERATIONS.md` | デプロイ・バックアップ・復旧の手順、手動介入が必要な箇所（ステップ9で作成） |
| `infra/` | インフラ定義一式（§1.3） |
| `README.md` | セットアップ手順 |

### 2.3 レビューのポイント

セッションが変わっても文脈が失われないよう、レビューすべき箇所を明示します。

| ステップ | 重点的に見てほしい点 |
|---|---|
| 2 | DBスキーマ。後から変えると面倒なので**ここが一番重要** |
| 3 | 掲示板の見た目・スクロールの質感。**実機 iPad で確認してほしい** |
| 4 | Discord ロール検証のロジック。**ここが破れると誰でも書ける** |
| 5 | 監査ログの記録漏れがないか（全書き込み経路を通っているか） |
| 6 | Bot のコマンド体系が使いやすいか |
| 8 | APIキーの保存方式（ハッシュ化しているか） |
| 9 | 外部公開の設定。**公開範囲が意図通りか** |

## 3. 実装ステップ

各ステップの `AC` = 受け入れ条件。すべて機械的に検証できる形にしています。

### Step 1: プロジェクト基盤 ✅ 完了 (2026-09-20)

- [x] Node + TypeScript + Hono + vitest のセットアップ
- [x] `/healthz` が `{"status":"ok"}` を返す
- [x] CI (GitHub Actions) で typecheck + test が走る

**AC**: `npm test` が通る / `curl localhost:3100/healthz` が 200 / CI が green

### Step 2: データモデルと永続化 ★要レビュー ✅ 完了・承認済み (2026-09-20)

- [x] SQLite スキーマ: `notices`, `settings`, `audit_logs`, `api_keys`
- [x] マイグレーション適用スクリプト（冪等）
- [x] notices の CRUD 関数 + 有効なお知らせ取得（期限切れ除外、論理削除除外）
- [x] settings の取得・更新（壊れた値は既定値に倒す）

**AC**: `npm test` でCRUDと期限切れ除外のユニットテストが通る

### Step 3: 掲示板画面（認証なし・読み取りのみ）★実機確認 ✅ 実装完了・**実機確認待ち** (2026-09-20)

- [x] `GET /` で黒背景＋白文字の横スクロール表示
- [x] 複数件のローテーション、時計・日付の常時表示
- [x] 0件時はフォールバックテキストを表示
- [x] `GET /api/notices` から取得。localStorage にキャッシュ
- [x] オフライン時: キャッシュを流し続け、隅に警告を小さく表示
- [x] 設定（速度・文字サイズ・テーマ）を反映

**AC**: `npm test` で API のテストが通る / **iPad 実機でホーム画面に追加して全画面表示を目視確認** / 機内モードにしても流れ続けることを確認

### Step 4: Discord OAuth2 + ロール検証 ★要レビュー

- [ ] `/login` → Discord 認可 → コールバックでセッション発行
- [ ] ギルドメンバー情報を取得し「EM住民」ロールを検証
- [ ] ロールなしは 403
- [ ] セッションは署名付き Cookie（HttpOnly, Secure, SameSite=Lax）

**AC**: ロールあり/なし/未ログインの3ケースをテストで検証

### Step 5: 管理画面（お知らせCRUD）+ 監査ログ ★要レビュー

- [ ] 一覧・作成・編集・削除（期限は任意、未指定で24h後）
- [ ] 設定変更（速度・文字サイズ・テーマ・フォールバックテキスト）
- [ ] **全書き込み操作を監査ログに記録**（日時・実行者・種別・対象・変更前後・経路・IP）
- [ ] 監査ログ閲覧画面（新しい順、種別で絞り込み）

**AC**: 各操作後に対応する監査ログ行が1件生成されることをテストで検証 / 監査ログはUI・APIから編集削除できないことを検証

### Step 6: SSE によるリアルタイム反映

- [ ] `GET /api/stream` でお知らせ・設定の変更をpush
- [ ] 掲示板画面がSSEで受信して即時更新。切断時は自動再接続＋ポーリングにフォールバック

**AC**: テストでイベント配信を検証 / **iPad実機で、管理画面から投稿して数秒以内に反映されることを確認**

### Step 7: Discord Bot

- [ ] 同一プロセスで discord.js 起動
- [ ] `/signboard post <text> [期限]` — 投稿
- [ ] `/signboard list` — 現在流れている内容
- [ ] `/signboard delete <id>` — 削除
- [ ] ロール検証。Bot経由も監査ログに記録

**AC**: コマンドハンドラのユニットテスト / 実サーバーで各コマンドを実行し監査ログに残ることを確認

### Step 8: API キー ★要レビュー

- [ ] 管理画面からキー発行・失効（**保存はハッシュ、平文は発行時のみ表示**）
- [ ] `Authorization: Bearer` でお知らせCRUD
- [ ] API経由も監査ログに記録

**AC**: `curl -H "Authorization: Bearer $KEY" ...` で投稿でき、無効キーは401 / DB内に平文キーが存在しないことをテストで検証

### Step 9: インフラのコード化とデプロイ ★要レビュー

- [ ] `infra/` 一式を作成（§1.3 の表のとおり）
- [ ] `infra/preflight.sh` — 適用前チェック
- [ ] `infra/setup.sh` — 冪等なセットアップ（sudo不要）
- [ ] systemd user unit で常駐（自動起動・異常時再起動）
- [ ] Cloudflare Tunnel で `signboard.emaker.dev` を公開
- [ ] SQLite 日次バックアップ（systemd timer、`VACUUM INTO` で世代管理）
- [ ] `docs/OPERATIONS.md`（手動介入が必要な箇所・復旧手順・ロールバック）

**AC**:
- `bash infra/preflight.sh` が全項目 PASS
- `bash infra/setup.sh` を**2回連続実行しても差分が出ない**（冪等性の確認）
- `curl https://signboard.emaker.dev/healthz` が 200
- サーバー再起動後に自動復帰する（`systemctl --user is-active signboard` が active）
- バックアップを手動トリガして復元でき、復元したDBでアプリが起動する

### Step 10（MVP後）: 拡張

- [ ] 天気表示（Open-Meteo）
- [ ] ゴミ出しスケジュール
- [ ] LEDドット風テーマ
- [ ] **本プロジェクトの設計プロセス（プロンプトのやり取り）の保存** — 後から振り返れるように。詳細は DECISIONS.md の D-003

## 4. 進捗

| Step | 状態 |
|---|---|
| 1 | ✅ 完了 (2026-09-20) |
| 2 | ✅ 完了・レビュー承認済み (2026-09-20) |
| 3 | ✅ 実装完了・**実機確認待ち** (2026-09-20) |
| 4〜10 | 未着手 |

**Step 3 の検証結果**（ヘッドレスブラウザ 1024x768 @2x = iPad Pro 9.7 相当）
- `npm test` — PASS (39 tests)
- 2件のお知らせが中黒区切りで連結、スクロール動作を確認。JSエラーなし
- 0件時 → 「お知らせ募集中」を表示
- **オフライン検証**: API を全て失敗させてリロード → キャッシュから同じ内容を復元し、
  スクロールを継続、「オフライン（保存済みの内容）」を表示
- 既定値を調整: fontScale 22→12（22vhは169pxで2文字しか入らなかった）、scrollSpeed 120→220

**実機で見てほしい点**
1. 文字サイズ（既定 12 = 約92px）がリビングの距離から読めるか
2. スクロール速度（既定 220px/秒）が速すぎ/遅すぎないか
3. 「ホーム画面に追加」で全画面になるか、上部のステータスバーが隠れるか
4. 数時間放置して描画が乱れたりメモリ不足で落ちたりしないか

**Step 2 の検証結果**
- `npm test` — PASS (32 tests: notices 18 / settings 8 / db 5 / healthz 1)
- `npm run typecheck` — PASS
- `npm run migrate` を2回連続実行 → 適用済みマイグレーションが増えないことを確認（冪等）

**Step 1 の検証結果**
- `npm run typecheck` — PASS
- `npm test` — PASS (1 test)
- `curl localhost:3100/healthz` — 200 `{"status":"ok"}`
- CI — push 後に確認

**メモ**: TypeScript は Node v24 の `--experimental-strip-types` で直接実行している（ビルド工程なし）。

## 5. 変更履歴

- 2026-09-20: 初版作成
- 2026-09-20: インフラのコード化方針(§1.3)を追加、Step 9 を拡充。**ユーザー承認取得、フェーズ2確定**
