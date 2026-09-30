import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function runInTransaction(database, operation) {
  if (database.isTransaction) {
    const savepoint = `netrunner_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = database.prepare('SELECT id FROM schema_migrations').all();
  const appliedIds = new Set(applied.map((migration) => migration.id));
  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    runInTransaction(database, () => {
      database.exec(migration.sql);
      insertMigration.run(migration.id, migration.name, nowIso());
    });
  }
}

export async function openDatabase(databasePath) {
  await mkdir(path.dirname(databasePath), { mode: 0o700, recursive: true });
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
  `);

  migrate(database);
  await chmod(databasePath, 0o600);

  const integrity = database.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') {
    database.close();
    throw new Error('Database integrity check failed');
  }

  return database;
}
