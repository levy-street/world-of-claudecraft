const {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  net,
  Notification,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
// Node's net, not Electron's: the presence socket is a local unix socket (a
// named pipe on Windows), and the electron `net` destructured above is the
// Chromium HTTP stack, which cannot open one.
const nodeNet = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  appNavigationOrigins,
  navigationAllowed,
  isTrustedSender,
  isDevToolsToggleShortcut,
  isSoftwareRenderer,
  deriveOrigin,
  buildContentSecurityPolicy,
  extractInlineScriptHashes,
  withCspHeader,
  ALLOWED_PERMISSIONS,
} = require('./shell_guards.cjs');
const { rangeContentType, rangedFileResponse } = require('./media_range.cjs');
const { resolveDesktopConfig, walletConnectionSupported } = require('./desktop_config.cjs');
const {
  DESKTOP_PREFS_FILENAME,
  loadDesktopPrefs,
  saveDesktopPrefs,
} = require('./desktop_prefs.cjs');
const {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  resolveWindowRestore,
} = require('./window_memory.cjs');
const { createPowerSave } = require('./power_save.cjs');
const { createNotifyGuard } = require('./notify_guard.cjs');
const {
  createDiscordPresence,
  resolveDiscordClientId,
  sanitizeDiscordActivity,
} = require('./discord_presence.cjs');
const { createSteamShell } = require('./steam.cjs');
const { createEpicShell } = require('./epic.cjs');
const { PRODUCTION_API_ORIGIN } = require('./update_guard.cjs');
const {
  MAX_FORWARDED_ERRORS,
  MAX_MIRRORED_CONSOLE_LINES,
  clampText,
  escapeNotificationMarkup,
  normalizeConsoleMessage,
  rendererErrorLogEntry,
  shouldLogConsoleLevel,
} = require('./diagnostics.cjs');
const { initLogging } = require('./logging.cjs');
const { DEFAULT_SHELL_STRINGS, sanitizeShellStrings } = require('./shell_strings.cjs');
const { registerLinuxUrlHandler } = require('./linux_url_handler.cjs');
const { allowGpuUnderSteamOverlay } = require('./steam_overlay_guard.cjs');
const { attachRendererCrashRecovery, installProcessCrashGuards } = require('./crash_guard.cjs');
const { initUpdater } = require('./updater.cjs');
const {
  forceHighPerformanceGpu,
  PRIME_RELAUNCH_MARKER,
  relaunchForLinuxPrime,
  summarizeGpuDevices,
} = require('./gpu_preference.cjs');
const { gpuStatusPayload } = require('./gpu_status_events.cjs');
const { presentationStatePayload } = require('./presentation_events.cjs');
const {
  displayChangedPayload,
  displayWirePayload,
  shouldForwardDisplayChange,
} = require('./display_events.cjs');
const {
  buildWalletHandoffBrowserUrl,
  parseWalletHandoffDeepLink,
} = require('./wallet_handoff.cjs');

// The shell's persisted preferences (electron/desktop_prefs.cjs), read synchronously and
// FIRST because the very next decision depends on them: both discrete-GPU levers have to
// run before Electron's own startup, so a preference fetched any later than this could not
// gate them. app.getPath('userData') is callable before app 'ready', and the resolve plus a
// small-file read plus JSON.parse measures well under a millisecond, so the boot cost is
// noise. This ONE object is the single in-memory source every save writes from: the window
// saver and the GPU opt-out setter each update their own field and persist the whole record,
// so neither can clobber the other's (the opt-out can be toggled mid-session, with a
// close-time bounds save still to come).
const desktopPrefsPath = path.join(app.getPath('userData'), DESKTOP_PREFS_FILENAME);
const desktopPrefs = loadDesktopPrefs(desktopPrefsPath);

// No-boot escape hatch (documented in docs/desktop-release.md): setting
// WOC_DISABLE_GPU_FORCE=1 in the environment skips BOTH discrete-GPU levers
// for this launch, exactly like the stored opt-out, without touching the
// stored preference. It exists for the machine the force prevents from
// booting at all: the in-game toggle needs a boot to reach and the prefs-file
// rescue needs a hand edit, an env var needs neither. Strict '1' so a stray
// value cannot half-arm it.
const gpuForceDisabledByEnv = process.env.WOC_DISABLE_GPU_FORCE === '1';

// On a Linux hybrid-graphics laptop, the PRIME render-offload env vars (DRI_PRIME,
// __NV_PRIME_RENDER_OFFLOAD, etc; see electron/gpu_preference.cjs) only reach the GPU
// process if they are present in THIS process's environment from birth: Electron's Linux
// GPU process forks from a zygote that already exec'd (and snapshotted its environ) before
// any of this script's lines run, so a later process.env write is invisible to it. This is
// the earliest point re-exec can happen (before crash reporting, logging, or any window are
// set up in this soon-to-exit process), and it must run before app 'ready'. log: console
// because file logging is deliberately not initialized yet in this soon-to-exit process; the
// durable main.log evidence is the relaunched-child line the child writes below.
//
// The player can opt out of the whole discrete-GPU force (Options > Interface, persisted in
// the prefs read above). Opting out means NOT CALLING this: the relaunch spawns a second
// process and pins the X11 Ozone backend, both of which the opt-out exists to avoid, and
// there is no gentler dial inside the function to reach for.
if (gpuForceDisabledByEnv) {
  console.log('[gpu] WOC_DISABLE_GPU_FORCE=1: skipping the Linux PRIME relaunch');
} else if (desktopPrefs.gpuForceOptOut === true) {
  console.log('[gpu] player opted out of the GPU force; skipping the Linux PRIME relaunch');
} else if (relaunchForLinuxPrime({ log: console })) {
  // process.exit stops the main script before any statement below runs, so this
  // soon-to-be-replaced process never sets up crash reporting, logging, or a window
  // (app.exit would also exit promptly, but process.exit depends on nothing).
  process.exit(0);
}

const APP_ORIGIN = 'app://worldofclaudecraft';
// The Vite dev server URL is a DEV-ONLY seam (electron-dev.mjs sets it): its
// origin joins the trusted set for BOTH navigation and IPC-sender trust, and it
// is loaded as the UI, so a packaged build must never honor it from runtime
// env. Gate it on isPackaged, mirroring the WOC_DISTRIBUTION / WOC_CRASH_SUBMIT_URL
// hatch closures in electron/desktop_config.cjs.
const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
// Origins the main frame may navigate to (app origin, plus the dev server in dev).
const appOrigins = appNavigationOrigins(APP_ORIGIN, devServerUrl);
const deepLinkProtocol = 'worldofclaudecraft';
let mainWindow = null;
// The live window's reveal closure (showMainWindow inside createMainWindow),
// published so focusMainWindow can route a pre-paint reveal through the SAME
// discipline as 'ready-to-show'. It self-guards on its captured window
// (isDestroyed/isVisible), so a stale value after a window dies is a no-op
// and the next createMainWindow overwrites it for the successor.
let revealMainWindow = null;
let pendingLoginCode = null;
let pendingWalletHandoffCode = null;
// Session cap counter for the renderer console mirror (used by the
// 'console-message' handler in createMainWindow).
let consoleLinesMirrored = 0;

// Which distribution this build is (website download vs Steam depot), whether
// the auto-updater may run, and the optional crash-minidump submit URL. The
// stamp is read from the PACKAGED package.json (electron-builder extraMetadata
// wrote wocDesktop there); a bare `electron .` checkout has no stamp and
// resolves to website-with-updater-off.
function readPackagedMetadata() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}
const packagedMetadata = readPackagedMetadata();
const desktopConfig = resolveDesktopConfig({
  packagedMetadata,
  env: process.env,
  isPackaged: app.isPackaged,
});

// API origin the renderer talks to (REST + WebSocket; feeds the CSP connect-src)
// and the origin openDesktopLogin() opens in the player's browser. Resolved by
// desktop_config.cjs from the build-time wocDesktop stamp (apiOrigin matches
// what the Vite client bundle was baked with; loginOrigin is main-process-only);
// the VITE_DESKTOP_* env pair is honored on unpackaged checkouts only,
// mirroring the WOC_DISTRIBUTION hatch closure.
const apiOrigin = deriveOrigin(desktopConfig.apiOrigin) || PRODUCTION_API_ORIGIN;
const desktopLoginOrigin = desktopConfig.loginOrigin.replace(/\/+$/, '');

// Crashpad must start before any window exists so native crashes in EVERY
// process (main, renderer, GPU, utility) are captured from the first frame.
// Without a provisioned submit URL the minidumps stay local under
// app.getPath('crashDumps') for attaching to bug reports; with one (stamped at
// build time, https-only) they upload compressed and rate-limited. No extra
// user data rides along: the report carries only process/version metadata.
crashReporter.start({
  productName: 'World of ClaudeCraft',
  // companyName is deprecated in Electron 43; the metadata field survives as
  // the _companyName global extra.
  globalExtra: { _companyName: 'World of ClaudeCraft' },
  submitURL: desktopConfig.crashSubmitUrl || undefined,
  uploadToServer: desktopConfig.crashSubmitUrl !== '',
  compress: true,
  rateLimit: true,
});

// Structured file logging (electron/logging.cjs). Everything the shell used to
// console.log now lands in a rotating main.log so a shipped build is
// diagnosable; the renderer's warnings/errors and uncaught exceptions are
// mirrored into the same file below.
const { log, filePath: logFilePath } = initLogging({ isPackaged: app.isPackaged });

// The durable evidence that the Linux PRIME relaunch happened: the parent that spawned us
// exited before logging existed, so the CHILD records it (docs/desktop-release.md points
// its GPU verification checklist at this line).
if (process.platform === 'linux' && process.env[PRIME_RELAUNCH_MARKER] === '1') {
  log.info('[gpu] running as PRIME-relaunched child (Linux discrete-GPU offload env active)');
}

// Force the discrete high-performance GPU on hybrid (Optimus) systems, with zero user
// action. Runs before app 'ready' (so the Chromium switches are read) and before any
// window (so the Windows per-app preference beats the GPU process this launch). See
// electron/gpu_preference.cjs for the two levers and why the client-side
// powerPreference:'high-performance' hint is not enough on Windows.
//
// Same opt-out as the Linux relaunch above: the function appends its Chromium switches on
// every platform before its own win32 gates, so honoring the preference means skipping the
// CALL, not adding a condition inside it. The value is read from the prefs file at launch,
// so a mid-session toggle takes effect the next time the game starts.
if (gpuForceDisabledByEnv) {
  log.info('[gpu] WOC_DISABLE_GPU_FORCE=1: no switches or per-app preference');
} else if (desktopPrefs.gpuForceOptOut === true) {
  log.info('[gpu] player opted out of the discrete-GPU force; no switches or per-app preference');
} else {
  forceHighPerformanceGpu({ app, log });
}

// Steam preloads its overlay into every native Linux game, and with that library mapped
// Chromium's GPU process cannot start: the browser process gives up with a CHECK and the app
// dies on SIGTRAP with no window and no log, which is the launching spinner that never ends.
// Relaxing the GPU sandbox is enough and is the narrowest fix; the renderer stays sandboxed.
// Applies ONLY when Steam actually injected, so an ordinary launch keeps the full sandbox.
// Must be before app 'ready', like the switches above, or Chromium never reads it.
allowGpuUnderSteamOverlay({ app, log });

// Player-visible strings for main-process dialogs (crash recovery): the
// renderer pushes t()-localized values via 'desktop-set-strings'
// (src/game/desktop_shell_strings.ts); until that first push, e.g. a crash
// before the client booted, the English defaults apply.
let shellStrings = DEFAULT_SHELL_STRINGS;
const getShellStrings = () => shellStrings;

installProcessCrashGuards({ app, dialog, log, getStrings: getShellStrings });

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

// The game draws its own chrome, so the default in-window menu bar on Windows
// and Linux is dead weight; nulling it at the APPLICATION level (not per window)
// means no window is ever created with a menu bar, so the first paint cannot
// flash one. This must run before app 'ready', hence module scope rather than
// inside whenReady. darwin is excluded on purpose: on macOS the menu lives in
// the system menu bar and owns the standard copy/paste/hide/quit accelerators,
// which a Mac app must keep.
if (process.platform === 'win32' || process.platform === 'linux') {
  Menu.setApplicationMenu(null);
}

function fileInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function registerAppProtocol() {
  const distDir = path.join(__dirname, '..', 'dist');
  // Build the CSP once from the shipped index.html: hash its inline bootstrap scripts
  // (their content is build-dependent) so a strict script-src allows them without
  // 'unsafe-inline'. In dev the window loads the Vite server and this app:// handler
  // is never hit, so a missing dist here is harmless.
  let scriptHashes = [];
  try {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    scriptHashes = extractInlineScriptHashes(html);
  } catch {
    scriptHashes = [];
  }
  const csp = buildContentSecurityPolicy({ apiOrigin, scriptHashes });
  const notFound = () =>
    new Response('not found', { status: 404, headers: { 'Content-Security-Policy': csp } });
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const candidate = path.normalize(path.join(distDir, requestedPath));
    if (!fileInside(distDir, candidate)) {
      return notFound();
    }
    const hasExtension = path.extname(candidate) !== '';
    const filePath = fs.existsSync(candidate)
      ? candidate
      : hasExtension
        ? candidate
        : path.join(distDir, 'index.html');
    if (!fs.existsSync(filePath) || !fileInside(distDir, filePath)) {
      return notFound();
    }
    // Chromium's media stack requests <audio>/<video> sources with a Range header
    // and rejects a plain 200 re-wrap as a format error, which left every streamed
    // music cue silent in the shipped shell. Serve those as proper 206 slices (or
    // a 416 for a past-EOF range) via electron/media_range.cjs; a null (non-media
    // file, malformed range, unreadable file) falls through to the full response.
    const rangeValue = request.headers.get('range');
    if (rangeValue) {
      const ranged = await rangedFileResponse(filePath, rangeValue, {
        'Content-Security-Policy': csp,
      });
      if (ranged) return ranged;
    }
    // Every served path (asset or the SPA index.html fallback) gets the CSP header;
    // net.fetch's own Response has immutable headers, so withCspHeader builds a fresh
    // one that preserves the body, status, statusText, and Content-Type. Media files
    // also advertise Accept-Ranges here, so range support is visible to a client
    // that probes the full response before sending its first ranged request.
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const full = withCspHeader(response, csp);
    if (rangeContentType(filePath)) full.headers.set('Accept-Ranges', 'bytes');
    return full;
  });
}

// Deny-by-default: only the two permissions the game legitimately uses are granted
// (pointerLock for mouselook, fullscreen for the game view); everything else is
// refused. Both gates are set because they answer different call paths: the check
// handler is synchronous and returns a boolean, the request handler is asynchronous
// and answers via callback exactly once. Neither inspects webContents (it can be
// null in the check handler). Device access (WebHID / Web Serial / WebUSB) is denied
// outright via a third handler.
function lockDownPermissions() {
  const { defaultSession } = session;
  defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  defaultSession.setDevicePermissionHandler(() => false);
}

// How long the shell waits for the renderer's first paint before showing the
// window anyway. Long enough that a cold start on a slow disk still shows a
// painted first frame, short enough that a wedged renderer does not read as a
// launch failure.
const READY_TO_SHOW_FALLBACK_MS = 4000;

// How long a window 'move' must settle before the shell re-reads the display.
// A drag fires 'move' continuously; only the position it lands on is worth a read.
const MOVE_DISPLAY_DEBOUNCE_MS = 250;

// The size a launch with no usable window memory gets (a first run, or a monitor
// layout the saved bounds no longer fit). The MINIMUMS live in
// electron/window_memory.cjs, which clamps every restored size to them.
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;

// How long a resize or a drag must settle before the window geometry is written
// to disk. Both events fire continuously, and the file is rewritten whole, so
// this is what keeps a single drag from being hundreds of writes.
const WINDOW_BOUNDS_SAVE_DEBOUNCE_MS = 700;

// The last display reading pushed, so an unchanged reading is not re-sent (both
// triggers fire for reasons that leave the reading identical).
let lastDisplayPush = null;

// How often the shell re-derives and re-pushes presentation state while the
// last derived reading was HIDDEN. The five window events plus did-finish-load
// cover every mainstream un-hide, but restore events have WM-specific misfire
// history (the same reason the state is derived, not latched), and the focus
// self-heal needs the player to interact first. This backstop bounds a fully
// swallowed un-hide event to one interval instead of "until the first click",
// and costs nothing while the window is visible: the interval only exists
// while the derived reading is hidden, and each tick re-derives, so the tick
// after an un-hide pushes visible and disarms itself.
const HIDDEN_REDERIVE_INTERVAL_MS = 15000;
let hiddenRederiveTimer = null;

const clearHiddenRederiveTimer = () => {
  if (hiddenRederiveTimer === null) return;
  clearInterval(hiddenRederiveTimer);
  hiddenRederiveTimer = null;
};

// Display-sleep suppression for controller-only play (electron/power_save.cjs
// owns the state machine and the reasoning). Wired to the real Electron blocker,
// the real timers, and the wall clock; the module itself is pure, so every
// transition is tested without an Electron runtime.
const powerSave = createPowerSave({
  start: (type) => powerSaveBlocker.start(type),
  stop: (id) => powerSaveBlocker.stop(id),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  now: () => Date.now(),
});

// The pacing authority for OS notifications (electron/notify_guard.cjs). Main
// side, because the renderer is not trusted to pace a surface outside the game.
const notifyGuard = createNotifyGuard({ now: () => Date.now() });

// Discord Rich Presence (electron/discord_presence.cjs owns the protocol and
// every failure arm). Built here at module scope because construction does no
// IO: the first candidate socket is dialed when the game first has something to
// show, not at boot. The app id resolves to the baked official registration by
// default (owner provisioning, 2026-08-15), with WOC_DISCORD_APP_ID as the
// operator override and any set-but-invalid value (WOC_DISCORD_APP_ID=off)
// keeping the feature inert, the documented fork opt-out.
const discordPresence = createDiscordPresence({
  clientId: resolveDiscordClientId(process.env),
  connect: (p) => nodeNet.createConnection(p),
  // The walk ends at world-writable /tmp, so a candidate is dialed only when it
  // is a socket this account owns (electron/discord_presence.cjs explains why).
  statPath: (p) => fs.statSync(p),
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
  // Peer-written text is clamped and control-character flattened before it can
  // reach the log, the same treatment renderer strings get.
  clampText,
  platform: process.platform,
  env: process.env,
  now: () => Date.now(),
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
  random: Math.random,
  pid: process.pid,
  log,
  initiallyEnabled: desktopPrefs.discordPresenceEnabled,
});

// The single send site for 'desktop-presentation-changed'. The renderer cannot
// work hidden-ness out for itself: the game window sets backgroundThrottling:false,
// which keeps the Page Visibility API reporting 'visible' the whole time the
// window is minimized, so this push is its only source.
//
// The state is DERIVED from the live window here rather than tracked in a latch
// the window events write. That is the load-bearing choice: Electron's restore
// events have WM-specific misfire history, and a latch that missed one 'restore'
// would park the renderer on a window the player is looking at, with nothing
// able to correct it. Deriving means every later event re-reads the truth, so a
// missed event costs one stale push instead of the rest of the session.
// The display-sleep lease (powerSave.setHidden below) reads the SAME
// derivation the renderer is told about, from this one site: a second reading
// of the window could disagree with the push, and then the shell would be
// holding the display awake for a window the renderer already stopped drawing.
function sendPresentationState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const hidden = mainWindow.isMinimized() || !mainWindow.isVisible();
  powerSave.setHidden(hidden);
  if (hidden && hiddenRederiveTimer === null) {
    hiddenRederiveTimer = setInterval(sendPresentationState, HIDDEN_REDERIVE_INTERVAL_MS);
  } else if (!hidden) clearHiddenRederiveTimer();
  const presentationState = presentationStatePayload(hidden);
  mainWindow.webContents.send('desktop-presentation-changed', presentationState);
}

// The single send site for 'desktop-display-changed'. The window guard comes
// first because the reading itself needs live bounds, and the dedup keeps a
// drag inside one monitor (or an unrelated monitor's metrics changing) from
// making the renderer re-resolve its pixel ratio for nothing.
function sendDisplayChange() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const displayChange = displayChangedPayload(display);
  if (!shouldForwardDisplayChange(lastDisplayPush, displayChange)) return;
  lastDisplayPush = displayChange;
  const displayWire = displayWirePayload(displayChange);
  mainWindow.webContents.send('desktop-display-changed', displayWire);
}

function createMainWindow() {
  // Where the window comes back (electron/window_memory.cjs): the remembered
  // geometry when the display it was saved on is still connected and enough of
  // the window would land on screen, otherwise the default size centered on the
  // nearest display. Resolved BEFORE the constructor so the restored size is in
  // the options literal itself: applying it afterwards with setBounds would
  // create the window at the default size first, and the reveal on
  // 'ready-to-show' could catch it mid-resize.
  const restore = resolveWindowRestore({
    saved: desktopPrefs,
    displays: screen.getAllDisplays(),
    primaryId: screen.getPrimaryDisplay()?.id,
    defaults: { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
  });
  mainWindow = new BrowserWindow({
    x: restore.x,
    y: restore.y,
    width: restore.width,
    height: restore.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'World of ClaudeCraft',
    backgroundColor: '#05070a',
    // Created hidden and revealed on 'ready-to-show' below, so the player never
    // sees an unpainted white or empty frame before the client boots.
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // webSecurity:true and allowRunningInsecureContent:false are already the
      // Chromium defaults; pinned explicitly so the safe baseline survives any
      // future webPreferences edit (Electron security checklist items 5 and 6).
      webSecurity: true,
      allowRunningInsecureContent: false,
      // This wrapper exists to give the browser game the best possible Chromium runtime,
      // so tune the page for a real-time MMO client (all gameplay-neutral: the server is
      // authoritative, so none of this changes outcomes or reveals actionable info).
      //  - backgroundThrottling:false keeps the render loop and the 20 Hz input/network
      //    timer running when the window is backgrounded. Chromium would otherwise throttle
      //    setInterval to about once a minute and pause requestAnimationFrame, freezing the
      //    world mirror and stalling the realm WebSocket traffic, so a brief alt-tab would
      //    cost a visible hitch on refocus. A game client staying live when backgrounded is
      //    the expected behavior; the cost is power while minimized, acceptable for a game.
      //  - spellcheck:false avoids a dictionary download and red squiggles in chat input.
      //  - webviewTag:false is already the default; state it so no <webview> can be embedded.
      //  - disableBlinkFeatures:'Autofill' removes a stray autofill dropdown over form fields
      //    and the repeated "Autofill.enable failed" console spam.
      backgroundThrottling: false,
      spellcheck: false,
      webviewTag: false,
      disableBlinkFeatures: 'Autofill',
    },
  });

  // Show once, and only a window that is still alive and still hidden: the
  // fallback timer and 'ready-to-show' race by design, and crash recovery
  // reloads this same window's webContents (electron/crash_guard.cjs), so a
  // late refire must be a no-op rather than a second show. Captured `win`, not
  // the module-level mainWindow: createMainWindow can run again (macOS
  // 'activate'), and this window's timer must never act on a successor window.
  //
  // A session that ended maximized comes back maximized, and the maximize has
  // to live INSIDE the reveal: maximize() on a hidden window also shows it
  // (documented BrowserWindow contract, verified against Electron 43), so a
  // constructor-time maximize would present an unpainted frame for the whole
  // load, defeating show:false. Placed before show() so the first visible
  // frame is the already-maximized one.
  const win = mainWindow;
  const showMainWindow = () => {
    if (win.isDestroyed() || win.isVisible()) return false;
    // Borderless SUPERSEDES a maximized session: full screen already covers the
    // display, and doing both would leave the window remembering a maximized
    // state it never presented. Applied here for the same reason as the
    // maximize (and never as a `fullscreen` option on the constructor: an
    // explicit fullscreen:false disables the macOS full-screen button, and
    // constructor-time state would skip this reveal discipline entirely).
    if (desktopPrefs.displayMode === 'borderless') win.setFullScreen(true);
    else if (restore.maximized) win.maximize();
    win.show();
    return true;
  };
  revealMainWindow = showMainWindow;
  // A renderer that wedges before its first paint must not leave the player
  // with no window at all, so showing is armed on a timer as well. Armed once
  // per window creation (never re-armed on a crash-recovery reload) and cleared
  // both by 'ready-to-show' and by 'closed', so no timer outlives its window.
  let readyToShowFallback = setTimeout(() => {
    readyToShowFallback = null;
    if (!showMainWindow()) return;
    log.warn(
      `[shell] ready-to-show did not fire within ${READY_TO_SHOW_FALLBACK_MS}ms; the fallback showed the window`,
    );
  }, READY_TO_SHOW_FALLBACK_MS);
  const clearReadyToShowFallback = () => {
    if (readyToShowFallback === null) return;
    clearTimeout(readyToShowFallback);
    readyToShowFallback = null;
  };
  mainWindow.once('ready-to-show', () => {
    clearReadyToShowFallback();
    showMainWindow();
  });

  // Window hidden-ness, pushed from here because the page can never observe it.
  // Each event just re-derives (see sendPresentationState above), so none of
  // them carries a polarity of its own to get wrong. 'focus' is the self-heal
  // and the reason a missed event cannot strand the renderer: restoring a window
  // focuses it, so the first click or alt-tab into the game re-derives and
  // clears a stale hidden even if the WM swallowed the 'restore'.
  mainWindow.on('minimize', sendPresentationState);
  mainWindow.on('restore', sendPresentationState);
  mainWindow.on('hide', sendPresentationState);
  mainWindow.on('show', sendPresentationState);
  mainWindow.on('focus', sendPresentationState);

  // Window memory: where and how big the window was, so the next launch opens
  // it there (electron/desktop_prefs.cjs stores it, window_memory.cjs decides at
  // launch whether it is still usable). getNormalBounds, never getBounds: a
  // session that ends maximized must remember the size it would un-maximize to,
  // or the window could never come back small again. The whole prefs record is
  // written each time, so this and the GPU opt-out setter cannot clobber each
  // other's field. Captured `win` for the same reason as the timers above.
  let boundsSaveTimer = null;
  const clearBoundsSaveTimer = () => {
    if (boundsSaveTimer === null) return;
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = null;
  };
  const captureWindowBounds = () => {
    if (win.isDestroyed()) return;
    // Never capture while full screen: on Linux getNormalBounds() returns the
    // same rect as getBounds(), so a borderless session would persist the full
    // display rect over the windowed geometry it is supposed to restore to
    // (the startup smoke reproduced exactly that before this guard). Skipping
    // leaves the last windowed capture standing, which is the memory the
    // windowed mode wants; entering windowed live fires its own resize and
    // re-captures real bounds.
    if (win.isFullScreen()) return;
    const bounds = win.getNormalBounds();
    // Persist-then-commit, the same discipline as the IPC setters: the
    // candidate record is built fresh (the whole record, spread from the live
    // module-scope object, so this and the setters cannot clobber each
    // other's fields), saved, and committed to the in-memory record only when
    // the save reached disk. Mutating first would leave memory ahead of disk
    // on a failed save, and the next unrelated successful save would then
    // silently persist bounds no save ever accepted.
    const nextPrefs = {
      ...desktopPrefs,
      windowBounds: bounds,
      displayId: screen.getDisplayMatching(bounds)?.id,
      maximized: win.isMaximized(),
    };
    if (!saveDesktopPrefs(desktopPrefsPath, nextPrefs)) {
      // Once per debounce settle at most, and worth the line: the player's
      // window memory is silently not sticking.
      log.warn('[shell] could not persist the window geometry');
      return;
    }
    desktopPrefs.windowBounds = nextPrefs.windowBounds;
    desktopPrefs.displayId = nextPrefs.displayId;
    desktopPrefs.maximized = nextPrefs.maximized;
  };
  const scheduleWindowBoundsSave = () => {
    clearBoundsSaveTimer();
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null;
      captureWindowBounds();
    }, WINDOW_BOUNDS_SAVE_DEBOUNCE_MS);
  };
  mainWindow.on('resize', scheduleWindowBoundsSave);
  // 'close' is the last moment the bounds can be read at all: it fires while the
  // window still exists, where 'closed' is already after destruction. The
  // pending debounce is cancelled first so this final capture is what lands.
  mainWindow.on('close', () => {
    clearBoundsSaveTimer();
    captureWindowBounds();
  });

  // Dragging the window to another monitor can change the scale factor the
  // renderer resolves its drawing buffer from. 'moved' would be the natural
  // event but does not fire on Linux, so listen to 'move' (which fires
  // continuously through a drag) and debounce to the settled position. Captured
  // `win`, not the module-level mainWindow, for the same reason as the
  // ready-to-show fallback: this window's timer must never act on a successor.
  lastDisplayPush = null;
  let moveDisplayTimer = null;
  const clearMoveDisplayTimer = () => {
    if (moveDisplayTimer === null) return;
    clearTimeout(moveDisplayTimer);
    moveDisplayTimer = null;
  };
  // Two independent debounces ride this one event: the window-memory save above
  // and the display re-read below. Separate timers on purpose, since they answer
  // to different settle times and neither may swallow the other.
  mainWindow.on('move', () => {
    scheduleWindowBoundsSave();
    clearMoveDisplayTimer();
    moveDisplayTimer = setTimeout(() => {
      moveDisplayTimer = null;
      if (win.isDestroyed()) return;
      sendDisplayChange();
    }, MOVE_DISPLAY_DEBOUNCE_MS);
  });

  // The application menu is nulled for win32/linux at module scope, before app ready (see the
  // Menu.setApplicationMenu call there), so on those platforms there is no menu and therefore
  // no default DevTools accelerator; macOS keeps its default menu deliberately. The packaged
  // build never auto-opens DevTools either, so bind a debug affordance directly to
  // the renderer's key events: F12, Cmd+Option+I (macOS), or Ctrl+Shift+I (Windows/Linux)
  // toggles the inspector. This is how CSP violations, GPU state, and runtime errors get
  // inspected in a shipped app. DevTools is a local-only affordance requiring physical
  // keyboard access; its console runs arbitrary JS in the page's own (sandboxed,
  // context-isolated) main world and can drive the wocDesktop bridge, so it is NOT a
  // read-only view. It is left available because the server is authoritative (nothing the
  // console can do confers a gameplay advantage) and it needs local machine access.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsToggleShortcut(input)) return;
    event.preventDefault();
    const wc = mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // setWindowOpenHandler governs only new windows, not navigation of an existing
  // frame, so guard all three navigation events: will-navigate (main frame),
  // will-frame-navigate (any frame, so subframes are covered), and will-redirect
  // (server-side redirects). Each receives the merged single-details Event object
  // (details.url, details.isMainFrame, details.preventDefault()); the positional
  // (event, url) form is deprecated. An off-origin navigation is blocked.
  const guardNavigation = (details) => {
    const isMainFrame = details.isMainFrame !== false;
    if (!navigationAllowed(details.url, isMainFrame, appOrigins)) {
      details.preventDefault();
    }
  };
  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-frame-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);

  // Report GPU status once the page has loaded (and the renderer has created its WebGL
  // context), by when getGPUFeatureStatus and getGPUInfo have settled to the real values.
  // Bound with .on, not .once: a GPU-process crash followed by the crash-recovery
  // auto-reload is exactly when the adapter can flip to the WARP software fallback, and a
  // .once here would keep only the pre-crash healthy reading in the log. logGpuStatus
  // dedupes an unchanged renderer line itself.
  mainWindow.webContents.on('did-finish-load', logGpuStatus);

  // Re-push the presentation state on every load. The channel has no replay, so
  // a reload (or the crash-recovery page) comes up knowing nothing about whether
  // its window is hidden, exactly the reasoning behind the GPU verdict re-push.
  // A separate listener, so neither flow can swallow the other's work.
  mainWindow.webContents.on('did-finish-load', () => {
    sendPresentationState();
  });

  // Crash recovery for the game view: bounded auto-reload, then an i18n
  // Reload/Quit dialog (electron/crash_guard.cjs).
  attachRendererCrashRecovery({
    window: mainWindow,
    app,
    dialog,
    log,
    getStrings: getShellStrings,
  });

  // Mirror renderer console warnings/errors into the shell log file so a
  // shipped build's page-level failures (CSP violations, WebGL loss, network
  // errors) are diagnosable without DevTools. Info-level output stays out of
  // the file (electron/diagnostics.cjs shouldLogConsoleLevel), and the mirror
  // is session-capped like the renderer-error channel so console spam cannot
  // churn the log rotation.
  //
  // Single-arg listener: Electron 43 delivers the merged Event form (details.*)
  // to a one-parameter listener (a multi-parameter listener opts into the
  // deprecated positional args and logs a deprecation warning; verified against
  // Electron 43). normalizeConsoleMessage still accepts the legacy positional
  // form as cross-version insurance. The level is read cheaply BEFORE the
  // redacting normalize so a page spewing info-level console output cannot cost
  // per-line regex work in the main process.
  mainWindow.webContents.on('console-message', (details) => {
    if (consoleLinesMirrored >= MAX_MIRRORED_CONSOLE_LINES) return;
    const rawLevel = typeof details?.level === 'string' ? details.level : 'info';
    if (!shouldLogConsoleLevel(rawLevel)) return;
    const entry = normalizeConsoleMessage(details);
    if (!entry || !shouldLogConsoleLevel(entry.level)) return;
    consoleLinesMirrored += 1;
    if (consoleLinesMirrored === MAX_MIRRORED_CONSOLE_LINES) {
      log.warn('[renderer-console] mirror cap reached; further console output stays in DevTools');
    }
    log[entry.level === 'error' ? 'error' : 'warn'](
      '[renderer-console]',
      entry.message,
      entry.source,
    );
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
    // Opt-in auto-open for a packaged build, so the inspector is up from the first frame
    // when diagnosing a shipped app (WOC_OPEN_DEVTOOLS=1). The keyboard chord above works
    // regardless; this just saves a keystroke during a debug launch.
    if (process.env.WOC_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  // No window left to keep awake, and the presentation derivation cannot run
  // any more (it returns early on a destroyed window), so the display-sleep
  // lease is released from 'closed' rather than waiting out its idle timer.
  mainWindow.on('closed', () => {
    powerSave.setHidden(true);
    clearReadyToShowFallback();
    clearMoveDisplayTimer();
    clearBoundsSaveTimer();
    clearHiddenRederiveTimer();
    mainWindow = null;
  });
}

function openDesktopLogin() {
  const url = new URL('/desktop-login', desktopLoginOrigin);
  shell.openExternal(url.toString());
}

function openDesktopWalletHandoff(code) {
  return shell.openExternal(buildWalletHandoffBrowserUrl(apiOrigin, code));
}

// Bring the running window back to the player. A deep link or a second launch
// can arrive during the pre-paint hidden phase (the window is created with
// show:false), where restore()/focus() alone would leave the app looking dead,
// so a still-hidden window is revealed here: a dark unpainted frame beats
// nothing happening. The reveal routes through revealMainWindow, the SAME
// discipline 'ready-to-show' uses: a bare show() would present the window
// with neither its stored display mode nor its maximized memory, and
// showMainWindow no-ops once visible, so the miss would hold for the whole
// session (the world-entry display-mode echo cannot heal it either: the
// idempotent set-display-mode guard compares against the same stored prefs
// the bare reveal skipped). restore() before focus(), because focus() on a
// minimized window does nothing on Windows and Linux.
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible() && !(revealMainWindow && revealMainWindow())) {
    // Defensive only (createMainWindow always publishes the closure before
    // the window can be reached): an unrevealable window still beats a
    // vanished one.
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function deliverLoginCode(code) {
  pendingLoginCode = code;
  if (!mainWindow) return;
  mainWindow.webContents.send('desktop-login-code', code);
  focusMainWindow();
}

function deliverWalletHandoffCode(code) {
  pendingWalletHandoffCode = code;
  if (process.platform === 'darwin') app.focus({ steal: true });
  if (!mainWindow) return;
  mainWindow.webContents.send('desktop-wallet-handoff-code', code);
  focusMainWindow();
}

function handleDeepLink(url) {
  const walletHandoff = parseWalletHandoffDeepLink(url);
  if (walletHandoff) {
    deliverWalletHandoffCode(walletHandoff.code);
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'worldofclaudecraft:' || parsed.hostname !== 'desktop-login') return;
  const code = parsed.searchParams.get('code');
  if (!code) return;
  deliverLoginCode(code);
}

// Trust only IPC from our own app frame (or the dev server in dev). event.senderFrame
// is read synchronously at the very top of each handler, before any other work; a null
// or foreign-origin sender is rejected with null.
const trustedSender = (event) => isTrustedSender(event.senderFrame, appOrigins);

// Steam link tickets (electron/steam.cjs). Inert on website builds: the shell
// only lazy-requires steamworks.js when the distribution stamp says 'steam'
// (or the unpackaged WOC_STEAM_DEV=1 dev loop), and getLinkTicket() answers
// null on every failure path instead of throwing across IPC.
const steamShell = createSteamShell({
  distribution: desktopConfig.distribution,
  packagedMetadata,
  env: process.env,
  isPackaged: app.isPackaged,
  log,
});

ipcMain.handle('desktop-steam-link-ticket', async (event) => {
  if (!trustedSender(event)) return null;
  return await steamShell.getLinkTicket();
});

// The renderer signals that a link attempt has settled (POST /api/steam/link
// resolved or rejected) so the shell can CancelAuthTicket the live handle
// promptly (Valve's contract), rather than waiting for the next mint or process
// exit. Idempotent; inert on website builds (no live handle ever exists).
ipcMain.handle('desktop-steam-link-settled', (event) => {
  if (!trustedSender(event)) return null;
  steamShell.cancelLinkTicket();
  return null;
});

// Whether this shell can mint link tickets at all (steam distribution or the
// unpackaged dev loop): the renderer hides the Link button when false instead
// of offering a click whose ticket can never exist (website builds). Computed
// without loading steamworks.js.
ipcMain.handle('desktop-steam-capability', (event) => {
  if (!trustedSender(event)) return false;
  return steamShell.enabled;
});

// Epic link proofs (electron/epic.cjs). Inert on website/steam builds: the
// shell only touches the injectable EOS adapter when the distribution stamp
// says 'epic' (or the unpackaged WOC_EPIC_DEV=1 dev loop), and getLinkProof()
// answers null on every failure path instead of throwing across IPC. Missing
// native degrades to the launcher exchange-code argv path, then null;
// capability still reports true on the epic channel so the UI can offer Link.
const epicShell = createEpicShell({
  distribution: desktopConfig.distribution,
  packagedMetadata,
  env: process.env,
  isPackaged: app.isPackaged,
  log,
});

ipcMain.handle('desktop-epic-link-proof', async (event) => {
  if (!trustedSender(event)) return null;
  return await epicShell.getLinkProof();
});

// The renderer signals that an Epic link attempt has settled (POST
// /api/epic/link resolved or rejected) so any cancelable adapter handle can
// be released promptly. Idempotent; inert when no live handle exists.
ipcMain.handle('desktop-epic-link-settled', (event) => {
  if (!trustedSender(event)) return null;
  epicShell.cancelLinkProof();
  return null;
});

// Whether this shell can mint Epic link proofs at all (epic distribution or
// the unpackaged WOC_EPIC_DEV loop). Computed without loading EOS native.
ipcMain.handle('desktop-epic-capability', (event) => {
  if (!trustedSender(event)) return false;
  return epicShell.enabled;
});

// WalletConnect is available in the website-distributed desktop shell but is
// intentionally absent from Steam until that distribution enables it.
ipcMain.handle('desktop-wallet-capability', (event) => {
  if (!trustedSender(event)) return false;
  return walletConnectionSupported(desktopConfig);
});

// The $WOC Exchange may attach only in the website-distributed shell. Steam
// and Epic builds, and any build without an explicit website stamp, answer
// false so no Exchange UI exists there at all (desktop_config.cjs owns the
// decision; the renderer gate in src/game/woc_market_wiring.ts fails closed
// on a false, missing, or failing answer).
ipcMain.handle('desktop-exchange-capability', (event) => {
  if (!trustedSender(event)) return false;
  return desktopConfig.wocExchangeEnabled === true;
});

ipcMain.handle('desktop-login-open-browser', (event) => {
  if (!trustedSender(event)) return null;
  openDesktopLogin();
  return null;
});

ipcMain.handle('desktop-login-take-code', (event) => {
  if (!trustedSender(event)) return null;
  const code = pendingLoginCode;
  pendingLoginCode = null;
  return code;
});

ipcMain.handle('desktop-wallet-open-browser', async (event, code) => {
  if (!trustedSender(event)) return false;
  try {
    await openDesktopWalletHandoff(code);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('desktop-wallet-take-code', (event) => {
  if (!trustedSender(event)) return null;
  const code = pendingWalletHandoffCode;
  pendingWalletHandoffCode = null;
  return code;
});

// The renderer's t()-localized shell strings (crash dialog text). Validated
// and clamped in shell_strings.cjs; unknown keys and junk values are dropped.
ipcMain.handle('desktop-set-strings', (event, strings) => {
  if (!trustedSender(event)) return null;
  shellStrings = sanitizeShellStrings(strings, shellStrings);
  return null;
});

// The player's opt-out of the discrete-GPU force (Options > Interface). Stored, not applied
// live: both levers run before Electron's own startup (see the two call sites at the top of
// this file), so a toggle takes effect at the NEXT launch. The renderer gets true only when
// the value actually reached disk, and the in-memory record is updated only then, so what
// the getter reports is always what the next launch will read.
ipcMain.handle('desktop-set-gpu-force-opt-out', (event, optOut) => {
  if (!trustedSender(event)) return false;
  // Strictly boolean: anything else is a bug or a probe, and neither may write.
  if (optOut !== true && optOut !== false) return false;
  if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, gpuForceOptOut: optOut })) {
    log.warn('[gpu] could not persist the GPU force preference');
    return false;
  }
  desktopPrefs.gpuForceOptOut = optOut;
  return true;
});

// What the NEXT launch will do, which is what the settings control shows: the stored value,
// not a reading of this launch's GPU state.
ipcMain.handle('desktop-get-gpu-force-opt-out', (event) => {
  if (!trustedSender(event)) return false;
  return desktopPrefs.gpuForceOptOut === true;
});

// How the shell presents its window (Options > Interface). Unlike the GPU force this
// applies LIVE as well as being stored: the player expects the mode to change under the
// click, and the next launch reads the same stored value at the reveal. Persisted first,
// so a mode that could not be written is not applied to a window the next launch would
// open differently.
ipcMain.handle('desktop-set-display-mode', (event, mode) => {
  if (!trustedSender(event)) return false;
  // The two literals only: this value is fed straight to setFullScreen, so a junk value
  // must not reach the file, let alone the window.
  if (mode !== 'borderless' && mode !== 'windowed') return false;
  // Idempotent on purpose: the renderer's world-entry apply-all loop re-sends
  // the reflected mode, and answering it with a disk write plus a setFullScreen
  // of the current state would snap back a window the player has manually
  // fullscreened (or restored) since launch. Same value stored = nothing to do.
  // Accepted cost (phase 8 QA, re-litigated): a window the WM forced OUT of
  // the stored mode is not healed by re-selecting that same mode; the
  // in-session heal is the two-click toggle, and the next launch re-applies
  // the stored mode at the reveal. Comparing against the live window instead
  // would turn the world-entry echo into exactly the snap-back this guard
  // exists to stop, because the echo and a deliberate same-value re-select
  // are byte-identical at this boundary.
  if (mode === desktopPrefs.displayMode) return true;
  if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, displayMode: mode })) {
    log.warn('[shell] could not persist the display mode preference');
    return false;
  }
  desktopPrefs.displayMode = mode;
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Leaving full screen restores the pre-fullscreen bounds itself, which is why
    // windowed needs no geometry of its own here.
    mainWindow.setFullScreen(mode === 'borderless');
  }
  return true;
});

// What the settings control shows: the stored mode, which is also what the next launch
// applies at the reveal. Guaranteed to be one of the two literals by the prefs sanitizer.
ipcMain.handle('desktop-get-display-mode', (event) => {
  if (!trustedSender(event)) return 'borderless';
  return desktopPrefs.displayMode;
});

// Exit the application through Electron's normal quit lifecycle. This lets
// the window close handler capture its final remembered bounds and gives
// before-quit / will-quit handlers their normal teardown opportunity.
ipcMain.handle('desktop-app-quit', (event) => {
  if (!trustedSender(event)) return false;
  if (!mainWindow) return false;
  if (mainWindow.isDestroyed()) return false;
  app.quit();
  return true;
});

// Gamepad activity from the renderer's input loop, the one signal the display-sleep lease
// runs on (gamepad input does not reset the OS idle timer on any platform we ship). The
// renderer fires and forgets; the rate limit lives in electron/power_save.cjs.
ipcMain.handle('desktop-gamepad-activity', (event) => {
  if (!trustedSender(event)) return false;
  powerSave.notifyActivity();
  return true;
});

// An OS notification for something the player asked to be told about while the
// game is not the focused window. Both strings arrive already rendered by the
// renderer's t(), because main stays language-agnostic and has no catalog of its
// own. The focus re-check here is the trusted-side mirror of the renderer's own
// gate rather than a duplicate of it: a renderer that lost track of focus (or a
// page that never checked) must not be able to toast a player who is looking
// straight at the game. Caps are 120/240 through clampText (a clamped string
// gains a three-dot suffix on top of the cap), which also flattens control and
// invisible-formatting characters so a crafted string cannot smuggle escapes
// or bidi reordering into the OS surface, and the rate limit stamps only on a
// notification that really shows. The guard also holds the per-session TOTAL
// cap (notify_guard.cjs MAX_NOTIFICATIONS_PER_SESSION, the console-mirror
// precedent): once a session has shown its fill, further asks drop silently.
// On Linux both strings additionally have their markup-significant characters
// entity-escaped (electron/diagnostics.cjs escapeNotificationMarkup): the
// freedesktop spec lets daemons parse markup in bodies, and a toast must
// never style itself or plant a link. Other platforms treat notification
// text as plain and get the strings verbatim. The escape deliberately runs
// AFTER the clamp: escaping first and clamping second could cut an entity
// mid-sequence, while the post-clamp expansion is bounded at five times the
// cap and purely cosmetic.
// A click only focuses the window, through the one shared focusMainWindow path,
// so the notification can never become a navigation the renderer chose.
ipcMain.handle('desktop-show-notification', (event, payload) => {
  if (!trustedSender(event)) return false;
  if (!payload || typeof payload !== 'object') return false;
  const kind = payload.kind;
  if (kind !== 'update-ready' && kind !== 'party-invite') return false;
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return false;
  const title = clampText(payload.title, 120);
  const body = clampText(payload.body, 240);
  if (title.trim() === '' || body.trim() === '') return false;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return false;
  if (!Notification.isSupported()) return false;
  if (!notifyGuard.allow(kind)) return false;
  const escapeMarkup = process.platform === 'linux';
  const notification = new Notification({
    title: escapeMarkup ? escapeNotificationMarkup(title) : title,
    body: escapeMarkup ? escapeNotificationMarkup(body) : body,
    silent: false,
  });
  notification.on('click', focusMainWindow);
  notification.show();
  return true;
});

// The Discord Rich Presence line. The renderer decides WHAT to report (it is
// the only side that knows the zone, and it is the side with a catalog, so the
// string arrives already rendered by its t()); main decides what may leave the
// machine. The whitelist itself lives in electron/discord_presence.cjs
// (sanitizeDiscordActivity) rather than inline here, because it is the
// privacy-load-bearing part of this handler and belongs where a test can
// EXECUTE it: an extra field quietly added to the outgoing object later is the
// regression this feature can least afford, and no amount of reading the
// handler proves that what leaves carries only the two allowed keys.
// The pacing, the connection, and every failure arm live in that module too; a
// shell with no Discord running does nothing here but return true.
ipcMain.handle('desktop-set-discord-activity', (event, payload) => {
  if (!trustedSender(event)) return false;
  // Null is the CLEAR, and it is the one payload with nothing to validate: the
  // renderer sends it when the fed world loses its player, once at every page
  // boot (the logout path is a location.reload(), so the NEXT page's
  // reconciliation clear is what covers leaving the world that way), and when
  // presence is disabled.
  if (payload === null) {
    discordPresence.setActivity(null);
    return true;
  }
  const clean = sanitizeDiscordActivity(payload, clampText);
  if (!clean) return false;
  discordPresence.setActivity(clean);
  return true;
});

// The player's Discord presence setting (Options > Interface). Stored like the
// other shell preferences AND applied live, because the toggle's promise is
// that turning it off removes the line from Discord now, not at the next
// launch. Persisted first, so a value that could not be written is not applied
// to a session the next launch would start differently.
ipcMain.handle('desktop-set-discord-presence-enabled', (event, enabled) => {
  if (!trustedSender(event)) return false;
  // Strictly boolean: anything else is a bug or a probe, and neither may write.
  if (enabled !== true && enabled !== false) return false;
  // Idempotent on purpose, and BEFORE the save: the renderer's world-entry
  // apply-all loop re-sends the reflected value, so without this early return
  // every world entry would rewrite the prefs file and re-run the clear/connect
  // transition for a setting that did not change.
  if (enabled === desktopPrefs.discordPresenceEnabled) return true;
  if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, discordPresenceEnabled: enabled })) {
    log.warn('[discord] could not persist the presence preference');
    return false;
  }
  desktopPrefs.discordPresenceEnabled = enabled;
  discordPresence.setEnabled(enabled);
  return true;
});

// Uncaught renderer errors forwarded by the preload. The preload clamps and
// caps, but main re-validates and re-caps without trusting it
// (electron/diagnostics.cjs); a malformed payload is dropped silently.
let rendererErrorsLogged = 0;
ipcMain.on('desktop-renderer-error', (event, payload) => {
  if (!trustedSender(event)) return;
  if (rendererErrorsLogged >= MAX_FORWARDED_ERRORS) return;
  const entry = rendererErrorLogEntry(payload);
  if (!entry) return;
  rendererErrorsLogged += 1;
  log.error('[renderer]', entry);
});

// Linux has no OS-level protocol registry to write: the scheme is owned by a .desktop
// entry, which an AppImage never installs and which Electron's own registration misnames.
// electron/linux_url_handler.cjs fixes both, and MUST run first so the file and the
// CHROME_DESKTOP name are in place before setAsDefaultProtocolClient shells out to
// xdg-settings. No-op on win32/darwin and on every non-AppImage Linux channel.
const linuxUrlHandler = registerLinuxUrlHandler({ scheme: deepLinkProtocol, log });

// CHROME_DESKTOP is process-wide and inherited by every child, including the browser we open
// for the Discord login itself. It exists only for the registration below, so the restore runs
// in a finally: a throw from setAsDefaultProtocolClient would otherwise leave our app identity
// set for every child, which is the exact outcome the module documents as the reason to
// restore it. No-op on win32/darwin, and when nothing was set.
try {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(deepLinkProtocol, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(deepLinkProtocol);
  }
} finally {
  linuxUrlHandler.restore();
  // AFTER setAsDefaultProtocolClient, never alongside it. Electron's Linux path shells out to
  // xdg-settings, which runs `xdg-mime default` itself against the same unlocked file, and a
  // torn read there makes it restore the ORIGINAL association and fail: exactly the broken
  // state this is meant to fix. Ours stays as the fallback for when Electron's registration
  // does not take.
  linuxUrlHandler.associate();
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Launching the game again is a request to see it, deep link or not: the
    // second process quits, so without this the click would look like nothing
    // happened when the first window sits minimized or behind another app.
    focusMainWindow();
    const url = argv.find((arg) => arg.startsWith(`${deepLinkProtocol}://`));
    if (url) handleDeepLink(url);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

// Log Chromium's GPU feature status and the active GL renderer so a shipped build can be
// checked for hardware-accelerated WebGL (the whole point of the wrapper). In the feature
// status, 'enabled' means hardware; 'software only' or 'disabled' means Chromium fell back to
// SwiftShader, which a WebGL game must not silently run on. getGPUInfo('complete') resolves
// the actual adapter (glRenderer names the real GPU, e.g. "Apple M1", vs "SwiftShader") and
// auxAttributes.softwareRendering is Chromium's own verdict; its gpuDevice list is the one
// line that settles a hybrid-laptop support ticket from a single player-supplied main.log
// (both adapters present, wrong one active means the gpu_preference.cjs levers did not take
// effect). This MUST run after the GPU process has reported (call it on the window's
// did-finish-load, not at whenReady, where getGPUFeatureStatus can still return a
// pre-initialization 'disabled_off'). Runs again after every reload (crash recovery); an
// unchanged renderer reading is deduped to keep the log quiet. The log lines themselves are
// dev-channel diagnostics; the whitelisted verdict pushed on 'desktop-gpu-status' is the one
// user-facing product of this flow (the renderer localizes it, see src/game/).
let lastGpuRendererLog = '';
function logGpuStatus() {
  let softwareVerdict = false;
  try {
    const status = app.getGPUFeatureStatus();
    log.info('[gpu] feature status', status);
    softwareVerdict = isSoftwareRenderer(status);
    if (softwareVerdict) {
      log.warn('[gpu] WebGL is NOT hardware-accelerated:', {
        webgl: status?.webgl,
        webgl2: status?.webgl2,
      });
    }
  } catch (err) {
    log.error('[gpu] could not read feature status', err);
  }
  app.getGPUInfo('complete').then(
    (info) => {
      const aux = info?.auxAttributes ?? {};
      if (aux.softwareRendering) {
        log.warn('[gpu] GPU process reports softwareRendering: the game is on a CPU rasterizer');
      }
      const { devices, discreteInactive } = summarizeGpuDevices(info?.gpuDevice);
      // Push the verdict BEFORE the log dedup below: the dedup exists only to keep the log
      // quiet, and after a crash-recovery reload the reading is usually identical, so a send
      // placed after it would never reach the freshly loaded page. This resolves async, so
      // re-check the window rather than trusting the caller's.
      const gpuStatus = gpuStatusPayload({
        softwareRendering: aux.softwareRendering,
        glRenderer: aux.glRenderer,
        discreteInactive,
        softwareVerdict,
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop-gpu-status', gpuStatus);
      }
      const line = {
        glRenderer: aux.glRenderer,
        glVendor: aux.glVendor,
        adapters: devices,
      };
      const key = JSON.stringify(line);
      if (key === lastGpuRendererLog) return;
      lastGpuRendererLog = key;
      log.info('[gpu] active renderer', line);
      if (discreteInactive) {
        log.warn(
          '[gpu] a discrete GPU is present but INACTIVE: the OS bound the integrated or ' +
            'software adapter, so the per-app preference and the Chromium switch did not ' +
            'take effect on this machine',
        );
      }
    },
    (err) => log.error('[gpu] could not read gpu info', err),
  );
}

app.whenReady().then(() => {
  log.info('[shell] starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    distribution: desktopConfig.distribution,
    updaterEnabled: desktopConfig.updaterEnabled,
    updateChannel: desktopConfig.updateChannel,
    // Logged so the per-channel release smoke (docs/desktop-release.md step 6)
    // has a field to read; on an unstamped packaged build `distribution` says
    // website (the channel collapse) while this correctly says false.
    wocExchangeEnabled: desktopConfig.wocExchangeEnabled,
    crashUpload: desktopConfig.crashSubmitUrl !== '',
    crashDumpDir: app.getPath('crashDumps'),
    logFile: logFilePath,
  });
  registerAppProtocol();
  lockDownPermissions();
  createMainWindow();

  // A monitor being added, removed, or re-scaled (a DPI change mid-session)
  // changes a reading the renderer's viewport poll cannot see: it reacts to size
  // changes, not to a pure scale change. Registered at app level, ONCE: the
  // screen module outlives every window, and a per-window registration would
  // stack a duplicate each time createMainWindow ran (macOS 'activate'). Noise
  // from an unrelated monitor is absorbed by the dedup in sendDisplayChange.
  screen.on('display-metrics-changed', () => sendDisplayChange());

  // Keep 'desktop-update-install' answerable whenever the real updater did NOT
  // claim it, so a renderer installUpdate() resolves null instead of rejecting
  // with "No handler registered". Registered when the updater is off (Steam/dev)
  // AND when an updater-enabled build could not load its updater bundle. The
  // try/catch guards the (practically impossible) double-registration race.
  const registerDisabledUpdateInstall = () => {
    try {
      ipcMain.handle('desktop-update-install', (event) => {
        if (!trustedSender(event)) return null;
        log.warn('[updater] install requested but auto-update is unavailable on this build');
        return null;
      });
    } catch (err) {
      log.warn('[updater] disabled-install handler already registered', err?.message ?? err);
    }
  };

  // Auto-update, website distribution only (desktop_config.cjs gates on
  // packaged + channel; Steam updates via SteamPipe depots, dev has nothing to
  // update). A failed init degrades to a log line: the game must still run.
  if (desktopConfig.updaterEnabled) {
    let updater = null;
    try {
      updater = initUpdater({
        ipcMain,
        log,
        getWindow: () => mainWindow,
        isTrusted: trustedSender,
        isPackaged: app.isPackaged,
        // The normalized origin this install talks to and the update channel
        // derived from it (electron/update_guard.cjs): the updater reads only
        // its own track's feed and refuses cross-origin artifacts.
        apiOrigin,
        updateChannel: desktopConfig.updateChannel,
      });
    } catch (err) {
      log.error('[updater] init failed', err);
    }
    // initUpdater returns null (without registering its handler) when the
    // updater bundle is missing or broken; keep the channel answerable then.
    if (!updater) registerDisabledUpdateInstall();
  } else {
    registerDisabledUpdateInstall();
  }

  const initialDeepLink = process.argv.find((arg) => arg.startsWith(`${deepLinkProtocol}://`));
  if (initialDeepLink) handleDeepLink(initialDeepLink);

  app.on('activate', () => {
    // A dock click during the pre-paint hidden phase must reveal the live
    // window, not no-op because a (hidden) window already exists.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else focusMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Drop the display-sleep lease for good on the way out. Terminal, so a late
// window event during teardown cannot re-arm a timer in a process that is
// leaving; on macOS the app can outlive its window, which is exactly why this
// hangs off quit rather than off 'window-all-closed'.
app.on('will-quit', () => {
  powerSave.shutdown();
  // Same reasoning for the presence socket: a reconnect timer that survived
  // the quit would hold a handle open behind a process on its way out.
  discordPresence.dispose();
});
