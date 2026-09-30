import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageRoot = path.resolve(currentDirectory, '../img');
const webRoot = path.resolve(currentDirectory, '../src/web');
const vendorRoot = path.resolve(currentDirectory, '../node_modules');

async function createTestServer(context) {
  const sessionToken = createSessionToken();
  const server = await startServer({ imageRoot, sessionToken, vendorRoot, webRoot });
  context.after(() => server.close());
  return { server, sessionToken };
}

test('serves local assets with hardened headers', async (context) => {
  const { server } = await createTestServer(context);
  const response = await fetch(`${server.origin}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await response.text(), /Marco 6 · Operação local segura/);
});

test('requires the ephemeral token for API access', async (context) => {
  const { server, sessionToken } = await createTestServer(context);
  const unauthorized = await fetch(`${server.origin}/api/health`);
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${server.origin}/api/health`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual((await authorized.json()).security, {
    externalConnections: false,
    loopbackOnly: true,
    telemetry: false,
  });
});

test('notifies only after the last authenticated browser connection closes', async (context) => {
  const sessionToken = createSessionToken();
  let disconnectCount = 0;
  const server = await startServer({
    browserDisconnectGraceMs: 10,
    imageRoot,
    onLastBrowserDisconnected: () => {
      disconnectCount += 1;
    },
    sessionToken,
    vendorRoot,
    webRoot,
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const firstController = new AbortController();
  const secondController = new AbortController();
  const [firstResponse, secondResponse] = await Promise.all([
    fetch(`${server.origin}/api/browser/lifecycle`, { headers, signal: firstController.signal }),
    fetch(`${server.origin}/api/browser/lifecycle`, { headers, signal: secondController.signal }),
  ]);
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);

  firstController.abort();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(disconnectCount, 0);

  secondController.abort();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(disconnectCount, 1);
});

test('does not expose arbitrary files', async (context) => {
  const { server } = await createTestServer(context);
  const response = await fetch(`${server.origin}/package.json`);
  assert.equal(response.status, 404);
});

test('serves only explicitly approved terminal assets', async (context) => {
  const { server } = await createTestServer(context);
  const inputModule = await fetch(`${server.origin}/terminal-input.js`);
  assert.equal(inputModule.status, 200);
  assert.match(inputModule.headers.get('content-type'), /^text\/javascript/);

  const styleModule = await fetch(`${server.origin}/terminal-styles.js`);
  assert.equal(styleModule.status, 200);
  assert.match(styleModule.headers.get('content-type'), /^text\/javascript/);

  const navigationModule = await fetch(`${server.origin}/navigation.js`);
  assert.equal(navigationModule.status, 200);
  assert.match(navigationModule.headers.get('content-type'), /^text\/javascript/);

  const terminalModule = await fetch(`${server.origin}/vendor/xterm/xterm.mjs`);
  assert.equal(terminalModule.status, 200);
  assert.match(terminalModule.headers.get('content-type'), /^text\/javascript/);

  const packageMetadata = await fetch(`${server.origin}/vendor/xterm/package.json`);
  assert.equal(packageMetadata.status, 404);
});

test('serves only explicitly approved brand images', async (context) => {
  const { server } = await createTestServer(context);
  const favicon = await fetch(`${server.origin}/favicon.png`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/png');

  const logo = await fetch(`${server.origin}/logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const arbitraryImage = await fetch(`${server.origin}/img/private.png`);
  assert.equal(arbitraryImage.status, 404);
});
