import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import {
  ALGORITHM_PROFILES,
  BACKSPACE_MODES,
  DEVICE_TYPES,
  ENCODINGS,
  LOCATION_TYPES,
  LOGIN_MODES,
  TERMINAL_TYPES,
  SESSION_SCOPED_COMMANDS,
  VENDORS,
} from '../shared/inventory-values.mjs';
import { ApplicationError } from './errors.mjs';
import { normalizeCustomAlgorithms } from './ssh/algorithm-profiles.mjs';

function validationError(field, message) {
  return new ApplicationError('Validation failed', {
    code: 'validation_error',
    details: { field, message },
    statusCode: 422,
  });
}

function requiredString(value, field, maximumLength) {
  if (typeof value !== 'string') {
    throw validationError(field, 'must be a string');
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw validationError(field, `must contain between 1 and ${maximumLength} valid characters`);
  }
  return normalized;
}

function optionalString(value, field, maximumLength) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredString(value, field, maximumLength);
}

function enumValue(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw validationError(field, `must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function booleanValue(value, field, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw validationError(field, 'must be a boolean');
  }
  return value;
}

function integerValue(value, field, fallback, minimum, maximum) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw validationError(field, `must be an integer between ${minimum} and ${maximum}`);
  }
  return candidate;
}

function nullableId(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredString(value, field, 64);
}

export function normalizeNetworkAddress(value) {
  const address = requiredString(value, 'address', 253);
  if (isIP(address) !== 0) {
    return { address, normalizedAddress: address.toLowerCase() };
  }

  const withoutTrailingDot = address.endsWith('.') ? address.slice(0, -1) : address;
  const ascii = domainToASCII(withoutTrailingDot).toLowerCase();
  const labels = ascii.split('.');
  const valid =
    ascii.length > 0 &&
    ascii.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

  if (!valid) {
    throw validationError('address', 'must be a valid IPv4, IPv6 or FQDN');
  }
  return { address, normalizedAddress: ascii };
}

function parseHttpsUrl(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw validationError('httpsUrl', 'must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw validationError('httpsUrl', 'must use HTTPS and must not include credentials');
  }
  return parsed.toString();
}

function parseTags(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 50) {
    throw validationError('tags', 'must be an array with at most 50 entries');
  }
  const byNormalizedName = new Map();
  for (const tag of value) {
    const name = requiredString(tag, 'tags', 60);
    byNormalizedName.set(name.toLocaleLowerCase('pt-BR'), name);
  }
  return [...byNormalizedName.values()];
}

export function parseLocationInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('location', 'must be an object');
  }
  return {
    address: optionalString(input.address, 'address', 500),
    code: optionalString(input.code, 'code', 40),
    name: requiredString(input.name, 'name', 120),
    notes: optionalString(input.notes, 'notes', 4000),
    parentId: nullableId(input.parentId, 'parentId'),
    position: integerValue(input.position, 'position', 0, 0, 1_000_000),
    type: enumValue(input.type, 'type', LOCATION_TYPES),
  };
}

export function parseUsernameInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('username', 'must be an object');
  }
  return {
    description: optionalString(input.description, 'description', 500),
    isDefault: booleanValue(input.isDefault, 'isDefault', false),
    username: requiredString(input.username, 'username', 128),
  };
}

export function parseDeviceInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('device', 'must be an object');
  }
  const { address, normalizedAddress } = normalizeNetworkAddress(input.address);
  const sshEnabled = booleanValue(input.sshEnabled, 'sshEnabled', true);
  const httpsEnabled = booleanValue(input.httpsEnabled, 'httpsEnabled', false);
  const algorithmProfile = enumValue(
    input.algorithmProfile ?? 'modern',
    'algorithmProfile',
    ALGORITHM_PROFILES,
  );
  const customAlgorithms = normalizeCustomAlgorithms(input.customAlgorithms);
  const postLoginCommand = optionalString(input.postLoginCommand, 'postLoginCommand', 120);
  const postLoginEnabled = booleanValue(input.postLoginEnabled, 'postLoginEnabled', false);
  if (algorithmProfile === 'custom' && customAlgorithms === null) {
    throw validationError('customAlgorithms', 'is required for the custom profile');
  }
  if (postLoginCommand !== null && !SESSION_SCOPED_COMMANDS.includes(postLoginCommand)) {
    throw validationError('postLoginCommand', 'must be an approved session-scoped command');
  }
  if (postLoginEnabled && postLoginCommand === null) {
    throw validationError('postLoginCommand', 'is required when post-login execution is enabled');
  }
  if (!sshEnabled && !httpsEnabled) {
    throw validationError('protocols', 'at least SSH or HTTPS must be enabled');
  }

  return {
    address,
    algorithmProfile,
    backspaceMode: enumValue(input.backspaceMode ?? 'del', 'backspaceMode', BACKSPACE_MODES),
    connectTimeout: integerValue(input.connectTimeout, 'connectTimeout', 20, 1, 300),
    customAlgorithms,
    deviceType: enumValue(input.deviceType, 'deviceType', DEVICE_TYPES),
    encoding: enumValue(input.encoding ?? 'utf-8', 'encoding', ENCODINGS),
    favorite: booleanValue(input.favorite, 'favorite', false),
    hostname: requiredString(input.hostname, 'hostname', 255),
    httpsEnabled,
    httpsPort: integerValue(input.httpsPort, 'httpsPort', 443, 1, 65535),
    httpsUrl: parseHttpsUrl(input.httpsUrl),
    keepaliveInterval: integerValue(input.keepaliveInterval, 'keepaliveInterval', 0, 0, 3600),
    keepaliveLimit: integerValue(input.keepaliveLimit, 'keepaliveLimit', 3, 1, 100),
    locationId: requiredString(input.locationId, 'locationId', 64),
    loginMode: enumValue(input.loginMode ?? 'standard', 'loginMode', LOGIN_MODES),
    normalizedAddress,
    notes: optionalString(input.notes, 'notes', 4000),
    platform: optionalString(input.platform, 'platform', 120),
    postLoginCommand,
    postLoginEnabled,
    sshEnabled,
    sshPort: integerValue(input.sshPort, 'sshPort', 22, 1, 65535),
    tags: parseTags(input.tags),
    terminalType: enumValue(input.terminalType ?? 'xterm-256color', 'terminalType', TERMINAL_TYPES),
    usernameId: requiredString(input.usernameId, 'usernameId', 64),
    vendor: enumValue(input.vendor, 'vendor', VENDORS),
  };
}
