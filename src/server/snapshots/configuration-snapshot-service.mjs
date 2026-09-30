import { createHash, randomUUID } from 'node:crypto';
import { ApplicationError, ConflictError, NotFoundError } from '../errors.mjs';
import { redactSensitiveConfiguration } from './configuration-redactor.mjs';
import { diffLines } from './line-diff.mjs';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 50_000;
const SOURCES = new Set(['manual', 'runbook', 'terminal']);

function normalizeContent(value) {
  if (typeof value !== 'string') {
    throw new ApplicationError('O conteúdo da configuração é obrigatório.', {
      code: 'validation_error',
      details: { field: 'content' },
      statusCode: 422,
    });
  }
  const normalized = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/gu, ''))
    .join('\n')
    .replace(/^\n+|\n+$/gu, '');
  if (normalized.length === 0) {
    throw new ApplicationError('O conteúdo da configuração não pode ficar vazio.', {
      code: 'validation_error',
      details: { field: 'content' },
      statusCode: 422,
    });
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_CONTENT_BYTES) {
    throw new ApplicationError('O snapshot excede o limite de 2 MiB.', {
      code: 'payload_too_large',
      details: { maximumBytes: MAX_CONTENT_BYTES },
      statusCode: 413,
    });
  }
  const lines = normalized.split('\n');
  if (lines.length > MAX_LINES) {
    throw new ApplicationError('O snapshot excede o limite de 50.000 linhas.', {
      code: 'validation_error',
      details: { field: 'content', maximumLines: MAX_LINES },
      statusCode: 422,
    });
  }
  return { content: normalized, lines };
}

function snapshotName(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 120) {
    throw new ApplicationError('Informe um nome de até 120 caracteres.', {
      code: 'validation_error',
      details: { field: 'name' },
      statusCode: 422,
    });
  }
  return value.trim();
}

function mapMetadata(row) {
  return {
    contentSha256: row.content_sha256,
    createdAt: row.created_at,
    deviceId: row.device_id,
    hostname: row.hostname,
    id: row.id,
    lineCount: row.line_count,
    name: row.name,
    redactionCount: row.redaction_count,
    source: row.source,
  };
}

function mapSnapshot(row) {
  return { ...mapMetadata(row), content: row.content };
}

export class ConfigurationSnapshotService {
  constructor({ database, inventory }) {
    this.database = database;
    this.inventory = inventory;
  }

  create({ content, deviceId, name, source = 'manual' }) {
    this.inventory.getDevice(deviceId);
    if (!SOURCES.has(source)) {
      throw new ApplicationError('A origem do snapshot é inválida.', {
        code: 'validation_error',
        details: { field: 'source' },
        statusCode: 422,
      });
    }
    const normalized = normalizeContent(content);
    const redacted = redactSensitiveConfiguration(normalized.content);
    const snapshot = {
      content: redacted.content,
      contentSha256: createHash('sha256').update(redacted.content).digest('hex'),
      createdAt: new Date().toISOString(),
      deviceId,
      id: randomUUID(),
      lineCount: redacted.content.split('\n').length,
      name: snapshotName(name),
      redactionCount: redacted.redactionCount,
      source,
    };
    this.database
      .prepare(`
        INSERT INTO configuration_snapshots
          (id, device_id, name, source, content, content_sha256, line_count, created_at, redaction_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.id,
        snapshot.deviceId,
        snapshot.name,
        snapshot.source,
        snapshot.content,
        snapshot.contentSha256,
        snapshot.lineCount,
        snapshot.createdAt,
        snapshot.redactionCount,
      );
    return this.get(snapshot.id);
  }

  list({ deviceId, limit = 500 } = {}) {
    if (deviceId !== undefined) this.inventory.getDevice(deviceId);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const where = deviceId === undefined ? '' : 'WHERE s.device_id = ?';
    const parameters = deviceId === undefined ? [safeLimit] : [deviceId, safeLimit];
    return this.database
      .prepare(`
        SELECT s.id, s.device_id, s.name, s.source, s.content_sha256, s.line_count, s.created_at,
          s.redaction_count,
          d.hostname
        FROM configuration_snapshots s
        JOIN devices d ON d.id = s.device_id
        ${where}
        ORDER BY s.created_at DESC, s.rowid DESC
        LIMIT ?
      `)
      .all(...parameters)
      .map(mapMetadata);
  }

  get(id) {
    const row = this.database
      .prepare(`
        SELECT s.*, d.hostname
        FROM configuration_snapshots s
        JOIN devices d ON d.id = s.device_id
        WHERE s.id = ?
      `)
      .get(id);
    if (row === undefined) throw new NotFoundError('Configuration snapshot');
    return mapSnapshot(row);
  }

  delete(id) {
    const result = this.database.prepare('DELETE FROM configuration_snapshots WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Configuration snapshot');
  }

  compare(leftId, rightId) {
    const left = this.get(leftId);
    const right = this.get(rightId);
    if (left.deviceId !== right.deviceId) {
      throw new ConflictError('Compare snapshots do mesmo dispositivo.', {
        leftDeviceId: left.deviceId,
        rightDeviceId: right.deviceId,
      });
    }
    const rows = diffLines(left.content.split('\n'), right.content.split('\n'));
    return {
      identical: left.contentSha256 === right.contentSha256,
      left: mapMetadata({
        content_sha256: left.contentSha256,
        created_at: left.createdAt,
        device_id: left.deviceId,
        hostname: left.hostname,
        id: left.id,
        line_count: left.lineCount,
        name: left.name,
        redaction_count: left.redactionCount,
        source: left.source,
      }),
      right: mapMetadata({
        content_sha256: right.contentSha256,
        created_at: right.createdAt,
        device_id: right.deviceId,
        hostname: right.hostname,
        id: right.id,
        line_count: right.lineCount,
        name: right.name,
        redaction_count: right.redactionCount,
        source: right.source,
      }),
      rows,
      stats: {
        added: rows.filter((row) => row.kind === 'added').length,
        removed: rows.filter((row) => row.kind === 'removed').length,
        unchanged: rows.filter((row) => row.kind === 'equal').length,
      },
    };
  }
}
