import { randomUUID } from 'node:crypto';
import ssh2 from 'ssh2';
import { ApplicationError, ConflictError, NotFoundError } from '../errors.mjs';
import { normalizeNetworkAddress } from '../validation.mjs';
import { resolveAlgorithmProfile } from './algorithm-profiles.mjs';
import {
  runbookFamilyById,
  runbookFamilyForDevice,
  runbookForDevice,
  runbooksForDevice,
} from '../runbooks/runbook-catalog.mjs';

const MAX_ACTIVE_SESSIONS = 20;
const MAX_EVENT_HISTORY = 4000;
const HOST_KEY_DECISION_TIMEOUT = 60_000;
const PROMPT_DECISION_TIMEOUT = 120_000;
const MAX_RECOVERABLE_OUTPUT_BYTES = 2 * 1024 * 1024;

function boundedInteger(value, fallback, minimum, maximum, field) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new ApplicationError('Validation failed', {
      code: 'validation_error',
      details: { field, message: `must be an integer between ${minimum} and ${maximum}` },
      statusCode: 422,
    });
  }
  return candidate;
}

function connectionString(value, field, maximumLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maximumLength || (!allowEmpty && value.length === 0)) {
    throw new ApplicationError('Validation failed', {
      code: 'validation_error',
      details: { field, message: `must be a string with at most ${maximumLength} characters` },
      statusCode: 422,
    });
  }
  return value;
}

function safePromptText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .slice(0, 2000);
}

function errorCodeFor(error) {
  if (error.level === 'client-authentication') return 'authentication_failed';
  if (error.level === 'handshake') return 'handshake_failed';
  if (/timed out/iu.test(error.message)) return 'connection_timeout';
  if (/host key|verification/iu.test(error.message)) return 'host_key_rejected';
  return 'connection_failed';
}

class SessionEvents {
  constructor() {
    this.events = [];
    this.sequence = 0;
    this.waiters = new Set();
  }

  emit(type, payload = {}) {
    const event = Object.freeze({ payload, sequence: ++this.sequence, type });
    this.events.push(event);
    if (this.events.length > MAX_EVENT_HISTORY) this.events.shift();
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
    return event;
  }

  async poll(after, timeout = 20_000) {
    const read = () => this.events.filter((event) => event.sequence > after);
    let available = read();
    if (available.length > 0) return available;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve();
      }, timeout);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
    });
    available = read();
    return available;
  }
}

class SshSession {
  constructor({ columns, device, hostKeys, id, idleDisconnectMinutes, onConnected, password, record, recordingService, rows, ticket, username }) {
    this.client = new ssh2.Client();
    this.columns = columns;
    this.createdAt = new Date().toISOString();
    this.debugHandshake = [];
    this.device = device;
    this.events = new SessionEvents();
    this.hostKeys = hostKeys;
    this.id = id;
    this.password = password;
    this.onConnected = onConnected;
    this.passwordUsed = false;
    this.rows = rows;
    this.state = 'connecting';
    this.stream = undefined;
    this.username = username;
    this.ticket = ticket;
    this.recordRequested = record;
    this.recordingService = recordingService;
    this.recordingState = record ? 'starting' : 'off';
    this.recordingPath = null;
    this.outputBuffer = [];
    this.outputBufferBytes = 0;
    this.recorder = undefined;
    this.recordingStartPromise = undefined;
    this.finishPromise = undefined;
    this.hostFingerprint = undefined;
    this.negotiatedAlgorithms = undefined;
    this.idleDisconnectMinutes = idleDisconnectMinutes;
    this.idleTimer = undefined;
    this.finished = false;
    this.pendingHostKey = undefined;
    this.pendingPrompt = undefined;
    this.runbookProfileId = undefined;
  }

  publicState() {
    return {
      address: this.device.address,
      algorithmProfile: this.device.algorithmProfile,
      createdAt: this.createdAt,
      deviceId: this.device.id,
      deviceType: this.device.deviceType,
      encoding: this.device.encoding,
      hostname: this.device.hostname,
      id: this.id,
      locationPath: this.device.locationPath,
      port: this.device.sshPort,
      recordingPath: this.recordingPath,
      recordingState: this.recordingState,
      state: this.state,
      ticket: this.ticket,
      username: this.username,
      vendor: this.device.vendor,
    };
  }

  start() {
    this.#resetIdleTimer();
    if (this.recordRequested) void this.startRecording({ recovered: false });
    this.events.emit('status', { stage: 'tcp', state: 'connecting' });
    this.client.on('banner', (message) => {
      this.#emitOutput(Buffer.from(message));
    });
    this.client.on('change password', (prompt, done) => {
      this.#handleInteractivePrompts(
        'Alteração de senha solicitada',
        'O servidor exige uma nova senha antes de concluir a autenticação.',
        [{ echo: false, prompt }],
        (answers) => done(answers[0] ?? ''),
      );
    });
    this.client.on('handshake', (negotiated) => {
      const algorithms = {
        cipher: negotiated.sc.cipher,
        hostKey: negotiated.srvHostKey,
        kex: negotiated.kex,
        mac: negotiated.sc.mac || 'integrado à cifra',
      };
      this.negotiatedAlgorithms = algorithms;
      this.events.emit('handshake', algorithms);
      this.recorder?.security({ algorithms });
      this.recordingService?.history.updateSecurity(this.id, { algorithms });
    });
    this.client.on('ready', () => this.#openShell());
    this.client.on('error', (error) => this.#fail(error));
    this.client.on('end', () => this.#finish('remote_end', 'O equipamento encerrou a conexão.'));
    this.client.on('close', () => this.#finish('connection_closed', 'Conexão encerrada.'));

    const algorithms = resolveAlgorithmProfile(
      this.device.algorithmProfile,
      this.device.customAlgorithms,
    );
    try {
      this.client.connect({
        algorithms,
        authHandler: (methodsLeft, partialSuccess, callback) =>
          this.#chooseAuthentication(methodsLeft, partialSuccess, callback),
        debug: (line) => this.#captureHandshakeDiagnostic(line),
        host: this.device.address,
        hostVerifier: (key, callback) => this.#verifyHostKey(key, callback),
        keepaliveCountMax: this.device.keepaliveLimit,
        keepaliveInterval: this.device.keepaliveInterval * 1000,
        port: this.device.sshPort,
        readyTimeout: this.device.connectTimeout * 1000,
        username: this.username,
      });
    } catch (error) {
      this.#fail(error);
    }
  }

  #captureHandshakeDiagnostic(line) {
    if (/^Handshake: \(remote\)|^Handshake: (?:N|n)o matching/iu.test(line)) {
      this.debugHandshake.push(line.slice(0, 4000));
      if (this.debugHandshake.length > 12) this.debugHandshake.shift();
    }
  }

  #verifyHostKey(key, callback) {
    const inspection = this.hostKeys.inspect({
      deviceId: this.device.id,
      host: this.device.address,
      key,
      port: this.device.sshPort,
    });
    this.hostFingerprint = inspection.candidate.fingerprint;
    this.recorder?.security({ hostFingerprint: inspection.candidate.fingerprint });
    this.recordingService?.history.updateSecurity(this.id, {
      hostFingerprint: inspection.candidate.fingerprint,
    });
    if (inspection.status === 'trusted') {
      this.events.emit('status', { stage: 'host-key', state: 'trusted' });
      callback(true);
      return;
    }
    this.state = 'awaiting_host_key';
    const timer = setTimeout(() => {
      if (this.pendingHostKey?.inspection === inspection) {
        this.pendingHostKey = undefined;
        callback(false);
        this.#finish('host_key_timeout', 'A confirmação da host key expirou.');
      }
    }, HOST_KEY_DECISION_TIMEOUT);
    this.pendingHostKey = { callback, inspection, timer };
    this.events.emit('host-key', {
      fingerprint: inspection.candidate.fingerprint,
      keyType: inspection.candidate.keyType,
      previousFingerprint: inspection.known?.fingerprint,
      previousKeyType: inspection.known?.keyType,
      status: inspection.status,
    });
  }

  decideHostKey({ accept, fingerprint, replace = false }) {
    this.#resetIdleTimer();
    if (this.pendingHostKey === undefined) {
      throw new ConflictError('This session is not waiting for a host key decision');
    }
    const pending = this.pendingHostKey;
    if (fingerprint !== pending.inspection.candidate.fingerprint) {
      throw new ConflictError('Host key decision does not match the pending fingerprint');
    }
    if (pending.inspection.status === 'changed' && accept && !replace) {
      throw new ConflictError('A changed host key requires explicit replacement');
    }
    clearTimeout(pending.timer);
    this.pendingHostKey = undefined;
    if (accept) {
      this.hostKeys.trust(pending.inspection.candidate, { replace });
      this.state = 'connecting';
      this.events.emit('status', { stage: 'host-key', state: replace ? 'replaced' : 'trusted' });
      pending.callback(true);
    } else {
      pending.callback(false);
      this.#finish('host_key_rejected', 'Host key rejeitada pelo usuário.');
    }
  }

  #chooseAuthentication(methodsLeft, partialSuccess, callback) {
    if (methodsLeft === null) {
      callback({ type: 'none', username: this.username });
      return;
    }
    if (partialSuccess || this.passwordUsed || this.device.loginMode === 'shell') {
      this.#clearPassword();
      callback(false);
      return;
    }
    if (methodsLeft.includes('keyboard-interactive')) {
      this.passwordUsed = true;
      callback({
        prompt: (name, instructions, instructionsLanguage, prompts, finish) =>
          this.#handleInteractivePrompts(name, instructions, prompts, finish),
        type: 'keyboard-interactive',
        username: this.username,
      });
      return;
    }
    if (methodsLeft.includes('password')) {
      this.passwordUsed = true;
      const password = this.password;
      this.#clearPassword();
      callback({ password, type: 'password', username: this.username });
      return;
    }
    this.#clearPassword();
    callback(false);
  }

  #handleInteractivePrompts(name, instructions, prompts, finish) {
    const answers = Array(prompts.length).fill(undefined);
    let passwordIndex = -1;
    if (this.password !== undefined) passwordIndex = prompts.findIndex((prompt) => !prompt.echo);
    if (passwordIndex >= 0) {
      answers[passwordIndex] = this.password;
      this.#clearPassword();
    }
    const pendingIndices = answers
      .map((answer, index) => (answer === undefined ? index : -1))
      .filter((index) => index >= 0);
    if (pendingIndices.length === 0) {
      finish(answers);
      answers.fill('');
      return;
    }

    const promptId = randomUUID();
    const timer = setTimeout(() => {
      if (this.pendingPrompt?.id === promptId) {
        this.pendingPrompt = undefined;
        finish([]);
        this.#finish('prompt_timeout', 'A resposta de autenticação expirou.');
      }
    }, PROMPT_DECISION_TIMEOUT);
    this.pendingPrompt = { answers, finish, id: promptId, pendingIndices, timer };
    this.events.emit('authentication-prompts', {
      instructions: safePromptText(instructions),
      name: safePromptText(name),
      promptId,
      prompts: pendingIndices.map((index) => ({
        echo: Boolean(prompts[index].echo),
        prompt: safePromptText(prompts[index].prompt),
      })),
    });
  }

  respondToPrompts(promptId, submittedAnswers) {
    this.#resetIdleTimer();
    const pending = this.pendingPrompt;
    if (pending === undefined || pending.id !== promptId) {
      throw new ConflictError('Authentication prompt is no longer active');
    }
    if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== pending.pendingIndices.length) {
      throw new ApplicationError('Validation failed', {
        code: 'validation_error',
        details: { field: 'answers', message: 'answer count does not match the active prompts' },
        statusCode: 422,
      });
    }
    submittedAnswers.forEach((answer, offset) => {
      pending.answers[pending.pendingIndices[offset]] = connectionString(
        answer,
        `answers.${offset}`,
        1024,
        { allowEmpty: true },
      );
    });
    clearTimeout(pending.timer);
    this.pendingPrompt = undefined;
    pending.finish([...pending.answers]);
    pending.answers.fill('');
  }

  #openShell() {
    this.#clearPassword();
    this.state = 'opening_shell';
    this.events.emit('status', { stage: 'authentication', state: 'authenticated' });
    this.client.shell(
      {
        cols: this.columns,
        rows: this.rows,
        term: this.device.terminalType,
      },
      (error, stream) => {
        if (error) {
          this.#fail(error);
          return;
        }
        this.stream = stream;
        this.state = 'connected';
        this.onConnected();
        this.events.emit('status', { stage: 'shell', state: 'connected' });
        this.#recordAppEvent('Shell SSH conectado.');
        stream.on('data', (data) => this.#emitOutput(data));
        stream.stderr.on('data', (data) => this.#emitOutput(data));
        stream.on('close', () => this.#finish('shell_closed', 'Shell remoto encerrado.'));
        stream.on('error', (streamError) => this.#fail(streamError));
        if (this.device.postLoginEnabled && this.device.postLoginCommand) {
          this.events.emit('app-message', {
            message: `Executando comando de sessão aprovado: ${this.device.postLoginCommand}`,
          });
          this.#recordAppEvent(
            `Executando comando de sessão aprovado: ${this.device.postLoginCommand}`,
          );
          stream.write(`${this.device.postLoginCommand}\r`);
        }
      },
    );
  }

  #emitOutput(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.#rememberOutput(buffer);
    if (this.recorder !== undefined) {
      const normalizedInput =
        this.device.encoding === 'iso-8859-1' ? buffer.toString('latin1') : buffer;
      void this.recorder.output(normalizedInput);
    }
    if (this.device.encoding === 'iso-8859-1') {
      this.events.emit('output', { data: buffer.toString('latin1'), encoding: 'text' });
    } else {
      this.events.emit('output', { data: buffer.toString('base64'), encoding: 'base64' });
    }
  }

  write(data) {
    if (this.state !== 'connected' || this.stream === undefined) {
      throw new ConflictError('SSH shell is not connected');
    }
    const input = connectionString(data, 'data', 65_536, { allowEmpty: true });
    this.#resetIdleTimer();
    const backspaceAdjusted =
      this.device.backspaceMode === 'bs' ? input.replaceAll('\u007f', '\u0008') : input;
    this.stream.write(
      this.device.encoding === 'iso-8859-1'
        ? Buffer.from(backspaceAdjusted, 'latin1')
        : backspaceAdjusted,
    );
  }

  async executeRunbook(runbook) {
    if (this.state !== 'connected' || this.stream === undefined) {
      throw new ConflictError('SSH shell is not connected');
    }
    this.events.emit('runbook', {
      id: runbook.id,
      kind: runbook.kind,
      name: runbook.name,
      state: 'started',
    });
    this.#recordAppEvent(`Runbook iniciado: ${runbook.name}.`);
    for (const command of runbook.commands) {
      this.write(`${command}\r`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    this.events.emit('runbook', {
      id: runbook.id,
      kind: runbook.kind,
      name: runbook.name,
      state: 'commands_sent',
    });
    return {
      commandsSent: runbook.commands.length,
      id: runbook.id,
      kind: runbook.kind,
      name: runbook.name,
    };
  }

  resize(columns, rows) {
    this.columns = boundedInteger(columns, this.columns, 20, 500, 'columns');
    this.rows = boundedInteger(rows, this.rows, 5, 300, 'rows');
    if (this.stream !== undefined) this.stream.setWindow(this.rows, this.columns, 0, 0);
    if (this.recorder !== undefined) void this.recorder.resize(this.columns, this.rows);
  }

  setIdleDisconnectMinutes(minutes) {
    this.idleDisconnectMinutes = minutes;
    this.#resetIdleTimer();
  }

  async startRecording({ recovered = true } = {}) {
    if (this.recordingService === undefined) {
      throw new ConflictError('Session recording is unavailable');
    }
    if (this.recordingState === 'active') return this.publicState();
    if (this.recordingState === 'stopped') {
      throw new ConflictError('Recording was already finalized for this session');
    }
    if (this.recordingState === 'error') this.recordingStartPromise = undefined;
    if (this.recordingStartPromise !== undefined) {
      await this.recordingStartPromise;
      return this.publicState();
    }
    this.recordingState = 'starting';
    this.events.emit('recording', { state: 'starting' });
    this.recordingStartPromise = (async () => {
      try {
        const recorder = await this.recordingService.createRecorder(this.#recordingMetadata(), {
          columns: this.columns,
          rows: this.rows,
        });
        const buffered = Buffer.concat(this.outputBuffer);
        this.recorder = recorder;
        this.recordingPath = recorder.logPath;
        recorder.security({
          algorithms: this.negotiatedAlgorithms,
          hostFingerprint: this.hostFingerprint,
        });
        if (recovered) {
          await recorder.event(
            'Gravação iniciada durante a sessão; o conteúdo anterior foi recuperado do buffer de saída.',
          );
        } else {
          await recorder.event('Gravação iniciada antes da autenticação.');
        }
        if (buffered.length > 0) {
          await recorder.output(
            this.device.encoding === 'iso-8859-1' ? buffered.toString('latin1') : buffered,
          );
        }
        this.recordingState = 'active';
        this.events.emit('recording', { path: this.recordingPath, state: 'active' });
      } catch (error) {
        this.recordingState = 'error';
        this.events.emit('recording', {
          message: 'Não foi possível iniciar a gravação desta sessão.',
          state: 'error',
        });
      }
    })();
    await this.recordingStartPromise;
    return this.publicState();
  }

  async stopRecording() {
    await this.recordingStartPromise;
    if (this.recorder === undefined || this.recordingState !== 'active') {
      throw new ConflictError('This session is not being recorded');
    }
    await this.recorder.event('Gravação interrompida pelo usuário.');
    await this.recorder.finalize('recording_stopped', new Date());
    this.recorder = undefined;
    this.recordingState = 'stopped';
    this.events.emit('recording', { path: this.recordingPath, state: 'stopped' });
    return this.publicState();
  }

  async poll(after) {
    const safeAfter = boundedInteger(Number(after), 0, 0, Number.MAX_SAFE_INTEGER, 'after');
    return this.events.poll(safeAfter);
  }

  close(reason = 'user_closed') {
    if (this.pendingHostKey !== undefined) {
      clearTimeout(this.pendingHostKey.timer);
      this.pendingHostKey.callback(false);
      this.pendingHostKey = undefined;
    }
    if (this.pendingPrompt !== undefined) {
      clearTimeout(this.pendingPrompt.timer);
      this.pendingPrompt.finish([]);
      this.pendingPrompt.answers.fill('');
      this.pendingPrompt = undefined;
    }
    this.stream?.close();
    this.client.end();
    return this.#finish(reason, 'Sessão encerrada pelo usuário.');
  }

  #clearPassword() {
    this.password = undefined;
  }

  #fail(error) {
    if (this.finished) return;
    const code = errorCodeFor(error);
    const diagnostic = code === 'handshake_failed' ? [...this.debugHandshake] : undefined;
    this.events.emit('error', {
      code,
      diagnostic,
      message:
        code === 'authentication_failed'
          ? 'Autenticação recusada. Verifique o username, a senha e o método oferecido.'
          : code === 'handshake_failed'
            ? 'Não foi possível negociar algoritmos SSH com o equipamento.'
            : code === 'connection_timeout'
              ? 'O tempo limite da conexão SSH foi atingido.'
              : 'A conexão SSH falhou.',
    });
    this.#finish(code, 'Conexão encerrada após erro.');
  }

  #finish(reason, message) {
    if (this.finished) return this.finishPromise;
    this.finished = true;
    clearTimeout(this.idleTimer);
    this.#clearPassword();
    this.state = 'disconnected';
    this.events.emit('ended', { message, reason });
    const endedAt = new Date();
    this.finishPromise = (async () => {
      try {
        await this.recordingStartPromise;
        if (this.recorder !== undefined) {
          await this.recorder.event(`Sessão encerrada: ${reason}.`);
          await this.recorder.finalize(reason, endedAt);
          this.recorder = undefined;
          this.recordingState = 'stopped';
        }
      } finally {
        this.recordingService?.finishSession(this.id, {
          endedAt: endedAt.toISOString(),
          reason,
          startedAt: this.createdAt,
        });
      }
    })();
    return this.finishPromise;
  }

  #rememberOutput(buffer) {
    this.outputBuffer.push(Buffer.from(buffer));
    this.outputBufferBytes += buffer.length;
    while (this.outputBufferBytes > MAX_RECOVERABLE_OUTPUT_BYTES && this.outputBuffer.length > 1) {
      this.outputBufferBytes -= this.outputBuffer.shift().length;
    }
  }

  #recordAppEvent(message) {
    if (this.recorder !== undefined) void this.recorder.event(message);
  }

  #recordingMetadata() {
    return {
      address: this.device.address,
      deviceId: this.device.id,
      deviceType: this.device.deviceType,
      hostname: this.device.hostname,
      id: this.id,
      locationPath: this.device.locationPath,
      port: this.device.sshPort,
      startedAt: this.createdAt,
      ticket: this.ticket,
      username: this.username,
      vendor: this.device.vendor,
    };
  }

  #resetIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.finished || this.idleDisconnectMinutes <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.stream?.close();
      this.client.end();
      this.#finish('idle_timeout', 'Sessão encerrada por inatividade conforme as Configurações.');
    }, this.idleDisconnectMinutes * 60_000);
    this.idleTimer.unref();
  }
}

export class SshSessionManager {
  constructor({ hostKeys, inventory, recordingService, settings }) {
    this.hostKeys = hostKeys;
    this.inventory = inventory;
    this.recordingService = recordingService;
    this.idleDisconnectMinutes = settings?.getAll().idleDisconnectMinutes ?? 0;
    this.sessions = new Map();
    this.unsubscribeSettings = settings?.onChange((updated) => {
      this.idleDisconnectMinutes = updated.idleDisconnectMinutes;
      for (const session of this.sessions.values()) {
        session.setIdleDisconnectMinutes(this.idleDisconnectMinutes);
      }
    });
  }

  create(input) {
    const activeCount = [...this.sessions.values()].filter((session) => !session.finished).length;
    if (activeCount >= MAX_ACTIVE_SESSIONS) {
      throw new ConflictError(`No more than ${MAX_ACTIVE_SESSIONS} SSH sessions may be active`);
    }
    const device =
      input.deviceId === undefined || input.deviceId === null
        ? this.#quickDevice(input.quick)
        : this.inventory.getDevice(input.deviceId);
    if (!device.sshEnabled) throw new ConflictError('SSH is disabled for this device');
    const username = connectionString(input.username ?? device.username, 'username', 128);
    const password =
      device.loginMode === 'shell'
        ? undefined
        : connectionString(input.password, 'password', 1024);
    const ticket =
      input.ticket === undefined || input.ticket === null || input.ticket === ''
        ? null
        : connectionString(input.ticket, 'ticket', 120);
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const session = new SshSession({
      columns: boundedInteger(input.columns, 100, 20, 500, 'columns'),
      device,
      hostKeys: this.hostKeys,
      id,
      idleDisconnectMinutes: this.idleDisconnectMinutes,
      onConnected: () => {
        if (device.id !== null) this.inventory.markDeviceConnected(device.id);
      },
      password,
      record: input.record === true,
      recordingService: this.recordingService,
      rows: boundedInteger(input.rows, 30, 5, 300, 'rows'),
      ticket,
      username,
    });
    session.createdAt = startedAt;
    this.recordingService?.beginSession({
      address: device.address,
      deviceId: device.id,
      deviceType: device.deviceType,
      hostname: device.hostname,
      id,
      locationPath: device.locationPath,
      port: device.sshPort,
      startedAt,
      ticket,
      username,
      vendor: device.vendor,
    });
    this.sessions.set(session.id, session);
    session.start();
    return session.publicState();
  }

  #quickDevice(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new ApplicationError('Validation failed', {
        code: 'validation_error',
        details: { field: 'quick', message: 'quick connection details are required' },
        statusCode: 422,
      });
    }
    const { address } = normalizeNetworkAddress(input.address);
    const algorithmProfile = ['modern', 'legacy'].includes(input.algorithmProfile)
      ? input.algorithmProfile
      : 'modern';
    const loginMode = input.loginMode === 'shell' ? 'shell' : 'standard';
    return {
      address,
      algorithmProfile,
      backspaceMode: input.backspaceMode === 'bs' ? 'bs' : 'del',
      connectTimeout: boundedInteger(input.connectTimeout, 20, 1, 300, 'connectTimeout'),
      customAlgorithms: null,
      deviceType: 'other',
      encoding: input.encoding === 'iso-8859-1' ? 'iso-8859-1' : 'utf-8',
      hostname: address,
      id: null,
      keepaliveInterval: 0,
      keepaliveLimit: 3,
      locationPath: 'Conexões avulsas',
      loginMode,
      postLoginCommand: null,
      postLoginEnabled: false,
      sshEnabled: true,
      sshPort: boundedInteger(input.port, 22, 1, 65_535, 'port'),
      terminalType: ['xterm-256color', 'xterm', 'vt100', 'vt220'].includes(input.terminalType)
        ? input.terminalType
        : 'xterm-256color',
      username: connectionString(input.username, 'username', 128),
      vendor: 'other',
    };
  }

  get(id) {
    const session = this.sessions.get(id);
    if (session === undefined) throw new NotFoundError('SSH session');
    return session;
  }

  list() {
    return [...this.sessions.values()].map((session) => session.publicState());
  }

  listRunbooks(id) {
    const session = this.get(id);
    const profile = session.runbookProfileId === undefined
      ? runbookFamilyForDevice(session.device)
      : runbookFamilyById(session.runbookProfileId);
    return {
      profile: profile ?? null,
      runbooks: runbooksForDevice(session.device, session.runbookProfileId),
    };
  }

  selectRunbookProfile(id, profileId) {
    const session = this.get(id);
    const registeredFamily = runbookFamilyForDevice(session.device);
    if (registeredFamily !== undefined) {
      throw new ConflictError('O dispositivo já possui um perfil de runbook definido no cadastro.');
    }
    session.runbookProfileId = runbookFamilyById(profileId).id;
    return this.listRunbooks(id);
  }

  executeRunbook(id, runbookId) {
    const session = this.get(id);
    return session.executeRunbook(
      runbookForDevice(session.device, runbookId, session.runbookProfileId),
    );
  }

  async remove(id) {
    const session = this.get(id);
    await session.close();
    this.sessions.delete(id);
  }

  async closeAll() {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.close('application_shutdown')),
    );
    this.sessions.clear();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = undefined;
  }
}
