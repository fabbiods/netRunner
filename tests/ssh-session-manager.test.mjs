import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ssh2 from 'ssh2';
import { openDatabase } from '../src/server/database/database.mjs';
import { InventoryService } from '../src/server/inventory/inventory-service.mjs';
import { RecordingService } from '../src/server/recording/recording-service.mjs';
import { SessionHistoryService } from '../src/server/recording/session-history-service.mjs';
import { HostKeyService } from '../src/server/ssh/host-key-service.mjs';
import { SshSessionManager } from '../src/server/ssh/ssh-session-manager.mjs';

async function startTestSshServer({
  algorithms,
  authenticate,
  banner = 'Authorized test system\r\n',
  onShell,
}) {
  const hostKey = ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 }).private;
  const server = new ssh2.Server({ algorithms, banner, hostKeys: [hostKey] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (context) => authenticate(context));
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => acceptPty());
        session.on('window-change', (acceptWindowChange) => acceptWindowChange?.());
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          if (onShell) onShell(stream);
          else stream.write('test-shell-ready\r\n');
          stream.on('data', (data) => stream.write(`echo:${data.toString()}`));
        });
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function nextEvent(session, cursor, predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const events = await session.poll(cursor.sequence);
    for (const event of events) {
      cursor.sequence = Math.max(cursor.sequence, event.sequence);
      if (predicate(event)) return event;
    }
  }
  throw new Error('Expected SSH session event was not emitted');
}

async function createEnvironment(
  server,
  { deviceType = 'switch', recording = false, vendor = 'cisco' } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-ssh-session-'));
  const databasePath = path.join(directory, 'netrunner.sqlite');
  const database = await openDatabase(databasePath);
  const inventory = new InventoryService(database);
  const location = inventory.createLocation({ name: 'Laboratório', type: 'site' });
  const username = inventory.createUsername({ username: 'netops' });
  const device = inventory.createDevice({
    address: '127.0.0.1',
    deviceType,
    hostname: 'ssh-test',
    locationId: location.id,
    sshPort: server.address().port,
    usernameId: username.id,
    vendor,
  }).device;
  const history = recording ? new SessionHistoryService(database) : undefined;
  const recordingService = recording
    ? new RecordingService({ history, logsRoot: path.join(directory, 'Logs') })
    : undefined;
  if (recordingService) await recordingService.initialize();
  const manager = new SshSessionManager({
    hostKeys: new HostKeyService(database),
    inventory,
    recordingService,
  });
  return { database, databasePath, device, directory, history, inventory, manager };
}

test('selects a safe runbook profile when inventory identification is unavailable', async () => {
  const server = await startTestSshServer({
    authenticate(context) {
      context.reject(['password']);
    },
  });
  const environment = await createEnvironment(server, { deviceType: 'other', vendor: 'other' });
  try {
    const created = environment.manager.create({
      columns: 100,
      deviceId: environment.device.id,
      password: 'temporary-test-password',
      rows: 30,
    });
    assert.equal(environment.manager.listRunbooks(created.id).profile, null);
    const selected = environment.manager.selectRunbookProfile(created.id, 'juniper-ex-switches');
    assert.equal(selected.profile.vendorLabel, 'Juniper');
    assert.equal(selected.runbooks.find((runbook) => runbook.kind === 'snapshot').commands.at(-1), 'show configuration');
  } finally {
    await environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

async function acceptFirstHostKey(session, cursor) {
  const event = await nextEvent(session, cursor, (candidate) => candidate.type === 'host-key');
  session.decideHostKey({
    accept: true,
    fingerprint: event.payload.fingerprint,
    replace: false,
  });
}

test('connects with one password attempt, TOFU and an interactive shell', async () => {
  const canary = 'CANARY-password-SSH-unique-2941';
  const attempts = [];
  const server = await startTestSshServer({
    authenticate(context) {
      attempts.push(context.method);
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === canary) context.accept();
      else context.reject();
    },
  });
  const environment = await createEnvironment(server);
  try {
    const created = environment.manager.create({
      columns: 100,
      deviceId: environment.device.id,
      password: canary,
      rows: 30,
    });
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    assert.deepEqual(attempts, ['none', 'password']);

    session.write('show version\r');
    const output = await nextEvent(session, cursor, (event) => {
      if (event.type !== 'output') return false;
      return Buffer.from(event.payload.data, 'base64').toString().includes('echo:show version');
    });
    assert.match(Buffer.from(output.payload.data, 'base64').toString(), /echo:show version/);
    assert.ok(environment.inventory.getDevice(environment.device.id).lastConnectedAt);

    const runbook = await environment.manager.executeRunbook(
      created.id,
      'cisco-iosxe-configuration',
    );
    assert.equal(runbook.commandsSent, 2);
    const runbookOutput = await nextEvent(session, cursor, (event) => {
      if (event.type !== 'output') return false;
      return Buffer.from(event.payload.data, 'base64').toString().includes('terminal length 0');
    });
    assert.match(
      Buffer.from(runbookOutput.payload.data, 'base64').toString(),
      /echo:terminal length 0/,
    );

    session.close();
    const dataFiles = await readdir(environment.directory);
    for (const filename of dataFiles) {
      const contents = await readFile(path.join(environment.directory, filename));
      assert.equal(contents.includes(Buffer.from(canary)), false, `${filename} contained the canary`);
    }
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('records only normalized server output and never persists the modal password', async () => {
  const passwordCanary = 'CANARY-recording-password-7842';
  const server = await startTestSshServer({
    authenticate(context) {
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === passwordCanary) context.accept();
      else context.reject();
    },
    onShell(stream) {
      stream.write('\u001b[32mshow version output\u001b[0m --More--\r\n');
    },
  });
  const environment = await createEnvironment(server, { recording: true });
  try {
    const created = environment.manager.create({
      deviceId: environment.device.id,
      password: passwordCanary,
      record: true,
      ticket: 'CHG-7842',
    });
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    await nextEvent(session, cursor, (event) => event.type === 'output');
    await session.close();

    const entry = environment.history.get(created.id);
    assert.equal(entry.ticket, 'CHG-7842');
    assert.equal(entry.reason, 'user_closed');
    assert.equal((await environment.history.verify(created.id)).status, 'valid');
    const log = await readFile(entry.logPath, 'utf8');
    assert.match(log, /show version output/);
    assert.doesNotMatch(log, /\u001b|--More--/u);
    assert.equal(log.includes(passwordCanary), false);
  } finally {
    await environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('uses the modal password once and asks separately for an OTP', async () => {
  const responsesSeen = [];
  const server = await startTestSshServer({
    authenticate(context) {
      if (context.method === 'none') {
        context.reject(['keyboard-interactive']);
      } else if (context.method === 'keyboard-interactive') {
        context.prompt(
          [
            { echo: false, prompt: 'Password: ' },
            { echo: false, prompt: 'OTP: ' },
          ],
          'Two-factor authentication',
          'Enter the current token',
          (responses) => {
            responsesSeen.push(...responses);
            if (responses[0] === 'one-use-password' && responses[1] === '123456') context.accept();
            else context.reject();
          },
        );
      } else {
        context.reject();
      }
    },
  });
  const environment = await createEnvironment(server);
  try {
    const created = environment.manager.create({
      deviceId: environment.device.id,
      password: 'one-use-password',
    });
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    const promptEvent = await nextEvent(
      session,
      cursor,
      (event) => event.type === 'authentication-prompts',
    );
    assert.deepEqual(promptEvent.payload.prompts, [{ echo: false, prompt: 'OTP: ' }]);
    session.respondToPrompts(promptEvent.payload.promptId, ['123456']);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    assert.deepEqual(responsesSeen, ['one-use-password', '123456']);
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('fails closed with Modern and connects only after opting into Legacy', async () => {
  const server = await startTestSshServer({
    algorithms: {
      cipher: ['aes128-cbc'],
      hmac: ['hmac-sha1'],
      kex: ['diffie-hellman-group14-sha1'],
      serverHostKey: ['ssh-rsa'],
    },
    authenticate(context) {
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === 'legacy-password') context.accept();
      else context.reject();
    },
  });
  const environment = await createEnvironment(server);
  try {
    const modern = environment.manager.create({
      deviceId: environment.device.id,
      password: 'legacy-password',
    });
    const modernSession = environment.manager.get(modern.id);
    const modernCursor = { sequence: 0 };
    const failure = await nextEvent(modernSession, modernCursor, (event) => event.type === 'error');
    assert.equal(failure.payload.code, 'handshake_failed');
    assert.ok(
      failure.payload.diagnostic.some((line) =>
        line.includes('diffie-hellman-group14-sha1'),
      ),
    );

    environment.inventory.updateDevice(environment.device.id, { algorithmProfile: 'legacy' });
    const legacy = environment.manager.create({
      deviceId: environment.device.id,
      password: 'legacy-password',
    });
    const legacySession = environment.manager.get(legacy.id);
    const legacyCursor = { sequence: 0 };
    await acceptFirstHostKey(legacySession, legacyCursor);
    await nextEvent(
      legacySession,
      legacyCursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    const handshake = await nextEvent(
      legacySession,
      { sequence: 0 },
      (event) => event.type === 'handshake',
    );
    assert.equal(handshake.payload.kex, 'diffie-hellman-group14-sha1');
    assert.equal(handshake.payload.cipher, 'aes128-cbc');
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('supports login inside the shell without receiving a modal password', async () => {
  const methods = [];
  const server = await startTestSshServer({
    authenticate(context) {
      methods.push(context.method);
      if (context.method === 'none') context.accept();
      else context.reject();
    },
  });
  const environment = await createEnvironment(server);
  try {
    environment.inventory.updateDevice(environment.device.id, { loginMode: 'shell' });
    const created = environment.manager.create({ deviceId: environment.device.id });
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    assert.deepEqual(methods, ['none']);
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('opens an unsaved quick connection with the same TOFU controls', async () => {
  const server = await startTestSshServer({
    authenticate(context) {
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === 'quick-password') context.accept();
      else context.reject();
    },
  });
  const environment = await createEnvironment(server);
  try {
    const created = environment.manager.create({
      password: 'quick-password',
      quick: {
        address: '127.0.0.1',
        algorithmProfile: 'modern',
        port: server.address().port,
        terminalType: 'xterm-256color',
        username: 'temporary-user',
      },
    });
    assert.equal(created.deviceId, null);
    assert.equal(created.locationPath, 'Conexões avulsas');
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('supports twenty simultaneous sessions and rejects a twenty-first', async () => {
  const server = await startTestSshServer({
    authenticate(context) {
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === 'parallel-password') context.accept();
      else context.reject();
    },
  });
  const environment = await createEnvironment(server);
  try {
    const active = [];
    for (let index = 0; index < 20; index += 1) {
      const created = environment.manager.create({
        deviceId: environment.device.id,
        password: 'parallel-password',
      });
      const cursor = { sequence: 0 };
      const session = environment.manager.get(created.id);
      if (index === 0) await acceptFirstHostKey(session, cursor);
      await nextEvent(
        session,
        cursor,
        (event) => event.type === 'status' && event.payload.state === 'connected',
      );
      active.push({ cursor, session });
    }
    assert.equal(environment.manager.list().length, 20);
    assert.throws(
      () =>
        environment.manager.create({
          deviceId: environment.device.id,
          password: 'parallel-password',
        }),
      /no more than 20/i,
    );
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});

test('streams ten megabytes of terminal output without truncation', async () => {
  const expectedBytes = 10 * 1024 * 1024;
  const server = await startTestSshServer({
    authenticate(context) {
      if (context.method === 'none') context.reject(['password']);
      else if (context.method === 'password' && context.password === 'output-password') context.accept();
      else context.reject();
    },
    onShell(stream) {
      stream.write(Buffer.alloc(expectedBytes, 0x58));
    },
  });
  const environment = await createEnvironment(server);
  try {
    const created = environment.manager.create({
      deviceId: environment.device.id,
      password: 'output-password',
    });
    const session = environment.manager.get(created.id);
    const cursor = { sequence: 0 };
    await acceptFirstHostKey(session, cursor);
    await nextEvent(
      session,
      cursor,
      (event) => event.type === 'status' && event.payload.state === 'connected',
    );
    let receivedBytes = 0;
    while (receivedBytes < expectedBytes) {
      const events = await session.poll(cursor.sequence);
      for (const event of events) {
        cursor.sequence = Math.max(cursor.sequence, event.sequence);
        if (event.type === 'output') {
          receivedBytes += Buffer.from(event.payload.data, 'base64').length;
        }
      }
    }
    assert.equal(receivedBytes, expectedBytes);
  } finally {
    environment.manager.closeAll();
    environment.database.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(environment.directory, { force: true, recursive: true });
  }
});
