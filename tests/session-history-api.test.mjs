import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

async function request(server, token, pathname, options = {}) {
  return fetch(`${server.origin}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

test('lists history and verifies logs through the authenticated local API', async (context) => {
  const captured = { filters: undefined, verified: undefined };
  let recordingDefault = true;
  const history = {
    get() {
      return { id: 'session-1', logPath: null };
    },
    list(filters) {
      captured.filters = filters;
      return [{ hostname: 'sw-01', id: 'session-1', protocol: 'ssh' }];
    },
    async logExists() {
      return false;
    },
    getRecordingDefault() {
      return recordingDefault;
    },
    setRecordingDefault(value) {
      recordingDefault = value;
      return recordingDefault;
    },
    async verify(id) {
      captured.verified = id;
      return { status: 'valid' };
    },
  };
  const sessionToken = createSessionToken();
  const server = await startServer({
    historyApi: { history, logsRoot: '/tmp/netrunner-api-test/Logs' },
    inventory: {},
    sessionToken,
    webRoot,
  });
  context.after(() => server.close());

  const listResponse = await request(
    server,
    sessionToken,
    '/api/history?protocol=ssh&ticket=CHG-1',
  );
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json())[0].hostname, 'sw-01');
  assert.equal(captured.filters.protocol, 'ssh');
  assert.equal(captured.filters.ticket, 'CHG-1');

  const verifyResponse = await request(server, sessionToken, '/api/history/session-1/verify', {
    method: 'POST',
  });
  assert.equal((await verifyResponse.json()).status, 'valid');
  assert.equal(captured.verified, 'session-1');

  const settingsResponse = await request(server, sessionToken, '/api/history/settings', {
    body: JSON.stringify({ recordingDefault: false }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  });
  assert.equal((await settingsResponse.json()).recordingDefault, false);

  const unauthorized = await fetch(`${server.origin}/api/history`);
  assert.equal(unauthorized.status, 401);
});
