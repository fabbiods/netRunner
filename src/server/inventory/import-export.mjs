import { runInTransaction } from '../database/database.mjs';
import { ApplicationError } from '../errors.mjs';
import { parseDeviceInput } from '../validation.mjs';
import { parseCsv, writeCsv } from './csv.mjs';

const CSV_HEADERS = Object.freeze([
  'hostname',
  'address',
  'vendor',
  'device_type',
  'platform',
  'location',
  'username',
  'ssh_port',
  'https_url',
  'tags',
  'favorite',
]);

function booleanFromText(value) {
  return ['1', 'sim', 'true', 'yes'].includes(String(value).trim().toLowerCase());
}

function parseDeviceRecord(source, metadata) {
  try {
    return {
      ...metadata,
      device: parseDeviceInput({
        address: source.address,
        algorithmProfile: source.algorithmProfile,
        customAlgorithms: source.customAlgorithms,
        deviceType: source.deviceType ?? source.device_type,
        favorite: source.favorite === true || booleanFromText(source.favorite),
        hostname: source.hostname,
        httpsEnabled: Boolean(source.httpsEnabled ?? source.https_url ?? source.httpsUrl),
        httpsPort: source.httpsPort,
        httpsUrl: source.httpsUrl ?? source.https_url ?? null,
        locationId: 'import-location',
        platform: source.platform || null,
        postLoginCommand: source.postLoginCommand,
        postLoginEnabled: source.postLoginEnabled,
        sshEnabled:
          source.sshEnabled === undefined && source.ssh_enabled === undefined
            ? true
            : source.sshEnabled === true || booleanFromText(source.ssh_enabled),
        sshPort:
          source.sshPort ??
          (source.ssh_port === '' || source.ssh_port === undefined ? 22 : Number(source.ssh_port)),
        tags: Array.isArray(source.tags)
          ? source.tags
          : source.tags
            ? source.tags.split('|').map((tag) => tag.trim()).filter(Boolean)
            : [],
        usernameId: 'import-username',
        vendor: source.vendor,
      }),
    };
  } catch (error) {
    return {
      ...metadata,
      error: {
        field: error.details?.field ?? 'record',
        index: metadata.index,
        message: error.details?.message ?? error.message,
      },
    };
  }
}

function recordsFromCsv(content) {
  const rows = parseCsv(content);
  const isLocationOnly =
    rows.length > 0 &&
    rows.every((row) => !row.hostname && !row.address && (row.location?.trim() || row.path?.trim()));
  if (isLocationOnly) {
    return {
      deviceRecords: [],
      locationPaths: rows.map((row) => (row.location || row.path).trim()),
      usernameNames: [],
    };
  }
  return {
    deviceRecords: rows.map((row, index) =>
      parseDeviceRecord(row, {
        index,
        locationPath: row.location?.trim(),
        username: row.username?.trim(),
      }),
    ),
    locationPaths: [],
    usernameNames: [],
  };
}

function recordsFromJson(content) {
  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    throw new ApplicationError('JSON is invalid', { code: 'validation_error', statusCode: 422 });
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.devices)) {
    throw new ApplicationError('JSON must contain a devices array', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  return {
    deviceRecords: parsed.devices.map((device, index) =>
      parseDeviceRecord(device, {
        index,
        locationPath: device.locationPath ?? device.location,
        username: device.username,
      }),
    ),
    locationPaths: Array.isArray(parsed.locations)
      ? parsed.locations.map((location) => location.path).filter((value) => typeof value === 'string')
      : [],
    usernameNames: Array.isArray(parsed.usernames)
      ? parsed.usernames.map((username) => username.username).filter((value) => typeof value === 'string')
      : [],
  };
}

function parseRecords(format, content) {
  let records;
  if (format === 'csv') records = recordsFromCsv(content);
  else if (format === 'json') records = recordsFromJson(content);
  else {
    throw new ApplicationError('Import format must be csv or json', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  const total = records.deviceRecords.length + records.locationPaths.length + records.usernameNames.length;
  if (total > 20_000) {
    throw new ApplicationError('Import is limited to 20,000 records', {
      code: 'validation_error',
      statusCode: 422,
    });
  }
  return records;
}

function validateReferences(records, inventory) {
  const locationPaths = new Set(inventory.listLocations().map((location) => location.path.toLowerCase()));
  const usernames = new Set(inventory.listUsernames().map((item) => item.username.toLowerCase()));
  const existingDevices = inventory.listDevices({ limit: 20_000 });
  const errors = records.deviceRecords.filter((record) => record.error).map((record) => record.error);
  const warnings = [];
  const importedDeviceKeys = new Set();

  records.deviceRecords.forEach((record) => {
    if (record.error) return;
    if (typeof record.locationPath !== 'string' || record.locationPath.trim() === '') {
      errors.push({ index: record.index, field: 'location', message: 'Localidade é obrigatória.' });
    }
    if (typeof record.username !== 'string' || record.username.trim() === '') {
      errors.push({ index: record.index, field: 'username', message: 'Username é obrigatório.' });
    }
    const key = `${record.device.hostname.toLowerCase()}\u0000${record.device.normalizedAddress}`;
    if (
      importedDeviceKeys.has(key) ||
      existingDevices.some(
        (device) =>
          device.hostname.toLowerCase() === record.device.hostname.toLowerCase() &&
          device.address.toLowerCase() === record.device.address.toLowerCase(),
      )
    ) {
      warnings.push({ index: record.index, code: 'duplicate_device', message: 'Dispositivo já cadastrado.' });
    }
    importedDeviceKeys.add(key);
  });

  const requestedLocations = [
    ...records.locationPaths,
    ...records.deviceRecords.map((record) => record.locationPath),
  ];
  const requestedUsernames = [
    ...records.usernameNames,
    ...records.deviceRecords.map((record) => record.username),
  ];
  return {
    errors,
    missingLocations: [
      ...new Set(
        requestedLocations
          .map((value) => value?.trim())
          .filter((value) => value && !locationPaths.has(value.toLowerCase())),
      ),
    ],
    missingUsernames: [
      ...new Set(
        requestedUsernames
          .map((value) => value?.trim())
          .filter((value) => value && !usernames.has(value.toLowerCase())),
      ),
    ],
    warnings,
  };
}

function ensureLocationPath(inventory, locationPath) {
  const parts = locationPath.split('›').map((part) => part.trim()).filter(Boolean);
  let parentId = null;
  let currentPath = '';
  for (const part of parts) {
    currentPath = currentPath === '' ? part : `${currentPath} › ${part}`;
    let location = inventory
      .listLocations()
      .find((item) => item.path.toLowerCase() === currentPath.toLowerCase());
    if (location === undefined) {
      location = inventory.createLocation({ name: part, parentId, type: 'other' });
    }
    parentId = location.id;
  }
  return parentId;
}

function ensureUsername(inventory, usernameName) {
  return (
    inventory
      .listUsernames()
      .find((item) => item.username.toLowerCase() === usernameName.toLowerCase()) ??
    inventory.createUsername({ username: usernameName })
  );
}

export function previewImport(inventory, { content, format }) {
  const records = parseRecords(format, content);
  const validation = validateReferences(records, inventory);
  return {
    ...validation,
    deviceTotal: records.deviceRecords.length,
    locationTotal: records.locationPaths.length,
    total: records.deviceRecords.length + records.locationPaths.length + records.usernameNames.length,
    usernameTotal: records.usernameNames.length,
  };
}

export function applyImport(
  inventory,
  { content, createMissingLocations = false, createMissingUsernames = false, format, skipDuplicates = true },
) {
  const records = parseRecords(format, content);
  const preview = validateReferences(records, inventory);
  if (preview.errors.length > 0) {
    throw new ApplicationError('Import contains invalid records', {
      code: 'validation_error',
      details: preview.errors,
      statusCode: 422,
    });
  }
  if (preview.missingLocations.length > 0 && !createMissingLocations) {
    throw new ApplicationError('Import contains unknown locations', {
      code: 'validation_error',
      details: preview.missingLocations,
      statusCode: 422,
    });
  }
  if (preview.missingUsernames.length > 0 && !createMissingUsernames) {
    throw new ApplicationError('Import contains unknown usernames', {
      code: 'validation_error',
      details: preview.missingUsernames,
      statusCode: 422,
    });
  }

  return runInTransaction(inventory.database, () => {
    let created = 0;
    let skipped = 0;
    for (const locationPath of records.locationPaths) ensureLocationPath(inventory, locationPath);
    for (const usernameName of records.usernameNames) ensureUsername(inventory, usernameName);
    for (const record of records.deviceRecords) {
      if (
        skipDuplicates &&
        preview.warnings.some(
          (warning) => warning.index === record.index && warning.code === 'duplicate_device',
        )
      ) {
        skipped += 1;
        continue;
      }
      const locationId = ensureLocationPath(inventory, record.locationPath);
      const username = ensureUsername(inventory, record.username);
      inventory.createDevice({ ...record.device, locationId, usernameId: username.id });
      created += 1;
    }
    return { created, skipped, total: records.deviceRecords.length };
  });
}

export function exportInventoryCsv(inventory) {
  const rows = inventory.listDevices({ limit: 20_000 }).map((device) => ({
    address: device.address,
    device_type: device.deviceType,
    favorite: device.favorite ? 'sim' : 'não',
    hostname: device.hostname,
    https_url: device.httpsUrl ?? '',
    location: device.locationPath,
    platform: device.platform ?? '',
    ssh_port: device.sshEnabled ? device.sshPort : '',
    tags: device.tags.join('|'),
    username: device.username,
    vendor: device.vendor,
  }));
  return writeCsv(CSV_HEADERS, rows);
}
