import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { openDb } from './db/index.ts';

const db = openDb(config.dbPath);

serve({ fetch: createApp(db).fetch, port: config.port }, (info) => {
  console.log(`signboard listening on http://localhost:${info.port}`);
});
