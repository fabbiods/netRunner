function reply(body, statusCode = 200) {
  return { body, statusCode };
}

function pathId(pathname, pattern) {
  const match = pattern.exec(pathname);
  return match === null ? undefined : decodeURIComponent(match[1]);
}

export async function routeSecurityMaterialApi(request, requestUrl, services) {
  const { method = 'GET' } = request;
  const { pathname } = requestUrl;
  if (pathname === '/api/security/host-keys' && method === 'GET') {
    return reply(services.hostKeys.list());
  }
  if (pathname === '/api/security/certificates' && method === 'GET') {
    return reply(services.certificates.list());
  }
  const hostKeyId = pathId(pathname, /^\/api\/security\/host-keys\/([^/]+)$/);
  if (hostKeyId !== undefined && method === 'DELETE') {
    services.hostKeys.remove(hostKeyId);
    return reply(undefined, 204);
  }
  const certificateId = pathId(pathname, /^\/api\/security\/certificates\/([^/]+)$/);
  if (certificateId !== undefined && method === 'DELETE') {
    services.certificates.remove(certificateId);
    return reply(undefined, 204);
  }
  return undefined;
}
