import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensurePrivateDirectory, resolveAppDataDirectory } from '../src/server/app-paths.mjs';

test('resolves the approved macOS application data path', () => {
  assert.equal(
    resolveAppDataDirectory({ homeDirectory: '/Users/network', platform: 'darwin' }),
    '/Users/network/Library/Application Support/NetRunner',
  );
});

test('creates application directories with owner-only permissions', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'netrunner-test-'));
  context.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const applicationDirectory = path.join(temporaryRoot, 'data');

  await ensurePrivateDirectory(applicationDirectory);
  const metadata = await stat(applicationDirectory);

  assert.equal(metadata.mode & 0o777, 0o700);
});
