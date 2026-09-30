import { readFile } from 'node:fs/promises';
import path from 'node:path';

const STATIC_FILES = Object.freeze({
  '/': Object.freeze({ contentType: 'text/html; charset=utf-8', fileName: 'index.html', root: 'web' }),
  '/app.js': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: 'app.js', root: 'web' }),
  '/favicon.png': Object.freeze({ contentType: 'image/png', fileName: 'icon.png', root: 'image' }),
  '/logo.png': Object.freeze({ contentType: 'image/png', fileName: 'logo.png', root: 'image' }),
  '/navigation.js': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: 'navigation.js', root: 'web' }),
  '/styles.css': Object.freeze({ contentType: 'text/css; charset=utf-8', fileName: 'styles.css', root: 'web' }),
  '/terminal-input.js': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: 'terminal-input.js', root: 'web' }),
  '/terminal-styles.js': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: 'terminal-styles.js', root: 'web' }),
  '/vendor/xterm/addon-fit.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/addon-fit/lib/addon-fit.mjs', root: 'vendor' }),
  '/vendor/xterm/addon-search.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/addon-search/lib/addon-search.mjs', root: 'vendor' }),
  '/vendor/xterm/addon-unicode11.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/addon-unicode11/lib/addon-unicode11.mjs', root: 'vendor' }),
  '/vendor/xterm/addon-web-links.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/addon-web-links/lib/addon-web-links.mjs', root: 'vendor' }),
  '/vendor/xterm/addon-webgl.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/addon-webgl/lib/addon-webgl.mjs', root: 'vendor' }),
  '/vendor/xterm/xterm.css': Object.freeze({ contentType: 'text/css; charset=utf-8', fileName: '@xterm/xterm/css/xterm.css', root: 'vendor' }),
  '/vendor/xterm/xterm.mjs': Object.freeze({ contentType: 'text/javascript; charset=utf-8', fileName: '@xterm/xterm/lib/xterm.mjs', root: 'vendor' }),
});

export async function readStaticFile(webRoot, requestPath, vendorRoot, imageRoot) {
  const descriptor = STATIC_FILES[requestPath];
  if (descriptor === undefined) {
    return undefined;
  }

  const root = descriptor.root === 'vendor' ? vendorRoot : descriptor.root === 'image' ? imageRoot : webRoot;
  if (root === undefined) return undefined;
  const body = await readFile(path.join(root, descriptor.fileName));
  return Object.freeze({ body, contentType: descriptor.contentType });
}
