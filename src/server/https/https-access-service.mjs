import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { ApplicationError, ConflictError } from '../errors.mjs';
import { inspectTlsCertificate } from './tls-probe.mjs';

function targetUrl(device) {
  if (device.httpsUrl !== null) return new URL(device.httpsUrl);
  const host = isIP(device.address) === 6 ? `[${device.address}]` : device.address;
  return new URL(`https://${host}:${device.httpsPort}/`);
}

function connectionTarget(url) {
  return {
    host: url.hostname.replace(/^\[|\]$/gu, ''),
    port: url.port === '' ? 443 : Number(url.port),
  };
}

function validateCertificateDates(certificate, now = new Date()) {
  if (certificate.validFrom !== null && new Date(certificate.validFrom) > now) {
    throw new ApplicationError('O certificado HTTPS ainda não é válido.', {
      code: 'tls_certificate_invalid',
      details: { reason: 'not_yet_valid' },
      statusCode: 409,
    });
  }
  if (certificate.validTo !== null && new Date(certificate.validTo) < now) {
    throw new ApplicationError('O certificado HTTPS está expirado.', {
      code: 'tls_certificate_invalid',
      details: { reason: 'expired' },
      statusCode: 409,
    });
  }
}

function defaultOpenExternal(url) {
  if (process.platform !== 'darwin') {
    throw new ApplicationError('A abertura no navegador padrão está disponível somente no macOS.', {
      code: 'unsupported_platform',
      statusCode: 409,
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export class HttpsAccessService {
  constructor({ certificates, history, inventory, openExternal = defaultOpenExternal, probe = inspectTlsCertificate }) {
    this.certificates = certificates;
    this.history = history;
    this.inventory = inventory;
    this.openExternal = openExternal;
    this.probe = probe;
  }

  async inspect(deviceId) {
    const device = this.#device(deviceId);
    const url = targetUrl(device);
    const { host, port } = connectionTarget(url);
    const certificate = await this.probe({
      host,
      port,
      timeout: device.connectTimeout * 1000,
    });
    validateCertificateDates(certificate);
    const trust = this.certificates.inspect({
      certificate,
      deviceId: device.id,
      host,
      port,
    });
    return {
      certificate,
      device: {
        hostname: device.hostname,
        id: device.id,
        locationPath: device.locationPath,
      },
      previousFingerprint: trust.known?.fingerprint ?? null,
      trustStatus: trust.status,
      url: url.toString(),
    };
  }

  async open({ decision, deviceId, expectedFingerprint }) {
    const inspection = await this.inspect(deviceId);
    if (inspection.certificate.fingerprint !== expectedFingerprint) {
      throw new ConflictError('Certificate changed between inspection and browser handoff');
    }
    if (inspection.trustStatus === 'changed' && decision !== 'replace') {
      throw new ConflictError('Changed certificate requires explicit replacement');
    }
    if (inspection.trustStatus === 'untrusted-first-seen' && decision !== 'trust') {
      throw new ConflictError('Untrusted certificate requires explicit trust');
    }
    if (
      (inspection.trustStatus === 'changed' && decision === 'replace') ||
      (inspection.trustStatus === 'untrusted-first-seen' && decision === 'trust')
    ) {
      const url = new URL(inspection.url);
      const { host, port } = connectionTarget(url);
      this.certificates.trust(
        {
          certificate: inspection.certificate,
          deviceId,
          host,
          port,
        },
        { replace: decision === 'replace' },
      );
    }

    const device = this.#device(deviceId);
    const url = new URL(inspection.url);
    const { host, port } = connectionTarget(url);
    const startedAt = new Date().toISOString();
    const sessionId = randomUUID();
    this.history.begin({
      address: host,
      deviceId: device.id,
      deviceType: device.deviceType,
      hostname: device.hostname,
      id: sessionId,
      locationPath: device.locationPath,
      port,
      protocol: 'https',
      startedAt,
      ticket: null,
      username: null,
      vendor: device.vendor,
    });
    this.history.updateSecurity(sessionId, {
      algorithms: {
        cipher: inspection.certificate.cipher,
        tlsProtocol: inspection.certificate.protocol,
      },
      hostFingerprint: inspection.certificate.fingerprint,
    });
    let reason = 'external_browser_handoff';
    try {
      await this.openExternal(inspection.url);
    } catch (error) {
      reason = 'browser_open_failed';
      throw new ApplicationError('Não foi possível abrir o navegador padrão.', {
        code: 'browser_open_failed',
        statusCode: 502,
      });
    } finally {
      this.history.finish(sessionId, {
        endedAt: new Date().toISOString(),
        reason,
        startedAt,
      });
    }
    return { opened: true, sessionId, url: inspection.url };
  }

  #device(deviceId) {
    const device = this.inventory.getDevice(deviceId);
    if (!device.httpsEnabled) {
      throw new ConflictError('HTTPS is disabled for this device');
    }
    return device;
  }
}
