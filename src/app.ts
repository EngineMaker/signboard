import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { DB } from './db/index.ts';
import type { AuthConfig } from './config.ts';
import { requireAuth, type AuthVars } from './auth/middleware.ts';
import { apiRoutes } from './routes/api.ts';
import { authRoutes } from './routes/auth.ts';

export interface AppOptions {
  auth?: AuthConfig;
  baseUrl?: string;
}

/**
 * アプリ本体。サーバー起動とは分離しておき、テストから `app.request()` で直接叩けるようにする。
 * auth を渡さない場合は掲示板の表示だけが動く（認証情報なしでも開発できるように）。
 */
export function createApp(db: DB, opts: AppOptions = {}) {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.route('/api', apiRoutes(db));

  if (opts.auth) {
    const auth = opts.auth;
    app.route('/auth', authRoutes(auth, opts.baseUrl ?? ''));

    /** ログイン中のユーザー。管理画面が自分の状態を知るために使う。 */
    app.get('/api/me', requireAuth(auth), (c) => {
      const session = c.get('session');
      return c.json({ userId: session.userId, userName: session.userName });
    });
  }

  // 掲示板画面。ビルド工程を置かず public/ をそのまま配信する。
  app.use('/*', serveStatic({ root: './public' }));

  return app;
}
