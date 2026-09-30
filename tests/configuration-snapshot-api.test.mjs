import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

function request(server, token, pathname, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${server.origin}${pathname}`, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
  });
}

test('routes snapshot creation, comparison and deletion', async (context) => {
  const calls = [];
  const snapshots = {
    compare(leftId, rightId) {
      calls.push(['compare', leftId, rightId]);
      return { identical: false, rows: [] };
    },
    create(input) {
      calls.push(['create', input]);
      return { id: 'snapshot-1', ...input };
    },
    delete(id) {
      calls.push(['delete', id]);
    },
    get(id) {
      return { content: 'hostname sw-01', id };
    },
    list(filters) {
      calls.push(['list', filters]);
      return [{ id: 'snapshot-1' }];
    },
  };
  const token = createSessionToken();
  const server = await startServer({ inventory: {}, sessionToken: token, snapshots, webRoot });
  context.after(() => server.close());

  const created = await request(server, token, '/api/configuration-snapshots', {
    body: { content: 'hostname sw-01', deviceId: 'device-1', name: 'Before' },
    method: 'POST',
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).id, 'snapshot-1');

  const listed = await request(server, token, '/api/configuration-snapshots?deviceId=device-1');
  assert.equal((await listed.json())[0].id, 'snapshot-1');

  const compared = await request(server, token, '/api/configuration-snapshots/compare', {
    body: { leftId: 'snapshot-1', rightId: 'snapshot-2' },
    method: 'POST',
  });
  assert.equal((await compared.json()).identical, false);

  const removed = await request(server, token, '/api/configuration-snapshots/snapshot-1', {
    method: 'DELETE',
  });
  assert.equal(removed.status, 204);
  assert.deepEqual(calls.at(-1), ['delete', 'snapshot-1']);
});
