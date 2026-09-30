import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDailyBackup } from '../src/server/database/backups.mjs';
import { openDatabase } from '../src/server/database/database.mjs';

test('creates one private backup per day and applies retention', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-backup-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const backupDirectory = path.join(directory, 'Backups');
  try {
    for (let day = 1; day <= 4; day += 1) {
      await createDailyBackup(database, backupDirectory, {
        date: new Date(`2026-09-0${day}T12:00:00Z`),
        retain: 3,
      });
    }
    const repeated = await createDailyBackup(database, backupDirectory, {
      date: new Date('2026-09-04T20:00:00Z'),
      retain: 3,
    });
    assert.equal(repeated.created, false);
    assert.deepEqual(await readdir(backupDirectory), [
      'netrunner-2026-09-02.sqlite',
      'netrunner-2026-09-03.sqlite',
      'netrunner-2026-09-04.sqlite',
    ]);
    assert.equal((await stat(repeated.backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(backupDirectory)).mode & 0o777, 0o700);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});
