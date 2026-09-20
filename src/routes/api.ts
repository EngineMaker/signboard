import { Hono } from 'hono';
import type { DB } from '../db/index.ts';
import { listActiveNotices } from '../repo/notices.ts';
import { getSettings } from '../repo/settings.ts';

/** 掲示板画面が読むだけの公開API。書き込みは Step 5 以降。 */
export function apiRoutes(db: DB) {
  const app = new Hono();

  /**
   * 掲示板が流す内容。お知らせと表示設定をまとめて返す。
   * 1リクエストで完結させ、iPad 側の取得処理を単純に保つ。
   */
  app.get('/notices', (c) => {
    const now = Date.now();
    const rows = listActiveNotices(db, now);

    const notices = rows.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author_name,
      // 新着かどうかの判定と「最終更新」の表示に使う
      createdAt: n.created_at,
    }));

    // 一番新しいお知らせの投稿時刻。0件なら null。
    // 画面の隅に「最終更新 14:32」と出すために返す。
    const latestAt = rows.length > 0 ? Math.max(...rows.map((n) => n.created_at)) : null;

    return c.json({
      notices,
      settings: getSettings(db),
      serverTime: now,
      latestAt,
    });
  });

  return app;
}
