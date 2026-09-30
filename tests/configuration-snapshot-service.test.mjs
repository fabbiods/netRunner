import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';
import { ConfigurationSnapshotService } from '../src/server/snapshots/configuration-snapshot-service.mjs';

async function withSnapshots(operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-snapshots-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const inventory = new InventoryService(database);
  const location = inventory.createLocation({ name: 'DC A', type: 'site' });
  const username = inventory.createUsername({ username: 'netops' });
  const snapshots = new ConfigurationSnapshotService({ database, inventory });
  try {
    return await operation({ database, inventory, location, snapshots, username });
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function createDevice(inventory, location, username, hostname = 'sw-01') {
  return inventory.createDevice({
    address: `${hostname}.example.net`,
    deviceType: 'switch',
    hostname,
    locationId: location.id,
    usernameId: username.id,
    vendor: 'cisco',
  }).device;
}

test('stores sanitized configuration snapshots with SHA-256 metadata', () =>
  withSnapshots(({ database, inventory, location, snapshots, username }) => {
    const device = createDevice(inventory, location, username);
    const created = snapshots.create({
      content: '\u001b[31m  hostname sw-01\u001b[0m\r\n username admin secret hidden\r\ninterface Gi1   \r\n',
      deviceId: device.id,
      name: 'Antes da mudança',
      source: 'terminal',
    });

    assert.equal(created.content, '  hostname sw-01\n [REDACTED SENSITIVE LINE]\ninterface Gi1');
    assert.equal(created.lineCount, 3);
    assert.equal(created.redactionCount, 1);
    assert.doesNotMatch(
      database.prepare('SELECT content FROM configuration_snapshots WHERE id = ?').get(created.id).content,
      /hidden/u,
    );
    assert.match(created.contentSha256, /^[a-f\d]{64}$/u);
    assert.equal(snapshots.list({ deviceId: device.id })[0].content, undefined);
    assert.equal(database.prepare('SELECT count(*) AS count FROM configuration_snapshots').get().count, 1);
  }));

test('compares two snapshots from the same device', () =>
  withSnapshots(({ inventory, location, snapshots, username }) => {
    const device = createDevice(inventory, location, username);
    const before = snapshots.create({
      content: 'hostname sw-01\ninterface Gi1\n shutdown',
      deviceId: device.id,
      name: 'Antes',
    });
    const after = snapshots.create({
      content: 'hostname sw-01\ninterface Gi1\n no shutdown\n description uplink',
      deviceId: device.id,
      name: 'Depois',
    });
    const comparison = snapshots.compare(before.id, after.id);

    assert.equal(comparison.identical, false);
    assert.deepEqual(comparison.stats, { added: 2, removed: 1, unchanged: 2 });
    assert.equal(comparison.rows.find((row) => row.kind === 'added').rightNumber, 3);
  }));

test('rejects cross-device comparisons and removes snapshots explicitly', () =>
  withSnapshots(({ inventory, location, snapshots, username }) => {
    const firstDevice = createDevice(inventory, location, username, 'sw-01');
    const secondDevice = createDevice(inventory, location, username, 'sw-02');
    const first = snapshots.create({ content: 'one', deviceId: firstDevice.id, name: 'One' });
    const second = snapshots.create({ content: 'two', deviceId: secondDevice.id, name: 'Two' });

    assert.throws(() => snapshots.compare(first.id, second.id), /mesmo dispositivo/iu);
    snapshots.delete(first.id);
    assert.throws(() => snapshots.get(first.id), /not found/iu);
  }));

test('enforces snapshot content and source limits', () =>
  withSnapshots(({ inventory, location, snapshots, username }) => {
    const device = createDevice(inventory, location, username);
    assert.throws(
      () => snapshots.create({ content: '', deviceId: device.id, name: 'Empty' }),
      (error) => error.code === 'validation_error' && error.details.field === 'content',
    );
    assert.throws(
      () => snapshots.create({ content: 'ok', deviceId: device.id, name: 'Bad', source: 'unknown' }),
      (error) => error.code === 'validation_error' && error.details.field === 'source',
    );
    assert.throws(
      () => snapshots.create({ content: 'x'.repeat(2 * 1024 * 1024 + 1), deviceId: device.id, name: 'Large' }),
      (error) => error.code === 'payload_too_large',
    );
  }));
