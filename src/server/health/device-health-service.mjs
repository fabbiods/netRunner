import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../errors.mjs';
import { probePing, probeTcp, probeTls } from './network-probes.mjs';

const MAX_BATCH_SIZE = 20;
const MAX_HISTORY_PER_DEVICE = 100;
const PROBE_CONCURRENCY = 4;

function disabledProbe() {
  return { latencyMs: null, reason: null, status: 'disabled' };
}

function mapRow(row) {
  return {
    checkedAt: row.checked_at,
    deviceId: row.device_id,
    durationMs: row.duration_ms,
    hostname: row.hostname,
    https: {
      latencyMs: row.https_latency_ms,
      reason: row.https_reason,
      status: row.https_status,
    },
    id: row.id,
    locationPath: row.location_path,
    overallStatus: row.overall_status,
    ping: {
      latencyMs: row.ping_latency_ms,
      reason: row.ping_reason,
      status: row.ping_status,
    },
    ssh: {
      latencyMs: row.ssh_latency_ms,
      reason: row.ssh_reason,
      status: row.ssh_status,
    },
  };
}

function overallStatus(results) {
  const enabled = results.filter((result) => result.status !== 'disabled');
  const online = enabled.filter((result) => result.status === 'online').length;
  if (online === enabled.length) return 'online';
  return online === 0 ? 'offline' : 'degraded';
}

function httpsTarget(device) {
  if (device.httpsUrl) {
    const url = new URL(device.httpsUrl);
    return {
      host: url.hostname.replace(/^\[|\]$/gu, ''),
      port: url.port === '' ? 443 : Number(url.port),
    };
  }
  return { host: device.address, port: device.httpsPort };
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export class DeviceHealthService {
  constructor({ database, inventory, pingProbe = probePing, tcpProbe = probeTcp, tlsProbe = probeTls }) {
    this.database = database;
    this.inventory = inventory;
    this.pingProbe = pingProbe;
    this.tcpProbe = tcpProbe;
    this.tlsProbe = tlsProbe;
  }

  listLatest() {
    return this.database
      .prepare(`
        WITH RECURSIVE location_paths(id, path) AS (
          SELECT id, name FROM locations WHERE parent_id IS NULL
          UNION ALL
          SELECT child.id, location_paths.path || ' › ' || child.name
          FROM locations child
          JOIN location_paths ON child.parent_id = location_paths.id
        )
        SELECT ranked.*, d.hostname, COALESCE(location_paths.path, '') AS location_path
        FROM (
          SELECT h.*, row_number() OVER (
            PARTITION BY h.device_id ORDER BY h.checked_at DESC, h.rowid DESC
          ) AS position
          FROM device_health_checks h
        ) ranked
        JOIN devices d ON d.id = ranked.device_id
        LEFT JOIN location_paths ON location_paths.id = d.location_id
        WHERE ranked.position = 1
        ORDER BY d.hostname COLLATE NOCASE
      `)
      .all()
      .map(mapRow);
  }

  listHistory(deviceId, limit = 20) {
    this.inventory.getDevice(deviceId);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_HISTORY_PER_DEVICE));
    return this.database
      .prepare(`
        SELECT h.*, d.hostname, '' AS location_path
        FROM device_health_checks h
        JOIN devices d ON d.id = h.device_id
        WHERE h.device_id = ?
        ORDER BY h.checked_at DESC, h.rowid DESC
        LIMIT ?
      `)
      .all(deviceId, safeLimit)
      .map(mapRow);
  }

  async checkDevices(deviceIds) {
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      throw new ApplicationError('Selecione ao menos um dispositivo.', {
        code: 'validation_error',
        details: { field: 'deviceIds' },
        statusCode: 422,
      });
    }
    const uniqueIds = [...new Set(deviceIds)];
    if (uniqueIds.some((id) => typeof id !== 'string' || id.length === 0)) {
      throw new ApplicationError('A lista de dispositivos é inválida.', {
        code: 'validation_error',
        details: { field: 'deviceIds' },
        statusCode: 422,
      });
    }
    if (uniqueIds.length > MAX_BATCH_SIZE) {
      throw new ApplicationError(`Verifique no máximo ${MAX_BATCH_SIZE} dispositivos por vez.`, {
        code: 'batch_too_large',
        details: { maximum: MAX_BATCH_SIZE },
        statusCode: 422,
      });
    }
    return mapWithConcurrency(uniqueIds, PROBE_CONCURRENCY, (deviceId) => this.checkDevice(deviceId));
  }

  async checkDevice(deviceId) {
    const device = this.inventory.getDevice(deviceId);
    const startedAt = Date.now();
    const timeout = Math.min(device.connectTimeout * 1000, 5000);
    const pingPromise = this.pingProbe({ host: device.address, timeout });
    const sshPromise = device.sshEnabled
      ? this.tcpProbe({ host: device.address, port: device.sshPort, timeout })
      : Promise.resolve(disabledProbe());
    const httpsPromise = device.httpsEnabled
      ? this.tlsProbe({ ...httpsTarget(device), timeout })
      : Promise.resolve(disabledProbe());
    const [ping, ssh, https] = await Promise.all([pingPromise, sshPromise, httpsPromise]);
    const checkedAt = new Date().toISOString();
    const result = {
      checkedAt,
      deviceId,
      durationMs: Math.max(0, Date.now() - startedAt),
      hostname: device.hostname,
      https,
      id: randomUUID(),
      locationPath: device.locationPath,
      overallStatus: overallStatus([ssh, https]),
      ping,
      ssh,
    };
    this.#persist(result);
    return result;
  }

  #persist(result) {
    this.database
      .prepare(`
        INSERT INTO device_health_checks (
          id, device_id, checked_at, duration_ms, overall_status,
          ping_status, ping_latency_ms, ping_reason,
          ssh_status, ssh_latency_ms, ssh_reason,
          https_status, https_latency_ms, https_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        result.id,
        result.deviceId,
        result.checkedAt,
        result.durationMs,
        result.overallStatus,
        result.ping.status,
        result.ping.latencyMs,
        result.ping.reason,
        result.ssh.status,
        result.ssh.latencyMs,
        result.ssh.reason,
        result.https.status,
        result.https.latencyMs,
        result.https.reason,
      );
    this.database
      .prepare(`
        DELETE FROM device_health_checks
        WHERE device_id = ? AND id NOT IN (
          SELECT id FROM device_health_checks
          WHERE device_id = ?
          ORDER BY checked_at DESC, rowid DESC
          LIMIT ?
        )
      `)
      .run(result.deviceId, result.deviceId, MAX_HISTORY_PER_DEVICE);
  }
}
