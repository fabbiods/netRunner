import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/server/security.mjs';
import { startServer } from '../src/server/server.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, '../src/web');

function createFakeSessions() {
  const captured = { answers: undefined, create: undefined, input: undefined, profile: undefined, recording: undefined, removed: undefined, runbook: undefined };
  const session = {
    decideHostKey() {},
    poll: async () => [{ payload: { stage: 'tcp' }, sequence: 1, type: 'status' }],
    publicState: () => ({ id: 'session-1', state: 'connecting' }),
    resize() {},
    async startRecording() {
      captured.recording = 'started';
      return { id: 'session-1', recordingState: 'active' };
    },
    async stopRecording() {
      captured.recording = 'stopped';
      return { id: 'session-1', recordingState: 'stopped' };
    },
    respondToPrompts(promptId, answers) {
      captured.answers = { answers: [...answers], promptId };
    },
    write(data) {
      captured.input = data;
    },
  };
  return {
    captured,
    create(input) {
      captured.create = structuredClone(input);
      return session.publicState();
    },
    get() {
      return session;
    },
    list() {
      return [session.publicState()];
    },
    listRunbooks(id) {
      captured.runbook = ['list', id];
      return {
        profile: { id: 'cisco-catalyst-switches', vendorLabel: 'Cisco' },
        runbooks: [{ id: 'cisco-iosxe-version', name: 'Consultar versão' }],
      };
    },
    selectRunbookProfile(id, profileId) {
      captured.profile = [id, profileId];
      return {
        profile: { id: profileId, vendorLabel: 'Juniper' },
        runbooks: [{ id: 'juniper-junos-version', name: 'Consultar versão' }],
      };
    },
    executeRunbook(id, runbookId) {
      captured.runbook = ['execute', id, runbookId];
      return { commandsSent: 1, id: runbookId };
    },
    remove(id) {
      captured.removed = id;
    },
  };
}

async function request(server, token, pathname, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${server.origin}${pathname}`, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
  });
}

test('routes authenticated SSH session commands without returning secrets', async (context) => {
  const sshSessions = createFakeSessions();
  const sessionToken = createSessionToken();
  const server = await startServer({ inventory: {}, sessionToken, sshSessions, webRoot });
  context.after(() => server.close());

  const createResponse = await request(server, sessionToken, '/api/ssh/sessions', {
    body: { deviceId: 'device-1', password: 'api-canary', username: 'netops' },
    method: 'POST',
  });
  assert.equal(createResponse.status, 201);
  assert.equal(JSON.stringify(await createResponse.json()).includes('api-canary'), false);
  assert.equal(sshSessions.captured.create.password, 'api-canary');

  const eventsResponse = await request(
    server,
    sessionToken,
    '/api/ssh/sessions/session-1/events?after=0',
  );
  assert.equal((await eventsResponse.json()).events[0].type, 'status');

  await request(server, sessionToken, '/api/ssh/sessions/session-1/input', {
    body: { data: 'show version\r' },
    method: 'POST',
  });
  assert.equal(sshSessions.captured.input, 'show version\r');

  const recordingResponse = await request(
    server,
    sessionToken,
    '/api/ssh/sessions/session-1/recording/start',
    { method: 'POST' },
  );
  assert.equal((await recordingResponse.json()).recordingState, 'active');
  assert.equal(sshSessions.captured.recording, 'started');

  const runbooksResponse = await request(
    server,
    sessionToken,
    '/api/ssh/sessions/session-1/runbooks',
  );
  const runbookContext = await runbooksResponse.json();
  assert.equal(runbookContext.profile.vendorLabel, 'Cisco');
  assert.equal(runbookContext.runbooks[0].id, 'cisco-iosxe-version');

  const profileResponse = await request(
    server,
    sessionToken,
    '/api/ssh/sessions/session-1/runbook-profile',
    { body: { profileId: 'juniper-ex-switches' }, method: 'POST' },
  );
  assert.equal((await profileResponse.json()).profile.vendorLabel, 'Juniper');
  assert.deepEqual(sshSessions.captured.profile, ['session-1', 'juniper-ex-switches']);

  const runbookResponse = await request(
    server,
    sessionToken,
    '/api/ssh/sessions/session-1/runbooks/cisco-iosxe-version',
    { method: 'POST' },
  );
  assert.equal((await runbookResponse.json()).commandsSent, 1);
  assert.deepEqual(sshSessions.captured.runbook, [
    'execute',
    'session-1',
    'cisco-iosxe-version',
  ]);

  const closeResponse = await request(server, sessionToken, '/api/ssh/sessions/session-1', {
    method: 'DELETE',
  });
  assert.equal(closeResponse.status, 204);
  assert.equal(sshSessions.captured.removed, 'session-1');
});
