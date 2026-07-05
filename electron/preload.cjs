const { contextBridge, ipcRenderer } = require('electron');

// Renderer error forwarding to the main-process log, two complementary paths:
//
//  1. reportRendererError on the wocDesktop bridge: the GAME (main world)
//     installs window error/unhandledrejection listeners and relays through
//     this (src/game/desktop_error_relay.ts). This is the path that actually
//     sees page errors: under contextIsolation the preload lives in an
//     ISOLATED world, and window 'error' / 'unhandledrejection' events do NOT
//     cross JS worlds (verified empirically against Electron 43).
//  2. The listeners below in the preload's own world, which only catch errors
//     THROWN IN THIS ISOLATED WORLD (i.e. preload bugs); kept because they are
//     free and main.cjs's console-message mirror does not cover this world.
//
// Uncaught page errors additionally reach the log as 'Uncaught ...' console
// messages via the main-side console-message mirror, so even a renderer too
// old to call the relay still leaves a trace. Everything below is clamped
// here AND re-validated + re-capped in main (electron/diagnostics.cjs
// rendererErrorLogEntry), which never trusts this side's counting.
const MAX_FORWARDED_ERRORS = 30;
const MAX_TEXT = 4000;
let forwardedErrors = 0;

const clampString = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function sanitizeErrorReport(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const kind =
    payload.kind === 'unhandledrejection'
      ? 'unhandledrejection'
      : payload.kind === 'error'
        ? 'error'
        : null;
  if (!kind) return null;
  const report = {
    kind,
    message: clampString(payload.message, MAX_TEXT),
    stack: clampString(payload.stack, MAX_TEXT),
    source: clampString(payload.source, 512),
  };
  if (typeof payload.line === 'number') report.line = payload.line;
  if (typeof payload.col === 'number') report.col = payload.col;
  return report;
}

function forwardRendererError(report) {
  if (!report || forwardedErrors >= MAX_FORWARDED_ERRORS) return;
  forwardedErrors += 1;
  try {
    ipcRenderer.send('desktop-renderer-error', report);
  } catch {
    // Never let diagnostics break the page.
  }
}

window.addEventListener('error', (event) => {
  forwardRendererError(
    sanitizeErrorReport({
      kind: 'error',
      message: event?.message,
      stack: event?.error?.stack,
      source: event?.filename,
      line: event?.lineno,
      col: event?.colno,
    }),
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  forwardRendererError(
    sanitizeErrorReport({
      kind: 'unhandledrejection',
      message: typeof reason === 'string' ? reason : reason?.message,
      stack: reason?.stack,
    }),
  );
});

contextBridge.exposeInMainWorld('wocDesktop', {
  openBrowserLogin: () => ipcRenderer.invoke('desktop-login-open-browser'),
  takeLoginCode: () => ipcRenderer.invoke('desktop-login-take-code'),
  onLoginCode: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, code) => {
      if (typeof code === 'string') callback(code);
    };
    ipcRenderer.on('desktop-login-code', listener);
    return () => ipcRenderer.removeListener('desktop-login-code', listener);
  },
  // Push the renderer's t()-rendered shell strings (crash dialog text) to the
  // main process, which has no i18n runtime of its own. Fire-and-forget.
  setShellStrings: (strings) => {
    if (!strings || typeof strings !== 'object') return Promise.resolve(null);
    return ipcRenderer.invoke('desktop-set-strings', strings);
  },
  // Main-world error relay (path 1 above): the game's window listeners hand
  // their uncaught errors here; same clamp + cap as the local listeners.
  reportRendererError: (payload) => {
    forwardRendererError(sanitizeErrorReport(payload));
  },
  // Auto-update events (website distribution only; the channel is simply
  // silent on Steam/dev builds). Payloads are the whitelisted shapes built in
  // electron/update_events.cjs.
  onUpdateEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
        callback(payload);
      }
    };
    ipcRenderer.on('desktop-update-event', listener);
    return () => ipcRenderer.removeListener('desktop-update-event', listener);
  },
  installUpdate: () => ipcRenderer.invoke('desktop-update-install'),
});
