import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, open, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APP_NAME, APP_VERSION } from '../../shared/app-info.mjs';
import { createPrivateLogPath } from './log-paths.mjs';
import { TerminalOutputNormalizer } from './terminal-output-normalizer.mjs';

const SYNC_INTERVAL_MS = 2_000;
const SYNC_THRESHOLD_BYTES = 64 * 1024;

function safeText(value, fallback = '—') {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > 0 ? text : fallback;
}

export function formatIsoWithTimezone(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .replace('Z', '');
  return `${local}${offset}`;
}

function lineTimestamp(date = new Date()) {
  return formatIsoWithTimezone(date).replace('T', ' ').slice(0, 23);
}

function durationText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function header(metadata) {
  return [
    '================================================================================',
    `${APP_NAME} ${APP_VERSION} · Registro de sessão SSH`,
    '================================================================================',
    `ID da sessão: ${safeText(metadata.id)}`,
    `Hostname: ${safeText(metadata.hostname)}`,
    `Destino: ${safeText(metadata.address)}:${metadata.port}`,
    `Fabricante / tipo: ${safeText(metadata.vendor)} / ${safeText(metadata.deviceType)}`,
    `Localidade: ${safeText(metadata.locationPath)}`,
    `Username remoto: ${safeText(metadata.username)}`,
    `Usuário local: ${safeText(metadata.localUsername ?? os.userInfo().username)}`,
    `Ticket / mudança: ${safeText(metadata.ticket)}`,
    `Início: ${formatIsoWithTimezone(new Date(metadata.startedAt))}`,
    'Host key: aguardando validação',
    'Algoritmos: aguardando negociação',
    '================================================================================',
    '',
  ].join('\n');
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

export async function sealLog(filePath) {
  const sha256 = await sha256File(filePath);
  const sidecarPath = `${filePath}.sha256`;
  await writeFile(sidecarPath, `${sha256}  ${path.basename(filePath)}\n`, { mode: 0o400 });
  await chmod(sidecarPath, 0o400);
  await chmod(filePath, 0o400);
  return sha256;
}

export class SessionRecorder {
  static async create({ columns, history, logsRoot, metadata, rows }) {
    const logPath = await createPrivateLogPath(logsRoot, metadata, new Date(metadata.startedAt));
    const handle = await open(logPath, 'wx', 0o600);
    const recorder = new SessionRecorder({ columns, handle, history, logPath, metadata, rows });
    await handle.writeFile(header(metadata), 'utf8');
    await handle.sync();
    history.attachLog(metadata.id, logPath);
    return recorder;
  }

  constructor({ columns, handle, history, logPath, metadata, rows }) {
    this.closed = false;
    this.handle = handle;
    this.history = history;
    this.lastSyncAt = Date.now();
    this.logPath = logPath;
    this.metadata = metadata;
    this.normalizer = new TerminalOutputNormalizer({ columns, rows });
    this.pendingBytes = 0;
    this.queue = Promise.resolve();
  }

  output(data, date = new Date()) {
    if (this.closed) return this.queue;
    return this.#enqueue(async () => {
      const lines = await this.normalizer.write(data);
      await this.#writeLines(lines, date);
    });
  }

  event(message, date = new Date()) {
    if (this.closed) return this.queue;
    return this.#enqueue(() => this.#append(`[${lineTimestamp(date)}] [NetRunner] ${safeText(message)}\n`));
  }

  security({ algorithms, hostFingerprint }) {
    this.history.updateSecurity(this.metadata.id, { algorithms, hostFingerprint });
    if (hostFingerprint) void this.event(`Host key validada: ${hostFingerprint}`);
    if (algorithms) {
      void this.event(
        `Algoritmos negociados: KEX=${algorithms.kex}; host-key=${algorithms.hostKey}; cifra=${algorithms.cipher}; MAC=${algorithms.mac}`,
      );
    }
  }

  resize(columns, rows) {
    return this.#enqueue(() => this.normalizer.resize(columns, rows));
  }

  async finalize(reason, endedAt = new Date()) {
    if (this.closed) return this.finalResult;
    this.closed = true;
    this.finalResult = this.#enqueue(async () => {
      const trailing = this.normalizer.flush();
      await this.#writeLines(trailing, endedAt);
      const duration = Math.max(0, endedAt.getTime() - new Date(this.metadata.startedAt).getTime());
      await this.#append(
        `\n[${lineTimestamp(endedAt)}] [NetRunner] Fim da gravação\n` +
          `Término: ${formatIsoWithTimezone(endedAt)}\n` +
          `Duração: ${durationText(duration)}\n` +
          `Motivo: ${safeText(reason)}\n`,
      );
      await this.handle.sync();
      await this.handle.close();
      this.normalizer.dispose();
      const sha256 = await sealLog(this.logPath);
      this.history.finalizeLog(this.metadata.id, sha256);
      return { logPath: this.logPath, sha256 };
    });
    return this.finalResult;
  }

  #enqueue(operation) {
    this.queue = this.queue.then(operation);
    return this.queue;
  }

  async #writeLines(lines, date) {
    for (const line of lines) await this.#append(`[${lineTimestamp(date)}] ${line}\n`);
  }

  async #append(value) {
    if (!value) return;
    await this.handle.writeFile(value, 'utf8');
    this.pendingBytes += Buffer.byteLength(value);
    if (
      this.pendingBytes >= SYNC_THRESHOLD_BYTES ||
      Date.now() - this.lastSyncAt >= SYNC_INTERVAL_MS
    ) {
      await this.handle.sync();
      this.pendingBytes = 0;
      this.lastSyncAt = Date.now();
    }
  }
}
