import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve('out/netrunner');
const launcherPath = path.join(outputRoot, 'start.command');
const runtimePackages = [
  '@xterm/addon-fit',
  '@xterm/addon-search',
  '@xterm/addon-unicode11',
  '@xterm/addon-web-links',
  '@xterm/addon-webgl',
  '@xterm/headless',
  '@xterm/xterm',
  'asn1',
  'bcrypt-pbkdf',
  'safer-buffer',
  'ssh2',
  'tweetnacl',
];

await rm(outputRoot, { force: true, recursive: true });
await mkdir(path.join(outputRoot, 'src'), { recursive: true });
await mkdir(path.join(outputRoot, 'node_modules', '@xterm'), { recursive: true });
await Promise.all([
  cp('src/server', path.join(outputRoot, 'src/server'), { recursive: true }),
  cp('src/shared', path.join(outputRoot, 'src/shared'), { recursive: true }),
  cp('src/web', path.join(outputRoot, 'src/web'), { recursive: true }),
  cp('img', path.join(outputRoot, 'img'), { recursive: true }),
  cp('README.md', path.join(outputRoot, 'README.md')),
  cp('package.json', path.join(outputRoot, 'package.json')),
  cp('package-lock.json', path.join(outputRoot, 'package-lock.json')),
  ...runtimePackages.map((packageName) =>
    cp(
      path.join('node_modules', packageName),
      path.join(outputRoot, 'node_modules', packageName),
      { recursive: true },
    ),
  ),
]);

await writeFile(
  launcherPath,
  '#!/bin/sh\ncd "$(dirname "$0")"\nexec node src/server/main.mjs\n',
  { mode: 0o700 },
);
await chmod(launcherPath, 0o700);

process.stdout.write(`Pacote local criado em ${outputRoot}\n`);
