import { appendFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import { ensurePrivateDirectory } from '../app-paths.mjs';
import { isPathInside } from './log-paths.mjs';
import { formatIsoWithTimezone, sealLog, SessionRecorder } from './session-recorder.mjs';

function durationText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class RecordingService {
  constructor({ history, logsRoot }) {
    this.history = history;
    this.logsRoot = logsRoot;
    this.localUsername = os.userInfo().username;
  }

  async initialize() {
    await ensurePrivateDirectory(this.logsRoot);
    await this.#recoverInterrupted();
  }

  beginSession(metadata) {
    this.history.begin(metadata);
  }

  async createRecorder(metadata, dimensions) {
    return SessionRecorder.create({
      ...dimensions,
      history: this.history,
      logsRoot: this.logsRoot,
      metadata: { ...metadata, localUsername: this.localUsername },
    });
  }

  finishSession(id, details) {
    this.history.finish(id, details);
  }

  async #recoverInterrupted() {
    for (const session of this.history.unfinished()) {
      const endedAt = new Date();
      if (session.logPath !== null && isPathInside(this.logsRoot, session.logPath)) {
        try {
          await chmod(session.logPath, 0o600);
          await appendFile(
            session.logPath,
            `\n[NetRunner] Sessão encerrada inesperadamente; registro recuperado na inicialização.\n` +
              `Término: ${formatIsoWithTimezone(endedAt)}\n` +
              `Duração: ${durationText(Math.max(0, endedAt.getTime() - new Date(session.startedAt).getTime()))}\n` +
              'Motivo: unexpected_shutdown\n',
            'utf8',
          );
          const sha256 = await sealLog(session.logPath);
          this.history.finalizeLog(session.id, sha256);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      this.history.finish(session.id, {
        endedAt: endedAt.toISOString(),
        reason: 'unexpected_shutdown',
        startedAt: session.startedAt,
      });
    }
  }
}
