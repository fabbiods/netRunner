import { createHash, randomUUID } from 'node:crypto';
import ssh2 from 'ssh2';
import { ConflictError, NotFoundError } from '../errors.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fingerprintFor(key) {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`;
}

function keyTypeFor(key) {
  const parsed = ssh2.utils.parseKey(key);
  if (parsed instanceof Error || Array.isArray(parsed)) return 'unknown';
  return parsed.type;
}

function mapKnownHost(row) {
  return {
    deviceId: row.device_id,
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at,
    host: row.host,
    id: row.id,
    keyType: row.key_type,
    lastSeenAt: row.last_seen_at,
    port: row.port,
  };
}

export class HostKeyService {
  constructor(database) {
    this.database = database;
  }

  inspect({ deviceId, host, key, port }) {
    const candidate = Object.freeze({
      deviceId,
      fingerprint: fingerprintFor(key),
      host,
      keyType: keyTypeFor(key),
      port,
    });
    const known = this.database
      .prepare('SELECT * FROM known_hosts WHERE host = ? AND port = ?')
      .get(host, port);
    if (known === undefined) return { candidate, status: 'unknown' };
    if (known.fingerprint !== candidate.fingerprint) {
      return { candidate, known: mapKnownHost(known), status: 'changed' };
    }
    this.database
      .prepare('UPDATE known_hosts SET device_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?')
      .run(deviceId, nowIso(), nowIso(), known.id);
    return { candidate, known: mapKnownHost(known), status: 'trusted' };
  }

  trust(candidate, { replace = false } = {}) {
    const known = this.database
      .prepare('SELECT * FROM known_hosts WHERE host = ? AND port = ?')
      .get(candidate.host, candidate.port);
    if (known !== undefined && known.fingerprint !== candidate.fingerprint && !replace) {
      throw new ConflictError('Host key changed and requires an explicit replacement');
    }
    const timestamp = nowIso();
    if (known === undefined) {
      this.database
        .prepare(`
          INSERT INTO known_hosts
            (id, device_id, host, port, key_type, fingerprint, first_seen_at, last_seen_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          candidate.deviceId,
          candidate.host,
          candidate.port,
          candidate.keyType,
          candidate.fingerprint,
          timestamp,
          timestamp,
          timestamp,
          timestamp,
        );
    } else {
      this.database
        .prepare(`
          UPDATE known_hosts
          SET device_id = ?, key_type = ?, fingerprint = ?, first_seen_at = ?, last_seen_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          candidate.deviceId,
          candidate.keyType,
          candidate.fingerprint,
          timestamp,
          timestamp,
          timestamp,
          known.id,
        );
    }
    return this.database
      .prepare('SELECT * FROM known_hosts WHERE host = ? AND port = ?')
      .get(candidate.host, candidate.port);
  }

  list() {
    return this.database
      .prepare('SELECT * FROM known_hosts ORDER BY host COLLATE NOCASE, port')
      .all()
      .map(mapKnownHost);
  }

  remove(id) {
    const result = this.database.prepare('DELETE FROM known_hosts WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Known host');
  }
}
