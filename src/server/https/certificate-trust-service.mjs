import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../errors.mjs';

function nowIso() {
  return new Date().toISOString();
}

function mapCertificate(row) {
  if (row === undefined) return null;
  return {
    deviceId: row.device_id,
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at,
    host: row.host,
    id: row.id,
    issuer: row.issuer,
    lastSeenAt: row.last_seen_at,
    port: row.port,
    subject: row.subject,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

export class CertificateTrustService {
  constructor(database) {
    this.database = database;
  }

  inspect({ certificate, deviceId, host, port }) {
    const known = mapCertificate(
      this.database
        .prepare(
          'SELECT * FROM trusted_certificates WHERE device_id = ? AND host = ? AND port = ?',
        )
        .get(deviceId, host, port),
    );
    if (known === null) {
      return { known, status: certificate.authorized ? 'system-trusted' : 'untrusted-first-seen' };
    }
    if (known.fingerprint === certificate.fingerprint) {
      this.database
        .prepare('UPDATE trusted_certificates SET last_seen_at = ?, updated_at = ? WHERE id = ?')
        .run(nowIso(), nowIso(), known.id);
      return { known, status: 'pinned' };
    }
    return { known, status: 'changed' };
  }

  trust({ certificate, deviceId, host, port }, { replace = false } = {}) {
    const inspection = this.inspect({ certificate, deviceId, host, port });
    if (inspection.status === 'changed' && !replace) {
      throw new ConflictError('Certificate fingerprint changed and requires explicit replacement');
    }
    const now = nowIso();
    if (inspection.known === null) {
      this.database.prepare(`INSERT INTO trusted_certificates (
        id, device_id, host, port, fingerprint, subject, issuer, valid_from, valid_to,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          randomUUID(),
          deviceId,
          host,
          port,
          certificate.fingerprint,
          certificate.subject,
          certificate.issuer,
          certificate.validFrom,
          certificate.validTo,
          now,
          now,
          now,
          now,
        );
    } else {
      this.database.prepare(`UPDATE trusted_certificates SET
        fingerprint = ?, subject = ?, issuer = ?, valid_from = ?, valid_to = ?,
        last_seen_at = ?, updated_at = ? WHERE id = ?`)
        .run(
          certificate.fingerprint,
          certificate.subject,
          certificate.issuer,
          certificate.validFrom,
          certificate.validTo,
          now,
          now,
          inspection.known.id,
        );
    }
    return this.inspect({ certificate, deviceId, host, port });
  }

  list() {
    return this.database
      .prepare('SELECT * FROM trusted_certificates ORDER BY host COLLATE NOCASE, port')
      .all()
      .map(mapCertificate);
  }

  remove(id) {
    const result = this.database.prepare('DELETE FROM trusted_certificates WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Trusted certificate');
  }
}
