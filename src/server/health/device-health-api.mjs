import { readJsonBody } from '../http-utils.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

export async function routeDeviceHealthApi(request, requestUrl, health) {
  const { method = 'GET' } = request;
  const { pathname, searchParams } = requestUrl;

  if (pathname === '/api/device-health' && method === 'GET') {
    const deviceId = searchParams.get('deviceId');
    return reply(
      deviceId === null
        ? health.listLatest()
        : health.listHistory(deviceId, searchParams.get('limit') ?? undefined),
    );
  }

  if (pathname === '/api/device-health/check' && method === 'POST') {
    const body = await readJsonBody(request, { maximumBytes: 16 * 1024 });
    return reply(await health.checkDevices(body.deviceIds));
  }

  return undefined;
}
