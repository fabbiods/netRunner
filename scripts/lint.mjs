import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceRoots = ['scripts', 'src', 'tests'];
const checkedExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs']);
const scriptExtensions = new Set(['.js', '.mjs']);
const failures = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    }),
  );
  return nestedFiles.flat();
}

for (const root of sourceRoots) {
  const files = await collectFiles(root);
  for (const file of files) {
    const extension = path.extname(file);
    if (!checkedExtensions.has(extension)) {
      continue;
    }

    const contents = await readFile(file, 'utf8');
    if (/\r/.test(contents)) {
      failures.push(`${file}: use LF line endings`);
    }
    if (/[^\S\r\n]+$/m.test(contents)) {
      failures.push(`${file}: contains trailing whitespace`);
    }
    if (!contents.endsWith('\n')) {
      failures.push(`${file}: must end with a newline`);
    }

    if (scriptExtensions.has(extension)) {
      const syntaxCheck = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (syntaxCheck.status !== 0) {
        failures.push(`${file}: ${syntaxCheck.stderr.trim()}`);
      }
    }
  }
}

const indexHtml = await readFile('src/web/index.html', 'utf8');
if (/(?:src|href)=["']https?:\/\//i.test(indexHtml)) {
  failures.push('src/web/index.html: remote assets are forbidden');
}

JSON.parse(await readFile('package.json', 'utf8'));

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Source checks passed.\n');
}
