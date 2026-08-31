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
  openWalletBrowser: (code) => ipcRenderer.invoke('desktop-wallet-open-browser', code),
  takeWalletHandoffCode: () => ipcRenderer.invoke('desktop-wallet-take-code'),
  onWalletHandoffCode: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, code) => {
      if (typeof code === 'string') callback(code);
    };
    ipcRenderer.on('desktop-wallet-handoff-code', listener);
    return () => ipcRenderer.removeListener('desktop-wallet-handoff-code', listener);
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
  // A Steam link ticket (hex) for the account-link handshake, or null when
  // Steam is unavailable (website build, Steam not running, ticket failure).
  // The main-process handler never rejects; steam.cjs owns every failure arm.
  steamLinkTicket: () => ipcRenderer.invoke('desktop-steam-link-ticket'),
  // Whether this shell can mint link tickets at all (false on packaged
  // website builds): the renderer hides the Link button instead of offering
  // a click whose ticket can never exist.
  steamLinkSupported: () => ipcRenderer.invoke('desktop-steam-capability'),
  walletConnectionSupported: () => ipcRenderer.invoke('desktop-wallet-capability'),
  // Whether the $WOC Exchange may attach in this shell (website distribution
  // only; Steam and Epic builds answer false and get no Exchange UI at all).
  wocExchangeSupported: () => ipcRenderer.invoke('desktop-exchange-capability'),
  // Signal that a link attempt has settled (the server verify resolved or
  // rejected) so the shell can cancel the Steam auth ticket (Valve's
  // CancelAuthTicket contract). Fire-and-forget; the main handler is idempotent.
  steamLinkSettled: () => ipcRenderer.invoke('desktop-steam-link-settled'),
  // An Epic link proof (string) for POST /api/epic/link, or null when Epic is
  // unavailable (website/steam build, no launcher exchange code, adapter
  // missing). The main-process handler never rejects; epic.cjs owns every
  // failure arm.
  epicLinkProof: () => ipcRenderer.invoke('desktop-epic-link-proof'),
  // Whether the shell can mint Epic link proofs at all (false on packaged
  // website/steam builds). Capability can be true even when a given mint
  // returns null (no native EOS / no launcher session yet).
  epicLinkSupported: () => ipcRenderer.invoke('desktop-epic-capability'),
  // Signal that an Epic link attempt has settled so any cancelable adapter
  // handle can be released. Fire-and-forget; the main handler is idempotent.
  epicLinkSettled: () => ipcRenderer.invoke('desktop-epic-link-settled'),
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
  // The shell's GPU verdict, pushed once the GPU process has reported (and again
  // after a crash-recovery reload). Payloads are the whitelisted shape built in
  // electron/gpu_status_events.cjs; the renderer localizes the notice itself.
  onGpuStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        typeof payload.softwareRendering === 'boolean' &&
        typeof payload.discreteInactive === 'boolean' &&
        typeof payload.adapter === 'string'
      ) {
        callback(payload);
      }
    };
    ipcRenderer.on('desktop-gpu-status', listener);
    return () => ipcRenderer.removeListener('desktop-gpu-status', listener);
  },
  // Whether the player has opted out of the shell forcing the discrete GPU.
  // Both are about the NEXT launch: the force levers run before Electron's own
  // startup, so the shell stores the choice rather than applying it live. The
  // setter answers whether the value actually reached disk.
  getGpuForceOptOut: () => ipcRenderer.invoke('desktop-get-gpu-force-opt-out'),
  setGpuForceOptOut: (optOut) =>
    ipcRenderer.invoke('desktop-set-gpu-force-opt-out', optOut === true),
  // How the shell presents its window: 'borderless' (full screen) or 'windowed'.
  // The setter applies live AND stores for the next launch, and answers whether
  // the choice actually reached disk. An unknown mode is refused here rather
  // than crossing the bridge, so main only ever sees a value it can apply.
  getDisplayMode: () => ipcRenderer.invoke('desktop-get-display-mode'),
  setDisplayMode: (mode) => {
    if (mode !== 'borderless' && mode !== 'windowed') return Promise.resolve(false);
    return ipcRenderer.invoke('desktop-set-display-mode', mode);
  },
  // One argument-free application exit capability. Main re-checks the sender
  // and live window before accepting the normal app.quit lifecycle request.
  quitApp: () => ipcRenderer.invoke('desktop-app-quit'),
  // Gamepad activity, so the shell can keep the display awake during a
  // controller-only session (gamepad input does not reset the OS idle timer).
  // Fire-and-forget from the renderer's input loop: it returns nothing and
  // swallows a rejection, because a shell that cannot take the lease must never
  // surface an unhandled rejection in the game's input path.
  notifyGamepadActivity: () => {
    ipcRenderer.invoke('desktop-gamepad-activity').catch(() => {});
  },
  // An OS notification, with both strings already rendered by the renderer's
  // t(). Refused here unless it is one of the two kinds main will accept, and
  // rebuilt into a fresh object so no renderer prototype crosses the bridge,
  // pre-capped so a hostile page cannot ship unbounded strings across the IPC
  // (main re-clamps to the visible 120/240 without trusting these caps).
  // Fire-and-forget: it returns nothing, swallows the rejection, and guards the
  // synchronous throw, because a shell that cannot notify must never surface an
  // error in the caller's path.
  showNotification: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const kind = payload.kind;
    if (kind !== 'update-ready' && kind !== 'party-invite') return;
    if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return;
    const message = { kind, title: payload.title.slice(0, 512), body: payload.body.slice(0, 1024) };
    try {
      ipcRenderer.invoke('desktop-show-notification', message).catch(() => {});
    } catch {}
  },
  // The Discord Rich Presence line, with the details string already rendered by
  // the renderer's t(). null is the clear. Rebuilt into a fresh object (nested
  // timestamps included) so no renderer prototype crosses the bridge, and
  // pre-capped so a hostile page cannot ship an unbounded string across the IPC
  // (main re-clamps to the visible 128 without trusting this cap). Fire-and-
  // forget: it returns nothing, swallows the rejection, and guards the
  // synchronous throw, because a shell that cannot report presence must never
  // surface an error in the caller's path.
  setDiscordActivity: (activity) => {
    let message = null;
    if (activity !== null) {
      if (!activity || typeof activity !== 'object') return;
      if (typeof activity.details !== 'string') return;
      message = { details: activity.details.slice(0, 256) };
      const timestamps = activity.timestamps;
      if (timestamps && typeof timestamps === 'object' && typeof timestamps.start === 'number') {
        message.timestamps = { start: timestamps.start };
      }
    }
    try {
      ipcRenderer.invoke('desktop-set-discord-activity', message).catch(() => {});
    } catch {}
  },
  // The player's Discord presence setting. Refused here unless it is a real
  // boolean, so main only ever sees a value it can store; fire-and-forget for
  // the same reason as the activity above.
  setDiscordPresenceEnabled: (enabled) => {
    if (enabled !== true && enabled !== false) return;
    try {
      ipcRenderer.invoke('desktop-set-discord-presence-enabled', enabled).catch(() => {});
    } catch {}
  },
  // Whether the shell's window is minimized or hidden, pushed from the main
  // process because the page cannot see it: the window sets
  // backgroundThrottling:false, which keeps document.visibilityState at
  // 'visible' the whole time it is minimized.
  onPresentationChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (payload && typeof payload === 'object' && typeof payload.hidden === 'boolean') {
        callback(payload);
      }
    };
    ipcRenderer.on('desktop-presentation-changed', listener);
    return () => ipcRenderer.removeListener('desktop-presentation-changed', listener);
  },
  // The scale factor of the display the window sits on, pushed when it changes.
  // The display's identity decides main-side whether a change is worth sending
  // and never crosses the bridge. The finiteness check is not ceremony: the
  // renderer resolves a pixel ratio from this, so a NaN would poison every
  // frame after it.
  onDisplayChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        typeof payload.scaleFactor === 'number' &&
        Number.isFinite(payload.scaleFactor)
      ) {
        callback(payload);
      }
    };
    ipcRenderer.on('desktop-display-changed', listener);
    return () => ipcRenderer.removeListener('desktop-display-changed', listener);
  },
});
