import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';

async function withInventory(operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-inventory-'));
  const databasePath = path.join(directory, 'netrunner.sqlite');
  const database = await openDatabase(databasePath);
  const inventory = new InventoryService(database);
  try {
    return await operation({ database, databasePath, inventory });
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function createReferences(inventory) {
  const country = inventory.createLocation({ name: 'Brasil', type: 'country' });
  const site = inventory.createLocation({
    code: 'SP04',
    name: 'Cajamar',
    parentId: country.id,
    type: 'site',
  });
  const username = inventory.createUsername({ username: 'netops' });
  return { country, site, username };
}

function deviceInput({ locationId, usernameId, ...overrides }) {
  return {
    address: 'sw01.example.net',
    deviceType: 'switch',
    hostname: 'sw01',
    locationId,
    tags: ['core', 'produção'],
    usernameId,
    vendor: 'cisco',
    ...overrides,
  };
}

test('applies migrations and protects the database file', () =>
  withInventory(async ({ database, databasePath }) => {
    assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 7);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
  }));

test('manages the location hierarchy and rejects cycles', () =>
  withInventory(({ inventory }) => {
    const { country, site } = createReferences(inventory);
    assert.equal(site.path, 'Brasil › Cajamar');
    assert.throws(
      () => inventory.updateLocation(country.id, { parentId: site.id }),
      /cannot be moved inside itself/i,
    );

    const destination = inventory.createLocation({ name: 'Barueri', parentId: country.id, type: 'site' });
    const rack = inventory.createLocation({ name: 'Rack A', parentId: site.id, type: 'rack' });
    inventory.deleteLocation(site.id, destination.id);
    assert.equal(inventory.listLocations().find((item) => item.id === rack.id).parentId, destination.id);
  }));

test('keeps one default username and supports safe reassignment', () =>
  withInventory(({ inventory }) => {
    const first = inventory.createUsername({ username: 'first' });
    const second = inventory.createUsername({ isDefault: true, username: 'second' });
    assert.equal(inventory.listUsernames().find((item) => item.id === first.id).isDefault, false);
    assert.equal(inventory.listUsernames().find((item) => item.id === second.id).isDefault, true);

    const location = inventory.createLocation({ name: 'DC', type: 'site' });
    const created = inventory.createDevice(
      deviceInput({ locationId: location.id, usernameId: second.id }),
    ).device;
    assert.throws(() => inventory.deleteUsername(second.id), /replacement username is required/i);
    inventory.deleteUsername(second.id, first.id);
    assert.equal(inventory.getDevice(created.id).usernameId, first.id);
    assert.equal(inventory.listUsernames()[0].isDefault, true);
  }));

test('creates, searches, updates and groups devices', () =>
  withInventory(({ inventory }) => {
    const { site, username } = createReferences(inventory);
    const first = inventory.createDevice(deviceInput({ locationId: site.id, usernameId: username.id }));
    assert.equal(first.device.locationPath, 'Brasil › Cajamar');
    assert.deepEqual(first.device.tags, ['core', 'produção']);
    assert.equal(inventory.listDevices({ search: 'Cajamar' })[0].id, first.device.id);
    assert.equal(inventory.listDevices({ search: 'produção' })[0].id, first.device.id);

    const duplicate = inventory.createDevice(
      deviceInput({
        hostname: 'sw02',
        locationId: site.id,
        tags: [],
        usernameId: username.id,
      }),
    );
    assert.equal(duplicate.warnings[0].code, 'duplicate_address');

    const updated = inventory.updateDevice(first.device.id, { favorite: true });
    assert.equal(updated.device.favorite, true);
    assert.deepEqual(inventory.listDevices({ favorites: true }).map((device) => device.id), [first.device.id]);

    const customAlgorithms = {
      cipher: ['aes256-ctr'],
      hmac: ['hmac-sha2-256'],
      kex: ['curve25519-sha256'],
      serverHostKey: ['ssh-ed25519'],
    };
    const custom = inventory.updateDevice(first.device.id, {
      algorithmProfile: 'custom',
      customAlgorithms,
    });
    assert.deepEqual(custom.device.customAlgorithms, customAlgorithms);

    inventory.bulkUpdateDevices([first.device.id, duplicate.device.id], { algorithmProfile: 'legacy' });
    assert.equal(inventory.getSummary().legacy, 2);
    inventory.markDeviceConnected(duplicate.device.id);
    assert.equal(inventory.listDevices({ recent: true })[0].id, duplicate.device.id);
  }));

test('validates addresses, URLs and protocol settings', () =>
  withInventory(({ inventory }) => {
    const { site, username } = createReferences(inventory);
    assert.throws(
      () =>
        inventory.createDevice(
          deviceInput({ address: 'not a fqdn', locationId: site.id, usernameId: username.id }),
        ),
      /validation failed/i,
    );
    assert.throws(
      () =>
        inventory.createDevice(
          deviceInput({
            httpsEnabled: true,
            httpsUrl: 'https://user:secret@example.net',
            locationId: site.id,
            usernameId: username.id,
          }),
        ),
      /validation failed/i,
    );
    assert.throws(
      () =>
        inventory.createDevice(
          deviceInput({
            httpsEnabled: false,
            locationId: site.id,
            sshEnabled: false,
            usernameId: username.id,
          }),
        ),
      /validation failed/i,
    );
    assert.throws(
      () =>
        inventory.createDevice(
          deviceInput({
            locationId: site.id,
            postLoginCommand: 'configure terminal',
            postLoginEnabled: true,
            usernameId: username.id,
          }),
        ),
      /validation failed/i,
    );
  }));
