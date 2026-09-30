import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalStylesForText } from '../src/web/terminal-styles.js';

test('styles offline and down as danger and online and up as success', () => {
  const styles = terminalStylesForText('Port DOWN, peer offline; uplink UP and service online');
  assert.deepEqual(styles.map(({ kind }) => kind), ['danger', 'danger', 'success', 'success']);
});

test('does not highlight status words inside larger words', () => {
  assert.deepEqual(terminalStylesForText('startup backup download').map(({ kind }) => kind), []);
});

test('styles 100 Mbps as warning and gigabit-or-faster rates as speed', () => {
  const styles = terminalStylesForText('Ethernet 100Mbps, uplink 1 Gbps, core 10Gbps, aggregate 1000mbps');
  assert.deepEqual(styles.map(({ kind }) => kind), ['warning', 'speed', 'speed', 'speed']);
});

test('keeps custom highlights without overriding semantic styles', () => {
  const styles = terminalStylesForText('critical port down', {
    keywords: ['critical', 'down'],
    theme: 'light',
  });
  assert.deepEqual(styles.map(({ kind }) => kind), ['custom', 'danger']);
  assert.equal(styles[1].foregroundColor, '#a91925');
});
