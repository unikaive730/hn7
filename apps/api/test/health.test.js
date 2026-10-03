import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('health reports ok and hides key values', async () => {
  const res = await createApp({ serveWeb: false }).request('/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.keys.openai, 'boolean');
});

test('unknown API route is a JSON 404', async () => {
  const res = await createApp({ serveWeb: false }).request('/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not_found' });
});
