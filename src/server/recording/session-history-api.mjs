import { spawn } from 'node:child_process';
import { ApplicationError } from '../errors.mjs';
import { readJsonBody } from '../http-utils.mjs';
import { isPathInside } from './log-paths.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

function pathId(pathname, pattern) {
  const match = pattern.exec(pathname);
  return match === null ? undefined : decodeURIComponent(match[1]);
}

function openLocalPath(filePath, reveal) {
  if (process.platform !== 'darwin') {
    throw new ApplicationError('Opening local logs is currently supported only on macOS', {
      code: 'unsupported_platform',
      statusCode: 409,
    });
  }
  const child = spawn('/usr/bin/open', reveal ? ['-R', filePath] : [filePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function optionalDuration(value, field) {
  if (value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 31_536_000_000) {
    throw new ApplicationError('Invalid duration filter', {
      code: 'validation_error',
      details: { field },
      statusCode: 422,
    });
  }
  return number;
}

export async function routeSessionHistoryApi(request, requestUrl, { history, logsRoot }) {
  const { method = 'GET' } = request;
  const { pathname, searchParams } = requestUrl;

  if (pathname === '/api/history' && method === 'GET') {
    return reply(
      history.list({
        dateFrom: searchParams.get('dateFrom') || undefined,
        dateTo: searchParams.get('dateTo') || undefined,
        deviceId: searchParams.get('deviceId') || undefined,
        limit: searchParams.get('limit') || undefined,
        location: searchParams.get('location') || undefined,
        maximumDurationMs: optionalDuration(searchParams.get('maximumDurationMs'), 'maximumDurationMs'),
        minimumDurationMs: optionalDuration(searchParams.get('minimumDurationMs'), 'minimumDurationMs'),
        protocol: searchParams.get('protocol') || undefined,
        ticket: searchParams.get('ticket') || undefined,
      }),
    );
  }

  if (pathname === '/api/history/settings') {
    if (method === 'GET') {
      return reply({ logsRoot, recordingDefault: history.getRecordingDefault() });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request);
      if (typeof body.recordingDefault !== 'boolean') {
        throw new ApplicationError('Invalid recording preference', {
          code: 'validation_error',
          details: { field: 'recordingDefault' },
          statusCode: 422,
        });
      }
      return reply({ logsRoot, recordingDefault: history.setRecordingDefault(body.recordingDefault) });
    }
  }

  const verifyId = pathId(pathname, /^\/api\/history\/([^/]+)\/verify$/);
  if (verifyId !== undefined && method === 'POST') return reply(await history.verify(verifyId));

  const openMatch = /^\/api\/history\/([^/]+)\/(open|reveal)$/.exec(pathname);
  if (openMatch !== null && method === 'POST') {
    const id = decodeURIComponent(openMatch[1]);
    const session = history.get(id);
    if (
      session.logPath === null ||
      !isPathInside(logsRoot, session.logPath) ||
      !(await history.logExists(id))
    ) {
      throw new ApplicationError('The session log is unavailable', {
        code: 'log_unavailable',
        statusCode: 404,
      });
    }
    openLocalPath(session.logPath, openMatch[2] === 'reveal');
    return reply({ opened: true });
  }

  return undefined;
}
