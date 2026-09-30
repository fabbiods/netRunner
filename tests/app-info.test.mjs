import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_VERSION, CONTRACT_VERSION, createHealthResponse } from '../src/shared/app-info.mjs';

test('health response exposes only expected local capability data', () => {
  assert.deepEqual(createHealthResponse('darwin'), {
    contractVersion: CONTRACT_VERSION,
    name: 'NetRunner',
    platform: 'darwin',
    security: {
      externalConnections: false,
      loopbackOnly: true,
      telemetry: false,
    },
    status: 'ok',
    version: APP_VERSION,
  });
});
