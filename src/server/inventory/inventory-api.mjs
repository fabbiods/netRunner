import { ApplicationError } from '../errors.mjs';
import { readJsonBody } from '../http-utils.mjs';
import { applyImport, exportInventoryCsv, previewImport } from './import-export.mjs';

function reply(body, statusCode = 200, options = {}) {
  return { body, statusCode, ...options };
}

function pathId(pathname, pattern) {
  const match = pattern.exec(pathname);
  if (match === null) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new ApplicationError('Path contains invalid encoding', {
      code: 'invalid_path',
      statusCode: 400,
    });
  }
}

function booleanQuery(value) {
  return value === '1' || value === 'true';
}

export async function routeInventoryApi(request, requestUrl, inventory) {
  const { method = 'GET' } = request;
  const { pathname, searchParams } = requestUrl;

  if (method === 'GET' && pathname === '/api/inventory/summary') {
    return reply(inventory.getSummary());
  }

  if (pathname === '/api/locations') {
    if (method === 'GET') {
      return reply(inventory.listLocations());
    }
    if (method === 'POST') {
      return reply(inventory.createLocation(await readJsonBody(request)), 201);
    }
  }

  const locationId = pathId(pathname, /^\/api\/locations\/([^/]+)$/);
  if (locationId !== undefined) {
    if (method === 'PUT') {
      return reply(inventory.updateLocation(locationId, await readJsonBody(request)));
    }
    if (method === 'DELETE') {
      const body = await readJsonBody(request);
      inventory.deleteLocation(locationId, body.destinationLocationId);
      return reply(undefined, 204);
    }
  }

  if (pathname === '/api/usernames') {
    if (method === 'GET') {
      return reply(inventory.listUsernames());
    }
    if (method === 'POST') {
      return reply(inventory.createUsername(await readJsonBody(request)), 201);
    }
  }

  const usernameId = pathId(pathname, /^\/api\/usernames\/([^/]+)$/);
  if (usernameId !== undefined) {
    if (method === 'PUT') {
      return reply(inventory.updateUsername(usernameId, await readJsonBody(request)));
    }
    if (method === 'DELETE') {
      const body = await readJsonBody(request);
      inventory.deleteUsername(usernameId, body.replacementUsernameId);
      return reply(undefined, 204);
    }
  }

  if (pathname === '/api/devices') {
    if (method === 'GET') {
      return reply(
        inventory.listDevices({
          algorithmProfile: searchParams.get('algorithmProfile') ?? undefined,
          favorites: booleanQuery(searchParams.get('favorites')),
          limit: searchParams.get('limit') ?? 200,
          locationId: searchParams.get('locationId') ?? undefined,
          recent: booleanQuery(searchParams.get('recent')),
          search: searchParams.get('search') ?? '',
        }),
      );
    }
    if (method === 'POST') {
      return reply(inventory.createDevice(await readJsonBody(request)), 201);
    }
  }

  if (method === 'POST' && pathname === '/api/devices/bulk') {
    const body = await readJsonBody(request);
    return reply(inventory.bulkUpdateDevices(body.ids, body.changes ?? {}));
  }

  const recentDeviceId = pathId(pathname, /^\/api\/devices\/([^/]+)\/recent$/);
  if (recentDeviceId !== undefined && method === 'POST') {
    return reply(inventory.markDeviceConnected(recentDeviceId));
  }

  const deviceId = pathId(pathname, /^\/api\/devices\/([^/]+)$/);
  if (deviceId !== undefined) {
    if (method === 'GET') {
      return reply(inventory.getDevice(deviceId));
    }
    if (method === 'PUT') {
      return reply(inventory.updateDevice(deviceId, await readJsonBody(request)));
    }
    if (method === 'DELETE') {
      inventory.deleteDevice(deviceId);
      return reply(undefined, 204);
    }
  }

  if (method === 'POST' && pathname === '/api/import/preview') {
    return reply(previewImport(inventory, await readJsonBody(request)));
  }

  if (method === 'POST' && pathname === '/api/import/apply') {
    return reply(applyImport(inventory, await readJsonBody(request)), 201);
  }

  if (method === 'GET' && pathname === '/api/export/json') {
    return reply(inventory.exportInventory(), 200, {
      headers: { 'Content-Disposition': 'attachment; filename="netrunner-inventory.json"' },
    });
  }

  if (method === 'GET' && pathname === '/api/export/csv') {
    return reply(exportInventoryCsv(inventory), 200, {
      contentType: 'text/csv; charset=utf-8',
      headers: { 'Content-Disposition': 'attachment; filename="netrunner-inventory.csv"' },
    });
  }

  return undefined;
}
