import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { migrations } from '../src/server/database/migrations.mjs';

test('upgrades a Marco 2 database without losing inventory records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-upgrade-'));
  const databasePath = path.join(directory, 'netrunner.sqlite');
  const original = new DatabaseSync(databasePath);
  try {
    original.exec(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT;
      ${migrations[0].sql}
    `);
    original
      .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
      .run(1, migrations[0].name, '2026-09-29T00:00:00.000Z');
    original
      .prepare(`INSERT INTO locations
        (id, name, code, type, parent_id, address, notes, position, created_at, updated_at)
        VALUES ('location-1', 'Site legado', NULL, 'site', NULL, NULL, NULL, 0, 'now', 'now')`)
      .run();
    original
      .prepare(`INSERT INTO usernames
        (id, username, description, is_default, created_at, updated_at)
        VALUES ('username-1', 'netops', NULL, 1, 'now', 'now')`)
      .run();
    original
      .prepare(`INSERT INTO devices
        (id, hostname, address, normalized_address, username_id, location_id, vendor, device_type,
         platform, notes, favorite, ssh_enabled, ssh_port, https_enabled, https_port, https_url,
         algorithm_profile, login_mode, terminal_type, backspace_mode, encoding, keepalive_interval,
         keepalive_limit, connect_timeout, last_connected_at, created_at, updated_at)
        VALUES
        ('device-1', 'sw-old', '192.0.2.20', '192.0.2.20', 'username-1', 'location-1',
         'cisco', 'switch', NULL, NULL, 0, 1, 22, 0, 443, NULL, 'modern', 'standard',
         'xterm-256color', 'del', 'utf-8', 0, 3, 20, NULL, 'now', 'now')`)
      .run();
  } finally {
    original.close();
  }

  const upgraded = await openDatabase(databasePath);
  try {
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 7);
    const device = upgraded.prepare('SELECT * FROM devices WHERE id = ?').get('device-1');
    assert.equal(device.hostname, 'sw-old');
    assert.equal(device.custom_algorithms, null);
    assert.equal(device.post_login_enabled, 0);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM known_hosts').get().count, 0);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM trusted_certificates').get().count, 0);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM device_health_checks').get().count, 0);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM configuration_snapshots').get().count, 0);
  } finally {
    upgraded.close();
    await rm(directory, { force: true, recursive: true });
  }
});
