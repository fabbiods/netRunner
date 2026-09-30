import { createServer as createHttpServer } from 'node:http';
import { createHealthResponse } from '../shared/app-info.mjs';
import { routeBackupApi } from './database/backup-api.mjs';
import { ApplicationError } from './errors.mjs';
import { routeDeviceHealthApi } from './health/device-health-api.mjs';
import { routeHttpsApi } from './https/https-api.mjs';
import { routeInventoryApi } from './inventory/inventory-api.mjs';
import { routeSessionHistoryApi } from './recording/session-history-api.mjs';
import { routeConfigurationSnapshotApi } from './snapshots/configuration-snapshot-api.mjs';
import { routeSshApi } from './ssh/ssh-api.mjs';
import {
  createSecurityHeaders,
  isRequestTargetTrusted,
  isSessionTokenValid,
  readBearerToken,
} from './security.mjs';
import { readStaticFile } from './static-files.mjs';
import { routeSettingsApi } from './settings/settings-api.mjs';
import { routeSecurityMaterialApi } from './security-material-api.mjs';

const LOOPBACK_HOST = '127.0.0.1';

function send(response, statusCode, headers, body) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function sendJson(response, statusCode, securityHeaders, value) {
  send(
    response,
    statusCode,
    { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    JSON.stringify(value),
  );
}

function sendApiReply(response, securityHeaders, apiReply) {
  if (apiReply.statusCode === 204) {
    send(response, 204, securityHeaders, undefined);
    return;
  }
  const contentType = apiReply.contentType ?? 'application/json; charset=utf-8';
  const body = apiReply.contentType === undefined ? JSON.stringify(apiReply.body) : apiReply.body;
  send(
    response,
    apiReply.statusCode,
    { ...securityHeaders, ...apiReply.headers, 'Content-Type': contentType },
    body,
  );
}

export async function startServer({ backups, browserDisconnectGraceMs = 750, health, historyApi, httpsAccess, imageRoot, inventory, onLastBrowserDisconnected, port = 0, securityMaterial, sessionToken, settings, snapshots, sshSessions, vendorRoot, webRoot }) {
  if (typeof sessionToken !== 'string' || sessionToken.length < 32) {
    throw new Error('A strong session token is required');
  }

  const securityHeaders = createSecurityHeaders();
  const browserConnections = new Set();
  let browserConnectionObserved = false;
  let browserDisconnectTimer;
  let serverClosing = false;
  let authority;

  function scheduleBrowserDisconnect() {
    if (
      serverClosing ||
      !browserConnectionObserved ||
      browserConnections.size > 0 ||
      typeof onLastBrowserDisconnected !== 'function'
    ) {
      return;
    }
    clearTimeout(browserDisconnectTimer);
    browserDisconnectTimer = setTimeout(() => {
      browserDisconnectTimer = undefined;
      if (serverClosing || browserConnections.size > 0) return;
      void Promise.resolve(onLastBrowserDisconnected()).catch((error) => {
        process.stderr.write(`Falha ao encerrar após fechar o navegador: ${error.message}\n`);
      });
    }, browserDisconnectGraceMs);
  }

  function openBrowserLifecycle(request, response) {
    browserConnectionObserved = true;
    clearTimeout(browserDisconnectTimer);
    browserDisconnectTimer = undefined;
    browserConnections.add(response);
    response.writeHead(200, {
      ...securityHeaders,
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
    });
    response.write('event: ready\ndata: {}\n\n');

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      browserConnections.delete(response);
      scheduleBrowserDisconnect();
    };
    request.once('aborted', release);
    response.once('close', release);
  }

  const server = createHttpServer(async (request, response) => {
    if (authority === undefined || !isRequestTargetTrusted(request, authority)) {
      sendJson(response, 421, securityHeaders, { error: 'untrusted_request_target' });
      return;
    }

    const requestUrl = new URL(request.url ?? '/', `http://${authority}`);

    if (requestUrl.pathname.startsWith('/api/')) {
      const providedToken = readBearerToken(request.headers.authorization);
      if (!isSessionTokenValid(providedToken, sessionToken)) {
        sendJson(response, 401, securityHeaders, { error: 'unauthorized' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/browser/lifecycle') {
        openBrowserLifecycle(request, response);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(response, 200, securityHeaders, createHealthResponse(process.platform));
        return;
      }

      if (inventory === undefined) {
        sendJson(response, 503, securityHeaders, { error: 'inventory_unavailable' });
        return;
      }

      try {
        if (backups !== undefined) {
          const backupReply = await routeBackupApi(request, requestUrl, backups);
          if (backupReply !== undefined) {
            sendApiReply(response, securityHeaders, backupReply);
            return;
          }
        }
        if (securityMaterial !== undefined) {
          const securityReply = await routeSecurityMaterialApi(request, requestUrl, securityMaterial);
          if (securityReply !== undefined) {
            sendApiReply(response, securityHeaders, securityReply);
            return;
          }
        }
        if (settings !== undefined) {
          const settingsReply = await routeSettingsApi(request, requestUrl, settings);
          if (settingsReply !== undefined) {
            sendApiReply(response, securityHeaders, settingsReply);
            return;
          }
        }
        if (httpsAccess !== undefined) {
          const httpsReply = await routeHttpsApi(request, requestUrl, httpsAccess);
          if (httpsReply !== undefined) {
            sendApiReply(response, securityHeaders, httpsReply);
            return;
          }
        }
        if (health !== undefined) {
          const healthReply = await routeDeviceHealthApi(request, requestUrl, health);
          if (healthReply !== undefined) {
            sendApiReply(response, securityHeaders, healthReply);
            return;
          }
        }
        if (snapshots !== undefined) {
          const snapshotReply = await routeConfigurationSnapshotApi(request, requestUrl, snapshots);
          if (snapshotReply !== undefined) {
            sendApiReply(response, securityHeaders, snapshotReply);
            return;
          }
        }
        if (historyApi !== undefined) {
          const historyReply = await routeSessionHistoryApi(request, requestUrl, historyApi);
          if (historyReply !== undefined) {
            sendApiReply(response, securityHeaders, historyReply);
            return;
          }
        }
        if (sshSessions !== undefined) {
          const sshReply = await routeSshApi(request, requestUrl, sshSessions);
          if (sshReply !== undefined) {
            sendApiReply(response, securityHeaders, sshReply);
            return;
          }
        }
        const apiReply = await routeInventoryApi(request, requestUrl, inventory);
        if (apiReply === undefined) {
          sendJson(response, 404, securityHeaders, { error: 'not_found' });
          return;
        }
        sendApiReply(response, securityHeaders, apiReply);
      } catch (error) {
        if (error instanceof ApplicationError) {
          sendJson(response, error.statusCode, securityHeaders, {
            details: error.details,
            error: error.code,
            message: error.message,
          });
          return;
        }
        process.stderr.write(`Falha interna ao processar a requisição: ${error.message}\n`);
        sendJson(response, 500, securityHeaders, { error: 'internal_error' });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, securityHeaders, { error: 'method_not_allowed' });
      return;
    }

    try {
      const staticFile = await readStaticFile(webRoot, requestUrl.pathname, vendorRoot, imageRoot);
      if (staticFile === undefined) {
        sendJson(response, 404, securityHeaders, { error: 'not_found' });
        return;
      }

      const body = request.method === 'HEAD' ? undefined : staticFile.body;
      send(
        response,
        200,
        { ...securityHeaders, 'Content-Type': staticFile.contentType },
        body,
      );
    } catch {
      sendJson(response, 500, securityHeaders, { error: 'internal_error' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Unable to resolve local server address');
  }

  authority = `${LOOPBACK_HOST}:${address.port}`;

  return Object.freeze({
    authority,
    close: () => {
      serverClosing = true;
      clearTimeout(browserDisconnectTimer);
      browserDisconnectTimer = undefined;
      for (const response of browserConnections) response.end();
      browserConnections.clear();
      const closePromise = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      return closePromise;
    },
    origin: `http://${authority}`,
  });
}
