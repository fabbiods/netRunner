import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TerminalOutputNormalizer } from '../src/server/recording/terminal-output-normalizer.mjs';

const vendorFixtures = JSON.parse(
  await readFile(new URL('./fixtures/vendor-terminal-output.json', import.meta.url), 'utf8'),
);

test('normalizes ANSI, backspaces, pager markers and carriage-return rewrites', async () => {
  const normalizer = new TerminalOutputNormalizer({ columns: 80, rows: 24 });
  try {
    assert.deepEqual(await normalizer.write('\u001b[31mhello\u001b[0m\r\n'), ['hello']);
    assert.deepEqual(await normalizer.write('abc\bX\r\n'), ['abX']);
    assert.deepEqual(await normalizer.write('result --More--\r\n'), ['result']);
    assert.deepEqual(await normalizer.write('Progress 1%\rProgress 2%\r\n'), ['Progress 2%']);
  } finally {
    normalizer.dispose();
  }
});

test('joins artificial terminal wraps into one logical line', async () => {
  const normalizer = new TerminalOutputNormalizer({ columns: 10, rows: 5 });
  try {
    assert.deepEqual(await normalizer.write('1234567890ABC\r\n'), ['1234567890ABC']);
    assert.deepEqual(await normalizer.write('tail'), []);
    assert.deepEqual(normalizer.flush(), ['tail']);
  } finally {
    normalizer.dispose();
  }
});

test('normalizes representative output fixtures from supported vendors', async () => {
  for (const fixture of vendorFixtures) {
    const normalizer = new TerminalOutputNormalizer({ columns: 120, rows: 24 });
    try {
      assert.deepEqual(await normalizer.write(fixture.input), [fixture.expected], fixture.vendor);
    } finally {
      normalizer.dispose();
    }
  }
});
