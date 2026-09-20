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
    const notices = listActiveNotices(db, now).map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author_name,
    }));

    return c.json({
      notices,
      settings: getSettings(db),
      serverTime: now,
    });
  });

  return app;
}
