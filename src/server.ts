import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`signboard listening on http://localhost:${info.port}`);
});
