import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { APP_NAME, API_PREFIX } from '@hn7/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIST = path.resolve(here, '..', '..', 'web', 'dist');

export function createApp({ serveWeb = true } = {}) {
  const app = new Hono();

  // Report which keys exist, never their values.
  app.get(`${API_PREFIX}/health`, (c) =>
    c.json({
      ok: true,
      app: APP_NAME,
      keys: { openai: Boolean(process.env.OPENAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY) },
    }),
  );

  app.all(`${API_PREFIX}/*`, (c) => c.json({ error: 'not_found' }, 404));

  if (serveWeb) {
    const root = path.relative(process.cwd(), WEB_DIST) || '.';
    app.use('/*', serveStatic({ root }));
    // Single-page app: any other GET returns index.html so client routes survive a reload.
    app.get('*', async (c) => {
      try {
        return c.html(await readFile(path.join(WEB_DIST, 'index.html'), 'utf8'));
      } catch {
        return c.text('Web app not built yet. Run npm run build.', 503);
      }
    });
  }

  return app;
}
