import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSensitiveConfiguration } from '../src/server/snapshots/configuration-redactor.mjs';

test('redacts representative secrets from supported network systems', () => {
  const input = [
    'hostname sw-01',
    'username admin secret 9 hidden-value',
    'snmp-server community internal-read ro',
    'snmp-server user monitor ops v3 auth sha auth-value priv aes 128 priv-value',
    'set system root-authentication encrypted-password "$6$hidden"',
    'radius-server host 192.0.2.1 key radius-value',
    ' key 7 encoded-value',
    'local-user netops password irreversible-cipher hidden',
    'wlan ssid-profile Corp pre-shared-key passphrase hidden',
    'description https://user:pass@example.net/path',
    'interface Gi1',
  ].join('\n');
  const result = redactSensitiveConfiguration(input);

  assert.equal(result.redactionCount, 9);
  assert.doesNotMatch(result.content, /hidden|internal-read|auth-value|priv-value|radius-value|encoded-value|user:pass/iu);
  assert.match(result.content, /hostname sw-01/u);
  assert.match(result.content, /interface Gi1/u);
});

test('replaces complete private key blocks with one marker', () => {
  const result = redactSensitiveConfiguration([
    'crypto material',
    ' -----BEGIN PRIVATE KEY-----',
    'sensitive-base64',
    '-----END PRIVATE KEY-----',
    'end',
  ].join('\n'));

  assert.equal(result.redactionCount, 1);
  assert.equal(result.content, 'crypto material\n [REDACTED PRIVATE KEY]\nend');
});
