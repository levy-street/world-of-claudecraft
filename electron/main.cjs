const {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
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
const { resolveDesktopConfig } = require('./desktop_config.cjs');
const { PRODUCTION_API_ORIGIN } = require('./update_guard.cjs');
const {
  MAX_FORWARDED_ERRORS,
  MAX_MIRRORED_CONSOLE_LINES,
  normalizeConsoleMessage,
  rendererErrorLogEntry,
  shouldLogConsoleLevel,
} = require('./diagnostics.cjs');
const { initLogging } = require('./logging.cjs');
const { DEFAULT_SHELL_STRINGS, sanitizeShellStrings } = require('./shell_strings.cjs');
const { attachRendererCrashRecovery, installProcessCrashGuards } = require('./crash_guard.cjs');
const { initUpdater } = require('./updater.cjs');

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
let pendingLoginCode = null;
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
const desktopConfig = resolveDesktopConfig({
  packagedMetadata: readPackagedMetadata(),
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
    },
  },
]);

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
    // Every served path (asset or the SPA index.html fallback) gets the CSP header;
    // net.fetch's own Response has immutable headers, so withCspHeader builds a fresh
    // one that preserves the body, status, statusText, and Content-Type.
    const response = await net.fetch(pathToFileURL(filePath).toString());
    return withCspHeader(response, csp);
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'World of ClaudeCraft',
    backgroundColor: '#05070a',
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

  mainWindow.setMenu(null);

  // setMenu(null) drops the default menu (and its DevTools accelerator), and the packaged
  // build never auto-opens DevTools, so bind a debug affordance directly to
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
  mainWindow.webContents.once('did-finish-load', logGpuStatus);

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openDesktopLogin() {
  const url = new URL('/desktop-login', desktopLoginOrigin);
  shell.openExternal(url.toString());
}

function deliverLoginCode(code) {
  pendingLoginCode = code;
  if (!mainWindow) return;
  mainWindow.webContents.send('desktop-login-code', code);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function handleDeepLink(url) {
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

// The renderer's t()-localized shell strings (crash dialog text). Validated
// and clamped in shell_strings.cjs; unknown keys and junk values are dropped.
ipcMain.handle('desktop-set-strings', (event, strings) => {
  if (!trustedSender(event)) return null;
  shellStrings = sanitizeShellStrings(strings, shellStrings);
  return null;
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

if (process.defaultApp) {
  app.setAsDefaultProtocolClient(deepLinkProtocol, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(deepLinkProtocol);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
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
// auxAttributes.softwareRendering is Chromium's own verdict. This MUST run after the GPU
// process has reported (call it on the window's did-finish-load, not at whenReady, where
// getGPUFeatureStatus can still return a pre-initialization 'disabled_off'). Dev-channel
// diagnostics only (the log file), never user-facing.
function logGpuStatus() {
  try {
    const status = app.getGPUFeatureStatus();
    log.info('[gpu] feature status', status);
    if (isSoftwareRenderer(status)) {
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
      log.info('[gpu] active renderer', {
        glRenderer: aux.glRenderer,
        glVendor: aux.glVendor,
      });
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
    crashUpload: desktopConfig.crashSubmitUrl !== '',
    crashDumpDir: app.getPath('crashDumps'),
    logFile: logFilePath,
  });
  registerAppProtocol();
  lockDownPermissions();
  createMainWindow();

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
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
