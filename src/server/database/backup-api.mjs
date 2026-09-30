import { readJsonBody } from '../http-utils.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

export async function routeBackupApi(request, requestUrl, backups) {
  if (requestUrl.pathname === '/api/backups' && request.method === 'GET') {
    return reply(await backups.list());
  }
  if (requestUrl.pathname === '/api/backups/create' && request.method === 'POST') {
    return reply(await backups.createManual(), 201);
  }
  if (requestUrl.pathname === '/api/backups/restore' && request.method === 'POST') {
    const body = await readJsonBody(request);
    return reply(await backups.queueRestore(body.name));
  }
  return undefined;
}
