import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { DB } from './db/index.ts';
import { apiRoutes } from './routes/api.ts';

/**
 * アプリ本体。サーバー起動とは分離しておき、テストから `app.request()` で直接叩けるようにする。
 */
export function createApp(db: DB) {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.route('/api', apiRoutes(db));

  // 掲示板画面。ビルド工程を置かず public/ をそのまま配信する。
  app.use('/*', serveStatic({ root: './public' }));

  return app;
}
