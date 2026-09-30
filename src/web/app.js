import { FitAddon } from '/vendor/xterm/addon-fit.mjs';
import { SearchAddon } from '/vendor/xterm/addon-search.mjs';
import { Unicode11Addon } from '/vendor/xterm/addon-unicode11.mjs';
import { WebLinksAddon } from '/vendor/xterm/addon-web-links.mjs';
import { WebglAddon } from '/vendor/xterm/addon-webgl.mjs';
import { Terminal } from '/vendor/xterm/xterm.mjs';
import { navigationGroupForView, sessionNavigationTarget } from '/navigation.js';
import { splitMultilineInput } from '/terminal-input.js';
import { terminalStylesForText } from '/terminal-styles.js';

const elements = {
  bulkToolbar: document.querySelector('#bulk-toolbar'),
  commandDialog: document.querySelector('#command-dialog'),
  commandResults: document.querySelector('#command-results'),
  commandSearch: document.querySelector('#command-search'),
  content: document.querySelector('#content'),
  dialog: document.querySelector('#editor-dialog'),
  dialogContent: document.querySelector('#dialog-content'),
  dialogEyebrow: document.querySelector('#dialog-eyebrow'),
  dialogForm: document.querySelector('#editor-form'),
  dialogSubmit: document.querySelector('#dialog-submit'),
  dialogTitle: document.querySelector('#dialog-title'),
  locationTree: document.querySelector('#location-tree'),
  search: document.querySelector('#global-search'),
  sessionCount: document.querySelector('#session-count'),
  sessionsNavigation: document.querySelector('#sessions-navigation'),
  sessionTabs: document.querySelector('#session-tabs'),
  sessionTools: document.querySelector('#session-tools'),
  status: document.querySelector('#runtime-status'),
  statusText: document.querySelector('#runtime-status-text'),
  summary: document.querySelector('#summary'),
  terminalPanels: document.querySelector('#terminal-panels'),
  terminalStatus: document.querySelector('#terminal-status'),
  terminalWorkspace: document.querySelector('#terminal-workspace'),
  toastRegion: document.querySelector('#toast-region'),
  viewTitle: document.querySelector('#view-title'),
};

const labels = {
  algorithmProfiles: { custom: 'Personalizado', legacy: 'Legado', modern: 'Moderno' },
  deviceTypes: {
    'access-point': 'Access Point',
    'wlan-controller': 'Controladora WLAN',
    firewall: 'Firewall',
    other: 'Outro',
    router: 'Roteador',
    switch: 'Switch',
  },
  locationTypes: {
    building: 'Prédio',
    city: 'Cidade',
    country: 'País',
    floor: 'Andar',
    other: 'Outro',
    rack: 'Rack',
    region: 'Estado / Região',
    site: 'Site',
  },
  vendors: {
    aruba: 'Aruba',
    cisco: 'Cisco',
    fortinet: 'Fortinet',
    huawei: 'Huawei',
    juniper: 'Juniper',
    'juniper-mist': 'Juniper Mist',
    other: 'Outro',
    ruckus: 'Ruckus',
  },
};

const algorithmCatalog = {
  cipher: [
    'chacha20-poly1305@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-ctr',
    'aes192-ctr',
    'aes128-ctr',
    'aes256-cbc',
    'aes192-cbc',
    'aes128-cbc',
    '3des-cbc',
  ],
  hmac: [
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512',
    'hmac-sha2-256',
    'hmac-sha1',
  ],
  kex: [
    'curve25519-sha256',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa',
    'ssh-dss',
  ],
};

const modernAlgorithmCounts = { cipher: 6, hmac: 4, kex: 8, serverHostKey: 6 };

const state = {
  bulkField: 'algorithmProfile',
  backups: [],
  certificates: [],
  devices: [],
  filter: 'all',
  health: [],
  healthRunning: false,
  history: [],
  historyFilters: {},
  historySettings: { recordingDefault: true },
  hostKeys: [],
  locationId: undefined,
  locations: [],
  pendingImport: undefined,
  runbookCatalog: [],
  search: '',
  selected: new Set(),
  sessions: new Map(),
  snapshotComparison: undefined,
  snapshotDeviceId: undefined,
  snapshots: [],
  summary: { devices: 0, favorites: 0, legacy: 0, locations: 0, usernames: 0 },
  usernames: [],
  settings: {
    copyOnSelect: false,
    highlightKeywords: [],
    idleDisconnectMinutes: 0,
    pasteDelayMs: 25,
    recordingDefault: true,
    rightClickPaste: false,
    terminalFontSize: 13,
    terminalScrollback: 20_000,
    theme: 'dark',
  },
  view: 'devices',
  activeSessionId: undefined,
};

let sessionToken;
let searchTimer;
let browserLifecycleController;
let pageClosing = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function consumeSessionToken() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token');
  window.history.replaceState(null, '', '/');
  return token;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function maintainBrowserLifecycle() {
  while (!pageClosing) {
    browserLifecycleController = new AbortController();
    try {
      const response = await fetch('/api/browser/lifecycle', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${sessionToken}` },
        signal: browserLifecycleController.signal,
      });
      if (!response.ok || response.body === null) return;
      const reader = response.body.getReader();
      while (!pageClosing) {
        const result = await reader.read();
        if (result.done) break;
      }
    } catch (error) {
      if (pageClosing || error.name === 'AbortError') return;
    }
    if (!pageClosing) await delay(250);
  }
}

async function api(path, options = {}) {
  const headers = { Authorization: `Bearer ${sessionToken}`, ...options.headers };
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, body, cache: 'no-store', headers });
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = {};
    }
    const error = new Error(errorBody.message ?? `A operação falhou (${response.status}).`);
    error.code = errorBody.error;
    error.details = errorBody.details;
    throw error;
  }
  if (response.status === 204) {
    return undefined;
  }
  return response.json();
}

async function downloadExport(format) {
  const response = await fetch(`/api/export/${format}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) {
    throw new Error('Não foi possível exportar o inventário.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `netrunner-inventory.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename, content, contentType) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toast(message, kind = 'success') {
  const notification = document.createElement('div');
  notification.className = `toast${kind === 'error' ? ' toast--error' : ''}`;
  notification.textContent = message;
  elements.toastRegion.append(notification);
  window.setTimeout(() => notification.remove(), 4200);
}

function setRuntimeStatus(status, text) {
  elements.status.className = `runtime-status runtime-status--${status}`;
  elements.statusText.textContent = text;
}

function terminalTheme() {
  if (state.settings.theme === 'light') {
    return {
      background: '#050607',
      cursor: '#f4f6f8',
      foreground: '#d8dce2',
      selectionBackground: '#355b85',
    };
  }
  if (state.settings.theme === 'high-contrast') {
    return {
      background: '#000000',
      cursor: '#ffff00',
      foreground: '#ffffff',
      selectionBackground: '#005f73',
    };
  }
  return {
    background: '#0b0e12',
    cursor: '#f5c542',
    foreground: '#e4e8ee',
    selectionBackground: '#2e6d73',
  };
}

function applySettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.lang = state.settings.locale ?? 'pt-BR';
  for (const session of state.sessions.values()) {
    session.terminal.options.fontSize = state.settings.terminalFontSize;
    session.terminal.options.scrollback = state.settings.terminalScrollback;
    session.terminal.options.theme = terminalTheme();
    window.requestAnimationFrame(() => session.fitAddon.fit());
  }
}

function activeSession() {
  return state.activeSessionId === undefined ? undefined : state.sessions.get(state.activeSessionId);
}

function renderSessionTools(session) {
  if (!session) {
    elements.sessionTools.innerHTML = '';
    return;
  }
  if (session.state !== 'connected') {
    elements.sessionTools.innerHTML = `
      <header><span>Automação segura</span><h2>Runbooks</h2></header>
      <p class="session-tools-note">Os comandos estarão disponíveis quando a sessão SSH estiver conectada.</p>`;
    return;
  }
  if (session.runbooksState === 'loading' || session.runbooksState === 'idle') {
    elements.sessionTools.innerHTML = `
      <header><span>Automação segura</span><h2>Runbooks</h2></header>
      <p class="session-tools-note">Carregando comandos compatíveis…</p>`;
    return;
  }
  if (session.runbooksState === 'error') {
    elements.sessionTools.innerHTML = `
      <header><span>Automação segura</span><h2>Runbooks</h2></header>
      <p class="session-tools-note">Não foi possível carregar os runbooks desta sessão.</p>
      <button type="button" class="secondary-button full-button" data-action="reload-session-runbooks" data-session-id="${escapeHtml(session.id)}">Tentar novamente</button>`;
    return;
  }
  if (!session.runbookProfile) {
    const profiles = state.runbookCatalog
      .filter((family) => family.management === 'ssh')
      .map(
        (family) => `<button type="button" class="session-profile-choice" data-action="select-runbook-profile" data-session-id="${escapeHtml(session.id)}" data-profile-id="${escapeHtml(family.id)}"><strong>${escapeHtml(labels.deviceTypes[family.deviceType] ?? family.deviceType)} ${escapeHtml(family.vendorLabel)}</strong><span>${escapeHtml(family.system)} · ${family.models.map(escapeHtml).join(', ')}</span></button>`,
      )
      .join('');
    elements.sessionTools.innerHTML = `
      <header><span>Perfil não identificado</span><h2>Qual runbook deseja exibir?</h2></header>
      <p class="session-tools-note">Não foi possível determinar uma família compatível pelo cadastro. A escolha vale somente para esta sessão.</p>
      <div class="session-profile-list">${profiles}</div>`;
    return;
  }
  const capture = session.snapshotCapture;
  const snapshotRunbook = session.runbooks.find((runbook) => runbook.kind === 'snapshot');
  const troubleshootingRunbooks = session.runbooks
    .filter((runbook) => runbook.kind === 'diagnostic')
    .map(
      (runbook) => `<button type="button" class="session-runbook" data-action="start-runbook" data-session-id="${escapeHtml(session.id)}" data-runbook-id="${escapeHtml(runbook.id)}" ${capture ? 'disabled' : ''}>
        <strong>${escapeHtml(runbook.name)}</strong>
        <span>${escapeHtml(runbook.description)}</span>
        <code>${runbook.commands.map(escapeHtml).join('<br />')}</code>
      </button>`,
    )
    .join('');
  elements.sessionTools.innerHTML = `
    <header><span>${escapeHtml(labels.deviceTypes[session.runbookProfile.deviceType] ?? session.runbookProfile.deviceType)} ${escapeHtml(session.runbookProfile.vendorLabel)}</span><h2>${escapeHtml(session.runbookProfile.system)}</h2></header>
    ${session.deviceId && snapshotRunbook ? `<section class="session-tool-section"><h3>Snapshot</h3><p class="session-tools-note">Coleta a configuração completa e salva com data e horário.</p>${capture ? `<div class="session-capture"><strong>Coletando configuração</strong><span>Aguarde o prompt retornar para garantir a saída completa.</span><button type="button" class="primary-button full-button" data-action="finish-snapshot-capture" data-session-id="${escapeHtml(session.id)}">Finalizar e salvar snapshot</button></div>` : `<button type="button" class="primary-button full-button" data-action="start-snapshot" data-session-id="${escapeHtml(session.id)}" data-runbook-id="${escapeHtml(snapshotRunbook.id)}">Criar snapshot</button>`}</section>` : ''}
    <section class="session-tool-section"><h3>Runbooks de troubleshooting</h3><p class="session-tools-note">Os comandos são enviados diretamente ao terminal e não criam snapshots.</p><div class="session-runbook-list">${troubleshootingRunbooks || '<p class="session-tools-note">Nenhum comando de troubleshooting disponível.</p>'}</div></section>`;
}

async function loadSessionRunbooks(session) {
  if (!session.deviceId || session.state !== 'connected' || session.runbooksState === 'loading') return;
  session.runbooksState = 'loading';
  renderSessionTools(session);
  try {
    const context = await api(`/api/ssh/sessions/${session.id}/runbooks`);
    session.runbookProfile = context.profile;
    session.runbooks = context.runbooks;
    if (!context.profile && state.runbookCatalog.length === 0) {
      state.runbookCatalog = await api('/api/runbooks/catalog');
    }
    session.runbooksState = 'loaded';
  } catch (error) {
    session.runbooks = [];
    session.runbooksState = 'error';
    toast(error.message, 'error');
  }
  if (session.id === state.activeSessionId) renderSessionTools(session);
}

function renderNavigation() {
  const activeGroup = navigationGroupForView(state.view);
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === state.view);
  });
  document.querySelectorAll('[data-navigation-group]').forEach((menu) => {
    menu.classList.toggle('is-active', menu.dataset.navigationGroup === activeGroup);
  });
  elements.sessionsNavigation.classList.toggle('is-active', ['sessions', 'terminal'].includes(state.view));
  elements.sessionCount.textContent = String(state.sessions.size);
  elements.sessionsNavigation.title = state.sessions.size === 0
    ? 'Nenhuma sessão aberta'
    : `${state.sessions.size} sessão(ões) aberta(s)`;
}

function renderSessionChrome() {
  elements.sessionTabs.innerHTML = [...state.sessions.values()]
    .map(
      (session) => `<button type="button" role="tab" aria-selected="${session.id === state.activeSessionId}" class="session-tab${session.id === state.activeSessionId ? ' is-active' : ''}" data-action="activate-session" data-session-id="${escapeHtml(session.id)}"><span class="session-tab-state ${session.state === 'connected' ? 'is-connected' : session.state === 'disconnected' ? 'is-disconnected' : ''}" aria-hidden="true"></span><span class="session-tab-label">${escapeHtml(session.hostname)}</span><span class="session-tab-close" data-action="close-session" data-session-id="${escapeHtml(session.id)}" aria-label="Fechar sessão">×</span></button>`,
    )
    .join('');

  const session = activeSession();
  document.querySelectorAll('#handshake-line [data-stage]').forEach((stage) => {
    stage.className = '';
    if (!session) return;
    const stageName = stage.dataset.stage;
    if (session.completedStages.has(stageName)) stage.classList.add('is-complete');
    if (session.activeStage === stageName) stage.classList.add('is-active');
    if (session.failedStage === stageName) stage.classList.add('is-failed');
  });
  for (const candidate of state.sessions.values()) {
    candidate.panel.hidden = candidate.id !== state.activeSessionId;
  }
  renderSessionTools(session);
  if (session) {
    const algorithms = session.algorithms
      ? `${session.algorithms.kex} · ${session.algorithms.cipher} · ${session.algorithms.mac}`
      : 'negociando algoritmos';
    const recording =
      session.recordingState === 'active'
        ? '<span class="recording-pill">● REC</span> <button type="button" class="text-button" data-action="stop-recording">Parar gravação</button>'
        : session.recordingState === 'starting'
          ? '<span class="recording-pill">Preparando REC…</span>'
          : session.state !== 'disconnected' && session.recordingState !== 'stopped'
            ? '<button type="button" class="text-button" data-action="start-recording">Iniciar gravação</button>'
            : '';
    const runbook = session.snapshotCapture
      ? ' · <span class="runbook-capture-state">Coletando snapshot</span>'
      : '';
    elements.terminalStatus.innerHTML = `${escapeHtml(session.stateLabel)} · ${escapeHtml(session.address)}:${session.port} · ${escapeHtml(session.username)} · ${escapeHtml(algorithms)} · ${session.columns}×${session.rows} · ${recording}${runbook}${session.state === 'disconnected' && session.deviceId ? ` · <button type="button" class="text-button" data-action="reconnect-session" data-session-id="${escapeHtml(session.id)}">Reconectar</button>` : ''}`;
  }
  renderNavigation();
}

function showSession(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return;
  state.activeSessionId = sessionId;
  state.view = 'terminal';
  elements.summary.hidden = true;
  elements.bulkToolbar.hidden = true;
  elements.content.hidden = true;
  elements.terminalWorkspace.hidden = false;
  elements.viewTitle.textContent = session.hostname;
  renderSessionChrome();
  window.requestAnimationFrame(() => {
    session.fitAddon.fit();
    session.terminal.focus();
  });
}

function openSessions() {
  const target = sessionNavigationTarget(state.activeSessionId, [...state.sessions.keys()]);
  if (target !== undefined) {
    showSession(target);
    return;
  }
  state.activeSessionId = undefined;
  state.view = 'sessions';
  render();
}

function base64Bytes(value) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function postSessionInput(session, data) {
  if (session.state !== 'connected' || session.snapshotCapture !== undefined) return;
  try {
    await api(`/api/ssh/sessions/${session.id}/input`, { body: { data }, method: 'POST' });
  } catch (error) {
    session.terminal.writeln(`\r\n[NetRunner] ${error.message}`);
  }
}

function queueSessionInput(session, data) {
  if (session.snapshotCapture !== undefined) return;
  const chunks = splitMultilineInput(data);
  if (chunks !== undefined) {
    void (async () => {
      for (const chunk of chunks) {
        await postSessionInput(session, chunk);
        await new Promise((resolve) => window.setTimeout(resolve, state.settings.pasteDelayMs));
      }
    })();
    return;
  }

  session.inputQueue += data;
  if (session.inputTimer !== undefined) return;
  session.inputTimer = window.setTimeout(() => {
    const queued = session.inputQueue;
    session.inputQueue = '';
    session.inputTimer = undefined;
    void postSessionInput(session, queued);
  }, 12);
}

function createTerminalSession(created) {
  const panel = document.createElement('div');
  panel.className = 'terminal-panel';
  panel.dataset.sessionPanel = created.id;
  elements.terminalPanels.append(panel);

  const terminal = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, monospace",
    fontSize: state.settings.terminalFontSize,
    scrollback: state.settings.terminalScrollback,
    theme: terminalTheme(),
  });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const unicodeAddon = new Unicode11Addon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(unicodeAddon);
  terminal.unicode.activeVersion = '11';
  terminal.parser.registerOscHandler(0, () => true);
  terminal.parser.registerOscHandler(1, () => true);
  terminal.parser.registerOscHandler(2, () => true);
  terminal.parser.registerOscHandler(8, () => true);
  terminal.parser.registerOscHandler(52, () => true);
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      let url;
      try {
        url = new URL(uri);
      } catch {
        return;
      }
      if (!event.metaKey || !['http:', 'https:'].includes(url.protocol)) return;
      if (window.confirm(`Abrir este link no navegador?\n\n${url.href}`)) {
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    }),
  );
  terminal.open(panel);
  try {
    terminal.loadAddon(new WebglAddon());
  } catch {
    // The DOM renderer remains active when WebGL is unavailable.
  }

  const session = {
    ...created,
    activeStage: 'tcp',
    algorithms: undefined,
    closed: false,
    columns: terminal.cols,
    completedStages: new Set(),
    failedStage: undefined,
    fitAddon,
    inputQueue: '',
    inputTimer: undefined,
    lastHighlightedLine: 0,
    lastSequence: 0,
    panel,
    runbookProfile: undefined,
    runbooks: [],
    runbooksState: 'idle',
    snapshotCapture: undefined,
    rows: terminal.rows,
    searchAddon,
    state: 'connecting',
    stateLabel: 'Conectando',
    terminal,
  };
  state.sessions.set(session.id, session);

  terminal.onData((data) => queueSessionInput(session, data));
  terminal.onSelectionChange(() => {
    if (!state.settings.copyOnSelect || !terminal.hasSelection()) return;
    void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
  });
  panel.addEventListener('contextmenu', (event) => {
    if (!state.settings.rightClickPaste) return;
    event.preventDefault();
    void navigator.clipboard
      .readText()
      .then((text) => queueSessionInput(session, text))
      .catch(() => toast('O navegador não permitiu ler a área de transferência.', 'error'));
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.metaKey && event.key.toLowerCase() === 'f' && event.type === 'keydown') {
      const query = window.prompt('Buscar no terminal');
      if (query) searchAddon.findNext(query, { caseSensitive: false, incremental: true });
      return false;
    }
    if (event.metaKey && ['+', '=', '-'].includes(event.key) && event.type === 'keydown') {
      terminal.options.fontSize = Math.max(
        9,
        Math.min(24, terminal.options.fontSize + (event.key === '-' ? -1 : 1)),
      );
      window.requestAnimationFrame(() => fitAddon.fit());
      return false;
    }
    return true;
  });

  let resizeTimer;
  const resizeObserver = new ResizeObserver(() => {
    if (panel.hidden) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(async () => {
      fitAddon.fit();
      session.columns = terminal.cols;
      session.rows = terminal.rows;
      if (session.state === 'connected') {
        try {
          await api(`/api/ssh/sessions/${session.id}/resize`, {
            body: { columns: terminal.cols, rows: terminal.rows },
            method: 'POST',
          });
        } catch {
          // A concurrent disconnect makes resize irrelevant.
        }
      }
      renderSessionChrome();
    }, 100);
  });
  resizeObserver.observe(panel);
  session.resizeObserver = resizeObserver;
  void pollSessionEvents(session);
  showSession(session.id);
}

function updateHandshakeStage(session, stage, stateValue) {
  if (stateValue === 'connected' || stateValue === 'authenticated' || stateValue === 'trusted' || stateValue === 'replaced') {
    session.completedStages.add(stage);
  }
  const stages = ['tcp', 'host-key', 'authentication', 'shell'];
  const nextIndex = stages.indexOf(stage) + 1;
  session.activeStage = nextIndex < stages.length ? stages[nextIndex] : undefined;
}

async function handleSessionEvent(session, event) {
  if (event.type === 'output') {
    const data = event.payload.encoding === 'base64' ? base64Bytes(event.payload.data) : event.payload.data;
    if (session.snapshotCapture !== undefined) {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
      const remaining = 2 * 1024 * 1024 - session.snapshotCapture.output.length;
      if (remaining > 0) session.snapshotCapture.output += text.slice(0, remaining);
      if (text.length > remaining) session.snapshotCapture.truncated = true;
    }
    session.terminal.write(data, () => highlightCompletedLines(session));
  } else if (event.type === 'handshake') {
    session.algorithms = event.payload;
    session.completedStages.add('tcp');
  } else if (event.type === 'status') {
    updateHandshakeStage(session, event.payload.stage, event.payload.state);
    if (event.payload.state === 'connected') {
      session.state = 'connected';
      session.stateLabel = 'Conectado';
      session.terminal.focus();
      void loadSessionRunbooks(session);
    }
  } else if (event.type === 'host-key') {
    session.completedStages.add('tcp');
    session.activeStage = 'host-key';
    openHostKeyDialog(session, event.payload);
  } else if (event.type === 'authentication-prompts') {
    openAuthenticationPromptDialog(session, event.payload);
  } else if (event.type === 'app-message') {
    session.terminal.writeln(`\r\n[NetRunner] ${event.payload.message}`);
  } else if (event.type === 'runbook') {
    if (session.snapshotCapture !== undefined && event.payload.state === 'commands_sent') {
      session.snapshotCapture.commandsSent = true;
    }
  } else if (event.type === 'error') {
    session.failedStage = session.activeStage;
    session.stateLabel = 'Falha';
    session.terminal.writeln(`\r\n[NetRunner] ${event.payload.message}`);
    if (event.payload.diagnostic?.length) {
      session.terminal.writeln('[NetRunner] Diagnóstico de negociação:');
      for (const line of event.payload.diagnostic) session.terminal.writeln(`  ${line}`);
      if (session.algorithmProfile === 'modern') {
        session.terminal.writeln('[NetRunner] Avalie o perfil Legado somente para este dispositivo.');
      }
  } else if (event.type === 'recording') {
    session.recordingState = event.payload.state;
    session.recordingPath = event.payload.path ?? session.recordingPath;
    if (event.payload.state === 'error') {
      session.terminal.writeln(`\r\n[NetRunner] ${event.payload.message}`);
    }
    }
  } else if (event.type === 'ended') {
    session.state = 'disconnected';
    session.stateLabel = 'Desconectado';
    session.closed = true;
    session.terminal.writeln(`\r\n[NetRunner] ${event.payload.message}`);
    session.terminal.writeln('[NetRunner] Use Reconectar na aba do dispositivo para iniciar uma nova sessão.');
  }
  renderSessionChrome();
}

function highlightCompletedLines(session) {
  const buffer = session.terminal.buffer.active;
  const cursorLine = buffer.baseY + buffer.cursorY;
  const start = Math.max(session.lastHighlightedLine, 0);
  for (let lineIndex = start; lineIndex < cursorLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    const text = line?.translateToString(true) ?? '';
    const styles = terminalStylesForText(text, {
      keywords: state.settings.highlightKeywords,
      theme: state.settings.theme,
    });
    if (styles.length > 0) {
      try {
        const marker = session.terminal.registerMarker(lineIndex - cursorLine);
        if (marker) {
          for (const style of styles) {
            session.terminal.registerDecoration({
              backgroundColor: style.backgroundColor,
              foregroundColor: style.foregroundColor,
              layer: 'top',
              marker,
              width: Math.min(style.length, session.terminal.cols - style.start),
              x: style.start,
            });
          }
        }
      } catch {
        // Decorations are unavailable in the alternate buffer; output remains unchanged.
      }
    }
  }
  session.lastHighlightedLine = cursorLine;
}

async function pollSessionEvents(session) {
  while (!session.closed) {
    try {
      const response = await api(
        `/api/ssh/sessions/${session.id}/events?after=${session.lastSequence}`,
      );
      for (const event of response.events) {
        session.lastSequence = Math.max(session.lastSequence, event.sequence);
        await handleSessionEvent(session, event);
      }
    } catch (error) {
      session.state = 'disconnected';
      session.stateLabel = 'Canal local interrompido';
      session.closed = true;
      session.terminal.writeln(`\r\n[NetRunner] ${error.message}`);
      renderSessionChrome();
    }
  }
}

function optionList(values, selectedValue, placeholder) {
  const initial = placeholder === undefined ? '' : `<option value="">${escapeHtml(placeholder)}</option>`;
  return `${initial}${values
    .map(
      ({ label, value }) =>
        `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(label)}</option>`,
    )
    .join('')}`;
}

function enumOptions(values, selectedValue) {
  return optionList(
    Object.entries(values).map(([value, label]) => ({ label, value })),
    selectedValue,
  );
}

function algorithmOptions(category, selectedValues) {
  const selected = new Set(
    selectedValues ?? algorithmCatalog[category].slice(0, modernAlgorithmCounts[category]),
  );
  return algorithmCatalog[category]
    .map(
      (algorithm) =>
        `<option value="${escapeHtml(algorithm)}"${selected.has(algorithm) ? ' selected' : ''}>${escapeHtml(algorithm)}</option>`,
    )
    .join('');
}

function locationOptions(selectedValue, excludedId, placeholder = 'Selecione uma localidade') {
  return optionList(
    state.locations
      .filter((location) => location.id !== excludedId)
      .map((location) => ({ label: location.path, value: location.id })),
    selectedValue,
    placeholder,
  );
}

function usernameOptions(selectedValue, excludedId, placeholder = 'Selecione um username') {
  return optionList(
    state.usernames
      .filter((username) => username.id !== excludedId)
      .map((username) => ({
        label: `${username.username}${username.isDefault ? ' · padrão' : ''}`,
        value: username.id,
      })),
    selectedValue,
    placeholder,
  );
}

function renderSummary() {
  const metrics = [
    [state.summary.devices, 'dispositivos'],
    [state.summary.locations, 'localidades'],
    [state.summary.favorites, 'favoritos'],
    [state.summary.legacy, 'perfil legado'],
  ];
  elements.summary.innerHTML = metrics
    .map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join('');
  document.querySelector('#favorite-count').textContent = state.summary.favorites;
  document.querySelector('#legacy-count').textContent = state.summary.legacy;
}

function childrenOf(parentId) {
  return state.locations.filter((location) => location.parentId === parentId);
}

function renderLocationBranch(parentId, depth = 0) {
  return childrenOf(parentId)
    .map((location) => {
      const devices = state.devices.filter((device) => device.locationId === location.id);
      return `
        <div role="treeitem" aria-level="${depth + 1}" aria-expanded="true">
          <div class="tree-row${state.locationId === location.id ? ' is-active' : ''}" data-drop-location="${escapeHtml(location.id)}" style="padding-left:${7 + depth * 14}px">
            <button type="button" class="tree-select" data-location-id="${escapeHtml(location.id)}">
              <span aria-hidden="true">⌁</span><span>${escapeHtml(location.name)}</span>
              <span class="tree-count">${location.deviceCount}</span>
            </button>
            <button type="button" class="tree-add" data-action="new-device" data-location-id="${escapeHtml(location.id)}" aria-label="Novo dispositivo em ${escapeHtml(location.name)}">＋</button>
          </div>
          ${devices
            .slice(0, 8)
            .map(
              (device) => `<button type="button" draggable="true" class="tree-row tree-device" data-device-id="${escapeHtml(device.id)}" data-action="edit-device" style="padding-left:${29 + depth * 14}px">${escapeHtml(device.hostname)}${device.algorithmProfile === 'legacy' ? ' !' : ''}</button>`,
            )
            .join('')}
          ${renderLocationBranch(location.id, depth + 1)}
        </div>`;
    })
    .join('');
}

function renderLocationTree() {
  elements.locationTree.innerHTML =
    state.locations.length === 0
      ? '<p class="secondary-text">Cadastre sua primeira localidade.</p>'
      : renderLocationBranch(null);
}

function renderBulkToolbar() {
  const count = state.selected.size;
  elements.bulkToolbar.hidden = state.view !== 'devices' || count === 0;
  if (elements.bulkToolbar.hidden) {
    return;
  }
  const fieldOptions = [
    { label: 'Perfil SSH', value: 'algorithmProfile' },
    { label: 'Localidade', value: 'locationId' },
    { label: 'Username', value: 'usernameId' },
    { label: 'Favorito', value: 'favorite' },
  ];
  let valueOptions;
  if (state.bulkField === 'algorithmProfile') {
    valueOptions = Object.entries(labels.algorithmProfiles).map(([value, label]) => ({ label, value }));
  } else if (state.bulkField === 'locationId') {
    valueOptions = state.locations.map((location) => ({ label: location.path, value: location.id }));
  } else if (state.bulkField === 'usernameId') {
    valueOptions = state.usernames.map((username) => ({ label: username.username, value: username.id }));
  } else {
    valueOptions = [
      { label: 'Sim', value: 'true' },
      { label: 'Não', value: 'false' },
    ];
  }
  elements.bulkToolbar.innerHTML = `
    <strong>${count} selecionado${count === 1 ? '' : 's'}</strong>
    <select id="bulk-field" aria-label="Campo para alterar">${optionList(fieldOptions, state.bulkField)}</select>
    <select id="bulk-value" aria-label="Novo valor">${optionList(valueOptions)}</select>
    <button type="button" class="primary-button" data-action="apply-bulk">Aplicar</button>
    <button type="button" class="secondary-button" data-action="clear-selection">Limpar</button>`;
}

function emptyState(title, message, action, label) {
  return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><button type="button" class="primary-button" data-action="${action}">${escapeHtml(label)}</button></div></div>`;
}

function renderDevices() {
  const filterLabels = {
    all: 'Todos os dispositivos',
    favorites: 'Dispositivos favoritos',
    legacy: 'Dispositivos com criptografia legada',
    recent: 'Dispositivos acessados recentemente',
  };
  if (state.devices.length === 0) {
    elements.content.innerHTML = emptyState(
      state.search ? 'Nenhum resultado' : 'Cadastre seu primeiro dispositivo',
      state.search
        ? 'Revise os termos da busca ou limpe os filtros ativos.'
        : 'Adicione um equipamento para começar a organizar seu inventário local.',
      'new-device',
      'Novo dispositivo',
    );
    return;
  }
  elements.content.innerHTML = `
    <div class="panel-toolbar"><p>${escapeHtml(filterLabels[state.filter])} · ${state.devices.length} exibido${state.devices.length === 1 ? '' : 's'}</p><button type="button" class="text-button" data-action="export-csv">Exportar CSV</button></div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th><input id="select-all" type="checkbox" aria-label="Selecionar todos" /></th><th aria-label="Favorito"></th><th>Dispositivo</th><th>Localidade</th><th>Fabricante / tipo</th><th>Perfil SSH</th><th>Ações</th></tr></thead>
      <tbody>${state.devices
        .map(
          (device) => `<tr draggable="true" tabindex="0" data-device-id="${escapeHtml(device.id)}" class="${state.selected.has(device.id) ? 'is-selected' : ''}">
            <td><input type="checkbox" data-select-device="${escapeHtml(device.id)}" aria-label="Selecionar ${escapeHtml(device.hostname)}" ${state.selected.has(device.id) ? 'checked' : ''} /></td>
            <td><button type="button" class="favorite-button${device.favorite ? ' is-active' : ''}" data-action="toggle-favorite" data-device-id="${escapeHtml(device.id)}" aria-label="${device.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">★</button></td>
            <td class="device-name"><strong>${escapeHtml(device.hostname)}</strong><small>${escapeHtml(device.address)}:${device.sshPort}</small></td>
            <td>${escapeHtml(device.locationPath)}</td>
            <td>${escapeHtml(labels.vendors[device.vendor] ?? device.vendor)}<div class="secondary-text">${escapeHtml(labels.deviceTypes[device.deviceType] ?? device.deviceType)}</div></td>
            <td><span class="badge${device.algorithmProfile === 'legacy' ? ' badge--legacy' : ''}">${escapeHtml(labels.algorithmProfiles[device.algorithmProfile])}</span>${device.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}</td>
            <td><div class="row-actions">${device.sshEnabled ? `<button type="button" class="text-button" data-action="connect-device" data-device-id="${escapeHtml(device.id)}">SSH</button>` : ''}${device.httpsEnabled ? `<button type="button" class="text-button" data-action="open-https" data-device-id="${escapeHtml(device.id)}">HTTPS</button>` : ''}<button type="button" class="text-button" data-action="edit-device" data-device-id="${escapeHtml(device.id)}">Editar</button><button type="button" class="text-button" data-action="delete-device" data-device-id="${escapeHtml(device.id)}">Excluir</button></div></td>
          </tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
}

function renderLocations() {
  if (state.locations.length === 0) {
    elements.content.innerHTML = emptyState(
      'Cadastre sua primeira localidade',
      'Monte uma hierarquia como Brasil › São Paulo › Site-01.',
      'new-location',
      'Nova localidade',
    );
    return;
  }
  elements.content.innerHTML = `
    <div class="panel-toolbar"><p>${state.locations.length} localidade${state.locations.length === 1 ? '' : 's'}</p><button type="button" class="primary-button" data-action="new-location">＋ Nova localidade</button></div>
    <table class="data-table"><thead><tr><th>Caminho</th><th>Tipo</th><th>Código</th><th>Dispositivos</th><th>Ações</th></tr></thead><tbody>
    ${state.locations
      .map(
        (location) => `<tr draggable="true" data-location-drag-id="${escapeHtml(location.id)}" data-drop-location="${escapeHtml(location.id)}"><td><strong>${escapeHtml(location.path)}</strong><div class="secondary-text">${escapeHtml(location.address ?? '')}</div></td><td>${escapeHtml(labels.locationTypes[location.type])}</td><td>${escapeHtml(location.code ?? '—')}</td><td>${location.deviceCount}</td><td><div class="row-actions"><button type="button" class="text-button" data-action="new-device" data-location-id="${escapeHtml(location.id)}">＋ Dispositivo</button><button type="button" class="text-button" data-action="edit-location" data-location-id="${escapeHtml(location.id)}">Editar</button><button type="button" class="text-button" data-action="delete-location" data-location-id="${escapeHtml(location.id)}">Excluir</button></div></td></tr>`,
      )
      .join('')}</tbody></table>`;
}

function renderUsernames() {
  if (state.usernames.length === 0) {
    elements.content.innerHTML = emptyState(
      'Cadastre seu primeiro username',
      'O NetRunner reutiliza apenas identificadores. Senhas nunca são armazenadas.',
      'new-username',
      'Novo username',
    );
    return;
  }
  elements.content.innerHTML = `
    <div class="panel-toolbar"><p>${state.usernames.length} username${state.usernames.length === 1 ? '' : 's'} · nenhuma senha armazenada</p><button type="button" class="primary-button" data-action="new-username">＋ Novo username</button></div>
    <table class="data-table"><thead><tr><th>Username</th><th>Descrição</th><th>Uso</th><th>Ações</th></tr></thead><tbody>
    ${state.usernames
      .map(
        (username) => `<tr><td><strong>${escapeHtml(username.username)}</strong>${username.isDefault ? '<span class="badge">padrão</span>' : ''}</td><td>${escapeHtml(username.description ?? '—')}</td><td>${username.deviceCount} dispositivo${username.deviceCount === 1 ? '' : 's'}</td><td><div class="row-actions"><button type="button" class="text-button" data-action="edit-username" data-username-id="${escapeHtml(username.id)}">Editar</button><button type="button" class="text-button" data-action="delete-username" data-username-id="${escapeHtml(username.id)}">Excluir</button></div></td></tr>`,
      )
      .join('')}</tbody></table>`;
}

function renderSessions() {
  elements.content.innerHTML = emptyState(
    'Nenhuma sessão aberta',
    'Inicie uma conexão SSH pelo cadastro de dispositivos ou use uma conexão rápida.',
    'quick-connect',
    'Nova conexão rápida',
  );
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function healthStatus(status) {
  const statusLabels = {
    degraded: 'Degradado',
    disabled: 'Desativado',
    offline: 'Offline',
    online: 'Online',
    unsupported: 'Indisponível',
    unknown: 'Não verificado',
  };
  return `<span class="health-status health-status--${escapeHtml(status)}">${escapeHtml(statusLabels[status] ?? status)}</span>`;
}

function probeSummary(probe) {
  if (probe === undefined) return healthStatus('unknown');
  const latency = Number.isFinite(probe.latencyMs) ? `<small>${probe.latencyMs} ms</small>` : '';
  return `<div class="health-probe">${healthStatus(probe.status)}${latency}</div>`;
}

function renderHealth() {
  const latest = new Map(state.health.map((item) => [item.deviceId, item]));
  const checkedCount = state.health.length;
  const rows = state.devices
    .map((device) => {
      const result = latest.get(device.id);
      return `<tr class="${state.selected.has(device.id) ? 'is-selected' : ''}">
        <td><input type="checkbox" data-select-device="${escapeHtml(device.id)}" aria-label="Selecionar ${escapeHtml(device.hostname)}" ${state.selected.has(device.id) ? 'checked' : ''} /></td>
        <td class="device-name"><strong>${escapeHtml(device.hostname)}</strong><small>${escapeHtml(device.address)} · ${escapeHtml(device.locationPath)}</small></td>
        <td>${healthStatus(result?.overallStatus ?? 'unknown')}</td>
        <td>${probeSummary(result?.ping)}</td>
        <td>${probeSummary(result?.ssh)}</td>
        <td>${probeSummary(result?.https)}</td>
        <td>${result ? escapeHtml(new Date(result.checkedAt).toLocaleString('pt-BR')) : '—'}</td>
        <td><button type="button" class="text-button" data-action="run-health-check" data-device-id="${escapeHtml(device.id)}" ${state.healthRunning ? 'disabled' : ''}>Verificar</button></td>
      </tr>`;
    })
    .join('');
  elements.content.innerHTML = `
    <div class="panel-toolbar health-toolbar">
      <div><strong>Verificação sob demanda</strong><p>ICMP é informativo; o estado geral usa TCP/SSH e TLS/HTTPS habilitados, sem autenticação.</p></div>
      <button type="button" class="primary-button" data-action="run-selected-health-checks" ${state.healthRunning || state.selected.size === 0 ? 'disabled' : ''}>${state.healthRunning ? 'Verificando…' : `Verificar selecionados (${state.selected.size})`}</button>
    </div>
    <div class="health-summary" role="status">${checkedCount} dispositivo${checkedCount === 1 ? '' : 's'} com resultado salvo · máximo de 20 por lote</div>
    <div class="table-scroll"><table class="data-table health-table">
      <thead><tr><th><input id="select-all" type="checkbox" aria-label="Selecionar todos" /></th><th>Dispositivo</th><th>Estado</th><th>ICMP</th><th>SSH</th><th>HTTPS</th><th>Última verificação</th><th>Ação</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8">Nenhum dispositivo encontrado no filtro atual.</td></tr>'}</tbody>
    </table></div>`;
}

function compactDiffRows(rows, context = 3, maximum = 5000) {
  const visible = new Set();
  rows.forEach((row, index) => {
    if (row.kind === 'equal') return;
    for (
      let candidate = Math.max(0, index - context);
      candidate <= Math.min(rows.length - 1, index + context);
      candidate += 1
    ) {
      visible.add(candidate);
    }
  });
  const indexes = [...visible].sort((left, right) => left - right).slice(0, maximum);
  const compacted = [];
  let previous = -1;
  for (const index of indexes) {
    if (index > previous + 1) compacted.push({ kind: 'omitted', count: index - previous - 1 });
    compacted.push(rows[index]);
    previous = index;
  }
  if (previous < rows.length - 1) compacted.push({ kind: 'omitted', count: rows.length - previous - 1 });
  return compacted;
}

function renderSnapshotComparison() {
  const comparison = state.snapshotComparison;
  if (comparison === undefined) return '';
  if (comparison.identical) {
    return '<section class="snapshot-comparison"><p class="snapshot-identical">Os snapshots são idênticos.</p></section>';
  }
  const rows = compactDiffRows(comparison.rows)
    .map((row) => {
      if (row.kind === 'omitted') {
        return `<tr class="diff-row diff-row--omitted"><td colspan="4">⋯ ${row.count} linha${row.count === 1 ? '' : 's'} sem alteração</td></tr>`;
      }
      const marker = row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' ';
      return `<tr class="diff-row diff-row--${row.kind}"><td>${row.leftNumber ?? ''}</td><td>${row.rightNumber ?? ''}</td><td aria-label="${row.kind}">${marker}</td><td><code>${escapeHtml(row.text)}</code></td></tr>`;
    })
    .join('');
  return `<section class="snapshot-comparison">
    <div class="snapshot-diff-summary"><strong>${escapeHtml(comparison.left.name)} → ${escapeHtml(comparison.right.name)}</strong><span class="diff-added">+${comparison.stats.added}</span><span class="diff-removed">−${comparison.stats.removed}</span><span>${comparison.stats.unchanged} sem alteração</span></div>
    <div class="table-scroll snapshot-diff-scroll"><table class="snapshot-diff"><thead><tr><th>Antes</th><th>Depois</th><th></th><th>Configuração</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function renderSnapshots() {
  if (state.devices.length === 0) {
    elements.content.innerHTML = emptyState(
      'Cadastre um dispositivo primeiro',
      'Snapshots de configuração são sempre vinculados a um equipamento do inventário.',
      'new-device',
      'Novo dispositivo',
    );
    return;
  }
  const device = state.devices.find((item) => item.id === state.snapshotDeviceId) ?? state.devices[0];
  const sourceLabels = { manual: 'Manual', runbook: 'Runbook', terminal: 'Terminal' };
  const options = state.snapshots
    .map(
      (snapshot) => `<option value="${escapeHtml(snapshot.id)}">${escapeHtml(snapshot.name)} · ${escapeHtml(new Date(snapshot.createdAt).toLocaleString('pt-BR'))}</option>`,
    )
    .join('');
  const rows = state.snapshots
    .map(
      (snapshot) => `<tr><td><strong>${escapeHtml(snapshot.name)}</strong><div class="secondary-text">${escapeHtml(snapshot.contentSha256.slice(0, 12))}…</div></td><td>${escapeHtml(sourceLabels[snapshot.source] ?? snapshot.source)}</td><td>${snapshot.lineCount}</td><td>${snapshot.redactionCount}</td><td>${escapeHtml(new Date(snapshot.createdAt).toLocaleString('pt-BR'))}</td><td><div class="row-actions"><button type="button" class="text-button" data-action="view-snapshot" data-snapshot-id="${escapeHtml(snapshot.id)}">Abrir</button><button type="button" class="text-button" data-action="delete-snapshot" data-snapshot-id="${escapeHtml(snapshot.id)}">Excluir</button></div></td></tr>`,
    )
    .join('');
  elements.content.innerHTML = `
    <div class="panel-toolbar snapshot-toolbar">
      <label>Dispositivo<select id="snapshot-device">${state.devices.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === device.id ? ' selected' : ''}>${escapeHtml(item.hostname)} · ${escapeHtml(item.locationPath)}</option>`).join('')}</select></label>
      <p class="snapshot-collection-note">Novos snapshots são coletados pela ação <strong>Snapshot</strong> de uma sessão SSH ativa.</p>
    </div>
    <div class="snapshot-compare-controls">
      <label>Antes<select id="snapshot-left"><option value="">Selecione</option>${options}</select></label>
      <label>Depois<select id="snapshot-right"><option value="">Selecione</option>${options}</select></label>
      <button type="button" class="secondary-button" data-action="compare-snapshots" ${state.snapshots.length < 2 ? 'disabled' : ''}>Comparar</button>
    </div>
    ${renderSnapshotComparison()}
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Snapshot</th><th>Origem</th><th>Linhas</th><th>Remoções</th><th>Criado em</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Nenhum snapshot salvo para este dispositivo.</td></tr>'}</tbody></table></div>`;
}

function renderRunbooks() {
  const cards = state.runbookCatalog
    .map((family) => {
      const troubleshootingRunbooks = family.runbooks.filter(
        (runbook) => runbook.kind === 'diagnostic',
      );
      const runbooks = troubleshootingRunbooks.length
        ? troubleshootingRunbooks
            .map(
              (runbook) => `<div class="runbook-definition"><strong>${escapeHtml(runbook.name)}</strong><p>${escapeHtml(runbook.description)}</p><code>${runbook.commands.map(escapeHtml).join('<br />')}</code></div>`,
            )
            .join('')
        : `<p class="runbook-cloud-note">Gerenciamento centralizado em ${escapeHtml(family.managementLabel)}. Nenhum comando SSH local será automatizado.</p>`;
      return `<article class="runbook-family">
        <header><div><span>${escapeHtml(family.vendorLabel)}</span><h2>${escapeHtml(family.system)}</h2></div><span class="badge">${family.management === 'ssh' ? 'SSH guiado' : 'Cloud'}</span></header>
        <p class="secondary-text">${family.models.map(escapeHtml).join(' · ')}</p>
        <div class="runbook-list">${runbooks}</div>
      </article>`;
    })
    .join('');
  elements.content.innerHTML = `
    <div class="panel-toolbar"><div><strong>Catálogo de troubleshooting</strong><p>Comandos somente leitura enviados diretamente para a sessão ativa, sem criar snapshots.</p></div></div>
    <div class="runbook-grid">${cards}</div>`;
}

function renderHistory() {
  const rows = state.history
    .map(
      (session) => `<tr>
        <td><strong>${escapeHtml(session.hostname)}</strong><div class="secondary-text">${escapeHtml(session.address)}:${session.port}</div></td>
        <td>${escapeHtml(session.locationPath ?? '—')}</td>
        <td>${escapeHtml(new Date(session.startedAt).toLocaleString('pt-BR'))}</td>
        <td>${formatDuration(session.durationMs)}</td>
        <td>${escapeHtml(session.ticket ?? '—')}</td>
        <td><span class="badge">${escapeHtml(session.protocol.toUpperCase())}</span></td>
        <td>${session.recorded ? `<span class="integrity-state">${session.sha256 ? 'SHA-256' : 'incompleto'}</span>` : 'Não gravada'}</td>
        <td><div class="row-actions">${session.recorded ? `<button type="button" class="text-button" data-action="verify-log" data-history-id="${escapeHtml(session.id)}">Verificar</button><button type="button" class="text-button" data-action="open-log" data-history-id="${escapeHtml(session.id)}">Abrir</button><button type="button" class="text-button" data-action="reveal-log" data-history-id="${escapeHtml(session.id)}">Finder</button>` : ''}</div></td>
      </tr>`,
    )
    .join('');
  elements.content.innerHTML = `
    <div class="history-location"><strong>Logs privados:</strong> ${escapeHtml(state.historySettings.logsRoot ?? '—')} · <label><input id="history-recording-default" type="checkbox" ${state.historySettings.recordingDefault ? 'checked' : ''} /> Gravar novas sessões por padrão</label></div>
    <div class="history-filters">
      <label>Dispositivo<select id="history-device"><option value="">Todos</option>${state.devices.map((device) => `<option value="${escapeHtml(device.id)}"${state.historyFilters.deviceId === device.id ? ' selected' : ''}>${escapeHtml(device.hostname)}</option>`).join('')}</select></label>
      <label>Localidade<select id="history-location"><option value="">Todas</option>${state.locations.map((location) => `<option value="${escapeHtml(location.path)}"${state.historyFilters.location === location.path ? ' selected' : ''}>${escapeHtml(location.path)}</option>`).join('')}</select></label>
      <label>De<input id="history-from" type="date" value="${escapeHtml(state.historyFilters.dateFrom ?? '')}" /></label>
      <label>Até<input id="history-to" type="date" value="${escapeHtml(state.historyFilters.dateTo ?? '')}" /></label>
      <label>Duração mín. (min)<input id="history-duration" type="number" min="0" max="525600" value="${escapeHtml(state.historyFilters.durationMinutes ?? '')}" /></label>
      <label>Ticket<input id="history-ticket" type="search" maxlength="120" value="${escapeHtml(state.historyFilters.ticket ?? '')}" /></label>
      <label>Protocolo<select id="history-protocol"><option value="">Todos</option><option value="ssh"${state.historyFilters.protocol === 'ssh' ? ' selected' : ''}>SSH</option><option value="https"${state.historyFilters.protocol === 'https' ? ' selected' : ''}>HTTPS</option></select></label>
      <button type="button" class="primary-button" data-action="refresh-history">Filtrar</button>
    </div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Dispositivo</th><th>Localidade</th><th>Início</th><th>Duração</th><th>Ticket</th><th>Protocolo</th><th>Integridade</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Nenhuma sessão encontrada.</td></tr>'}</tbody></table></div>`;
}

function renderSettings() {
  const backupRows = state.backups
    .map(
      (backup) => `<tr><td><strong>${escapeHtml(backup.name)}</strong>${backup.pendingRestore ? '<span class="badge badge--legacy">restauração agendada</span>' : ''}</td><td>${new Date(backup.createdAt).toLocaleString('pt-BR')}</td><td>${Math.max(1, Math.round(backup.size / 1024))} KiB</td><td><button type="button" class="text-button" data-action="restore-backup" data-backup-name="${escapeHtml(backup.name)}">Restaurar no próximo início</button></td></tr>`,
    )
    .join('');
  elements.content.innerHTML = `
    <form id="settings-form" class="settings-form">
      <section class="settings-section">
        <h2>Aparência</h2>
        <div class="field"><label for="setting-theme">Tema</label><select id="setting-theme" name="theme"><option value="dark"${state.settings.theme === 'dark' ? ' selected' : ''}>Escuro</option><option value="light"${state.settings.theme === 'light' ? ' selected' : ''}>Claro</option><option value="high-contrast"${state.settings.theme === 'high-contrast' ? ' selected' : ''}>Alto contraste</option></select></div>
        <p class="dialog-message">Interface em Português (Brasil). O contrato de idioma está preparado para espanhol e inglês, ainda sem tradução completa.</p>
      </section>
      <section class="settings-section">
        <h2>Terminal</h2>
        <div class="settings-grid">
          <div class="field"><label for="setting-font-size">Tamanho da fonte</label><input id="setting-font-size" name="terminalFontSize" type="number" min="9" max="24" value="${state.settings.terminalFontSize}" /></div>
          <div class="field"><label for="setting-scrollback">Linhas de scrollback</label><input id="setting-scrollback" name="terminalScrollback" type="number" min="1000" max="100000" step="1000" value="${state.settings.terminalScrollback}" /></div>
          <div class="field"><label for="setting-paste-delay">Atraso por linha ao colar (ms)</label><input id="setting-paste-delay" name="pasteDelayMs" type="number" min="0" max="2000" value="${state.settings.pasteDelayMs}" /></div>
          <label class="check-field"><input type="checkbox" name="copyOnSelect" ${state.settings.copyOnSelect ? 'checked' : ''} /> Copiar ao selecionar</label>
          <label class="check-field"><input type="checkbox" name="rightClickPaste" ${state.settings.rightClickPaste ? 'checked' : ''} /> Colar com clique direito</label>
        </div>
        <div class="field"><label for="setting-highlights">Palavras realçadas, separadas por vírgula</label><textarea id="setting-highlights" name="highlightKeywords" maxlength="1800">${escapeHtml(state.settings.highlightKeywords.join(', '))}</textarea></div>
        <p class="dialog-message">O realce existe somente no terminal visual e nunca modifica o TXT de auditoria.</p>
      </section>
      <section class="settings-section">
        <h2>Sessões e segurança</h2>
        <div class="settings-grid">
          <label class="check-field"><input type="checkbox" name="recordingDefault" ${state.settings.recordingDefault ? 'checked' : ''} /> Gravar novas sessões por padrão</label>
          <div class="field"><label for="setting-idle">Desconectar após inatividade (min; 0 desativa)</label><input id="setting-idle" name="idleDisconnectMinutes" type="number" min="0" max="480" value="${state.settings.idleDisconnectMinutes}" /></div>
        </div>
        <p class="security-warning">Touch ID e Secure Keyboard Entry exigem integração nativa macOS e não estão disponíveis nesta edição web local. O NetRunner não simula esses controles.</p>
      </section>
      <section class="settings-section">
        <div class="panel-toolbar"><div><h2>Backup e restauração</h2><p>Uma restauração validada é aplicada somente no próximo início.</p></div><button type="button" class="secondary-button" data-action="create-backup">Criar backup agora</button></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th>Ação</th></tr></thead><tbody>${backupRows || '<tr><td colspan="4">Nenhum backup disponível.</td></tr>'}</tbody></table></div>
      </section>
      <footer class="settings-actions"><button type="button" class="primary-button" data-action="save-settings">Salvar configurações</button></footer>
    </form>`;
}

function renderTrustMaterial() {
  const hostRows = state.hostKeys
    .map(
      (host) => `<tr><td><strong>${escapeHtml(host.host)}:${host.port}</strong></td><td>${escapeHtml(host.keyType)}</td><td class="fingerprint-cell">${escapeHtml(host.fingerprint)}</td><td>${new Date(host.lastSeenAt).toLocaleString('pt-BR')}</td><td><button type="button" class="text-button" data-action="remove-host-key" data-trust-id="${escapeHtml(host.id)}">Remover</button></td></tr>`,
    )
    .join('');
  const certificateRows = state.certificates
    .map(
      (certificate) => `<tr><td><strong>${escapeHtml(certificate.host)}:${certificate.port}</strong></td><td>${escapeHtml(certificate.subject ?? '—')}</td><td class="fingerprint-cell">${escapeHtml(certificate.fingerprint)}</td><td>${new Date(certificate.lastSeenAt).toLocaleString('pt-BR')}</td><td><button type="button" class="text-button" data-action="remove-certificate" data-trust-id="${escapeHtml(certificate.id)}">Remover</button></td></tr>`,
    )
    .join('');
  elements.content.innerHTML = `
    <section class="settings-section"><h2>Host keys SSH</h2><p class="dialog-message">Remover uma chave fará o NetRunner solicitar uma nova confirmação TOFU na próxima conexão.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Destino</th><th>Tipo</th><th>Fingerprint</th><th>Última verificação</th><th>Ação</th></tr></thead><tbody>${hostRows || '<tr><td colspan="5">Nenhuma host key armazenada.</td></tr>'}</tbody></table></div></section>
    <section class="settings-section"><h2>Certificados HTTPS fixados</h2><p class="dialog-message">Certificados públicos validados pelo sistema não são fixados nesta lista.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Destino</th><th>Assunto</th><th>Fingerprint</th><th>Última verificação</th><th>Ação</th></tr></thead><tbody>${certificateRows || '<tr><td colspan="5">Nenhum certificado privado fixado.</td></tr>'}</tbody></table></div></section>`;
}

async function loadHistory() {
  const query = new URLSearchParams({ limit: '500' });
  const fields = {
    dateFrom: document.querySelector('#history-from')?.value,
    dateTo: document.querySelector('#history-to')?.value,
    deviceId: document.querySelector('#history-device')?.value,
    location: document.querySelector('#history-location')?.value,
    protocol: document.querySelector('#history-protocol')?.value,
    ticket: document.querySelector('#history-ticket')?.value,
  };
  const durationMinutes = document.querySelector('#history-duration')?.value;
  state.historyFilters = { ...fields, durationMinutes };
  for (const [key, value] of Object.entries(fields)) {
    if (value) query.set(key, key === 'dateTo' ? `${value}T23:59:59.999Z` : value);
  }
  if (durationMinutes) query.set('minimumDurationMs', String(Number(durationMinutes) * 60_000));
  state.history = await api(`/api/history?${query}`);
  render();
}

function render() {
  renderNavigation();
  if (state.view === 'terminal') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = true;
    elements.terminalWorkspace.hidden = false;
    renderSessionChrome();
    return;
  }
  if (state.view === 'sessions') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Sessões';
    renderSessions();
    return;
  }
  if (state.view === 'history') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Histórico de sessões';
    renderHistory();
    return;
  }
  if (state.view === 'health') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Saúde dos dispositivos';
    renderHealth();
    return;
  }
  if (state.view === 'snapshots') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Snapshots de configuração';
    renderSnapshots();
    return;
  }
  if (state.view === 'runbooks') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Runbooks operacionais';
    renderRunbooks();
    return;
  }
  if (state.view === 'settings') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Configurações';
    renderSettings();
    return;
  }
  if (state.view === 'trust') {
    elements.summary.hidden = true;
    elements.bulkToolbar.hidden = true;
    elements.content.hidden = false;
    elements.terminalWorkspace.hidden = true;
    elements.viewTitle.textContent = 'Confianças SSH e HTTPS';
    renderTrustMaterial();
    return;
  }
  elements.summary.hidden = false;
  elements.content.hidden = false;
  elements.terminalWorkspace.hidden = true;
  renderSummary();
  renderLocationTree();
  renderBulkToolbar();
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === state.filter);
  });
  const titles = { devices: 'Dispositivos', locations: 'Localidades', usernames: 'Usernames' };
  elements.viewTitle.textContent = titles[state.view];
  if (state.view === 'devices') renderDevices();
  if (state.view === 'locations') renderLocations();
  if (state.view === 'usernames') renderUsernames();
}

async function loadInventory() {
  const query = new URLSearchParams({ limit: '500' });
  if (state.search) query.set('search', state.search);
  if (state.locationId) query.set('locationId', state.locationId);
  if (state.filter === 'favorites') query.set('favorites', 'true');
  if (state.filter === 'recent') query.set('recent', 'true');
  if (state.filter === 'legacy') query.set('algorithmProfile', 'legacy');
  const [summary, locations, usernames, devices] = await Promise.all([
    api('/api/inventory/summary'),
    api('/api/locations'),
    api('/api/usernames'),
    api(`/api/devices?${query}`),
  ]);
  state.summary = summary;
  state.locations = locations;
  state.usernames = usernames;
  state.devices = devices;
  for (const id of state.selected) {
    if (!devices.some((device) => device.id === id)) state.selected.delete(id);
  }
  render();
}

async function loadBackups() {
  state.backups = await api('/api/backups');
}

async function loadHealth() {
  state.health = await api('/api/device-health');
  render();
}

async function loadSnapshots(deviceId = state.snapshotDeviceId ?? state.devices[0]?.id) {
  state.snapshotDeviceId = deviceId;
  state.snapshotComparison = undefined;
  state.snapshots = deviceId
    ? await api(`/api/configuration-snapshots?deviceId=${encodeURIComponent(deviceId)}`)
    : [];
  render();
}

async function loadRunbookCatalog() {
  state.runbookCatalog = await api('/api/runbooks/catalog');
  render();
}

async function runHealthChecks(deviceIds) {
  state.healthRunning = true;
  render();
  try {
    await api('/api/device-health/check', { body: { deviceIds }, method: 'POST' });
    state.health = await api('/api/device-health');
    toast('Verificação de saúde concluída.');
  } finally {
    state.healthRunning = false;
    render();
  }
}

async function loadTrustMaterial() {
  [state.hostKeys, state.certificates] = await Promise.all([
    api('/api/security/host-keys'),
    api('/api/security/certificates'),
  ]);
}

async function navigateToView(view) {
  if (view === 'sessions') {
    openSessions();
    return;
  }
  state.view = view;
  if (view === 'history') await loadHistory();
  else if (view === 'health') await loadHealth();
  else if (view === 'snapshots') await loadSnapshots();
  else if (view === 'runbooks') await loadRunbookCatalog();
  else if (view === 'settings') {
    await loadBackups();
    render();
  } else if (view === 'trust') {
    await loadTrustMaterial();
    render();
  } else render();
}

function commandItems() {
  const navigation = [
    { detail: 'Tela', id: 'sessions', label: 'Abrir Sessões', type: 'view' },
    { detail: 'Tela', id: 'devices', label: 'Abrir Dispositivos', type: 'view' },
    { detail: 'Tela', id: 'locations', label: 'Abrir Localidades', type: 'view' },
    { detail: 'Tela', id: 'usernames', label: 'Abrir Usernames', type: 'view' },
    { detail: 'Tela', id: 'health', label: 'Abrir Saúde', type: 'view' },
    { detail: 'Tela', id: 'snapshots', label: 'Abrir Snapshots', type: 'view' },
    { detail: 'Tela', id: 'runbooks', label: 'Abrir Runbooks', type: 'view' },
    { detail: 'Tela', id: 'history', label: 'Abrir Histórico', type: 'view' },
    { detail: 'Tela', id: 'trust', label: 'Abrir Confianças', type: 'view' },
    { detail: 'Tela', id: 'settings', label: 'Abrir Configurações', type: 'view' },
    { detail: '⌘T', id: 'quick', label: 'Nova conexão rápida', type: 'quick' },
  ];
  const devices = state.devices.flatMap((device) => {
    const results = [];
    if (device.sshEnabled) {
      results.push({
        detail: `${device.address}:${device.sshPort} · ${device.locationPath}`,
        id: device.id,
        label: `SSH · ${device.hostname}`,
        type: 'ssh',
      });
    }
    if (device.httpsEnabled) {
      results.push({
        detail: `${device.httpsUrl ?? `${device.address}:${device.httpsPort}`} · ${device.locationPath}`,
        id: device.id,
        label: `HTTPS · ${device.hostname}`,
        type: 'https',
      });
    }
    return results;
  });
  return [...navigation, ...devices];
}

function renderCommandPalette(query = '') {
  const terms = query.trim().toLocaleLowerCase('pt-BR');
  const items = commandItems()
    .filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase('pt-BR').includes(terms))
    .slice(0, 30);
  elements.commandResults.innerHTML = items.length
    ? items
        .map(
          (item, index) => `<button id="command-option-${index}" type="button" role="option" aria-selected="${index === 0}" class="command-item${index === 0 ? ' is-selected' : ''}" data-action="command-execute" data-command-type="${escapeHtml(item.type)}" data-command-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></button>`,
        )
        .join('')
    : '<p class="command-empty">Nenhum dispositivo ou ação encontrado.</p>';
  elements.commandSearch.setAttribute('aria-activedescendant', items.length ? 'command-option-0' : '');
}

function moveCommandSelection(direction) {
  const options = [...elements.commandResults.querySelectorAll('[data-action="command-execute"]')];
  if (options.length === 0) return;
  const current = options.findIndex((option) => option.classList.contains('is-selected'));
  const next = (current + direction + options.length) % options.length;
  options.forEach((option, index) => {
    option.classList.toggle('is-selected', index === next);
    option.setAttribute('aria-selected', String(index === next));
  });
  elements.commandSearch.setAttribute('aria-activedescendant', options[next].id);
  options[next].scrollIntoView({ block: 'nearest' });
}

function openCommandPalette() {
  elements.commandSearch.value = '';
  renderCommandPalette();
  if (!elements.commandDialog.open) elements.commandDialog.showModal();
  elements.commandSearch.focus();
}

async function executeCommand(button) {
  const { commandId, commandType } = button.dataset;
  elements.commandDialog.close();
  if (commandType === 'view') {
    await navigateToView(commandId);
    return;
  }
  if (commandType === 'quick') {
    openQuickConnectionDialog();
    return;
  }
  const device = state.devices.find((item) => item.id === commandId);
  if (commandType === 'ssh' && device) openConnectionDialog(device);
  if (commandType === 'https' && device) await openHttpsDialog(device);
}

function openDialog({ content, eyebrow = 'Inventário local', id, kind, submit = 'Salvar', title }) {
  elements.dialog.dataset.kind = kind;
  elements.dialog.dataset.id = id ?? '';
  elements.dialog.dataset.stage = '';
  elements.dialog.dataset.sessionId = '';
  elements.dialogEyebrow.textContent = eyebrow;
  elements.dialogTitle.textContent = title;
  elements.dialogContent.innerHTML = content;
  elements.dialogSubmit.textContent = submit;
  elements.dialogSubmit.className = 'primary-button';
  elements.dialog.showModal();
  elements.dialogContent.querySelector('input, select, textarea')?.focus();
}

function openSnapshotViewer(snapshot) {
  openDialog({
    content: `
      <div class="connection-device"><strong>${escapeHtml(snapshot.name)}</strong><span>${escapeHtml(snapshot.hostname)} · ${escapeHtml(new Date(snapshot.createdAt).toLocaleString('pt-BR'))} · ${snapshot.redactionCount} trecho${snapshot.redactionCount === 1 ? '' : 's'} removido${snapshot.redactionCount === 1 ? '' : 's'} · SHA-256 ${escapeHtml(snapshot.contentSha256)}</span></div>
      <div class="field field--wide"><label for="snapshot-view-content">Conteúdo armazenado</label><textarea id="snapshot-view-content" class="snapshot-content-input" readonly spellcheck="false">${escapeHtml(snapshot.content)}</textarea></div>`,
    eyebrow: 'Snapshot somente para leitura',
    id: snapshot.id,
    kind: 'snapshot-view',
    submit: 'Fechar',
    title: snapshot.name,
  });
}

function sanitizeCapturedOutput(value) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
}

function openLocationDialog(location) {
  openDialog({
    content: `
      <div class="field"><label for="location-name">Nome *</label><input id="location-name" name="name" required maxlength="120" value="${escapeHtml(location?.name ?? '')}" /></div>
      <div class="field"><label for="location-code">Sigla / código</label><input id="location-code" name="code" maxlength="40" value="${escapeHtml(location?.code ?? '')}" /></div>
      <div class="field"><label for="location-type">Tipo *</label><select id="location-type" name="type" required>${enumOptions(labels.locationTypes, location?.type ?? 'site')}</select></div>
      <div class="field"><label for="location-parent">Localidade-pai</label><select id="location-parent" name="parentId">${locationOptions(location?.parentId ?? '', location?.id, 'Sem localidade-pai')}</select></div>
      <div class="field field--wide"><label for="location-address">Endereço</label><input id="location-address" name="address" maxlength="500" value="${escapeHtml(location?.address ?? '')}" /></div>
      <div class="field field--wide"><label for="location-notes">Observações</label><textarea id="location-notes" name="notes" maxlength="4000">${escapeHtml(location?.notes ?? '')}</textarea></div>`,
    id: location?.id,
    kind: 'location',
    title: location ? 'Editar localidade' : 'Nova localidade',
  });
}

function openUsernameDialog(username) {
  openDialog({
    content: `
      <p class="dialog-message">Somente o identificador é salvo. Não existe campo de senha no cadastro.</p>
      <div class="field"><label for="username-value">Username *</label><input id="username-value" name="username" required maxlength="128" autocomplete="off" value="${escapeHtml(username?.username ?? '')}" /></div>
      <label class="check-field"><input type="checkbox" name="isDefault" ${username?.isDefault ? 'checked' : ''} /> Usar como padrão</label>
      <div class="field field--wide"><label for="username-description">Descrição</label><input id="username-description" name="description" maxlength="500" value="${escapeHtml(username?.description ?? '')}" placeholder="Ex.: TACACS pessoal" /></div>`,
    id: username?.id,
    kind: 'username',
    title: username ? 'Editar username' : 'Novo username',
  });
}

function openDeviceDialog(device, locationId) {
  const defaultUsername = state.usernames.find((username) => username.isDefault) ?? state.usernames[0];
  const selectedLocation = state.locations.find(
    (location) => location.id === (device?.locationId ?? locationId),
  );
  const selectedUsername = state.usernames.find(
    (username) => username.id === (device?.usernameId ?? defaultUsername?.id),
  );
  openDialog({
    content: `
      <div class="field"><label for="device-hostname">Hostname *</label><input id="device-hostname" name="hostname" required maxlength="255" value="${escapeHtml(device?.hostname ?? '')}" /></div>
      <div class="field"><label for="device-address">IPv4, IPv6 ou FQDN *</label><input id="device-address" name="address" required maxlength="253" spellcheck="false" value="${escapeHtml(device?.address ?? '')}" /></div>
      <div class="field"><label for="device-location">Localidade * · digite para buscar</label><input id="device-location" name="locationPath" list="device-location-options" required value="${escapeHtml(selectedLocation?.path ?? '')}" /><datalist id="device-location-options">${state.locations.map((location) => `<option value="${escapeHtml(location.path)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="device-username">Username * · digite para buscar</label><input id="device-username" name="usernameName" list="device-username-options" required value="${escapeHtml(selectedUsername?.username ?? '')}" /><datalist id="device-username-options">${state.usernames.map((username) => `<option value="${escapeHtml(username.username)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="device-vendor">Fabricante *</label><select id="device-vendor" name="vendor" required>${enumOptions(labels.vendors, device?.vendor ?? 'cisco')}</select></div>
      <div class="field"><label for="device-type">Tipo *</label><select id="device-type" name="deviceType" required>${enumOptions(labels.deviceTypes, device?.deviceType ?? 'switch')}</select></div>
      <div class="field"><label for="device-platform">Plataforma</label><input id="device-platform" name="platform" maxlength="120" value="${escapeHtml(device?.platform ?? '')}" placeholder="Ex.: IOS-XE" /></div>
      <div class="field"><label for="device-tags">Tags separadas por vírgula</label><input id="device-tags" name="tags" value="${escapeHtml(device?.tags.join(', ') ?? '')}" /></div>
      <label class="check-field"><input type="checkbox" name="sshEnabled" ${device?.sshEnabled === false ? '' : 'checked'} /> SSH habilitado</label>
      <div class="field"><label for="device-ssh-port">Porta SSH</label><input id="device-ssh-port" name="sshPort" type="number" min="1" max="65535" value="${device?.sshPort ?? 22}" /></div>
      <label class="check-field"><input type="checkbox" name="httpsEnabled" ${device?.httpsEnabled ? 'checked' : ''} /> HTTPS habilitado</label>
      <div class="field"><label for="device-https-port">Porta HTTPS</label><input id="device-https-port" name="httpsPort" type="number" min="1" max="65535" value="${device?.httpsPort ?? 443}" /></div>
      <div class="field field--wide"><label for="device-https-url">URL HTTPS personalizada</label><input id="device-https-url" name="httpsUrl" type="url" value="${escapeHtml(device?.httpsUrl ?? '')}" placeholder="https://portal.example.net/" /></div>
      <div class="field"><label for="device-profile">Perfil de algoritmos SSH</label><select id="device-profile" name="algorithmProfile">${enumOptions(labels.algorithmProfiles, device?.algorithmProfile ?? 'modern')}</select></div>
      <div class="field"><label for="device-login-mode">Modo de login</label><select id="device-login-mode" name="loginMode"><option value="standard"${device?.loginMode === 'shell' ? '' : ' selected'}>Padrão</option><option value="shell"${device?.loginMode === 'shell' ? ' selected' : ''}>Login no shell</option></select></div>
      <div class="field"><label for="device-terminal-type">Tipo de terminal</label><select id="device-terminal-type" name="terminalType">${optionList(['xterm-256color', 'xterm', 'vt100', 'vt220'].map((value) => ({ label: value, value })), device?.terminalType ?? 'xterm-256color')}</select></div>
      <div class="field"><label for="device-backspace">Backspace envia</label><select id="device-backspace" name="backspaceMode"><option value="del"${device?.backspaceMode === 'bs' ? '' : ' selected'}>DEL (^?)</option><option value="bs"${device?.backspaceMode === 'bs' ? ' selected' : ''}>BS (^H)</option></select></div>
      <div class="field"><label for="device-encoding">Codificação</label><select id="device-encoding" name="encoding"><option value="utf-8"${device?.encoding === 'iso-8859-1' ? '' : ' selected'}>UTF-8</option><option value="iso-8859-1"${device?.encoding === 'iso-8859-1' ? ' selected' : ''}>ISO-8859-1</option></select></div>
      <div class="field"><label for="device-timeout">Timeout de conexão (s)</label><input id="device-timeout" name="connectTimeout" type="number" min="1" max="300" value="${device?.connectTimeout ?? 20}" /></div>
      <div class="field"><label for="device-keepalive">Keepalive (s; 0 desativa)</label><input id="device-keepalive" name="keepaliveInterval" type="number" min="0" max="3600" value="${device?.keepaliveInterval ?? 0}" /></div>
      <div class="field"><label for="device-keepalive-limit">Limite de keepalive</label><input id="device-keepalive-limit" name="keepaliveLimit" type="number" min="1" max="100" value="${device?.keepaliveLimit ?? 3}" /></div>
      <div class="field"><label for="device-post-login">Comando pós-login aprovado</label><select id="device-post-login" name="postLoginCommand"><option value="">Desativado</option>${optionList(['terminal length 0', 'screen-length 0 temporary', 'skip-page-display', 'set cli screen-length 0', 'no paging', 'no page'].map((value) => ({ label: value, value })), device?.postLoginCommand ?? '')}</select></div>
      <label class="check-field"><input type="checkbox" name="postLoginEnabled" ${device?.postLoginEnabled ? 'checked' : ''} /> Executar após conectar</label>
      <details class="algorithm-editor field--wide"${device?.algorithmProfile === 'custom' ? ' open' : ''}>
        <summary>Configurar perfil personalizado</summary>
        <p>Use ⌘+clique para selecionar algoritmos permitidos. A prioridade segue a ordem exibida. Algoritmos proibidos não são oferecidos.</p>
        <div class="algorithm-grid">
          <div class="field"><label for="custom-kex">Troca de chaves</label><select id="custom-kex" multiple size="6">${algorithmOptions('kex', device?.customAlgorithms?.kex)}</select></div>
          <div class="field"><label for="custom-host-key">Host key</label><select id="custom-host-key" multiple size="6">${algorithmOptions('serverHostKey', device?.customAlgorithms?.serverHostKey)}</select></div>
          <div class="field"><label for="custom-cipher">Cifras</label><select id="custom-cipher" multiple size="6">${algorithmOptions('cipher', device?.customAlgorithms?.cipher)}</select></div>
          <div class="field"><label for="custom-hmac">MACs</label><select id="custom-hmac" multiple size="6">${algorithmOptions('hmac', device?.customAlgorithms?.hmac)}</select></div>
        </div>
      </details>
      <label class="check-field"><input type="checkbox" name="favorite" ${device?.favorite ? 'checked' : ''} /> Favorito</label>
      <div class="field field--wide"><label for="device-notes">Observações</label><textarea id="device-notes" name="notes" maxlength="4000">${escapeHtml(device?.notes ?? '')}</textarea></div>`,
    id: device?.id,
    kind: 'device',
    title: device ? 'Editar dispositivo' : 'Novo dispositivo',
  });
}

function openDeleteLocationDialog(location) {
  openDialog({
    content: `<p class="dialog-message">${location.childCount + location.deviceCount > 0 ? 'O conteúdo deve ser movido antes da exclusão. Escolha uma localidade de destino.' : 'Esta ação remove a localidade do inventário.'}</p>${
      location.childCount + location.deviceCount > 0
        ? `<div class="field field--wide"><label for="destination-location">Destino *</label><select id="destination-location" name="destinationLocationId" required>${locationOptions('', location.id)}</select></div>`
        : ''
    }`,
    id: location.id,
    kind: 'delete-location',
    submit: 'Excluir localidade',
    title: `Excluir ${location.name}?`,
  });
  elements.dialogSubmit.className = 'danger-button';
}

function openDeleteUsernameDialog(username) {
  openDialog({
    content: `<p class="dialog-message">${username.deviceCount > 0 ? `${username.deviceCount} dispositivo(s) usam este username. Escolha a reatribuição.` : 'Esta ação remove o username do inventário.'}</p>${
      username.deviceCount > 0
        ? `<div class="field field--wide"><label for="replacement-username">Username substituto *</label><select id="replacement-username" name="replacementUsernameId" required>${usernameOptions('', username.id)}</select></div>`
        : ''
    }`,
    id: username.id,
    kind: 'delete-username',
    submit: 'Excluir username',
    title: `Excluir ${username.username}?`,
  });
  elements.dialogSubmit.className = 'danger-button';
}

function openImportDialog() {
  state.pendingImport = undefined;
  openDialog({
    content: `
      <p class="dialog-message">Aceita o JSON exportado pelo NetRunner ou CSV UTF-8 separado por vírgula ou ponto e vírgula. Revise a prévia antes de importar.</p>
      <div class="field field--wide"><button type="button" class="secondary-button" data-action="download-template">Baixar modelo CSV</button></div>
      <div class="field field--wide"><label for="import-file">Arquivo CSV ou JSON *</label><input id="import-file" name="file" type="file" accept=".csv,.json,text/csv,application/json" required /></div>
      <label class="check-field"><input type="checkbox" name="createMissingLocations" /> Criar localidades inexistentes</label>
      <label class="check-field"><input type="checkbox" name="createMissingUsernames" /> Criar usernames inexistentes</label>
      <label class="check-field"><input type="checkbox" name="skipDuplicates" checked /> Ignorar dispositivos duplicados</label>
      <div id="import-result" class="import-result"></div>`,
    kind: 'import',
    submit: 'Gerar prévia',
    title: 'Importar inventário',
  });
}

function openConnectionDialog(device) {
  const shellLogin = device.loginMode === 'shell';
  openDialog({
    content: `
      <div class="connection-device"><strong>${escapeHtml(device.hostname)}</strong><span>${escapeHtml(device.address)}:${device.sshPort} · ${escapeHtml(device.locationPath)}</span></div>
      ${device.algorithmProfile === 'legacy' ? '<p class="security-warning">Este dispositivo usa algoritmos legados. Confirme se o firmware ainda exige este perfil.</p>' : ''}
      <div class="field field--wide"><label for="connection-username">Username</label><input id="connection-username" name="username" required maxlength="128" autocomplete="off" value="${escapeHtml(device.username)}" /></div>
      ${
        shellLogin
          ? '<p class="security-warning field--wide">Modo login no shell: o SSH será aberto sem enviar senha. Digite as credenciais diretamente no terminal quando o equipamento solicitar.</p>'
          : '<div class="field field--wide"><label for="connection-password">Senha *</label><input id="connection-password" name="password" type="password" required maxlength="1024" autocomplete="new-password" autocapitalize="off" spellcheck="false" /></div>'
      }
      <div class="field field--wide"><label for="connection-ticket">Ticket / mudança (opcional)</label><input id="connection-ticket" name="ticket" maxlength="120" autocomplete="off" /></div>
      <label class="check-field field--wide"><input type="checkbox" name="record" ${state.settings.recordingDefault ? 'checked' : ''} /> Gravar sessão em TXT</label>
      <p class="dialog-message">A senha permanece apenas durante esta tentativa de autenticação e não é salva no banco, histórico ou logs.</p>`,
    eyebrow: 'Conexão SSH segura',
    id: device.id,
    kind: 'ssh-connect',
    submit: 'Conectar',
    title: `Conectar a ${device.hostname}`,
  });
}

function openQuickConnectionDialog() {
  openDialog({
    content: `
      <p class="dialog-message">Conecte sem cadastrar o equipamento. Use <strong>usuario@host:porta</strong>; para IPv6, use colchetes.</p>
      <div class="field field--wide"><label for="quick-target">Destino *</label><input id="quick-target" name="target" required maxlength="390" autocomplete="off" spellcheck="false" placeholder="netops@192.0.2.10:22" /></div>
      <div class="field field--wide"><label for="quick-password">Senha (deixe vazia no login dentro do shell)</label><input id="quick-password" name="password" type="password" maxlength="1024" autocomplete="new-password" autocapitalize="off" spellcheck="false" /></div>
      <div class="field"><label for="quick-profile">Perfil SSH</label><select id="quick-profile" name="algorithmProfile"><option value="modern">Moderno</option><option value="legacy">Legado</option></select></div>
      <div class="field"><label for="quick-login-mode">Modo de login</label><select id="quick-login-mode" name="loginMode"><option value="standard">Padrão</option><option value="shell">Login no shell</option></select></div>
      <div class="field"><label for="quick-terminal">Terminal</label><select id="quick-terminal" name="terminalType"><option value="xterm-256color">xterm-256color</option><option value="xterm">xterm</option><option value="vt100">vt100</option><option value="vt220">vt220</option></select></div>
      <div class="field field--wide"><label for="quick-ticket">Ticket / mudança (opcional)</label><input id="quick-ticket" name="ticket" maxlength="120" autocomplete="off" /></div>
      <label class="check-field field--wide"><input type="checkbox" name="record" ${state.settings.recordingDefault ? 'checked' : ''} /> Gravar sessão em TXT</label>
      <p class="dialog-message">Esta conexão não será adicionada ao inventário. A host key continuará protegida por TOFU para o endereço e porta.</p>`,
    eyebrow: 'Conexão SSH avulsa',
    kind: 'ssh-quick-connect',
    submit: 'Conectar',
    title: 'Conexão rápida',
  });
}

async function openHttpsDialog(device) {
  let inspection;
  try {
    inspection = await api('/api/https/inspect', {
      body: { deviceId: device.id },
      method: 'POST',
    });
  } catch (error) {
    const reasons = {
      connection_refused: 'O equipamento recusou a conexão HTTPS.',
      dns_not_found: 'O endereço HTTPS não foi encontrado pelo DNS do sistema.',
      obsolete_tls: 'O equipamento oferece somente uma versão TLS obsoleta. TLS 1.0 e 1.1 não são aceitos.',
      timeout: 'O equipamento não respondeu ao handshake TLS dentro do tempo limite.',
    };
    throw new Error(reasons[error.details?.reason] ?? error.message);
  }
  const changed = inspection.trustStatus === 'changed';
  const untrusted = inspection.trustStatus === 'untrusted-first-seen';
  const statusMessage = changed
    ? 'O certificado é diferente do que foi fixado anteriormente. O acesso está bloqueado até a substituição explícita.'
    : untrusted
      ? 'A cadeia não é confiável para o macOS/Node. Confirme a fingerprint por um canal confiável antes de fixá-la.'
      : inspection.trustStatus === 'pinned'
        ? 'A fingerprint corresponde ao certificado fixado para este dispositivo.'
        : 'A cadeia do certificado foi validada pelo sistema.';
  openDialog({
    content: `
      <p class="security-warning${changed ? ' security-warning--danger' : ''}">${escapeHtml(statusMessage)}</p>
      <div class="connection-device"><strong>${escapeHtml(device.hostname)}</strong><span>${escapeHtml(inspection.url)}</span></div>
      ${changed ? `<div class="field field--wide"><span>Fingerprint fixada</span><div class="host-key-fingerprint">${escapeHtml(inspection.previousFingerprint)}</div></div>` : ''}
      <div class="field field--wide"><span>Fingerprint apresentada</span><div class="host-key-fingerprint">${escapeHtml(inspection.certificate.fingerprint)}</div></div>
      <div class="field"><span>Protocolo</span><strong>${escapeHtml(inspection.certificate.protocol ?? '—')}</strong></div>
      <div class="field"><span>Cifra</span><strong>${escapeHtml(inspection.certificate.cipher ?? '—')}</strong></div>
      <div class="field field--wide"><span>Emitido para</span><div>${escapeHtml(inspection.certificate.subject ?? '—')}</div></div>
      <div class="field field--wide"><span>Emissor</span><div>${escapeHtml(inspection.certificate.issuer ?? '—')}</div></div>
      <div class="field"><span>Válido desde</span><div>${escapeHtml(inspection.certificate.validFrom ? new Date(inspection.certificate.validFrom).toLocaleString('pt-BR') : '—')}</div></div>
      <div class="field"><span>Válido até</span><div>${escapeHtml(inspection.certificate.validTo ? new Date(inspection.certificate.validTo).toLocaleString('pt-BR') : '—')}</div></div>
      <p class="dialog-message">O NetRunner abrirá o navegador padrão. Cookies, autenticação e validação final do TLS pertencem ao navegador; nenhuma senha ou conteúdo HTTPS passa pelo NetRunner.</p>`,
    eyebrow: 'Inspeção TLS local',
    id: device.id,
    kind: 'https-certificate',
    submit: changed ? 'Substituir e abrir' : untrusted ? 'Confiar e abrir' : 'Abrir no navegador',
    title: changed ? 'Certificado HTTPS alterado' : 'Abrir interface HTTPS?',
  });
  elements.dialog.dataset.fingerprint = inspection.certificate.fingerprint;
  elements.dialog.dataset.trustStatus = inspection.trustStatus;
  if (changed) elements.dialogSubmit.className = 'danger-button';
}

function parseQuickTarget(value) {
  const match = /^([^@\s]+)@(\[[^\]]+\]|[^:\s]+)(?::(\d{1,5}))?$/u.exec(value.trim());
  if (!match) throw new Error('Use o formato usuario@host:porta. IPv6 deve ficar entre colchetes.');
  const port = match[3] === undefined ? 22 : Number(match[3]);
  if (port < 1 || port > 65_535) throw new Error('A porta deve estar entre 1 e 65535.');
  return {
    address: match[2].startsWith('[') ? match[2].slice(1, -1) : match[2],
    port,
    username: match[1],
  };
}

function openHostKeyDialog(session, hostKey) {
  const changed = hostKey.status === 'changed';
  openDialog({
    content: `
      <p class="security-warning${changed ? ' security-warning--danger' : ''}">${
        changed
          ? 'A host key é diferente da registrada. A conexão está bloqueada até uma substituição deliberada.'
          : 'Primeira conexão com este endereço. Confirme a fingerprint por um canal confiável antes de continuar.'
      }</p>
      ${changed ? `<div class="field field--wide"><span>Fingerprint registrada</span><div class="host-key-fingerprint">${escapeHtml(hostKey.previousKeyType)} · ${escapeHtml(hostKey.previousFingerprint)}</div></div>` : ''}
      <div class="field field--wide"><span>${changed ? 'Nova fingerprint' : 'Fingerprint apresentada'}</span><div class="host-key-fingerprint">${escapeHtml(hostKey.keyType)} · ${escapeHtml(hostKey.fingerprint)}</div></div>`,
    eyebrow: 'Verificação TOFU',
    kind: 'ssh-host-key',
    submit: changed ? 'Substituir e continuar' : 'Confiar e continuar',
    title: changed ? 'Host key alterada' : 'Confiar nesta host key?',
  });
  elements.dialog.dataset.sessionId = session.id;
  elements.dialog.dataset.fingerprint = hostKey.fingerprint;
  elements.dialog.dataset.replace = changed ? 'true' : 'false';
  if (changed) elements.dialogSubmit.className = 'danger-button';
}

function openAuthenticationPromptDialog(session, promptRequest) {
  openDialog({
    content: `
      ${promptRequest.instructions ? `<p class="dialog-message">${escapeHtml(promptRequest.instructions)}</p>` : ''}
      ${promptRequest.prompts
        .map(
          (prompt, index) => `<div class="field field--wide"><label for="auth-prompt-${index}">${escapeHtml(prompt.prompt || `Resposta ${index + 1}`)}</label><input id="auth-prompt-${index}" data-prompt-answer type="${prompt.echo ? 'text' : 'password'}" required maxlength="1024" autocomplete="off" spellcheck="false" /></div>`,
        )
        .join('')}`,
    eyebrow: 'Autenticação interativa',
    kind: 'ssh-prompts',
    submit: 'Enviar respostas',
    title: promptRequest.name || 'Autenticação adicional',
  });
  elements.dialog.dataset.sessionId = session.id;
  elements.dialog.dataset.promptId = promptRequest.promptId;
}

function formObject() {
  return Object.fromEntries(new FormData(elements.dialogForm));
}

async function submitEditor(event) {
  event.preventDefault();
  const kind = elements.dialog.dataset.kind;
  const id = elements.dialog.dataset.id;
  const values = formObject();
  elements.dialogSubmit.disabled = true;
  try {
    if (kind === 'ssh-connect') {
      const passwordInput = elements.dialogForm.querySelector('[name="password"]');
      const created = await api('/api/ssh/sessions', {
        body: {
          columns: 100,
          deviceId: id,
          password: values.password,
          record: elements.dialogForm.elements.record.checked,
          rows: 30,
          ticket: values.ticket,
          username: values.username,
        },
        method: 'POST',
      });
      if (passwordInput) passwordInput.value = '';
      values.password = '';
      elements.dialog.close();
      createTerminalSession(created);
      return;
    }
    if (kind === 'ssh-quick-connect') {
      const target = parseQuickTarget(values.target);
      const passwordInput = elements.dialogForm.querySelector('[name="password"]');
      const created = await api('/api/ssh/sessions', {
        body: {
          columns: 100,
          password: values.password,
          record: elements.dialogForm.elements.record.checked,
          quick: {
            ...target,
            algorithmProfile: values.algorithmProfile,
            loginMode: values.loginMode,
            terminalType: values.terminalType,
          },
          rows: 30,
          ticket: values.ticket,
        },
        method: 'POST',
      });
      passwordInput.value = '';
      values.password = '';
      elements.dialog.close();
      createTerminalSession(created);
      return;
    }
    if (kind === 'ssh-host-key') {
      await api(`/api/ssh/sessions/${elements.dialog.dataset.sessionId}/host-key`, {
        body: {
          decision: 'accept',
          fingerprint: elements.dialog.dataset.fingerprint,
          replace: elements.dialog.dataset.replace === 'true',
        },
        method: 'POST',
      });
      elements.dialog.close();
      elements.dialogSubmit.className = 'primary-button';
      return;
    }
    if (kind === 'ssh-prompts') {
      const answerInputs = [...elements.dialogForm.querySelectorAll('[data-prompt-answer]')];
      const answers = answerInputs.map((input) => input.value);
      await api(`/api/ssh/sessions/${elements.dialog.dataset.sessionId}/prompts`, {
        body: { answers, promptId: elements.dialog.dataset.promptId },
        method: 'POST',
      });
      answers.fill('');
      answerInputs.forEach((input) => {
        input.value = '';
      });
      elements.dialog.close();
      return;
    }
    if (kind === 'https-certificate') {
      const trustStatus = elements.dialog.dataset.trustStatus;
      const decision =
        trustStatus === 'changed'
          ? 'replace'
          : trustStatus === 'untrusted-first-seen'
            ? 'trust'
            : 'continue';
      await api('/api/https/open', {
        body: {
          decision,
          deviceId: id,
          expectedFingerprint: elements.dialog.dataset.fingerprint,
        },
        method: 'POST',
      });
      elements.dialog.close();
      elements.dialogSubmit.className = 'primary-button';
      toast('Interface HTTPS aberta no navegador padrão.');
      return;
    }
    if (kind === 'snapshot-view') {
      elements.dialog.close();
      return;
    }
    if (kind === 'location') {
      const body = { ...values, parentId: values.parentId || null, type: values.type };
      await api(id ? `/api/locations/${id}` : '/api/locations', {
        body,
        method: id ? 'PUT' : 'POST',
      });
      toast(id ? 'Localidade atualizada.' : 'Localidade cadastrada.');
    } else if (kind === 'username') {
      await api(id ? `/api/usernames/${id}` : '/api/usernames', {
        body: {
          description: values.description,
          isDefault: elements.dialogForm.elements.isDefault.checked,
          username: values.username,
        },
        method: id ? 'PUT' : 'POST',
      });
      toast(id ? 'Username atualizado.' : 'Username cadastrado.');
    } else if (kind === 'device') {
      const location = state.locations.find(
        (item) => item.path.toLowerCase() === values.locationPath.trim().toLowerCase(),
      );
      const username = state.usernames.find(
        (item) => item.username.toLowerCase() === values.usernameName.trim().toLowerCase(),
      );
      if (!location || !username) {
        throw new Error('Selecione uma localidade e um username existentes nas sugestões.');
      }
      const body = {
        address: values.address,
        algorithmProfile: values.algorithmProfile,
        backspaceMode: values.backspaceMode,
        connectTimeout: Number(values.connectTimeout),
        customAlgorithms:
          values.algorithmProfile === 'custom'
            ? {
                cipher: [...document.querySelector('#custom-cipher').selectedOptions].map((option) => option.value),
                hmac: [...document.querySelector('#custom-hmac').selectedOptions].map((option) => option.value),
                kex: [...document.querySelector('#custom-kex').selectedOptions].map((option) => option.value),
                serverHostKey: [...document.querySelector('#custom-host-key').selectedOptions].map((option) => option.value),
              }
            : null,
        deviceType: values.deviceType,
        encoding: values.encoding,
        favorite: elements.dialogForm.elements.favorite.checked,
        hostname: values.hostname,
        httpsEnabled: elements.dialogForm.elements.httpsEnabled.checked,
        httpsPort: Number(values.httpsPort),
        httpsUrl: values.httpsUrl,
        keepaliveInterval: Number(values.keepaliveInterval),
        keepaliveLimit: Number(values.keepaliveLimit),
        locationId: location.id,
        loginMode: values.loginMode,
        notes: values.notes,
        platform: values.platform,
        postLoginCommand: values.postLoginCommand,
        postLoginEnabled: elements.dialogForm.elements.postLoginEnabled.checked,
        sshEnabled: elements.dialogForm.elements.sshEnabled.checked,
        sshPort: Number(values.sshPort),
        tags: values.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        terminalType: values.terminalType,
        usernameId: username.id,
        vendor: values.vendor,
      };
      const result = await api(id ? `/api/devices/${id}` : '/api/devices', {
        body,
        method: id ? 'PUT' : 'POST',
      });
      toast(result.warnings?.[0]?.message ?? (id ? 'Dispositivo atualizado.' : 'Dispositivo cadastrado.'));
    } else if (kind === 'delete-location') {
      await api(`/api/locations/${id}`, {
        body: { destinationLocationId: values.destinationLocationId || null },
        method: 'DELETE',
      });
      toast('Localidade excluída.');
    } else if (kind === 'delete-username') {
      await api(`/api/usernames/${id}`, {
        body: { replacementUsernameId: values.replacementUsernameId || null },
        method: 'DELETE',
      });
      toast('Username excluído.');
    } else if (kind === 'import') {
      const file = elements.dialogForm.elements.file.files[0];
      if (elements.dialog.dataset.stage !== 'apply') {
        const content = await file.text();
        const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
        const preview = await api('/api/import/preview', { body: { content, format }, method: 'POST' });
        state.pendingImport = { content, format };
        document.querySelector('#import-result').innerHTML = `<p><strong>${preview.total}</strong> registro(s) · ${preview.errors.length} erro(s) · ${preview.warnings.length} aviso(s)</p><p class="secondary-text">Localidades novas: ${preview.missingLocations.map(escapeHtml).join(', ') || 'nenhuma'}<br />Usernames novos: ${preview.missingUsernames.map(escapeHtml).join(', ') || 'nenhum'}</p>`;
        elements.dialog.dataset.stage = 'apply';
        elements.dialogSubmit.textContent = 'Importar agora';
        return;
      }
      await api('/api/import/apply', {
        body: {
          ...state.pendingImport,
          createMissingLocations: elements.dialogForm.elements.createMissingLocations.checked,
          createMissingUsernames: elements.dialogForm.elements.createMissingUsernames.checked,
          skipDuplicates: elements.dialogForm.elements.skipDuplicates.checked,
        },
        method: 'POST',
      });
      toast('Importação concluída.');
    }
    elements.dialog.close();
    elements.dialogSubmit.className = 'primary-button';
    await loadInventory();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    elements.dialogSubmit.disabled = false;
  }
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (action === 'command-execute') {
    await executeCommand(button);
  } else if (action === 'close-dialog') {
    const dialogKind = elements.dialog.dataset.kind;
    const pendingSessionId = elements.dialog.dataset.sessionId;
    if (dialogKind === 'ssh-host-key' && pendingSessionId) {
      await api(`/api/ssh/sessions/${pendingSessionId}/host-key`, {
        body: {
          decision: 'reject',
          fingerprint: elements.dialog.dataset.fingerprint,
        },
        method: 'POST',
      });
    } else if (dialogKind === 'ssh-prompts' && pendingSessionId) {
      await api(`/api/ssh/sessions/${pendingSessionId}`, { method: 'DELETE' });
    }
    elements.dialog.close();
    elements.dialogSubmit.className = 'primary-button';
  } else if (action === 'new-location') {
    openLocationDialog();
  } else if (action === 'edit-location') {
    openLocationDialog(state.locations.find((location) => location.id === button.dataset.locationId));
  } else if (action === 'delete-location') {
    openDeleteLocationDialog(state.locations.find((location) => location.id === button.dataset.locationId));
  } else if (action === 'new-username') {
    openUsernameDialog();
  } else if (action === 'edit-username') {
    openUsernameDialog(state.usernames.find((username) => username.id === button.dataset.usernameId));
  } else if (action === 'delete-username') {
    openDeleteUsernameDialog(state.usernames.find((username) => username.id === button.dataset.usernameId));
  } else if (action === 'new-device') {
    if (state.locations.length === 0 || state.usernames.length === 0) {
      toast('Cadastre ao menos uma localidade e um username antes do dispositivo.', 'error');
      return;
    }
    openDeviceDialog(undefined, button.dataset.locationId ?? state.locationId);
  } else if (action === 'edit-device') {
    openDeviceDialog(state.devices.find((device) => device.id === button.dataset.deviceId));
  } else if (action === 'connect-device') {
    const device = state.devices.find((item) => item.id === button.dataset.deviceId);
    if (!device.sshEnabled) {
      toast('SSH está desabilitado para este dispositivo.', 'error');
      return;
    }
    openConnectionDialog(device);
  } else if (action === 'open-https') {
    const device = state.devices.find((item) => item.id === button.dataset.deviceId);
    if (!device?.httpsEnabled) {
      toast('HTTPS está desabilitado para este dispositivo.', 'error');
      return;
    }
    await openHttpsDialog(device);
  } else if (action === 'delete-device') {
    const device = state.devices.find((item) => item.id === button.dataset.deviceId);
    if (window.confirm(`Excluir ${device.hostname} do inventário?`)) {
      await api(`/api/devices/${device.id}`, { method: 'DELETE' });
      toast('Dispositivo excluído.');
      await loadInventory();
    }
  } else if (action === 'toggle-favorite') {
    const device = state.devices.find((item) => item.id === button.dataset.deviceId);
    await api(`/api/devices/${device.id}`, { body: { favorite: !device.favorite }, method: 'PUT' });
    await loadInventory();
  } else if (action === 'clear-selection') {
    state.selected.clear();
    render();
  } else if (action === 'apply-bulk') {
    const field = document.querySelector('#bulk-field').value;
    let value = document.querySelector('#bulk-value').value;
    if (field === 'favorite') value = value === 'true';
    await api('/api/devices/bulk', {
      body: { changes: { [field]: value }, ids: [...state.selected] },
      method: 'POST',
    });
    state.selected.clear();
    toast('Alteração aplicada aos dispositivos selecionados.');
    await loadInventory();
  } else if (action === 'open-import') {
    openImportDialog();
  } else if (action === 'export-json') {
    await downloadExport('json');
  } else if (action === 'export-csv') {
    await downloadExport('csv');
  } else if (action === 'download-template') {
    downloadText(
      'netrunner-modelo.csv',
      '\uFEFFhostname;address;vendor;device_type;platform;location;username;ssh_port;https_url;tags;favorite\nSW-EXEMPLO-01;192.0.2.10;cisco;switch;IOS-XE;Brasil › São Paulo › Site-01;netops;22;;core|acesso;não\n',
      'text/csv;charset=utf-8',
    );
  } else if (action === 'activate-session') {
    showSession(button.dataset.sessionId);
  } else if (action === 'open-sessions') {
    openSessions();
  } else if (action === 'close-session') {
    const session = state.sessions.get(button.dataset.sessionId);
    if (!session) return;
    if (session.state === 'connected' && !window.confirm(`Encerrar a sessão com ${session.hostname}?`)) return;
    try {
      await api(`/api/ssh/sessions/${session.id}`, { method: 'DELETE' });
    } catch {
      // The local session may already be gone; the UI can still release its resources.
    }
    session.closed = true;
    session.resizeObserver.disconnect();
    session.terminal.dispose();
    session.panel.remove();
    state.sessions.delete(session.id);
    state.activeSessionId = state.sessions.keys().next().value;
    if (state.activeSessionId) showSession(state.activeSessionId);
    else {
      state.view = 'sessions';
      render();
    }
  } else if (action === 'reconnect-session') {
    const session = state.sessions.get(button.dataset.sessionId);
    const device = state.devices.find((item) => item.id === session?.deviceId);
    if (device) openConnectionDialog(device);
  } else if (action === 'quick-connect') {
    openQuickConnectionDialog();
  } else if (action === 'reload-session-runbooks') {
    const session = state.sessions.get(button.dataset.sessionId);
    if (session) {
      session.runbooksState = 'idle';
      await loadSessionRunbooks(session);
    }
  } else if (action === 'select-runbook-profile') {
    const session = state.sessions.get(button.dataset.sessionId);
    if (!session) return;
    const context = await api(`/api/ssh/sessions/${session.id}/runbook-profile`, {
      body: { profileId: button.dataset.profileId },
      method: 'POST',
    });
    session.runbookProfile = context.profile;
    session.runbooks = context.runbooks;
    session.runbooksState = 'loaded';
    renderSessionChrome();
    toast(`Runbook ${context.profile.vendorLabel} selecionado para esta sessão.`);
  } else if (action === 'start-runbook') {
    const session = state.sessions.get(button.dataset.sessionId);
    if (!session || session.snapshotCapture !== undefined) return;
    const runbook = session.runbooks.find((candidate) => candidate.id === button.dataset.runbookId);
    if (!runbook || runbook.kind !== 'diagnostic') return;
    await api(`/api/ssh/sessions/${session.id}/runbooks/${encodeURIComponent(runbook.id)}`, {
      method: 'POST',
    });
    session.terminal.focus();
    toast(`${runbook.name}: comando enviado para a sessão.`);
  } else if (action === 'start-snapshot') {
    const session = state.sessions.get(button.dataset.sessionId);
    if (!session || !session.deviceId || session.snapshotCapture !== undefined) return;
    const runbook = session.runbooks.find((candidate) => candidate.id === button.dataset.runbookId);
    if (!runbook || runbook.kind !== 'snapshot') return;
    session.snapshotCapture = {
      commandsSent: false,
      id: runbook.id,
      output: '',
      truncated: false,
    };
    renderSessionChrome();
    try {
      await api(
        `/api/ssh/sessions/${session.id}/runbooks/${encodeURIComponent(runbook.id)}`,
        { method: 'POST' },
      );
      toast('Coleta iniciada. Finalize quando o prompt retornar para salvar o snapshot.');
    } catch (error) {
      session.snapshotCapture = undefined;
      renderSessionChrome();
      throw error;
    }
  } else if (action === 'finish-snapshot-capture') {
    const session = state.sessions.get(button.dataset.sessionId ?? state.activeSessionId);
    if (!session?.snapshotCapture || !session.deviceId) return;
    const capture = session.snapshotCapture;
    session.snapshotCapture = undefined;
    capture.output = sanitizeCapturedOutput(capture.output).replace(/^\n+|\n+$/gu, '');
    renderSessionChrome();
    if (capture.output === '') {
      toast('Nenhuma configuração foi capturada para o snapshot.', 'error');
      return;
    }
    if (capture.truncated) {
      toast('Snapshot descartado: a captura ultrapassou 2 MiB e ficou incompleta.', 'error');
      return;
    }
    const name = `Snapshot · ${new Date().toLocaleString('pt-BR')}`;
    await api('/api/configuration-snapshots', {
      body: { content: capture.output, deviceId: session.deviceId, name, source: 'runbook' },
      method: 'POST',
    });
    toast(`${name} salvo no banco local.`);
  } else if (action === 'view-snapshot') {
    openSnapshotViewer(await api(`/api/configuration-snapshots/${button.dataset.snapshotId}`));
  } else if (action === 'delete-snapshot') {
    const snapshot = state.snapshots.find((item) => item.id === button.dataset.snapshotId);
    if (snapshot && window.confirm(`Excluir o snapshot “${snapshot.name}”?`)) {
      await api(`/api/configuration-snapshots/${snapshot.id}`, { method: 'DELETE' });
      await loadSnapshots();
      toast('Snapshot excluído.');
    }
  } else if (action === 'compare-snapshots') {
    const leftId = document.querySelector('#snapshot-left').value;
    const rightId = document.querySelector('#snapshot-right').value;
    if (!leftId || !rightId || leftId === rightId) {
      toast('Selecione dois snapshots diferentes do mesmo dispositivo.', 'error');
      return;
    }
    state.snapshotComparison = await api('/api/configuration-snapshots/compare', {
      body: { leftId, rightId },
      method: 'POST',
    });
    render();
  } else if (action === 'start-recording') {
    const session = activeSession();
    if (session) {
      const updated = await api(`/api/ssh/sessions/${session.id}/recording/start`, { method: 'POST' });
      session.recordingState = updated.recordingState;
      session.recordingPath = updated.recordingPath;
      renderSessionChrome();
    }
  } else if (action === 'stop-recording') {
    const session = activeSession();
    if (session && window.confirm('Finalizar a gravação desta sessão?')) {
      const updated = await api(`/api/ssh/sessions/${session.id}/recording/stop`, { method: 'POST' });
      session.recordingState = updated.recordingState;
      renderSessionChrome();
    }
  } else if (action === 'refresh-history') {
    await loadHistory();
  } else if (action === 'run-health-check') {
    await runHealthChecks([button.dataset.deviceId]);
  } else if (action === 'run-selected-health-checks') {
    await runHealthChecks([...state.selected]);
  } else if (action === 'save-settings') {
    const form = document.querySelector('#settings-form');
    const values = Object.fromEntries(new FormData(form));
    state.settings = await api('/api/settings', {
      body: {
        copyOnSelect: form.elements.copyOnSelect.checked,
        highlightKeywords: values.highlightKeywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        idleDisconnectMinutes: Number(values.idleDisconnectMinutes),
        pasteDelayMs: Number(values.pasteDelayMs),
        recordingDefault: form.elements.recordingDefault.checked,
        rightClickPaste: form.elements.rightClickPaste.checked,
        terminalFontSize: Number(values.terminalFontSize),
        terminalScrollback: Number(values.terminalScrollback),
        theme: values.theme,
      },
      method: 'PUT',
    });
    state.historySettings.recordingDefault = state.settings.recordingDefault;
    applySettings();
    render();
    toast('Configurações salvas.');
  } else if (action === 'create-backup') {
    await api('/api/backups/create', { method: 'POST' });
    await loadBackups();
    render();
    toast('Backup manual criado.');
  } else if (action === 'restore-backup') {
    if (
      window.confirm(
        `Restaurar ${button.dataset.backupName} no próximo início? O estado atual será preservado em um backup de emergência.`,
      )
    ) {
      await api('/api/backups/restore', {
        body: { name: button.dataset.backupName },
        method: 'POST',
      });
      await loadBackups();
      render();
      toast('Restauração agendada. Feche e inicie o NetRunner novamente.');
    }
  } else if (action === 'remove-host-key' || action === 'remove-certificate') {
    const label = action === 'remove-host-key' ? 'host key' : 'certificado fixado';
    if (window.confirm(`Remover esta ${label}? A próxima conexão exigirá nova confirmação.`)) {
      const resource = action === 'remove-host-key' ? 'host-keys' : 'certificates';
      await api(`/api/security/${resource}/${button.dataset.trustId}`, { method: 'DELETE' });
      await loadTrustMaterial();
      render();
      toast('Confiança removida.');
    }
  } else if (['verify-log', 'open-log', 'reveal-log'].includes(action)) {
    const operation = { 'open-log': 'open', 'reveal-log': 'reveal', 'verify-log': 'verify' }[action];
    const result = await api(`/api/history/${button.dataset.historyId}/${operation}`, { method: 'POST' });
    if (operation === 'verify') {
      toast(
        result.status === 'valid' ? 'Integridade SHA-256 confirmada.' : `Falha de integridade: ${result.status}.`,
        result.status === 'valid' ? 'success' : 'error',
      );
    }
  }
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  const filterButton = event.target.closest('[data-filter]');
  const locationButton = event.target.closest('[data-location-id]:not([data-action])');
  const actionButton = event.target.closest('[data-action]');
  try {
    if (viewButton) {
      viewButton.closest('details')?.removeAttribute('open');
      await navigateToView(viewButton.dataset.view);
    } else if (filterButton) {
      state.filter = state.filter === filterButton.dataset.filter ? 'all' : filterButton.dataset.filter;
      state.locationId = undefined;
      await loadInventory();
    } else if (locationButton) {
      state.locationId = state.locationId === locationButton.dataset.locationId ? undefined : locationButton.dataset.locationId;
      state.filter = 'all';
      state.view = 'devices';
      await loadInventory();
    } else if (actionButton) {
      await handleAction(actionButton);
    }
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.addEventListener('dblclick', async (event) => {
  const row = event.target.closest('tr[data-device-id]');
  if (!row || event.target.closest('button, input, a')) return;
  const device = state.devices.find((item) => item.id === row.dataset.deviceId);
  if (device?.sshEnabled) openConnectionDialog(device);
  else if (device?.httpsEnabled) {
    try {
      await openHttpsDialog(device);
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-select-device]')) {
    if (event.target.checked) state.selected.add(event.target.dataset.selectDevice);
    else state.selected.delete(event.target.dataset.selectDevice);
    render();
  } else if (event.target.id === 'select-all') {
    state.selected.clear();
    if (event.target.checked) {
      const selectableDevices = state.view === 'health' ? state.devices.slice(0, 20) : state.devices;
      selectableDevices.forEach((device) => state.selected.add(device.id));
    }
    render();
  } else if (event.target.id === 'bulk-field') {
    state.bulkField = event.target.value;
    renderBulkToolbar();
  } else if (event.target.id === 'history-recording-default') {
    void api('/api/settings', {
      body: { recordingDefault: event.target.checked },
      method: 'PUT',
    })
      .then((settings) => {
        state.settings = settings;
        state.historySettings.recordingDefault = settings.recordingDefault;
        toast('Preferência de gravação atualizada.');
      })
      .catch((error) => toast(error.message, 'error'));
  } else if (event.target.id === 'snapshot-device') {
    void loadSnapshots(event.target.value).catch((error) => toast(error.message, 'error'));
  }
});

document.addEventListener('dragstart', (event) => {
  const device = event.target.closest('[data-device-id]');
  const location = event.target.closest('[data-location-drag-id]');
  const payload = device
    ? { id: device.dataset.deviceId, type: 'device' }
    : location
      ? { id: location.dataset.locationDragId, type: 'location' }
      : undefined;
  if (payload) event.dataTransfer.setData('application/x-netrunner', JSON.stringify(payload));
});

document.addEventListener('dragover', (event) => {
  const target = event.target.closest('[data-drop-location]');
  if (target) {
    event.preventDefault();
    target.classList.add('is-drop-target');
  }
});

document.addEventListener('dragleave', (event) => {
  event.target.closest('[data-drop-location]')?.classList.remove('is-drop-target');
});

document.addEventListener('drop', async (event) => {
  const target = event.target.closest('[data-drop-location]');
  if (!target) return;
  event.preventDefault();
  target.classList.remove('is-drop-target');
  try {
    const payload = JSON.parse(event.dataTransfer.getData('application/x-netrunner'));
    if (payload.type === 'device') {
      await api(`/api/devices/${payload.id}`, {
        body: { locationId: target.dataset.dropLocation },
        method: 'PUT',
      });
      toast('Dispositivo movido.');
    } else if (payload.type === 'location' && payload.id !== target.dataset.dropLocation) {
      await api(`/api/locations/${payload.id}`, {
        body: { parentId: target.dataset.dropLocation },
        method: 'PUT',
      });
      toast('Hierarquia atualizada.');
    }
    await loadInventory();
  } catch (error) {
    toast(error.message, 'error');
  }
});

elements.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    state.search = elements.search.value.trim();
    state.locationId = undefined;
    state.filter = 'all';
    try {
      await loadInventory();
    } catch (error) {
      toast(error.message, 'error');
    }
  }, 180);
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommandPalette();
  } else if (event.metaKey && event.key === ',') {
    event.preventDefault();
    state.view = 'settings';
    void loadBackups()
      .then(render)
      .catch((error) => toast(error.message, 'error'));
  } else if (event.metaKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    openQuickConnectionDialog();
  } else if (event.metaKey && /^[1-9]$/u.test(event.key)) {
    const session = [...state.sessions.values()][Number(event.key) - 1];
    if (session) {
      event.preventDefault();
      showSession(session.id);
    }
  } else if (event.metaKey && event.key.toLowerCase() === 'w' && state.view === 'terminal') {
    event.preventDefault();
    const session = activeSession();
    if (session) {
      const closeControl = document.createElement('button');
      closeControl.dataset.action = 'close-session';
      closeControl.dataset.sessionId = session.id;
      void handleAction(closeControl);
    }
  } else if (event.key === 'Enter') {
    const row = event.target.closest?.('tr[data-device-id]');
    if (row) {
      const device = state.devices.find((item) => item.id === row.dataset.deviceId);
      if (device?.sshEnabled) openConnectionDialog(device);
      else if (device?.httpsEnabled) void openHttpsDialog(device).catch((error) => toast(error.message, 'error'));
    }
  }
});

elements.commandSearch.addEventListener('input', () => {
  renderCommandPalette(elements.commandSearch.value);
});

elements.commandSearch.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveCommandSelection(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    const selected = elements.commandResults.querySelector('.command-item.is-selected');
    if (selected) {
      event.preventDefault();
      void executeCommand(selected).catch((error) => toast(error.message, 'error'));
    }
  }
});

elements.dialogForm.addEventListener('submit', submitEditor);
elements.dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  const closeControl = document.createElement('button');
  closeControl.dataset.action = 'close-dialog';
  void handleAction(closeControl).catch((error) => toast(error.message, 'error'));
});

window.addEventListener('beforeunload', (event) => {
  if ([...state.sessions.values()].some((session) => ['connected', 'connecting'].includes(session.state))) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('pagehide', () => {
  pageClosing = true;
  browserLifecycleController?.abort();
});

async function start() {
  sessionToken = consumeSessionToken();
  if (sessionToken === null || sessionToken.length < 32) {
    setRuntimeStatus('error', 'Sessão inválida · reinicie o NetRunner');
    elements.content.innerHTML = '<div class="error-state">A sessão local expirou. Feche esta aba e inicie o NetRunner novamente.</div>';
    return;
  }
  void maintainBrowserLifecycle();
  try {
    state.health = await api('/api/health');
    state.settings = await api('/api/settings');
    state.historySettings = {
      ...(await api('/api/history/settings')),
      recordingDefault: state.settings.recordingDefault,
    };
    await Promise.all([loadBackups(), loadTrustMaterial()]);
    applySettings();
    setRuntimeStatus('ready', `Somente neste Mac · v${state.health.version}`);
    await loadInventory();
  } catch (error) {
    setRuntimeStatus('error', 'Serviço local indisponível');
    elements.content.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

void start();
