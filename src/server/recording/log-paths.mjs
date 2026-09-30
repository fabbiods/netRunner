import { chmod, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_COMPONENT_LENGTH = 80;

export function sanitizePathComponent(value, fallback = '_') {
  const sanitized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\:]/gu, '_')
    .replace(/\.\.+/gu, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[ .]+|[ .]+$/gu, '')
    .slice(0, MAX_COMPONENT_LENGTH);
  return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..' ? sanitized : fallback;
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[:.]/gu, '-');
}

export async function createPrivateLogPath(logsRoot, metadata, startDate = new Date()) {
  const locationParts = String(metadata.locationPath ?? 'Sem localidade')
    .split(/\s*›\s*/u)
    .filter(Boolean)
    .map((part) => sanitizePathComponent(part, 'Sem localidade'));
  const hostname = sanitizePathComponent(metadata.hostname, 'host');
  const address = sanitizePathComponent(metadata.address, 'endereco');
  const ticket = metadata.ticket ? `_${sanitizePathComponent(metadata.ticket, 'ticket')}` : '';
  let directory = logsRoot;
  for (const component of [...locationParts, hostname]) {
    directory = path.join(directory, component);
    await mkdir(directory, { mode: 0o700, recursive: true });
    await chmod(directory, 0o700);
  }

  let candidate = path.join(
    directory,
    `${timestampForFilename(startDate)}_${hostname}_${address}${ticket}.txt`,
  );
  let suffix = 1;
  while (await fileExists(candidate)) {
    candidate = path.join(
      directory,
      `${timestampForFilename(startDate)}_${hostname}_${address}${ticket}_${suffix}.txt`,
    );
    suffix += 1;
  }
  await chmod(logsRoot, 0o700);
  return candidate;
}

async function fileExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function isPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}
