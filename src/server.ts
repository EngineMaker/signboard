import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { authConfig, config, type AuthConfig } from './config.ts';
import { openDb } from './db/index.ts';

const db = openDb(config.dbPath);

// 認証情報が無くても掲示板の表示だけは動かせるようにする（開発の取り回しのため）。
let auth: AuthConfig | undefined;
try {
  auth = authConfig();
} catch (err) {
  console.warn(`[警告] ${(err as Error).message}`);
  console.warn('[警告] 認証なしで起動します。掲示板の表示のみ利用できます。');
}

serve({ fetch: createApp(db, { auth, baseUrl: config.baseUrl }).fetch, port: config.port }, (info) => {
  console.log(`signboard listening on http://localhost:${info.port}`);
  if (auth) console.log('Discord 認証: 有効');
});
