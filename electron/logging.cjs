'use strict';

// File logging for the desktop shell, built on electron-log's main-process
// side only. The renderer never imports electron-log (the game client is
// web-first and identical to the browser bundle); renderer output reaches this
// log via the webContents 'console-message' event and the preload's error
// forwarding, both wired in electron/main.cjs. electron-log's initialize()
// (renderer IPC + preload injection) is therefore deliberately NOT called.
//
// The module is loaded from the esbuild vendor bundle (the packaged app ships
// no node_modules), falling back to node_modules for a bare `electron .`
// checkout, and finally to a console shim: logging must never be the thing
// that breaks the game.

// A packaged app loads ONLY the in-asar vendor bundle: the bare-specifier
// fallback would walk Node's module paths out of the asar into the (per-user
// installs: user-writable) install directory. It exists solely for a bare
// `electron .` checkout, where node_modules is the only place the dep lives.
// Pure, so tests/electron_vendor_loading.test.ts can pin the packaged-only order.
function logRequireCandidates(isPackaged) {
  return isPackaged === true
    ? ['./vendor/electron_log_main.cjs']
    : ['./vendor/electron_log_main.cjs', 'electron-log/main'];
}

function loadElectronLog({ isPackaged } = {}) {
  for (const candidate of logRequireCandidates(isPackaged)) {
    try {
      const mod = require(candidate);
      const log = mod?.default ?? mod;
      if (log && typeof log.info === 'function' && log.transports) return log;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function consoleShim() {
  const bind =
    (fn) =>
    (...args) =>
      fn('[shell-log]', ...args);
  return {
    error: bind(console.error),
    warn: bind(console.warn),
    info: bind(console.log),
    debug: () => {},
    transports: null,
  };
}

// Initialize the shell logger. Returns { log, filePath } where filePath is
// null when only the console shim is available. The file transport rotates at
// 5 MB (electron-log keeps one .old archive next to it); locations follow
// app.name, which is the package NAME (verified on a packaged build):
//   macOS   ~/Library/Logs/world-of-claudecraft/main.log
//   Windows %USERPROFILE%\AppData\Roaming\world-of-claudecraft\logs\main.log
//   Linux   ~/.config/world-of-claudecraft/logs/main.log
function initLogging({ isPackaged }) {
  const log = loadElectronLog({ isPackaged });
  if (!log) return { log: consoleShim(), filePath: null };
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // In a packaged build the console transport is mostly invisible anyway;
  // keep it for `electron .` / electron:dev where the terminal is the tool.
  log.transports.console.level = isPackaged ? 'warn' : 'info';
  let filePath = null;
  try {
    filePath = log.transports.file.getFile()?.path ?? null;
  } catch {
    filePath = null;
  }
  return { log, filePath };
}

module.exports = { initLogging, loadElectronLog, logRequireCandidates, consoleShim };
