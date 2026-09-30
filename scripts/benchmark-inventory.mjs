import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runInTransaction, openDatabase } from '../src/server/database/database.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';

const DEVICE_COUNT = 10_000;
const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-benchmark-'));
const database = await openDatabase(path.join(directory, 'benchmark.sqlite'));

try {
  const inventory = new InventoryService(database);
  const location = inventory.createLocation({ name: 'Laboratório', type: 'site' });
  const username = inventory.createUsername({ username: 'benchmark' });
  const timestamp = new Date().toISOString();
  const insertDevice = database.prepare(`
    INSERT INTO devices (
      id, hostname, address, normalized_address, username_id, location_id, vendor, device_type,
      platform, notes, favorite, ssh_enabled, ssh_port, https_enabled, https_port, https_url,
      algorithm_profile, login_mode, terminal_type, backspace_mode, encoding, keepalive_interval,
      keepalive_limit, connect_timeout, last_connected_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSearch = database.prepare(`
    INSERT INTO device_search
      (device_id, hostname, address, location_path, vendor, device_type, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  runInTransaction(database, () => {
    for (let index = 0; index < DEVICE_COUNT; index += 1) {
      const id = `benchmark-${index}`;
      const hostname = index === DEVICE_COUNT - 1 ? 'needle-target' : `switch-${index}`;
      const address = `192.0.2.${(index % 254) + 1}`;
      insertDevice.run(
        id,
        hostname,
        address,
        address,
        username.id,
        location.id,
        'cisco',
        'switch',
        null,
        null,
        0,
        1,
        22,
        0,
        443,
        null,
        'modern',
        'standard',
        'xterm-256color',
        'del',
        'utf-8',
        0,
        3,
        20,
        null,
        timestamp,
        timestamp,
      );
      insertSearch.run(id, hostname, address, 'Laboratório', 'cisco', 'switch', 'benchmark');
    }
  });

  inventory.listDevices({ search: 'needle' });
  const timings = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const startedAt = performance.now();
    const results = inventory.listDevices({ search: 'needle' });
    timings.push(performance.now() - startedAt);
    if (results.length !== 1) throw new Error('Benchmark search returned an unexpected result');
  }
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.floor((timings.length - 1) * 0.95)];
  process.stdout.write(`Busca FTS5 em ${DEVICE_COUNT} dispositivos: p95 ${p95.toFixed(2)} ms\n`);
  if (p95 >= 100) {
    process.stderr.write('Meta não atendida: a busca deve permanecer abaixo de 100 ms.\n');
    process.exitCode = 1;
  }
} finally {
  database.close();
  await rm(directory, { force: true, recursive: true });
}
