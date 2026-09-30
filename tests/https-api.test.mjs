import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

async function request(server, token, pathname, body) {
  return fetch(`${server.origin}${pathname}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

test('routes HTTPS certificate inspection and explicit browser handoff', async (context) => {
  const captured = { inspect: undefined, open: undefined };
  const httpsAccess = {
    async inspect(deviceId) {
      captured.inspect = deviceId;
      return {
        certificate: { fingerprint: 'SHA256:test' },
        trustStatus: 'untrusted-first-seen',
      };
    },
    async open(input) {
      captured.open = input;
      return { opened: true, sessionId: 'https-session-1' };
    },
  };
  const token = createSessionToken();
  const server = await startServer({ httpsAccess, inventory: {}, sessionToken: token, webRoot });
  context.after(() => server.close());

  const inspection = await request(server, token, '/api/https/inspect', { deviceId: 'device-1' });
  assert.equal(inspection.status, 200);
  assert.equal((await inspection.json()).certificate.fingerprint, 'SHA256:test');
  assert.equal(captured.inspect, 'device-1');

  const opened = await request(server, token, '/api/https/open', {
    decision: 'trust',
    deviceId: 'device-1',
    expectedFingerprint: 'SHA256:test',
  });
  assert.equal((await opened.json()).opened, true);
  assert.deepEqual(captured.open, {
    decision: 'trust',
    deviceId: 'device-1',
    expectedFingerprint: 'SHA256:test',
  });
});
