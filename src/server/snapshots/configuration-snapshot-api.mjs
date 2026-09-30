import { readJsonBody } from '../http-utils.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

function pathId(pathname) {
  const match = /^\/api\/configuration-snapshots\/([^/]+)$/u.exec(pathname);
  return match === null ? undefined : decodeURIComponent(match[1]);
}

export async function routeConfigurationSnapshotApi(request, requestUrl, snapshots) {
  const { method = 'GET' } = request;
  const { pathname, searchParams } = requestUrl;

  if (pathname === '/api/configuration-snapshots') {
    if (method === 'GET') {
      return reply(
        snapshots.list({
          deviceId: searchParams.get('deviceId') || undefined,
          limit: searchParams.get('limit') || undefined,
        }),
      );
    }
    if (method === 'POST') {
      const body = await readJsonBody(request, { maximumBytes: 2 * 1024 * 1024 + 16 * 1024 });
      return reply(snapshots.create(body), 201);
    }
  }

  if (pathname === '/api/configuration-snapshots/compare' && method === 'POST') {
    const body = await readJsonBody(request, { maximumBytes: 16 * 1024 });
    return reply(snapshots.compare(body.leftId, body.rightId));
  }

  const snapshotId = pathId(pathname);
  if (snapshotId !== undefined) {
    if (method === 'GET') return reply(snapshots.get(snapshotId));
    if (method === 'DELETE') {
      snapshots.delete(snapshotId);
      return reply(undefined, 204);
    }
  }

  return undefined;
}
