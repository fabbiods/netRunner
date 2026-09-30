import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { AppSettingsService } from '../src/server/settings/app-settings-service.mjs';

test('persists validated application settings and notifies runtime listeners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-settings-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  try {
    const settings = new AppSettingsService(database);
    assert.equal(settings.getAll().theme, 'dark');
    assert.equal(settings.getAll().terminalScrollback, 20_000);
    let notification;
    settings.onChange((updated) => {
      notification = updated;
    });
    const updated = settings.update({
      highlightKeywords: ['DOWN', 'critical', 'down'],
      idleDisconnectMinutes: 15,
      pasteDelayMs: 50,
      recordingDefault: false,
      theme: 'high-contrast',
    });
    assert.deepEqual(updated.highlightKeywords, ['DOWN', 'critical']);
    assert.equal(updated.idleDisconnectMinutes, 15);
    assert.equal(notification.theme, 'high-contrast');
    assert.equal(new AppSettingsService(database).getAll().recordingDefault, false);

    assert.throws(() => settings.update({ idleDisconnectMinutes: -1 }), /Validation failed/);
    assert.throws(() => settings.update({ unknownOption: true }), /Validation failed/);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});
