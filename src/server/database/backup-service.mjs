import { copyFile, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ApplicationError, NotFoundError } from '../errors.mjs';

const BACKUP_PATTERN = /^netrunner-(?:\d{4}-\d{2}-\d{2}|manual-[\dTZ-]+|pre-restore-[\dTZ-]+)\.sqlite$/u;

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function validateBackupFile(backupPath) {
  let database;
  try {
    database = new DatabaseSync(backupPath, { allowExtension: false, readOnly: true });
    const integrity = database.prepare('PRAGMA integrity_check').get();
    const migrations = database
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (integrity.integrity_check !== 'ok' || migrations.count !== 1) {
      throw new Error('invalid backup');
    }
  } catch {
    throw new ApplicationError('O arquivo selecionado não é um backup íntegro do NetRunner.', {
      code: 'invalid_backup',
      statusCode: 422,
    });
  } finally {
    database?.close();
  }
}

async function readPending(markerPath) {
  try {
    return JSON.parse(await readFile(markerPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function applyPendingRestore(appDataDirectory, databasePath) {
  const markerPath = path.join(appDataDirectory, 'restore-pending.json');
  const pending = await readPending(markerPath);
  if (pending === null) return { restored: false };
  if (typeof pending.name !== 'string' || !BACKUP_PATTERN.test(pending.name)) {
    throw new ApplicationError('A solicitação de restauração é inválida.', {
      code: 'invalid_restore_request',
      statusCode: 422,
    });
  }
  const backupDirectory = path.join(appDataDirectory, 'Backups');
  const backupPath = path.join(backupDirectory, pending.name);
  validateBackupFile(backupPath);
  try {
    await stat(databasePath);
    const emergencyPath = path.join(
      backupDirectory,
      `netrunner-pre-restore-${safeTimestamp()}.sqlite`,
    );
    let currentDatabase;
    try {
      currentDatabase = new DatabaseSync(databasePath, { allowExtension: false });
      const integrity = currentDatabase.prepare('PRAGMA integrity_check').get();
      if (integrity.integrity_check !== 'ok') throw new Error('invalid current database');
      await writeFile(emergencyPath, currentDatabase.serialize(), { flag: 'wx', mode: 0o600 });
    } finally {
      currentDatabase?.close();
    }
    await chmod(emergencyPath, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await copyFile(backupPath, databasePath);
  await chmod(databasePath, 0o600);
  await rm(markerPath, { force: true });
  return { restored: true, source: pending.name };
}

export class BackupService {
  constructor({ appDataDirectory, database }) {
    this.appDataDirectory = appDataDirectory;
    this.backupDirectory = path.join(appDataDirectory, 'Backups');
    this.database = database;
    this.markerPath = path.join(appDataDirectory, 'restore-pending.json');
  }

  async list() {
    await mkdir(this.backupDirectory, { mode: 0o700, recursive: true });
    const pending = await readPending(this.markerPath);
    const entries = await readdir(this.backupDirectory, { withFileTypes: true });
    const backups = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && BACKUP_PATTERN.test(entry.name))
        .map(async (entry) => {
          const details = await stat(path.join(this.backupDirectory, entry.name));
          return {
            createdAt: details.mtime.toISOString(),
            name: entry.name,
            pendingRestore: pending?.name === entry.name,
            size: details.size,
          };
        }),
    );
    return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createManual() {
    await mkdir(this.backupDirectory, { mode: 0o700, recursive: true });
    await chmod(this.backupDirectory, 0o700);
    const name = `netrunner-manual-${safeTimestamp()}.sqlite`;
    const backupPath = path.join(this.backupDirectory, name);
    await writeFile(backupPath, this.database.serialize(), { flag: 'wx', mode: 0o600 });
    await chmod(backupPath, 0o600);
    return { name };
  }

  async queueRestore(name) {
    if (typeof name !== 'string' || !BACKUP_PATTERN.test(name)) {
      throw new NotFoundError('Backup');
    }
    const backupPath = path.join(this.backupDirectory, name);
    try {
      await stat(backupPath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new NotFoundError('Backup');
      throw error;
    }
    validateBackupFile(backupPath);
    await writeFile(this.markerPath, JSON.stringify({ name }), { mode: 0o600 });
    await chmod(this.markerPath, 0o600);
    return { name, restartRequired: true };
  }
}
