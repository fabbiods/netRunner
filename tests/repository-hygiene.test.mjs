import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
const ignoredPatterns = new Set(gitignore.split(/\r?\n/u));

test('keeps local inventory data and credentials out of version control', () => {
  for (const pattern of [
    '*.db',
    '*.sqlite',
    '*.sqlite-*',
    '/backups/',
    '/logs/',
    '/exports/',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
  ]) {
    assert.equal(ignoredPatterns.has(pattern), true, pattern);
  }
});
