'use strict';

// Crash and error hooks for the Electron shell: main-process uncaught errors,
// dead child processes, and renderer (game view) crashes with bounded
// auto-recovery. Every DECISION lives in electron/diagnostics.cjs (pure,
// tested); this module is thin dependency-injected wiring so electron/main.cjs
// stays a coordinator. Player-facing dialog text comes from getStrings(), the
// renderer-pushed t() translations cached in main (electron/shell_strings.cjs).

const { classifyRendererExit, rendererCrashAction } = require('./diagnostics.cjs');

// Main-process guards. Per Node's own guidance the process is in an undefined
// state after an uncaughtException: log it, tell the player synchronously,
// and exit non-zero; never swallow-and-continue. Unhandled rejections are
// logged but do not kill the app (the main process has no rejection that
// should take the game down with it). Dead child processes (GPU, network
// service, utility) are logged; Chromium relaunches the important ones itself.
function installProcessCrashGuards({ app, dialog, log, getStrings }) {
  process.on('uncaughtException', (err) => {
    try {
      log.error('[main] uncaught exception', err?.stack ?? String(err));
      const strings = getStrings();
      dialog.showErrorBox(strings.fatalTitle, strings.fatalBody);
    } catch {
      // Even the error path must not throw; fall through to the exit.
    }
    app.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    // A log-only path, so it must not itself throw: a rejection reason whose
    // stack/toString getter throws (or a hostile Symbol.toPrimitive) would
    // otherwise surface as an uncaughtException and escalate to a fatal exit.
    try {
      log.error(
        '[main] unhandled rejection',
        reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
      );
    } catch {
      // best-effort second attempt with no interpolation of `reason`
      try {
        log.error('[main] unhandled rejection (unprintable reason)');
      } catch {
        // give up rather than take the app down over a log line
      }
    }
  });
  app.on('child-process-gone', (_event, details) => {
    // Reuse the pure classifier so the benign-vs-crash decision lives in one
    // place (electron/diagnostics.cjs), not duplicated here.
    const benign = classifyRendererExit(details?.reason) === 'benign';
    log[benign ? 'info' : 'error']('[child] process gone', details);
  });
}

// Renderer (game view) crash recovery: reload silently up to the
// diagnostics-decided budget, then ask the player (Reload / Quit). An
// 'integrity-failure' (the asar failed its tamper check) is fatal: reloading
// the same bundle cannot help, so report and exit.
function attachRendererCrashRecovery({
  window,
  app,
  dialog,
  log,
  getStrings,
  now = () => Date.now(),
}) {
  let recentCrashTimes = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    const reason = details?.reason ?? 'unknown';
    if (classifyRendererExit(reason) === 'benign') {
      log.info('[renderer] gone (benign)', details);
      return;
    }
    log.error('[renderer] gone', details);
    // A crash racing the window teardown: nothing to recover into (and a
    // reload/dialog on a destroyed window would throw inside this handler,
    // which the uncaughtException guard would escalate to a fatal exit).
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      log.warn('[renderer] window already gone; skipping recovery');
      return;
    }
    if (reason === 'integrity-failure') {
      const strings = getStrings();
      dialog.showErrorBox(strings.fatalTitle, strings.fatalBody);
      app.exit(1);
      return;
    }
    const { action, times } = rendererCrashAction(recentCrashTimes, now());
    recentCrashTimes = times;
    if (action === 'reload') {
      log.warn('[renderer] auto-reloading after crash', { attempt: times.length });
      window.webContents.reload();
      return;
    }
    const strings = getStrings();
    dialog
      .showMessageBox(window, {
        type: 'error',
        title: strings.crashTitle,
        message: strings.crashBody,
        buttons: [strings.crashReload, strings.crashQuit],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          recentCrashTimes = [];
          log.warn('[renderer] player chose reload after repeated crashes');
          window.webContents.reload();
        } else {
          log.warn('[renderer] player chose quit after repeated crashes');
          app.quit();
        }
      })
      .catch((err) => {
        log.error('[renderer] crash dialog failed', err);
        app.quit();
      });
  });
}

module.exports = { installProcessCrashGuards, attachRendererCrashRecovery };
