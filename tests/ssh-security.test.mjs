import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ssh2 from 'ssh2';
import { openDatabase } from '../src/server/database/database.mjs';
import {
  ALGORITHM_CATALOG,
  LEGACY_ALGORITHMS,
  MODERN_ALGORITHMS,
  normalizeCustomAlgorithms,
  resolveAlgorithmProfile,
} from '../src/server/ssh/algorithm-profiles.mjs';
import { HostKeyService } from '../src/server/ssh/host-key-service.mjs';

test('algorithm profiles never include explicitly prohibited algorithms', () => {
  const prohibited = ['none', 'arcfour', 'arcfour128', 'arcfour256', 'blowfish-cbc', 'cast128-cbc', 'hmac-md5'];
  for (const profile of [MODERN_ALGORITHMS, LEGACY_ALGORITHMS]) {
    assert.equal(Object.values(profile).flat().some((algorithm) => prohibited.includes(algorithm)), false);
  }
  assert.ok(LEGACY_ALGORITHMS.kex.includes('diffie-hellman-group14-sha1'));
  assert.equal(MODERN_ALGORITHMS.kex.includes('diffie-hellman-group14-sha1'), false);
});

test('custom algorithm profiles accept only the allowlist', () => {
  const custom = Object.fromEntries(
    Object.entries(ALGORITHM_CATALOG).map(([category, algorithms]) => [category, [algorithms[0]]]),
  );
  assert.deepEqual(resolveAlgorithmProfile('custom', custom), custom);
  assert.throws(
    () => normalizeCustomAlgorithms({ ...custom, cipher: ['arcfour'] }),
    /validation failed/i,
  );
});

test('TOFU trusts the first key, recognizes it and blocks an unapproved change', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-host-key-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  try {
    const service = new HostKeyService(database);
    const firstKey = ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 }).public;
    const secondKey = ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 }).public;
    const first = service.inspect({ deviceId: null, host: '192.0.2.10', key: firstKey, port: 22 });
    assert.equal(first.status, 'unknown');
    assert.match(first.candidate.fingerprint, /^SHA256:/);
    service.trust(first.candidate);
    assert.equal(
      service.inspect({ deviceId: null, host: '192.0.2.10', key: firstKey, port: 22 }).status,
      'trusted',
    );

    const changed = service.inspect({ deviceId: null, host: '192.0.2.10', key: secondKey, port: 22 });
    assert.equal(changed.status, 'changed');
    assert.notEqual(changed.candidate.fingerprint, changed.known.fingerprint);
    assert.throws(() => service.trust(changed.candidate), /requires an explicit replacement/i);
    service.trust(changed.candidate, { replace: true });
    assert.equal(service.list()[0].fingerprint, changed.candidate.fingerprint);
    service.remove(service.list()[0].id);
    assert.equal(service.list().length, 0);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});
