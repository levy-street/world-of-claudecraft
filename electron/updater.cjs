'use strict';

// Auto-update wiring for the WEBSITE distribution only. electron/main.cjs
// calls initUpdater solely when desktop_config.cjs resolved updaterEnabled
// (packaged AND website channel): Steam builds update via SteamPipe depots and
// must never self-update, and their build also nulls the publish config so no
// app-update.yml even ships. The module is defensive throughout: a missing or
// broken updater bundle degrades to a log line, never a broken game.
//
// UX contract: this side only LOGS and forwards whitelisted payloads
// (electron/update_events.cjs) to the renderer over 'desktop-update-event';
// the renderer renders the t()-localized toast and calls
// 'desktop-update-install' when the player picks "restart now". Downloads are
// automatic; if the player ignores the toast the update installs on quit
// (autoInstallOnAppQuit).

const { shouldNotifyProgress, updateEventPayload } = require('./update_events.cjs');

const FIRST_CHECK_DELAY_MS = 15_000;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// A packaged app loads ONLY the in-asar vendor bundle (integrity-validated,
// static path). The bare-specifier fallback would walk Node's module paths
// out of the asar into the install directory, which is user-writable on a
// per-user install; it exists solely for a bare `electron .` checkout, where
// node_modules is the only place the dependency lives. Pure, so
// tests/electron_vendor_loading.test.ts can pin the packaged-only order.
function updaterRequireCandidates(isPackaged) {
  return isPackaged === true
    ? ['./vendor/electron_updater.cjs']
    : ['./vendor/electron_updater.cjs', 'electron-updater'];
}

function loadAutoUpdater({ isPackaged } = {}) {
  for (const candidate of updaterRequireCandidates(isPackaged)) {
    try {
      const mod = require(candidate);
      const autoUpdater = mod?.autoUpdater ?? mod?.default?.autoUpdater;
      if (autoUpdater && typeof autoUpdater.checkForUpdates === 'function') return autoUpdater;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function initUpdater({ ipcMain, log, getWindow, isTrusted, isPackaged }) {
  const autoUpdater = loadAutoUpdater({ isPackaged });
  if (!autoUpdater) {
    log.warn('[updater] electron-updater bundle missing; auto-update disabled this session');
    return null;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload) => {
    if (!payload) return;
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('desktop-update-event', payload);
  };

  let lastProgressSent = -1;
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available', { version: info?.version });
    lastProgressSent = -1;
    send(updateEventPayload('available', info));
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] up to date', { version: info?.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    if (!shouldNotifyProgress(lastProgressSent, progress?.percent)) return;
    const payload = updateEventPayload('progress', progress);
    lastProgressSent = payload.percent;
    send(payload);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update downloaded; will install on quit or restart', {
      version: info?.version,
    });
    send(updateEventPayload('downloaded', info));
  });
  // Log-only: a failed check is normal life (offline, captive portal, feed
  // host down) and retries on the next interval. Never user-facing.
  autoUpdater.on('error', (err) => {
    log.warn('[updater] error (will retry on the next check)', err?.message ?? String(err));
  });

  ipcMain.handle('desktop-update-install', (event) => {
    if (!isTrusted(event)) return null;
    log.info('[updater] player chose restart-to-update');
    // Defer past the IPC reply so the renderer promise settles before teardown.
    setImmediate(() => autoUpdater.quitAndInstall());
    return null;
  });

  const check = () => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => log.warn('[updater] check failed', err?.message ?? String(err)));
  };
  // First check after the game has had its boot bandwidth; then periodically.
  // Process-lifetime timers by design (the updater lives as long as the app),
  // so they are deliberately never cleared.
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, RECHECK_INTERVAL_MS);
  return autoUpdater;
}

module.exports = {
  initUpdater,
  loadAutoUpdater,
  updaterRequireCandidates,
  FIRST_CHECK_DELAY_MS,
  RECHECK_INTERVAL_MS,
};
