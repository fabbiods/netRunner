import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/server/database/database.mjs';
import { RecordingService } from '../src/server/recording/recording-service.mjs';
import { SessionHistoryService } from '../src/server/recording/session-history-service.mjs';

function metadata(id, startedAt = new Date().toISOString()) {
  return {
    address: '192.0.2.10',
    deviceId: null,
    deviceType: 'switch',
    hostname: 'sw/core',
    id,
    locationPath: 'Brasil › Site/01',
    port: 22,
    startedAt,
    ticket: 'CHG-123',
    username: 'netops',
    vendor: 'cisco',
  };
}

test('streams a normalized private log and seals it with a valid SHA-256 sidecar', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-recording-'));
  const logsRoot = path.join(directory, 'Logs');
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const history = new SessionHistoryService(database);
  const service = new RecordingService({ history, logsRoot });
  try {
    await service.initialize();
    assert.equal(history.getRecordingDefault(), true);
    assert.equal(history.setRecordingDefault(false), false);
    const details = metadata('session-recorded');
    service.beginSession(details);
    const recorder = await service.createRecorder(details, { columns: 12, rows: 5 });
    recorder.security({
      algorithms: { cipher: 'aes256-ctr', hostKey: 'ssh-ed25519', kex: 'curve25519-sha256', mac: 'hmac-sha2-256' },
      hostFingerprint: 'SHA256:test',
    });
    await recorder.output('\u001b[32m123456789012345\u001b[0m\r\nresult --More--\r\n');
    await recorder.event('Shell conectado.');
    const result = await recorder.finalize('user_closed', new Date());
    service.finishSession(details.id, {
      endedAt: new Date().toISOString(),
      reason: 'user_closed',
      startedAt: details.startedAt,
    });

    const contents = await readFile(result.logPath, 'utf8');
    assert.match(contents, /123456789012345/);
    assert.match(contents, /result/);
    assert.doesNotMatch(contents, /\u001b|--More--/u);
    assert.match(contents, /Host key validada: SHA256:test/);
    assert.match(contents, /Motivo: user_closed/);
    assert.equal((await stat(result.logPath)).mode & 0o777, 0o400);
    assert.equal((await stat(`${result.logPath}.sha256`)).mode & 0o777, 0o400);
    assert.equal((await stat(logsRoot)).mode & 0o777, 0o700);
    assert.equal((await history.verify(details.id)).status, 'valid');
    assert.equal(history.list({ minimumDurationMs: 0, ticket: 'CHG' }).length, 1);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('recovers and seals an unfinished log on the next startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netrunner-recovery-'));
  const logsRoot = path.join(directory, 'Logs');
  const database = await openDatabase(path.join(directory, 'netrunner.sqlite'));
  const history = new SessionHistoryService(database);
  try {
    const details = metadata('session-crashed', '2026-09-29T12:00:00.000Z');
    history.begin(details);
    const logPath = path.join(logsRoot, 'Site', 'host', 'incomplete.txt');
    await mkdir(path.dirname(logPath), { mode: 0o700, recursive: true });
    await writeFile(logPath, 'conteúdo recebido antes da falha\n', { mode: 0o600 });
    history.attachLog(details.id, logPath);

    const service = new RecordingService({ history, logsRoot });
    await service.initialize();
    const recovered = history.get(details.id);
    assert.equal(recovered.reason, 'unexpected_shutdown');
    assert.ok(recovered.endedAt);
    assert.equal((await history.verify(details.id)).status, 'valid');
    assert.match(await readFile(logPath, 'utf8'), /encerrada inesperadamente/);
    assert.equal((await stat(logPath)).mode & 0o777, 0o400);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});
