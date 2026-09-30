import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { CertificateTrustService } from '../src/server/https/certificate-trust-service.mjs';
import { HttpsAccessService } from '../src/server/https/https-access-service.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';
import { SessionHistoryService } from '../src/server/recording/session-history-service.mjs';

function certificate(fingerprint, authorized = false) {
  return {
    authorizationError: authorized ? null : 'DEPTH_ZERO_SELF_SIGNED_CERT',
    authorized,
    cipher: 'TLS_AES_256_GCM_SHA384',
    fingerprint,
    issuer: 'CN=NetRunner Test CA',
    protocol: 'TLSv1.3',
    subject: 'CN=device.example.net',
    subjectAltName: 'DNS:device.example.net',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2030-01-01T00:00:00.000Z',
  };
}

async function environment(address = 'device.example.net', httpsUrl = null) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-https-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const inventory = new InventoryService(database);
  const location = inventory.createLocation({ name: 'Site HTTPS', type: 'site' });
  const username = inventory.createUsername({ username: 'netops' });
  const device = inventory.createDevice({
    address,
    deviceType: 'firewall',
    hostname: 'fw-https',
    httpsEnabled: true,
    httpsPort: 8443,
    httpsUrl,
    locationId: location.id,
    sshEnabled: false,
    usernameId: username.id,
    vendor: 'fortinet',
  }).device;
  return { database, device, directory, inventory };
}

test('requires TOFU for an untrusted certificate and blocks an unapproved change', async () => {
  const setup = await environment();
  let presented = certificate('SHA256:first');
  const opened = [];
  const history = new SessionHistoryService(setup.database);
  const certificates = new CertificateTrustService(setup.database);
  const service = new HttpsAccessService({
    certificates,
    history,
    inventory: setup.inventory,
    openExternal: async (url) => opened.push(url),
    probe: async () => presented,
  });
  try {
    const first = await service.inspect(setup.device.id);
    assert.equal(first.trustStatus, 'untrusted-first-seen');
    await assert.rejects(
      service.open({
        decision: 'none',
        deviceId: setup.device.id,
        expectedFingerprint: presented.fingerprint,
      }),
      /explicit trust/,
    );

    await service.open({
      decision: 'trust',
      deviceId: setup.device.id,
      expectedFingerprint: presented.fingerprint,
    });
    assert.equal(opened[0], 'https://device.example.net:8443/');
    assert.equal((await service.inspect(setup.device.id)).trustStatus, 'pinned');

    presented = certificate('SHA256:changed');
    const changed = await service.inspect(setup.device.id);
    assert.equal(changed.trustStatus, 'changed');
    assert.equal(changed.previousFingerprint, 'SHA256:first');
    await assert.rejects(
      service.open({
        decision: 'trust',
        deviceId: setup.device.id,
        expectedFingerprint: presented.fingerprint,
      }),
      /explicit replacement/,
    );
    await service.open({
      decision: 'replace',
      deviceId: setup.device.id,
      expectedFingerprint: presented.fingerprint,
    });

    const sessions = history.list({ protocol: 'https' });
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].reason, 'external_browser_handoff');
    assert.equal(sessions[0].recorded, false);
    assert.equal(sessions[0].hostFingerprint, 'SHA256:changed');
    assert.equal(certificates.list().length, 1);
    certificates.remove(certificates.list()[0].id);
    assert.equal(certificates.list().length, 0);
  } finally {
    setup.database.close();
    await rm(setup.directory, { force: true, recursive: true });
  }
});

test('uses a custom IPv6 HTTPS URL without brackets in the TLS socket host', async () => {
  const setup = await environment('2001:db8::10', 'https://[2001:db8::20]:9443/admin');
  const probes = [];
  const service = new HttpsAccessService({
    certificates: new CertificateTrustService(setup.database),
    history: new SessionHistoryService(setup.database),
    inventory: setup.inventory,
    openExternal: async () => {},
    probe: async (target) => {
      probes.push(target);
      return certificate('SHA256:public', true);
    },
  });
  try {
    const inspected = await service.inspect(setup.device.id);
    assert.equal(inspected.trustStatus, 'system-trusted');
    assert.equal(inspected.url, 'https://[2001:db8::20]:9443/admin');
    assert.equal(probes[0].host, '2001:db8::20');
    assert.equal(probes[0].port, 9443);
  } finally {
    setup.database.close();
    await rm(setup.directory, { force: true, recursive: true });
  }
});

test('fails closed when the presented certificate is expired', async () => {
  const setup = await environment();
  const expired = { ...certificate('SHA256:expired'), validTo: '2026-01-02T00:00:00.000Z' };
  const service = new HttpsAccessService({
    certificates: new CertificateTrustService(setup.database),
    history: new SessionHistoryService(setup.database),
    inventory: setup.inventory,
    openExternal: async () => assert.fail('expired certificate must not be opened'),
    probe: async () => expired,
  });
  try {
    await assert.rejects(service.inspect(setup.device.id), /expirado/);
  } finally {
    setup.database.close();
    await rm(setup.directory, { force: true, recursive: true });
  }
});
