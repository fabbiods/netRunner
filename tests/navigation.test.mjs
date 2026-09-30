import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationGroupForView, sessionNavigationTarget } from '../src/web/navigation.js';

test('returns to the active session before falling back to another open session', () => {
  assert.equal(sessionNavigationTarget('session-2', ['session-1', 'session-2']), 'session-2');
  assert.equal(sessionNavigationTarget('closed-session', ['session-1', 'session-2']), 'session-1');
  assert.equal(sessionNavigationTarget(undefined, []), undefined);
});

test('groups registration and operational views under compact menus', () => {
  assert.equal(navigationGroupForView('locations'), 'registration');
  assert.equal(navigationGroupForView('usernames'), 'registration');
  assert.equal(navigationGroupForView('devices'), 'registration');
  assert.equal(navigationGroupForView('health'), 'operation');
  assert.equal(navigationGroupForView('settings'), 'administration');
  assert.equal(navigationGroupForView('terminal'), undefined);
});
