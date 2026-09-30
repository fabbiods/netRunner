import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/server/database/database.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

async function createApiServer(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-api-'));
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const inventory = new InventoryService(database);
  const sessionToken = createSessionToken();
  const server = await startServer({ inventory, sessionToken, webRoot });
  context.after(async () => {
    await server.close();
    database.close();
    await rm(directory, { force: true, recursive: true });
  });
  return { inventory, server, sessionToken };
}

function request(server, sessionToken, pathname, options = {}) {
  const headers = { Authorization: `Bearer ${sessionToken}`, ...options.headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${server.origin}${pathname}`, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
  });
}

test('exposes authenticated inventory CRUD routes', async (context) => {
  const { server, sessionToken } = await createApiServer(context);
  const locationResponse = await request(server, sessionToken, '/api/locations', {
    body: { name: 'Site-Teste', type: 'site' },
    method: 'POST',
  });
  assert.equal(locationResponse.status, 201);
  const location = await locationResponse.json();

  const usernameResponse = await request(server, sessionToken, '/api/usernames', {
    body: { username: 'netops' },
    method: 'POST',
  });
  assert.equal(usernameResponse.status, 201);
  const username = await usernameResponse.json();

  const deviceResponse = await request(server, sessionToken, '/api/devices', {
    body: {
      address: '192.0.2.40',
      deviceType: 'firewall',
      hostname: 'fw-exemplo-01',
      locationId: location.id,
      usernameId: username.id,
      vendor: 'fortinet',
    },
    method: 'POST',
  });
  assert.equal(deviceResponse.status, 201);
  const created = await deviceResponse.json();
  assert.equal(created.device.hostname, 'fw-exemplo-01');

  const searchResponse = await request(server, sessionToken, '/api/devices?search=fw-exemplo-01');
  assert.equal(searchResponse.status, 200);
  assert.equal((await searchResponse.json())[0].id, created.device.id);

  const summaryResponse = await request(server, sessionToken, '/api/inventory/summary');
  assert.deepEqual(await summaryResponse.json(), {
    devices: 1,
    favorites: 0,
    legacy: 0,
    locations: 1,
    usernames: 1,
  });

  const deleteResponse = await request(server, sessionToken, `/api/devices/${created.device.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.status, 204);
});

test('validates media type and does not expose internal errors', async (context) => {
  const { server, sessionToken } = await createApiServer(context);
  const mediaResponse = await fetch(`${server.origin}/api/locations`, {
    body: '{}',
    headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'text/plain' },
    method: 'POST',
  });
  assert.equal(mediaResponse.status, 415);
  assert.equal((await mediaResponse.json()).error, 'unsupported_media_type');

  const validationResponse = await request(server, sessionToken, '/api/locations', {
    body: { name: '', type: 'invalid' },
    method: 'POST',
  });
  assert.equal(validationResponse.status, 422);
  assert.equal((await validationResponse.json()).error, 'validation_error');
});

test('exports JSON and CSV with safe download headers', async (context) => {
  const { server, sessionToken } = await createApiServer(context);
  const jsonResponse = await request(server, sessionToken, '/api/export/json');
  assert.equal(jsonResponse.status, 200);
  assert.match(jsonResponse.headers.get('content-disposition'), /netrunner-inventory\.json/);

  const csvResponse = await request(server, sessionToken, '/api/export/csv');
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type'), /^text\/csv/);
  assert.match(await csvResponse.text(), /^hostname;/);
});
