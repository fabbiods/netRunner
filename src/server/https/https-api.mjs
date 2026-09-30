import { readJsonBody } from '../http-utils.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

export async function routeHttpsApi(request, requestUrl, httpsAccess) {
  const { method = 'GET' } = request;
  const { pathname } = requestUrl;

  if (pathname === '/api/https/inspect' && method === 'POST') {
    const body = await readJsonBody(request);
    return reply(await httpsAccess.inspect(body.deviceId));
  }

  if (pathname === '/api/https/open' && method === 'POST') {
    const body = await readJsonBody(request);
    return reply(
      await httpsAccess.open({
        decision: body.decision,
        deviceId: body.deviceId,
        expectedFingerprint: body.expectedFingerprint,
      }),
    );
  }

  return undefined;
}
