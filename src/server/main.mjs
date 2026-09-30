import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePrivateDirectory, resolveAppDataDirectory, resolveLogsDirectory } from './app-paths.mjs';
import { createDailyBackup } from './database/backups.mjs';
import { applyPendingRestore, BackupService } from './database/backup-service.mjs';
import { openDatabase } from './database/database.mjs';
import { InventoryService } from './inventory/inventory-service.mjs';
import { CertificateTrustService } from './https/certificate-trust-service.mjs';
import { HttpsAccessService } from './https/https-access-service.mjs';
import { DeviceHealthService } from './health/device-health-service.mjs';
import { RecordingService } from './recording/recording-service.mjs';
import { SessionHistoryService } from './recording/session-history-service.mjs';
import { createSessionToken } from './security.mjs';
import { startServer } from './server.mjs';
import { AppSettingsService } from './settings/app-settings-service.mjs';
import { ConfigurationSnapshotService } from './snapshots/configuration-snapshot-service.mjs';
import { HostKeyService } from './ssh/host-key-service.mjs';
import { SshSessionManager } from './ssh/ssh-session-manager.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageRoot = path.resolve(currentDirectory, '../../img');
const webRoot = path.resolve(currentDirectory, '../web');
const vendorRoot = path.resolve(currentDirectory, '../../node_modules');
const shouldOpenBrowser = !process.argv.includes('--no-open');

function openBrowser(url) {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic browser opening is currently supported only on macOS');
  }

  const child = spawn('/usr/bin/open', [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

const appDataDirectory = resolveAppDataDirectory();
await ensurePrivateDirectory(appDataDirectory);
const databasePath = path.join(appDataDirectory, 'netrunner.sqlite');
await applyPendingRestore(appDataDirectory, databasePath);
const database = await openDatabase(databasePath);
await createDailyBackup(database, path.join(appDataDirectory, 'Backups'));
const backups = new BackupService({ appDataDirectory, database });
const inventory = new InventoryService(database);
const settings = new AppSettingsService(database);
const hostKeys = new HostKeyService(database);
const history = new SessionHistoryService(database);
const certificates = new CertificateTrustService(database);
const httpsAccess = new HttpsAccessService({ certificates, history, inventory });
const health = new DeviceHealthService({ database, inventory });
const snapshots = new ConfigurationSnapshotService({ database, inventory });
const recordingService = new RecordingService({ history, logsRoot: resolveLogsDirectory() });
await recordingService.initialize();
const sshSessions = new SshSessionManager({ hostKeys, inventory, recordingService, settings });

let localServer;
let shutdownPromise;

function shutdown() {
  if (shutdownPromise !== undefined) return shutdownPromise;
  shutdownPromise = (async () => {
    await sshSessions.closeAll();
    await localServer?.close();
    database.close();
    process.exitCode = 0;
  })();
  return shutdownPromise;
}

const sessionToken = createSessionToken();
localServer = await startServer({
  backups,
  health,
  historyApi: { history, logsRoot: recordingService.logsRoot },
  httpsAccess,
  imageRoot,
  inventory,
  onLastBrowserDisconnected: shutdown,
  securityMaterial: { certificates, hostKeys },
  sessionToken,
  settings,
  snapshots,
  sshSessions,
  vendorRoot,
  webRoot,
});
const launchUrl = `${localServer.origin}/#token=${encodeURIComponent(sessionToken)}`;

if (shouldOpenBrowser) {
  openBrowser(launchUrl);
}

process.stdout.write(`NetRunner ativo em ${localServer.origin}\n`);

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
