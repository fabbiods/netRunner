import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

test('routes authenticated health listing and checks', async (context) => {
  const calls = [];
  const health = {
    async checkDevices(deviceIds) {
      calls.push(deviceIds);
      return [{ deviceId: deviceIds[0], overallStatus: 'online' }];
    },
    listHistory(deviceId, limit) {
      return [{ deviceId, limit }];
    },
    listLatest() {
      return [{ deviceId: 'device-1', overallStatus: 'offline' }];
    },
  };
  const token = createSessionToken();
  const server = await startServer({ health, inventory: {}, sessionToken: token, webRoot });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const latest = await fetch(`${server.origin}/api/device-health`, { headers });
  assert.equal(latest.status, 200);
  assert.equal((await latest.json())[0].overallStatus, 'offline');

  const history = await fetch(`${server.origin}/api/device-health?deviceId=device-1&limit=7`, { headers });
  assert.deepEqual(await history.json(), [{ deviceId: 'device-1', limit: '7' }]);

  const checked = await fetch(`${server.origin}/api/device-health/check`, {
    body: JSON.stringify({ deviceIds: ['device-1'] }),
    headers,
    method: 'POST',
  });
  assert.equal(checked.status, 200);
  assert.equal((await checked.json())[0].overallStatus, 'online');
  assert.deepEqual(calls, [['device-1']]);
});
