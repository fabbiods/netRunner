import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runbookCatalog,
  runbookFamilyById,
  runbooksForDevice,
} from '../src/server/runbooks/runbook-catalog.mjs';

const sessionCommands = new Set(['set cli screen-length 0', 'skip', 'terminal length 0']);

test('keeps every runbook command on the immutable read-only allowlist', () => {
  for (const family of runbookCatalog) {
    for (const runbook of family.runbooks) {
      assert.ok(Object.isFrozen(runbook));
      assert.ok(Object.isFrozen(runbook.commands));
      for (const command of runbook.commands) {
        assert.ok(command.startsWith('show ') || sessionCommands.has(command), command);
        assert.doesNotMatch(command, /[\r\n;]/u);
      }
    }
  }
});

test('maps supported switches and keeps cloud access points without SSH runbooks', () => {
  assert.deepEqual(
    runbooksForDevice({ deviceType: 'switch', id: 'device-1', vendor: 'cisco' }).map(
      (runbook) => runbook.id,
    ),
    ['cisco-iosxe-configuration', 'cisco-iosxe-version'],
  );
  assert.deepEqual(
    runbooksForDevice({ deviceType: 'access-point', id: 'device-2', vendor: 'aruba' }),
    [],
  );
  assert.deepEqual(runbooksForDevice({ deviceType: 'other', id: null, vendor: 'other' }), []);
  assert.deepEqual(
    runbookCatalog.find((family) => family.id === 'ruckus-fastiron-switches').models,
    ['ICX8200', 'ICX7550', 'ICX7150'],
  );
});

test('provides exactly one complete configuration snapshot runbook per SSH family', () => {
  const sshFamilies = runbookCatalog.filter((family) => family.management === 'ssh');
  assert.ok(sshFamilies.length > 0);
  for (const family of sshFamilies) {
    const snapshotRunbooks = family.runbooks.filter((runbook) => runbook.kind === 'snapshot');
    assert.equal(snapshotRunbooks.length, 1, family.id);
    assert.match(snapshotRunbooks[0].commands.at(-1), /^show (?:running-config|configuration)$/u);
  }
});

test('allows an explicit safe profile for an unidentified session', () => {
  const device = { deviceType: 'other', id: 'device-1', vendor: 'other' };
  assert.deepEqual(runbooksForDevice(device), []);
  assert.deepEqual(
    runbooksForDevice(device, 'juniper-ex-switches').map((runbook) => runbook.id),
    ['juniper-junos-configuration', 'juniper-junos-version'],
  );
  assert.equal(runbookFamilyById('juniper-ex-switches').vendorLabel, 'Juniper');
  assert.throws(() => runbookFamilyById('aruba-central-access-points'), /Perfil de runbook/u);
});
