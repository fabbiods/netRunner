import { chmod, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function resolveAppDataDirectory({
  homeDirectory = os.homedir(),
  platform = process.platform,
  xdgDataHome = process.env.XDG_DATA_HOME,
} = {}) {
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'NetRunner');
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData === undefined || localAppData.length === 0) {
      throw new Error('LOCALAPPDATA is required on Windows');
    }
    return path.join(localAppData, 'NetRunner');
  }

  return path.join(xdgDataHome ?? path.join(homeDirectory, '.local', 'share'), 'netrunner');
}

export async function ensurePrivateDirectory(directoryPath) {
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  await chmod(directoryPath, 0o700);
}

export function resolveLogsDirectory({ homeDirectory = os.homedir() } = {}) {
  return path.join(homeDirectory, 'NetRunner', 'Logs');
}

export function isCloudSyncedPath(candidatePath, { homeDirectory = os.homedir() } = {}) {
  const resolved = path.resolve(candidatePath);
  const cloudRoots = [
    path.join(homeDirectory, 'Desktop'),
    path.join(homeDirectory, 'Documents'),
    path.join(homeDirectory, 'Library', 'CloudStorage'),
    path.join(homeDirectory, 'Library', 'Mobile Documents'),
  ];
  return cloudRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}
