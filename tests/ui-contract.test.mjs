import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, script, styles] = await Promise.all([
  readFile(new URL('../src/web/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/web/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8'),
]);

test('keeps the primary UI keyboard-accessible and locally rendered', () => {
  assert.match(html, /lang="pt-BR"/u);
  assert.match(html, /role="combobox"/u);
  assert.match(html, /aria-controls="command-results"/u);
  assert.match(html, /data-view="settings"/u);
  assert.match(html, /data-view="trust"/u);
  assert.match(html, /data-view="health"/u);
  assert.match(html, /data-view="snapshots"/u);
  assert.match(html, /data-view="runbooks"/u);
  assert.match(html, /data-action="open-sessions"/u);
  assert.match(html, /data-navigation-group="registration"/u);
  assert.match(html, /id="session-tools"/u);
  assert.match(html, /Localidades[\s\S]*Username[\s\S]*Dispositivos/u);
  assert.match(html, /rel="icon" type="image\/png" href="\/favicon\.png"/u);
  assert.match(html, /<img class="brand-mark" src="\/favicon\.png" alt="" aria-hidden="true" \/>/u);
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>NR</u);
  assert.match(script, /aria-activedescendant/u);
  assert.match(script, /\/api\/browser\/lifecycle/u);
  assert.match(script, /pagehide/u);
  assert.match(script, /\/api\/device-health\/check/u);
  assert.match(script, /Verificação sob demanda/u);
  assert.match(script, /\/api\/configuration-snapshots\/compare/u);
  assert.match(script, /data-action="start-runbook"/u);
  assert.match(script, /data-action="start-snapshot"/u);
  assert.match(script, /data-action="select-runbook-profile"/u);
  assert.match(script, /Snapshot descartado: a captura ultrapassou 2 MiB/u);
  assert.match(script, /\/api\/runbooks\/catalog/u);
  assert.match(script, /Finalizar e salvar snapshot/u);
  assert.match(script, /Snapshot · \$\{new Date\(\)\.toLocaleString\('pt-BR'\)\}/u);
  assert.doesNotMatch(script, /openSnapshotDialog|openRunbookResultDialog|runbookCapture/u);
  assert.match(script, /session\.state !== 'connected' \|\| session\.snapshotCapture !== undefined/u);
  assert.doesNotMatch(script, /data-action="new-snapshot"|snapshot-terminal-selection/u);
  assert.match(script, /sessionNavigationTarget/u);
  assert.match(script, /event\.key === 'ArrowDown'/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(styles, /url\('\/logo\.png'\)/u);
  assert.match(styles, /opacity: 0\.5/u);
  assert.match(styles, /\.view-tabs\s*\{[^}]*z-index:\s*20/su);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//iu);
});

test('does not use browser persistence for settings or credentials', () => {
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/u);
  assert.doesNotMatch(script, /Colar .* linhas no equipamento/u);
  assert.match(script, /autocomplete="new-password"/u);
});

test('keeps the light application chrome professional while the terminal stays dark', () => {
  assert.match(styles, /:root\[data-theme='light'\]\s*\{[^}]*--graphite:\s*#f4f5f7/su);
  assert.match(styles, /:root\[data-theme='light'\] \.workspace::before\s*\{[^}]*display:\s*none/su);
  assert.match(styles, /\.brand-mark\s*\{[^}]*object-fit:\s*contain/su);
  assert.match(styles, /:root\[data-theme='light'\] \.primary-button\s*\{[^}]*background:\s*#456f9c/su);
  assert.match(script, /state\.settings\.theme === 'light'[\s\S]*background: '#050607'/u);
  assert.match(styles, /\.sidebar\s*\{[^}]*background:\s*#151a20/su);
});
