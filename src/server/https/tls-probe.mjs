import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import tls from 'node:tls';
import { ApplicationError } from '../errors.mjs';

function distinguishedName(value) {
  if (value === null || typeof value !== 'object') return null;
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item === 'string' && item.length > 0)
    .map(([key, item]) => `${key}=${item}`);
  return entries.length === 0 ? null : entries.join(', ');
}

function certificateDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function preflightError(error) {
  const message = String(error.message ?? '');
  let reason = 'connection_failed';
  if (error.code === 'ETIMEDOUT' || /timed out/iu.test(message)) reason = 'timeout';
  else if (error.code === 'ENOTFOUND') reason = 'dns_not_found';
  else if (error.code === 'ECONNREFUSED') reason = 'connection_refused';
  else if (/protocol version|unsupported protocol|wrong version/iu.test(message)) {
    reason = 'obsolete_tls';
  }
  return new ApplicationError('Não foi possível inspecionar o endpoint HTTPS.', {
    code: 'tls_preflight_failed',
    details: { reason },
    statusCode: 502,
  });
}

export function inspectTlsCertificate({ host, port, timeout = 20_000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tls.connect({
      host,
      minVersion: 'TLSv1.2',
      port,
      rejectUnauthorized: false,
      servername: isIP(host) === 0 ? host : undefined,
    });
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      operation();
    };
    socket.setTimeout(timeout, () => finish(() => reject(preflightError({ code: 'ETIMEDOUT' }))));
    socket.once('error', (error) => finish(() => reject(preflightError(error))));
    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate(true);
      if (!peer?.raw) {
        finish(() => reject(preflightError(new Error('Peer certificate unavailable'))));
        return;
      }
      const cipher = socket.getCipher();
      const certificate = {
        authorizationError: socket.authorized ? null : String(socket.authorizationError ?? 'untrusted'),
        authorized: socket.authorized,
        cipher: cipher?.standardName ?? cipher?.name ?? null,
        fingerprint: `SHA256:${createHash('sha256').update(peer.raw).digest('base64')}`,
        issuer: distinguishedName(peer.issuer),
        protocol: socket.getProtocol(),
        subject: distinguishedName(peer.subject),
        subjectAltName: typeof peer.subjectaltname === 'string' ? peer.subjectaltname : null,
        validFrom: certificateDate(peer.valid_from),
        validTo: certificateDate(peer.valid_to),
      };
      finish(() => resolve(certificate));
    });
  });
}
