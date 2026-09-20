import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { DB } from './db/index.ts';
import type { AuthConfig } from './config.ts';
import { requireAuth, type AuthVars } from './auth/middleware.ts';
import { apiRoutes } from './routes/api.ts';
import { streamRoutes } from './routes/stream.ts';
import { EventBus } from './events/bus.ts';
import { adminApiRoutes } from './routes/admin-api.ts';
import { publicApiRoutes } from './routes/public-api.ts';
import { isCrawler, renderCard } from './routes/og-card.ts';
import { authRoutes } from './routes/auth.ts';
import { getCookie } from 'hono/cookie';
import { decodeSession } from './auth/session.ts';
import { SESSION_COOKIE } from './auth/middleware.ts';

export interface AppOptions {
  auth?: AuthConfig;
  baseUrl?: string;
  /** 省略時は内部で作る。テストから発火を観測したい場合に渡す。 */
  events?: EventBus;
}

/**
 * アプリ本体。サーバー起動とは分離しておき、テストから `app.request()` で直接叩けるようにする。
 * auth を渡さない場合は掲示板の表示だけが動く（認証情報なしでも開発できるように）。
 */
export function createApp(db: DB, opts: AppOptions = {}) {
  const app = new Hono<{ Variables: AuthVars }>();
  const events = opts.events ?? new EventBus();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.route('/api', apiRoutes(db));
  app.route('/api', streamRoutes(events));

  // APIキーで叩ける公開 API（SPEC §2.1）。認証設定の有無によらず使える。
  app.route('/api/v1', publicApiRoutes(db, events));

  if (opts.auth) {
    const auth = opts.auth;
    app.route('/auth', authRoutes(auth, opts.baseUrl ?? ''));

    /** ログイン中のユーザー。管理画面が自分の状態を知るために使う。 */
    app.get('/api/me', requireAuth(auth), (c) => {
      const session = c.get('session');
      return c.json({ userId: session.userId, userName: session.userName });
    });

    app.route('/api/admin', adminApiRoutes(db, auth, events));

    // 管理画面の HTML 自体もログイン必須にする。
    // 未ログインはログインへ送る（API と違い 401 を返しても人間には不親切なため）。
    app.get('/admin', (c) => {
      if (!decodeSession(getCookie(c, SESSION_COOKIE), auth.sessionSecret)) {
        // クローラーには /admin/ を見に行かせる（そこでカードを返す）
        if (isCrawler(c.req.header('user-agent'))) return c.redirect('/admin/');
        return c.redirect('/auth/login');
      }
      return c.redirect('/admin/');
    });

    /*
     * 管理画面は認証必須。ただし次の2つは通す。
     *
     *  - OGP 画像: クローラーはログインできないので、塞ぐと絵が出ない
     *  - クローラーからのページ要求: メタタグだけの HTML を返す
     *
     * どちらも返すのは題名・説明・絵だけで、お知らせ一覧や APIキーは含まない。
     */
    app.use('/admin/*', async (c, next) => {
      if (c.req.path === '/admin/ogp.png') {
        await next();
        return;
      }

      if (decodeSession(getCookie(c, SESSION_COOKIE), auth.sessionSecret)) {
        await next();
        return;
      }

      const base = opts.baseUrl ?? '';
      if (isCrawler(c.req.header('user-agent'))) {
        return c.html(
          renderCard({
            siteName: 'リビングの電光掲示板',
            title: '掲示板の管理',
            description:
              'お知らせの投稿・編集と、文字サイズやスクロール速度の設定。EM住民ロールを持っている人が使えます。',
            url: `${base}/admin/`,
            image: `${base}/admin/ogp.png`,
            imageAlt: '黒地に琥珀色のドットで SIGNBOARD と描かれた管理画面の案内画像',
          }),
        );
      }

      return c.redirect('/auth/login');
    });
  }

  /*
   * 掲示板画面。ビルド工程を置かず public/ をそのまま配信する。
   *
   * ただし Cloudflare は静的ファイルを既定で数時間キャッシュするため、
   * デプロイしても古い JS/CSS が配られ続ける。HTML だけ新しくなって
   * 中身が食い違う事故が起きたので、キャッシュの扱いを明示する。
   */
  app.use('/*', async (c, next) => {
    await next();

    const path = c.req.path;
    if (path.endsWith('.js') || path.endsWith('.css')) {
      /*
       * no-store にする。no-cache だと Cloudflare 側の Browser Cache TTL
       * （既定4時間）が残り、古いファイルが配られ続けた。
       * no-store はキャッシュ自体を禁じるので設定に上書きされない。
       * ファイルは数十KBで更新も稀なため、毎回取得させても問題ない。
       */
      c.header('Cache-Control', 'no-store');
    } else if (path.endsWith('.mp4') || path.endsWith('.png') || path.endsWith('.jpg')) {
      // 画像や動画は差し替えの頻度がさらに低く、容量が大きいので長めに持たせる
      c.header('Cache-Control', 'public, max-age=86400');
    }
  });

  app.use('/*', serveStatic({ root: './public' }));

  return app;
}
