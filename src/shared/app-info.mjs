export const APP_NAME = 'NetRunner';
export const APP_VERSION = '0.6.0';
export const CONTRACT_VERSION = 5;

export function createHealthResponse(platform) {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    name: APP_NAME,
    platform,
    security: Object.freeze({
      externalConnections: false,
      loopbackOnly: true,
      telemetry: false,
    }),
    status: 'ok',
    version: APP_VERSION,
  });
}
