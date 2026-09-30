import { ApplicationError } from '../errors.mjs';

const modern = Object.freeze({
  cipher: Object.freeze([
    'chacha20-poly1305@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-ctr',
    'aes192-ctr',
    'aes128-ctr',
  ]),
  hmac: Object.freeze([
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512',
    'hmac-sha2-256',
  ]),
  kex: Object.freeze([
    'curve25519-sha256',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256',
  ]),
  serverHostKey: Object.freeze([
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
  ]),
});

const legacyOnly = Object.freeze({
  cipher: Object.freeze(['aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc']),
  hmac: Object.freeze(['hmac-sha1']),
  kex: Object.freeze([
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ]),
  serverHostKey: Object.freeze(['ssh-rsa', 'ssh-dss']),
});

export const ALGORITHM_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.keys(modern).map((category) => [
      category,
      Object.freeze([...modern[category], ...legacyOnly[category]]),
    ]),
  ),
);

export const MODERN_ALGORITHMS = modern;
export const LEGACY_ALGORITHMS = Object.freeze(
  Object.fromEntries(
    Object.keys(modern).map((category) => [
      category,
      Object.freeze([...modern[category], ...legacyOnly[category]]),
    ]),
  ),
);

function algorithmError(category, message) {
  return new ApplicationError('Validation failed', {
    code: 'validation_error',
    details: { field: `customAlgorithms.${category}`, message },
    statusCode: 422,
  });
}

export function normalizeCustomAlgorithms(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw algorithmError('profile', 'must be an object');
  }
  return Object.fromEntries(
    Object.entries(ALGORITHM_CATALOG).map(([category, allowed]) => {
      const selection = value[category];
      if (!Array.isArray(selection) || selection.length === 0) {
        throw algorithmError(category, 'must contain at least one algorithm');
      }
      const unique = [...new Set(selection)];
      if (unique.some((algorithm) => !allowed.includes(algorithm))) {
        throw algorithmError(category, 'contains an unsupported or prohibited algorithm');
      }
      return [category, unique];
    }),
  );
}

export function resolveAlgorithmProfile(profile, customAlgorithms) {
  if (profile === 'modern') return MODERN_ALGORITHMS;
  if (profile === 'legacy') return LEGACY_ALGORITHMS;
  const normalized = normalizeCustomAlgorithms(customAlgorithms);
  if (normalized === null) {
    throw algorithmError('profile', 'is required when the custom profile is selected');
  }
  return normalized;
}
