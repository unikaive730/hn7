import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 8977);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
