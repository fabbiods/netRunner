import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { exportInventoryCsv, applyImport, previewImport } from '../src/server/inventory/import-export.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';

async function withInventory(operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-import-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const inventory = new InventoryService(database);
  try {
    return await operation(inventory);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

const csv = `\uFEFFhostname;address;vendor;device_type;platform;location;username;ssh_port;https_url;tags;favorite\n"sw;exemplo-01";192.0.2.1;cisco;switch;C9300;Brasil › Site-Teste;netops;22;;"core|produção";sim\n`;

test('previews and imports CSV with optional reference creation', () =>
  withInventory((inventory) => {
    const preview = previewImport(inventory, { content: csv, format: 'csv' });
    assert.equal(preview.total, 1);
    assert.deepEqual(preview.missingLocations, ['Brasil › Site-Teste']);
    assert.deepEqual(preview.missingUsernames, ['netops']);

    const result = applyImport(inventory, {
      content: csv,
      createMissingLocations: true,
      createMissingUsernames: true,
      format: 'csv',
    });
    assert.deepEqual(result, { created: 1, skipped: 0, total: 1 });
    assert.equal(inventory.listDevices()[0].hostname, 'sw;exemplo-01');
    assert.equal(inventory.listDevices()[0].favorite, true);
    assert.match(exportInventoryCsv(inventory), /^\uFEFFhostname;/);
  }));

test('imports the native JSON export and skips existing duplicates', () =>
  withInventory((inventory) => {
    applyImport(inventory, {
      content: csv,
      createMissingLocations: true,
      createMissingUsernames: true,
      format: 'csv',
    });
    const exported = inventory.exportInventory();
    const preview = previewImport(inventory, { content: exported, format: 'json' });
    assert.equal(preview.warnings[0].code, 'duplicate_device');
    const result = applyImport(inventory, { content: exported, format: 'json' });
    assert.deepEqual(result, { created: 0, skipped: 1, total: 1 });
  }));

test('imports a location-only CSV and reports row validation errors in preview', () =>
  withInventory((inventory) => {
    const locationsCsv = '\uFEFFlocation;type\nBrasil › São Paulo › Site-Teste;site\n';
    const preview = previewImport(inventory, { content: locationsCsv, format: 'csv' });
    assert.equal(preview.locationTotal, 1);
    assert.deepEqual(preview.missingLocations, ['Brasil › São Paulo › Site-Teste']);
    applyImport(inventory, {
      content: locationsCsv,
      createMissingLocations: true,
      format: 'csv',
    });
    assert.ok(
      inventory.listLocations().some((location) => location.path === 'Brasil › São Paulo › Site-Teste'),
    );

    const invalidCsv = '\uFEFFhostname;address;vendor;device_type;location;username\nbad;invalid address;cisco;switch;Site-Teste;netops\n';
    const invalidPreview = previewImport(inventory, { content: invalidCsv, format: 'csv' });
    assert.equal(invalidPreview.errors[0].field, 'address');
  }));
