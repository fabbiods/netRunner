import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { DeviceHealthService } from '../src/server/health/device-health-service.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';

async function withHealth(operation, probes = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-health-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const inventory = new InventoryService(database);
  const location = inventory.createLocation({ name: 'Site A', type: 'site' });
  const username = inventory.createUsername({ username: 'netops' });
  const health = new DeviceHealthService({ database, inventory, ...probes });
  try {
    return await operation({ database, health, inventory, location, username });
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function createDevice(inventory, location, username, overrides = {}) {
  return inventory.createDevice({
    address: '192.0.2.10',
    deviceType: 'switch',
    hostname: 'sw-health-01',
    locationId: location.id,
    usernameId: username.id,
    vendor: 'cisco',
    ...overrides,
  }).device;
}

const online = async () => ({ latencyMs: 12, reason: null, status: 'online' });
const offline = async () => ({ latencyMs: null, reason: 'timeout', status: 'offline' });

test('checks enabled protocols and persists the latest health result', () =>
  withHealth(
    async ({ database, health, inventory, location, username }) => {
      const device = createDevice(inventory, location, username, {
        httpsEnabled: true,
        httpsUrl: 'https://[2001:db8::10]:8443/status',
      });
      const [result] = await health.checkDevices([device.id]);

      assert.equal(result.overallStatus, 'online');
      assert.equal(result.ping.status, 'online');
      assert.equal(result.ssh.latencyMs, 12);
      assert.equal(result.https.status, 'online');
      assert.equal(database.prepare('SELECT count(*) AS count FROM device_health_checks').get().count, 1);
      assert.deepEqual(health.listLatest().map((item) => item.deviceId), [device.id]);
      assert.equal(health.listLatest()[0].locationPath, 'Site A');
    },
    { pingProbe: online, tcpProbe: online, tlsProbe: online },
  ));

test('reports degraded and offline states without using disabled protocols', async () => {
  let tcpResult = await offline();
  await withHealth(
    async ({ health, inventory, location, username }) => {
      const degraded = createDevice(inventory, location, username, {
        httpsEnabled: true,
      });
      const first = await health.checkDevice(degraded.id);
      assert.equal(first.overallStatus, 'degraded');

      tcpResult = await offline();
      const sshOnly = createDevice(inventory, location, username, {
        address: '192.0.2.11',
        hostname: 'sw-health-02',
      });
      const second = await health.checkDevice(sshOnly.id);
      assert.equal(second.overallStatus, 'offline');
      assert.equal(second.https.status, 'disabled');
    },
    {
      pingProbe: offline,
      tcpProbe: async () => tcpResult,
      tlsProbe: online,
    },
  );
});

test('limits health batches to twenty unique devices', () =>
  withHealth(async ({ health }) => {
    await assert.rejects(
      health.checkDevices(Array.from({ length: 21 }, (_, index) => `device-${index}`)),
      (error) => error.code === 'batch_too_large' && error.details.maximum === 20,
    );
    await assert.rejects(
      health.checkDevices([]),
      (error) => error.code === 'validation_error' && error.details.field === 'deviceIds',
    );
  }));

test('retains only the latest one hundred checks per device', () =>
  withHealth(
    async ({ database, health, inventory, location, username }) => {
      const device = createDevice(inventory, location, username);
      for (let index = 0; index < 105; index += 1) await health.checkDevice(device.id);
      assert.equal(
        database
          .prepare('SELECT count(*) AS count FROM device_health_checks WHERE device_id = ?')
          .get(device.id).count,
        100,
      );
      assert.equal(health.listHistory(device.id, 500).length, 100);
    },
    { pingProbe: online, tcpProbe: online, tlsProbe: online },
  ));
