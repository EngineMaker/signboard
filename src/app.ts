import { Hono } from 'hono';

/**
 * アプリ本体。サーバー起動とは分離しておき、テストから `app.request()` で直接叩けるようにする。
 */
export function createApp() {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  return app;
}
