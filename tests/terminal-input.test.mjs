import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMultilineInput } from '../src/web/terminal-input.js';

test('does not classify keyboard Enter as multiline paste', () => {
  assert.equal(splitMultilineInput('\r'), undefined);
  assert.equal(splitMultilineInput('show interfaces\r'), undefined);
  assert.equal(splitMultilineInput('show interfaces\r\n'), undefined);
});

test('splits actual multiline input while preserving line endings', () => {
  assert.deepEqual(splitMultilineInput('show clock\rshow interfaces\r'), [
    'show clock\r',
    'show interfaces\r',
  ]);
  assert.deepEqual(splitMultilineInput('show clock\nshow interfaces'), [
    'show clock\n',
    'show interfaces',
  ]);
});
