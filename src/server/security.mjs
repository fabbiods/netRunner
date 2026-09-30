import { randomBytes, timingSafeEqual } from 'node:crypto';

const PERMISSIONS_POLICY = [
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'microphone=()',
  'notifications=()',
  'payment=()',
  'publickey-credentials-get=()',
  'usb=()',
].join(', ');

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function isSessionTokenValid(providedToken, expectedToken) {
  if (typeof providedToken !== 'string') {
    return false;
  }

  const provided = Buffer.from(providedToken, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function readBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== 'string') {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorizationHeader);
  return match?.[1];
}

export function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createSecurityHeaders() {
  return Object.freeze({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': buildContentSecurityPolicy(),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
}

export function isRequestTargetTrusted(request, expectedAuthority) {
  if (request.headers.host !== expectedAuthority) {
    return false;
  }

  const origin = request.headers.origin;
  return origin === undefined || origin === `http://${expectedAuthority}`;
}
