import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function dateToken(date) {
  return date.toISOString().slice(0, 10);
}

export async function createDailyBackup(database, backupDirectory, { date = new Date(), retain = 14 } = {}) {
  await mkdir(backupDirectory, { mode: 0o700, recursive: true });
  await chmod(backupDirectory, 0o700);

  const backupPath = path.join(backupDirectory, `netrunner-${dateToken(date)}.sqlite`);
  let created = false;

  try {
    await writeFile(backupPath, database.serialize(), { flag: 'wx', mode: 0o600 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  const backupFiles = (await readdir(backupDirectory))
    .filter((name) => /^netrunner-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort()
    .reverse();

  for (const expiredBackup of backupFiles.slice(retain)) {
    await rm(path.join(backupDirectory, expiredBackup), { force: true });
  }

  return Object.freeze({ backupPath, created });
}
