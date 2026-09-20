import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { authConfig, config, type AuthConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { EventBus } from './events/bus.ts';
import { startBot, type BotHandle } from './bot/index.ts';

const db = openDb(config.dbPath);
const events = new EventBus();

// 認証情報が無くても掲示板の表示だけは動かせるようにする（開発の取り回しのため）。
let auth: AuthConfig | undefined;
try {
  auth = authConfig();
} catch (err) {
  console.warn(`[警告] ${(err as Error).message}`);
  console.warn('[警告] 認証なしで起動します。掲示板の表示のみ利用できます。');
}

const server = serve(
  { fetch: createApp(db, { auth, baseUrl: config.baseUrl, events }).fetch, port: config.port },
  (info) => {
    console.log(`signboard listening on http://localhost:${info.port}`);
    if (auth) console.log('Discord 認証: 有効');
  },
);

// Bot は Web と同一プロセスで動かす（PLAN §1.1）。
// 起動に失敗しても掲示板は動かし続ける。
let bot: BotHandle | undefined;
if (auth && process.env.DISABLE_BOT !== '1') {
  try {
    bot = await startBot({ db, events }, auth);
  } catch (err) {
    console.error('[警告] Discord Bot の起動に失敗しました:', (err as Error).message);
    console.error('[警告] 掲示板と管理画面は引き続き利用できます。');
  }
}

/** systemd からの停止（SIGTERM）で後片付けしてから終わる。 */
async function shutdown(signal: string) {
  console.log(`${signal} を受信。終了します。`);
  await bot?.stop().catch(() => {});
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // 接続が残っていても一定時間で強制終了する
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
