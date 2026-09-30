import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPendingRestore, BackupService } from '../src/server/database/backup-service.mjs';
import { openDatabase } from '../src/server/database/database.mjs';
import { AppSettingsService } from '../src/server/settings/app-settings-service.mjs';

test('creates, validates and applies a queued restore on the next startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-restore-'));
  const databasePath = path.join(directory, 'netrunner.sqlite');
  let database = await openDatabase(databasePath);
  try {
    const settings = new AppSettingsService(database);
    settings.update({ theme: 'light' });
    const backups = new BackupService({ appDataDirectory: directory, database });
    const created = await backups.createManual();
    settings.update({ theme: 'high-contrast' });
    const queued = await backups.queueRestore(created.name);
    assert.equal(queued.restartRequired, true);
    assert.equal((await backups.list())[0].pendingRestore, true);
    await assert.rejects(backups.queueRestore('../outside.sqlite'), /not found/);

    database.close();
    database = undefined;
    const restored = await applyPendingRestore(directory, databasePath);
    assert.equal(restored.restored, true);
    database = await openDatabase(databasePath);
    assert.equal(new AppSettingsService(database).getAll().theme, 'light');
    const files = await readdir(path.join(directory, 'Backups'));
    assert.ok(files.some((name) => name.startsWith('netrunner-pre-restore-')));
  } finally {
    database?.close();
    await rm(directory, { force: true, recursive: true });
  }
});
