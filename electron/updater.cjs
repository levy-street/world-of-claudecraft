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
// 'desktop-update-install' when the player picks "restart now". Downloads
// start as soon as an offered update passes the cross-track origin guard
// (electron/update_guard.cjs); if the player ignores the toast the update
// installs on quit (autoInstallOnAppQuit).
//
// Track safety: this install reads ONLY the update channel derived from its
// own baked API origin (production origin: 'latest'; anything else: 'dev'),
// and it refuses to download an update whose feed-file wocApiOrigin stamp
// differs from that origin. Both are defense in depth behind the build-time
// split in scripts/electron-builder-config.mjs; see the issue this closes:
// a dev-origin artifact on the production feed must never install.

const { shouldNotifyProgress, updateEventPayload } = require('./update_events.cjs');
const { evaluateUpdateOffer } = require('./update_guard.cjs');

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

function initUpdater({
  ipcMain,
  log,
  getWindow,
  isTrusted,
  isPackaged,
  apiOrigin,
  updateChannel,
  autoUpdater: injectedAutoUpdater,
}) {
  // injectedAutoUpdater is a test seam only (tests/electron_updater_track.test.ts);
  // electron/main.cjs never passes it, so a real app always loads the vendor bundle.
  const autoUpdater = injectedAutoUpdater ?? loadAutoUpdater({ isPackaged });
  if (!autoUpdater) {
    log.warn('[updater] electron-updater bundle missing; auto-update disabled this session');
    return null;
  }

  autoUpdater.logger = log;
  // Read the channel derived from this build's own baked API origin, never the
  // one in the shipped app-update.yml: even an artifact packaged with a wrong
  // publish config stays on its origin's track. electron-updater's channel
  // setter silently flips allowDowngrade to true, so reset it right after (a
  // production install must never "update" onto an older feed entry).
  if (typeof updateChannel === 'string' && updateChannel !== '') {
    autoUpdater.channel = updateChannel;
    autoUpdater.allowDowngrade = false;
  }
  // Downloads are gated on the cross-track origin guard in 'update-available'
  // below; only a guard-approved download exists for autoInstallOnAppQuit to
  // install.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload) => {
    if (!payload) return;
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('desktop-update-event', payload);
  };

  let lastProgressSent = -1;
  autoUpdater.on('update-available', (info) => {
    const verdict = evaluateUpdateOffer({ apiOrigin, info });
    if (!verdict.ok) {
      // Never user-facing: the player keeps playing on the build they have.
      // Loud in the log so the operator finds the wrong-track artifact.
      log.error('[updater] REFUSED update: baked for another API origin; not downloading', {
        version: info?.version,
        offeredOrigin: verdict.offeredOrigin,
        expectedOrigin: verdict.expectedOrigin,
      });
      return;
    }
    log.info('[updater] update available', {
      version: info?.version,
      originStamp: verdict.stamped ? 'match' : 'absent (pre-split feed file)',
    });
    lastProgressSent = -1;
    send(updateEventPayload('available', info));
    autoUpdater
      .downloadUpdate()
      .catch((err) => log.warn('[updater] download failed', err?.message ?? String(err)));
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
