import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContentSecurityPolicy,
  createSecurityHeaders,
  createSessionToken,
  isRequestTargetTrusted,
  isSessionTokenValid,
  readBearerToken,
} from '../src/server/security.mjs';

test('creates a high-entropy URL-safe session token', () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, createSessionToken());
});

test('compares session tokens without accepting malformed input', () => {
  const token = createSessionToken();
  assert.equal(isSessionTokenValid(token, token), true);
  assert.equal(isSessionTokenValid(`${token}x`, token), false);
  assert.equal(isSessionTokenValid(undefined, token), false);
  assert.equal(readBearerToken(`Bearer ${token}`), token);
  assert.equal(readBearerToken(`Basic ${token}`), undefined);
});

test('uses a restrictive content security policy', () => {
  const policy = buildContentSecurityPolicy();
  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.doesNotMatch(policy, /unsafe-eval|unsafe-inline|https:/);

  const headers = createSecurityHeaders();
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});

test('rejects DNS rebinding and cross-origin requests', () => {
  const expectedAuthority = '127.0.0.1:43210';
  assert.equal(
    isRequestTargetTrusted({ headers: { host: expectedAuthority } }, expectedAuthority),
    true,
  );
  assert.equal(
    isRequestTargetTrusted({ headers: { host: 'attacker.example' } }, expectedAuthority),
    false,
  );
  assert.equal(
    isRequestTargetTrusted(
      { headers: { host: expectedAuthority, origin: 'https://attacker.example' } },
      expectedAuthority,
    ),
    false,
  );
});
