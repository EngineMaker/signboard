# 作業ログ — signboard

> **迷ったらここだけ読めば戻れます。** 詳細は下に追記式で続きます。

## 🔖 いまの状況（2026-09-21 時点）

**この現場は何**: シェアハウス（EngineMaker）のリビングに置いた古い iPad Pro 9.7 を
**電光掲示板**にする Web アプリ。黒背景に大きな白文字でお知らせを横スクロール表示し、
時計と日付を常時出す。

**🟢 本番稼働中。うまくいっている。** いまは**運用しながら細かく改善するフェーズ**。
新機能を積むより、住人の声を拾って直す時期。

### 📺 稼働しているもの

| | URL |
|---|---|
| 掲示板（iPad が表示） | https://signboard.emaker.dev/ |
| 管理画面 | https://signboard.emaker.dev/admin/ |
| ヘルスチェック | https://signboard.emaker.dev/healthz |

お知らせの更新は **3経路**。どれもリビングまで行かずに使える（これが作った動機）。

- **Discord** … `/signboard post` `/signboard list` `/signboard delete`
- **管理画面** … Discord ログイン（EM住民ロールが要る）
- **API** … `POST /api/v1/notices` に Bearer キー

### 👉 次にやること

**急ぎは無い。** 気が向いたときに下から選ぶ。**1 が一番おすすめ**（穴が空いている）。

1. **`docs/TABLET.md` を書く** — サーバー側は OPERATIONS.md で手厚いのに、
   **iPad 側の手順がほぼ無い**。自動ロックを切る設定、常時給電、「ホーム画面に追加」の手順、
   **停電で落ちたとき誰がどう戻すか**。ここだけ非対称
2. **同時表示の件数上限を決める**（SPEC の TBD-4 が未決着）。
   1件200文字は決めたが件数は未定。**増えると一周が長くなる**。運用の実績を見て決める
3. **設計プロセスを残す**（DECISIONS の D-003 で保留中）。`docs/journal/` に。
   「区切りの良いタイミングで」としていて、**いまがそれ**
4. 天気表示（Open-Meteo）／ゴミ出し予定／LEDドット風テーマ — いずれも受け皿は作ってある

## 🏗 どう出来ているか

| | |
|---|---|
| 言語 | TypeScript。**ビルド工程なし**（Node の `--experimental-strip-types` で直接実行） |
| サーバー | Hono 4 + SQLite（better-sqlite3）。Bot も同じプロセスに同居 |
| フロント | **素の HTML/CSS/JS**。バンドラなし（Safari 16 固定なので困らない） |
| 即時反映 | SSE。実測 147ms。通信が切れても localStorage のキャッシュを流し続ける |
| 認証 | Discord OAuth2 ／ API は Bearer キー。権限の源泉は Discord の「EM住民」ロール |
| 置き場所 | ハウス内の Ubuntu 機 `em105-mktoho` の `~/apps/signboard` |
| 公開 | Cloudflare Tunnel（ポート開放なし）。systemd user unit で常駐・自動再起動 |
| バックアップ | 毎日 04:30 に `VACUUM INTO` で30日分 |
| 月額 | **0円** |

テスト 193件・CI green・TODO/FIXME ゼロ。決定事項は `docs/DECISIONS.md` に37件（ADR形式）。

### 🚀 デプロイのしかた

> **2026-09-30 時点**: ホスト名が `em105-claw` になっており、`ssh em105-mktoho` は名前解決できなかった。
> サーバー上で作業しているなら ssh は不要で、`~/apps/signboard` で `git pull && bash infra/setup.sh` すればよい。

```
ssh em105-mktoho
cd ~/apps/signboard
git pull
bash infra/setup.sh      # 冪等。変更が無ければ何もしない
```

**デプロイ後は `curl` で実物が届いたか確認する。** Cloudflare のキャッシュで
古い JS/CSS が配られた事故があった（D-030）。

## ⚠️ 触るとき気をつけること

- **型チェックが通っても起動で落ちることがある**（D-014）。`tsc --noEmit` は通るのに
  `--experimental-strip-types` が受け付けない構文がある。**CI でも拾えていない**ので、
  変更したら必ず起動を確認する
- **サーバーは GUI デスクトップ兼用機**。自動更新で勝手に再起動しうる。
  「常時稼働が保証された機械ではない」前提で、オフライン耐性を生命線にしてある
- **API キーはロールを失っても自動で止まらない**（D-025）。退去した住人のキーは
  管理画面から手で失効させる
- iPad は落ちてもキャッシュを流し続けるので、**サーバーが死んでも画面上は気づきにくい**

## 📜 これまでの経緯

**全42コミットが 2026-09-20 の1日**に収まっている。要件定義 → 技術選定（3案比較）→
9ステップの実装 → MVP → 発表スライド18枚、まで1日で駆け抜けた。

そのあと運用に入ってからの改善が続いている。**後半は住人の声が起点**:

- 見出し・本文が単語の途中で折り返される問題を修正
- PC 用のフルスクリーンボタン（マウスがあるときだけ出す / D-029）
- Cloudflare キャッシュ対策（JS/CSS を `no-store` に / D-030）
- OGP と favicon（小サイズと大サイズで意匠を変える / D-034）
- **新着を5分間だけ強調表示**（D-033）← 「居続ける人は変化に気づけない」という指摘から
- **新着で画面を光らせる**（D-035）。光り方4種を管理画面で選べて、その場でテスト送信できる
- 2026-09-29: Cosense 用の概要ページ（前半: 住民向けの使い方 / 後半: 開発の記録）を下書き。
  1ページ構成・問い合わせ先「Discord で mktoho」で確定。Cosense の EngineMaker プロジェクトに貼り付け済み（ページ名「signboard（リビングの電光掲示板）」）
- 2026-09-30: rain-alert から API 連携の問い合わせ。調べる中で見つかった公開 API の PATCH の穴を修正（D-036）。
  期限切れは 404 にして復活させない／期限の1年上限を POST と揃えた
- 2026-09-30: 公開 API の 404 に理由の `code`（not_found / deleted / expired）を追加（D-037）。rain-alert の要望
- 2026-09-30: **rain-alert（雨の通知）と連携開始**。雨の間は同じお知らせの期限を PATCH で延ばし、
  404 の `code` が deleted ならその雨の間は出さない／expired・not_found なら POST し直す（rain-alert 側で実装・稼働中）。
  管理画面の PATCH は期限切れでも延長できるまま（人の意図した操作のため。D-036）

## 📚 ドキュメントの地図

| 読みたいもの | ファイル |
|---|---|
| 使い方・稼働URL | `README.md` |
| なぜ作ったか | `REQUEST.md` |
| 仕様 | `docs/SPEC.md` |
| 実装の計画と進捗 | `docs/PLAN.md` |
| **なぜそう決めたか（37件）** | `docs/DECISIONS.md` |
| **運用・トラブル対応** | `docs/OPERATIONS.md` |
| API の叩き方 | `docs/API.md` |
| 発表スライド（18枚） | `docs/slides/index.html` |

環境変数は `.env.example` にキー名がある。`bash infra/preflight.sh` で過不足を確認できる。
