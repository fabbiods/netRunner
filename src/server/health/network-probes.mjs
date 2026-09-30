import { spawn } from 'node:child_process';
import net from 'node:net';
import { inspectTlsCertificate } from '../https/tls-probe.mjs';

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
}

function failureReason(error) {
  if (error?.code === 'ETIMEDOUT') return 'timeout';
  if (error?.code === 'ENOTFOUND') return 'dns_not_found';
  if (error?.code === 'ECONNREFUSED') return 'connection_refused';
  if (error?.code === 'EHOSTUNREACH' || error?.code === 'ENETUNREACH') return 'unreachable';
  return error?.code === 'ENOENT' ? 'probe_unavailable' : 'connection_failed';
}

export function probeTcp({ host, port, timeout }) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout, () =>
      finish({ latencyMs: null, reason: 'timeout', status: 'offline' }),
    );
    socket.once('connect', () =>
      finish({ latencyMs: elapsedMilliseconds(startedAt), reason: null, status: 'online' }),
    );
    socket.once('error', (error) =>
      finish({ latencyMs: null, reason: failureReason(error), status: 'offline' }),
    );
  });
}

export async function probeTls({ host, port, timeout }) {
  const startedAt = process.hrtime.bigint();
  try {
    const certificate = await inspectTlsCertificate({ host, port, timeout });
    return {
      latencyMs: elapsedMilliseconds(startedAt),
      reason: null,
      status: 'online',
      tls: { cipher: certificate.cipher, protocol: certificate.protocol },
    };
  } catch (error) {
    return {
      latencyMs: null,
      reason: error.details?.reason ?? failureReason(error),
      status: 'offline',
    };
  }
}

function pingCommand(platform, timeout) {
  if (platform === 'darwin') {
    return { command: '/sbin/ping', arguments: ['-n', '-c', '1', '-W', String(timeout)] };
  }
  if (platform === 'linux') {
    return {
      command: '/bin/ping',
      arguments: ['-n', '-c', '1', '-W', String(Math.max(1, Math.ceil(timeout / 1000)))],
    };
  }
  return undefined;
}

export function probePing({ host, platform = process.platform, spawnProcess = spawn, timeout }) {
  const command = pingCommand(platform, timeout);
  if (command === undefined) {
    return Promise.resolve({ latencyMs: null, reason: 'unsupported_platform', status: 'unsupported' });
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawnProcess(command.command, [...command.arguments, host], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ latencyMs: null, reason: 'timeout', status: 'offline' });
    }, timeout + 250);
    child.stdout.on('data', (chunk) => {
      if (output.length < 16_384) output += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      const reason = failureReason(error);
      finish({
        latencyMs: null,
        reason,
        status: reason === 'probe_unavailable' ? 'unsupported' : 'offline',
      });
    });
    child.once('close', (code) => {
      if (code !== 0) {
        finish({ latencyMs: null, reason: 'no_reply', status: 'offline' });
        return;
      }
      const match = /time[=<]([\d.]+)\s*ms/iu.exec(output);
      finish({
        latencyMs: match === null ? null : Number(match[1]),
        reason: null,
        status: 'online',
      });
    });
  });
}
