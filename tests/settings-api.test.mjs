import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

test('exposes settings only through the authenticated API', async (context) => {
  let current = { theme: 'dark' };
  const settings = {
    getAll: () => current,
    update(input) {
      current = { ...current, ...input };
      return current;
    },
  };
  const token = createSessionToken();
  const server = await startServer({ inventory: {}, sessionToken: token, settings, webRoot });
  context.after(() => server.close());

  const unauthorized = await fetch(`${server.origin}/api/settings`);
  assert.equal(unauthorized.status, 401);

  const updated = await fetch(`${server.origin}/api/settings`, {
    body: JSON.stringify({ theme: 'light' }),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'PUT',
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).theme, 'light');
});
