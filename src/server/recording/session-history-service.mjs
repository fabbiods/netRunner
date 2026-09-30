import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { NotFoundError } from '../errors.mjs';

function nowIso() {
  return new Date().toISOString();
}

function mapSession(row) {
  return {
    address: row.address,
    algorithms: row.algorithms === null ? null : JSON.parse(row.algorithms),
    deviceId: row.device_id,
    deviceType: row.device_type,
    durationMs: row.duration_ms,
    endedAt: row.ended_at,
    hostFingerprint: row.host_fingerprint,
    hostname: row.hostname,
    id: row.id,
    locationPath: row.location_path,
    logPath: row.log_path,
    port: row.port,
    protocol: row.protocol,
    reason: row.reason,
    recorded: row.recorded === 1,
    sha256: row.sha256,
    startedAt: row.started_at,
    ticket: row.ticket,
    username: row.username,
    vendor: row.vendor,
  };
}

export class SessionHistoryService {
  constructor(database) {
    this.database = database;
    const now = nowIso();
    this.database
      .prepare(`INSERT INTO settings (key, value, created_at, updated_at)
        VALUES ('recording.default', 'true', ?, ?)
        ON CONFLICT(key) DO NOTHING`)
      .run(now, now);
  }

  getRecordingDefault() {
    return this.database
      .prepare("SELECT value FROM settings WHERE key = 'recording.default'")
      .get().value === 'true';
  }

  setRecordingDefault(value) {
    this.database
      .prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'recording.default'")
      .run(value ? 'true' : 'false', nowIso());
    return this.getRecordingDefault();
  }

  begin(metadata) {
    const now = nowIso();
    this.database.prepare(`INSERT INTO sessions (
      id, device_id, protocol, hostname, address, port, username, location_path, vendor,
      device_type, ticket, started_at, recorded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(
        metadata.id,
        metadata.deviceId,
        metadata.protocol ?? 'ssh',
        metadata.hostname,
        metadata.address,
        metadata.port,
        metadata.username,
        metadata.locationPath,
        metadata.vendor,
        metadata.deviceType,
        metadata.ticket,
        metadata.startedAt,
        now,
        now,
      );
  }

  attachLog(id, logPath) {
    this.database
      .prepare('UPDATE sessions SET log_path = ?, recorded = 1, updated_at = ? WHERE id = ?')
      .run(logPath, nowIso(), id);
  }

  updateSecurity(id, { algorithms, hostFingerprint }) {
    this.database.prepare(`UPDATE sessions SET
      algorithms = COALESCE(?, algorithms),
      host_fingerprint = COALESCE(?, host_fingerprint),
      updated_at = ?
      WHERE id = ?`)
      .run(
        algorithms === undefined ? null : JSON.stringify(algorithms),
        hostFingerprint ?? null,
        nowIso(),
        id,
      );
  }

  finalizeLog(id, sha256) {
    this.database
      .prepare('UPDATE sessions SET sha256 = ?, updated_at = ? WHERE id = ?')
      .run(sha256, nowIso(), id);
  }

  finish(id, { endedAt, reason, startedAt }) {
    const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
    this.database.prepare(`UPDATE sessions SET
      ended_at = ?, duration_ms = ?, reason = ?, updated_at = ? WHERE id = ?`)
      .run(endedAt, durationMs, reason, nowIso(), id);
  }

  get(id) {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (row === undefined) throw new NotFoundError('Session history entry');
    return mapSession(row);
  }

  list(filters = {}) {
    const clauses = [];
    const parameters = [];
    if (filters.deviceId) {
      clauses.push('device_id = ?');
      parameters.push(filters.deviceId);
    }
    if (filters.location) {
      clauses.push('location_path = ?');
      parameters.push(filters.location);
    }
    if (filters.protocol) {
      clauses.push('protocol = ?');
      parameters.push(filters.protocol);
    }
    if (filters.ticket) {
      clauses.push('ticket LIKE ? ESCAPE \'\\\'');
      parameters.push(`%${String(filters.ticket).replace(/[\\%_]/gu, '\\$&')}%`);
    }
    if (filters.dateFrom) {
      clauses.push('started_at >= ?');
      parameters.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      clauses.push('started_at <= ?');
      parameters.push(filters.dateTo);
    }
    if (filters.minimumDurationMs !== undefined) {
      clauses.push('duration_ms >= ?');
      parameters.push(filters.minimumDurationMs);
    }
    if (filters.maximumDurationMs !== undefined) {
      clauses.push('duration_ms <= ?');
      parameters.push(filters.maximumDurationMs);
    }
    const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.database
      .prepare(`SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...parameters, limit)
      .map(mapSession);
  }

  unfinished() {
    return this.database
      .prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at')
      .all()
      .map(mapSession);
  }

  async verify(id) {
    const session = this.get(id);
    if (!session.recorded || session.logPath === null || session.sha256 === null) {
      return { status: 'unavailable' };
    }
    try {
      const contents = await readFile(session.logPath);
      const actual = createHash('sha256').update(contents).digest('hex');
      return { actual, expected: session.sha256, status: actual === session.sha256 ? 'valid' : 'invalid' };
    } catch (error) {
      return { error: error.code, expected: session.sha256, status: 'missing' };
    }
  }

  async logExists(id) {
    const session = this.get(id);
    if (session.logPath === null) return false;
    try {
      await stat(session.logPath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
