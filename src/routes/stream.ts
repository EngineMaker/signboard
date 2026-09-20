import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventBus } from '../events/bus.ts';

/**
 * 掲示板向けのリアルタイム配信（SSE）。
 *
 * 配るのは「変わった」という合図だけで、中身は送らない。
 * 受け取った iPad が `/api/notices` を取り直す。こうしておくと
 * 取得経路が1つ（ポーリングと共通）になり、再接続時のズレも起きない。
 */

/** 中継のアイドルタイムアウトで切られないよう、無通信でも定期的に送る。 */
const KEEPALIVE_MS = 25000;

export function streamRoutes(events: EventBus) {
  const app = new Hono();

  app.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;

      const unsubscribe = events.subscribe((event) => {
        if (!alive) return;
        void stream.writeSSE({ event: event.name, data: String(event.at) });
      });

      stream.onAbort(() => {
        alive = false;
        unsubscribe();
      });

      // 接続できたことを伝える。クライアントはこれを見てポーリング間隔を延ばす。
      await stream.writeSSE({ event: 'connected', data: String(Date.now()) });

      while (alive) {
        await stream.sleep(KEEPALIVE_MS);
        if (!alive) break;
        // コメント行。イベントとしては扱われず、接続維持だけに使われる。
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
      }
    }),
  );

  return app;
}
