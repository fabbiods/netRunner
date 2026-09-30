import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLines } from '../src/server/snapshots/line-diff.mjs';

test('creates a line diff with stable line numbers', () => {
  assert.deepEqual(diffLines(['hostname old', 'interface Gi1', ' shutdown'], ['hostname new', 'interface Gi1', ' no shutdown']), [
    { kind: 'removed', leftNumber: 1, rightNumber: null, text: 'hostname old' },
    { kind: 'added', leftNumber: null, rightNumber: 1, text: 'hostname new' },
    { kind: 'equal', leftNumber: 2, rightNumber: 2, text: 'interface Gi1' },
    { kind: 'removed', leftNumber: 3, rightNumber: null, text: ' shutdown' },
    { kind: 'added', leftNumber: null, rightNumber: 3, text: ' no shutdown' },
  ]);
});

test('handles identical and empty line collections', () => {
  assert.deepEqual(diffLines(['same'], ['same']), [
    { kind: 'equal', leftNumber: 1, rightNumber: 1, text: 'same' },
  ]);
  assert.deepEqual(diffLines([], ['new']), [
    { kind: 'added', leftNumber: null, rightNumber: 1, text: 'new' },
  ]);
});
