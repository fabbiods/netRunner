import { readJsonBody } from '../http-utils.mjs';

function reply(body, statusCode = 200) {
  return { body, statusCode };
}

export async function routeSettingsApi(request, requestUrl, settings) {
  if (requestUrl.pathname !== '/api/settings') return undefined;
  if (request.method === 'GET') return reply(settings.getAll());
  if (request.method === 'PUT') return reply(settings.update(await readJsonBody(request)));
  return undefined;
}
