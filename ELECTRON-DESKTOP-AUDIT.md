# Electron desktop app: deep audit and upgrade plan

Research date: 2026-07-01. Branch: `feature/electron-steam-desktop`.
Scope: the Electron/Steam desktop wrapper (`electron/main.cjs`, `electron/preload.cjs`,
`scripts/electron-dev.mjs`, `scripts/electron-build.mjs`, and the `build` block in
`package.json`). Every version and best-practice claim below was verified live against
primary sources (release pages, official Electron/Steamworks/Apple/Microsoft docs) on the
research date, then run through an adversarial verification pass that tried to refute each
finding and re-check its currency.

## Product decisions this plan is built on

These were locked with the maintainer during the audit:

1. Distribution is two channels: the Steam store AND direct downloads from
   worldofclaudecraft.com. One Electron bundle serves both; no separate native Steam build.
2. Sign-in is Discord plus email only, exactly the web flow: email/password logs in
   inside the app, and Discord goes through the browser plus deep-link `desktop-login`
   handoff. There is no Steam sign-in (Discord is the community-growth funnel, and one
   bundle must behave identically on both channels).
3. Keep the dependency set tiny (repo doctrine). Prefer pure-code fixes and config over new
   packages.

## TL;DR

- The shell is genuinely well built for its size. The load-bearing isolation is correct
  (`contextIsolation`, `sandbox`, `nodeIntegration:false`), the custom protocol is modern
  and traversal-guarded, single-instance and deep-link handling is textbook, and the preload
  is minimal and sandbox-compliant.
- Versions are current: Electron 43 (the newest stable; this plan bumped it from 42) and
  electron-builder on the newest 26.x.
- Every gap this audit found has since been implemented on the branch (the
  implementation-status sections below record the details): deny-by-default permissions,
  the navigation guards, the app:// CSP, IPC sender validation, the fuses plus ASAR
  integrity, macOS/Windows signing and notarization config, the website auto-updater with
  the Steam split, and full error/crash capture. What remains is maintainer accounts and
  infrastructure, listed in `docs/desktop-release.md`.
- Sign-in is email plus Discord only (the web flow). steamworks.js was removed entirely;
  Steam is a distribution channel only.

## Implementation status (branch feature/electron-steam-desktop)

Done in this hardening pass (each is its own commit; see the git log):

- Steam sign-in code removed (section 6): sign-in is Discord and email only; the
  browser plus deep-link desktop-login flow is intact; steamworks.js and its
  asarUnpack entry are gone.
- S1, deny-by-default permissions: an allow-list of pointerLock and fullscreen in
  both permission gates, plus setDevicePermissionHandler denying device access.
- S2, navigation guard: will-navigate, will-frame-navigate, and will-redirect all
  block off-origin navigation, with the origin derived as protocol//host (not
  URL.origin, which is "null" for every app:// host).
- S3, Content-Security-Policy: served on every app:// response; strict script-src
  with the inline bootstrap scripts hashed from the built index.html at runtime; no
  unsafe-eval and no unsafe-inline scripts.
- S4, IPC sender validation: both desktop-login handlers check event.senderFrame.
- S5, Electron fuses: the safe set is enabled (RunAsNode off, cookie encryption on,
  node-options and inspect off, file-protocol-extra-privileges off, only-load-app-
  from-asar on).

The pure origin, CSP, and trusted-sender logic lives in electron/shell_guards.cjs
with unit tests (tests/electron_shell_guards.test.ts), since main.cjs runs outside
tsc and vitest.

### Launch, inspect, perform, and in-app login pass (2026-07-01)

A follow-up pass on top of the hardening. The goal for the wrapper is one thing: the
best possible Chromium runtime for the same browser game, kept gameplay-neutral. Four
changes, each its own commit.

- Packaged app launch crash, fixed (unblocks every unsigned local/CI test build). The
  electronFuses flip rewrites the Electron executable, which invalidates the prebuilt
  ad-hoc signature and the surrounding bundle seal. When a build has no real Developer ID,
  electron-builder was skipping signing, so the app shipped with a broken signature and the
  Apple Silicon kernel SIGKILLed it at launch (Code Signature Invalid). Fix: in
  scripts/electron-build.mjs, when no real certificate is configured (CSC_LINK and CSC_NAME
  both unset), pass electron-builder `--config.mac.identity=-` so it ad-hoc signs the whole
  bundle itself. That runs @electron/osx-sign AFTER the fuse flip (electron-builder flips
  fuses immediately before signing by design), producing a valid ad-hoc signature that
  launches with no manual `codesign` step. Scoped to macOS and to unsigned builds only, so
  the deferred production path (B1) is untouched: set CSC_LINK or CSC_NAME and the override
  is skipped, and the real certificate signs the app.
  Options considered and rejected: an afterPack/afterSign hook (rejected: afterPack runs
  BEFORE the fuse flip so its re-sign is clobbered, and afterSign is skipped entirely when
  no signing occurs); electronFuses.resetAdHocDarwinSignature (works, but re-signs even
  signed production builds and its `codesign --deep` is the legacy path); skipping the fuse
  flip for unsigned builds (loses the fused-binary test coverage locally).
- Packaged-build DevTools affordance (N-new). setMenu(null) plus no DevTools left no way to
  inspect CSP, GPU, or errors in a shipped app. A before-input-event handler now toggles
  DevTools on F12, Cmd+Option+I (macOS), or Ctrl+Shift+I (Windows/Linux); WOC_OPEN_DEVTOOLS=1
  auto-opens it on launch. DevTools is read-only against the sandboxed, context-isolated
  renderer and confers no gameplay advantage. The chord predicate is pure
  (isDevToolsToggleShortcut in shell_guards.cjs, matched on the PHYSICAL key code because
  macOS Option composes input.key into a dead key), unit-tested.
- Runtime CSP verification found and fixed one real block. Launching the packaged app with
  Chromium logging showed the ONLY violations were connect-src refusing 226 blob: URLs:
  Three.js GLTFLoader loads a model's embedded textures by turning them into blob: object
  URLs and fetch()ing them (a connect-src request, not img-src), so every model rendered
  untextured. Fix: add blob: to connect-src in buildContentSecurityPolicy (img-src and
  worker-src already had it). After the fix a relaunch logged zero CSP violations. Everything
  else the game needs is already allowed: 'wasm-unsafe-eval' for the Three.js WASM decoders,
  worker-src blob: for decoder workers, 'self' for dynamic imports and app:// assets, wss:
  for the realm socket, and the HTTPS API origin. The web build ships no CSP at all, so the
  desktop CSP stays a strict superset of what the web build implicitly allows.
- N2 and N7, performance and QoL. webPreferences now set backgroundThrottling:false (an MMO
  client must keep its render loop and its 20 Hz input/network timer alive when backgrounded;
  Chromium would otherwise throttle timers to about once a minute and pause rAF, stalling the
  world mirror and the realm WebSocket for a visible hitch on refocus; the server has no
  app-level idle disconnect, so this is safe and gameplay-neutral), spellcheck:false,
  webviewTag:false (explicit), and disableBlinkFeatures:'Autofill'. Hardware acceleration is
  left ON (no disableHardwareAcceleration, no blocklist override); a diagnostic logs
  app.getGPUFeatureStatus() plus getGPUInfo('complete') glRenderer, fired on the window's
  did-finish-load (NOT at whenReady, where the GPU process has not reported yet and WebGL can
  read a spurious 'disabled_off'), so a shipped build can confirm WebGL is hardware-accelerated
  (verified: webgl 'enabled', not SwiftShader). No GPU command-line switches were shipped:
  --ignore-gpu-blocklist and forced-GPU switches were considered and left out (risk or power
  cost without a measured win); the client's own FPS governor is left to own frame pacing.
- Login stays in the app (fixes a hardening-pass regression). Clicking Play (Online) in the
  desktop app now shows the in-app #login-panel instead of bouncing to the website;
  username/password logs in in place via api.login. Only "Continue with Discord" is routed to
  the external browser (#btn-login-discord calls the preload openBrowserLogin bridge in the
  desktop build), because its OAuth redirect is off-origin and the navigation guard blocks it
  in-app; it returns via the worldofclaudecraft://desktop-login?code= deep link (unchanged).

Known dependency, not a wrapper bug (server deploy): the packaged app is served from origin
app://worldofclaudecraft and calls https://worldofclaudecraft.com, a cross-origin request that
needs the server to reflect Access-Control-Allow-Origin for that origin. This branch's server
already allows it (server/web_login_guard.ts DESKTOP_APP_ORIGINS includes app://worldofclaudecraft,
reflected by maybeCors), but a live probe of production returns no CORS header for that origin,
so production has not been deployed with this support yet. Until it is, the desktop app cannot
reach the REST API from production (login, realm list, and the landing-page player counts all
fail CORS); the realm WebSocket itself is not Origin-gated. Unblock by deploying this branch's
server to production, or for a local end-to-end smoke test point the build at a local server:
VITE_DESKTOP_API_ORIGIN=http://localhost:8787 npm run electron:pack (local is http/ws).

Deferred, gated on code signing (B1), not done here:

- EnableEmbeddedAsarIntegrityValidation (to be paired with the enabled
  OnlyLoadAppFromAsar): it only delivers real tamper protection once the binary is
  signed and commonly fails to launch unsigned.
- macOS signing plus notarization (B1), website auto-update (S6), Windows signing
  (N3), and the remaining nice-to-haves (N1, N2, N4 to N8).

### Production-readiness pass (2026-07-01, ship prep)

The pass that closes the deferred list above for public distribution (website
download + Steam depot). Full operational detail in docs/desktop-release.md; the
per-area design notes live as comments in the new electron/*.cjs modules. Four
commits:

- Channel split + packaging hygiene. scripts/electron-build.mjs derives a
  per-channel electron-builder config (pure, tested scripts/electron-builder-config
  .mjs) and stamps extraMetadata.wocDesktop into the packaged package.json;
  electron/desktop_config.cjs (pure, tested) resolves {distribution,
  updaterEnabled, crashSubmitUrl} at runtime. The bundle stops shipping the repo's
  production node_modules (pg, three, ws and friends were being collected into the
  asar; build.files now excludes them) and the two main-process runtime deps
  (electron-log, electron-updater) are esbuild-bundled into gitignored
  electron/vendor/ instead. Static release config landed with it: mac universal +
  win/linux x64+arm64 arch matrix, artifactName, hardenedRuntime + entitlements
  plist, Azure Artifact Signing injection from WIN_SIGN_* env, --publish never.
- S6, auto-update (website channel only): electron/updater.cjs + the generic
  publish feed; whitelisted renderer payloads (electron/update_events.cjs, pure,
  tested); t()-localized toast with Restart now / Later
  (src/ui/desktop_update_toast.ts on a pure reducer, desktop.update.* keys with
  the five non-Latin fills). Steam builds null the publish feed at build time AND
  gate the updater off at runtime; dev checkouts are off via isPackaged.
- N8, error/crash capture: rotating file log (electron/logging.cjs, vendor bundle
  with node_modules and console-shim fallbacks), crashReporter/Crashpad started
  before any window (local minidumps by default, optional https submit URL stamped
  at build), uncaughtException/unhandledRejection/child-process-gone handlers,
  preload forwarding of renderer window errors over a capped validated IPC channel,
  renderer console warn/error mirroring, and bounded renderer crash recovery
  (auto-reload then a localized Reload/Quit dialog; integrity-failure is fatal).
  Decision logic is pure and tested (electron/diagnostics.cjs,
  electron/shell_strings.cjs); the dialog strings are the renderer's t()
  translations pushed over IPC, mirroring the sim/server language-agnostic rule.
  One empirical correction from the QA verify pass: under contextIsolation the
  preload's window listeners CANNOT see main-world page errors (worlds do not
  share error/unhandledrejection events; proven with a live Electron 43 probe),
  so the game client relays them through a new wocDesktop.reportRendererError
  bridge method (src/game/desktop_error_relay.ts, pure mapper tested); the
  preload's own listeners remain for isolated-world (preload) errors, and the
  console-message mirror already catches the 'Uncaught ...' lines as a backstop
  even without the relay.
- EnableEmbeddedAsarIntegrityValidation: enabled after all. The "fails to launch
  unsigned" concern did not survive testing: electron-builder 26 embeds the asar
  hash in Info.plist on every build and the ad-hoc-signed pack launches fine with
  the fuse on (verified on arm64; the fuse read shows it Enabled and the plist
  carries ElectronAsarIntegrity).

Verified on a packaged arm64 build via the new log file (the observability this
pass added): startup banner with the right channel flags for BOTH channels
(website: updaterEnabled true, feed checked at +15s and failing gracefully without
a feed file; steam: updaterEnabled false, no updater activity, no app-update.yml
in the bundle), hardware GPU (ANGLE Metal, Apple M4 Max; webgl enabled, no
software fallback), renderer console capture (it caught the production CORS gap
below), and zero node_modules in the asar with the vendor bundles loading.

Still with the maintainer (accounts and infrastructure, not code; see the
provisioning table in docs/desktop-release.md): the Developer ID certificate +
notarytool API key, the Azure Artifact Signing account + service principal, the
update host for https://updates.worldofclaudecraft.com/desktop, the Steam
partner app + depots, the optional crash-minidump endpoint, and deploying this
branch's server so production reflects CORS for app://worldofclaudecraft.

### Independent re-verification passes (2026-07-01)

Two fresh audits over the whole ship-prep range (requirement-by-requirement
auditors with adversarial refutation of every finding, plus privacy, malware,
QA, and version-currency reviewers) confirmed the state above; every surviving
finding was applied (commits 8bae7110 and 3d4e49b8):

- First pass (8bae7110): C1 control characters stripped from renderer-supplied
  log text (not just C0/DEL); the console-message handler moved to the arity-1
  Electron 43 Event form with a cheap level gate before the redacting
  normalize; VITE_DEV_SERVER_URL gated on isPackaged; a disabled-install IPC
  handler registered when an updater-enabled build cannot load its updater
  bundle; a throw-proofed unhandledRejection path; runbook artifact-name
  corrections (x86_64 AppImage, amd64 deb, the latest-linux-arm64.yml feed).
- Second pass (3d4e49b8): the web origins joined the wocDesktop stamp, so a
  PACKAGED build ignores VITE_DESKTOP_API_ORIGIN / VITE_DESKTOP_LOGIN_ORIGIN
  from runtime env (they previously could widen the app:// CSP connect-src or
  move the external login page); proven by launching a packaged build with
  hostile env vars set. The crash-dialog t() strings re-push once the stored
  non-English boot locale finishes loading (the initial push races the lazy
  locale fetch and the boot load fires no woc:languagechange). Packaged builds
  load the vendored main-process deps ONLY from the in-asar bundle (no
  bare-specifier fallback through user-writable module paths;
  tests/electron_vendor_loading.test.ts pins it). Renderer-error and
  console-mirror source URLs pass redactSecrets like message/stack.
  webSecurity: true and allowRunningInsecureContent: false pinned explicitly.
- Cross-checks that came back clean: the vendored bundles match the npm
  registry tarballs byte-for-byte; the malware gate PASSED; every pinned
  version was current at the audit date (Electron 43.0.0, electron-builder
  26.15.6, electron-updater 6.8.9, electron-log 5.4.4); no IWorld / wire / sim
  divergence; the desktop Turnstile posture unchanged.

---

## 1. Setup snapshot at the research date (historical: the overhaul below has since landed)

- `package.json` `main`: `electron/main.cjs`. Project is `"type":"module"`; the Electron
  entry and preload are deliberately `.cjs`.
- Electron deps (before this plan): `electron ^42.4.1`, `electron-builder ^26.15.3`,
  `steamworks.js ^0.4.0`. `@electron/fuses`, `@electron/notarize`, `@electron/asar` are
  present transitively via electron-builder, none configured.
- `electron/main.cjs` (219 lines): custom `app://` protocol via `protocol.handle` plus
  `registerSchemesAsPrivileged`; `fileInside()` path-traversal guard; BrowserWindow with
  `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`; `setMenu(null)`;
  `setWindowOpenHandler` denies all and forwards http/https to `shell.openExternal`;
  permission handlers use a deny-list; single-instance lock; `worldofclaudecraft://`
  deep-link for `desktop-login`; plus the since-removed steamworks.js integration.
- `electron/preload.cjs` (15 lines): `contextBridge.exposeInMainWorld('wocDesktop', ...)`
  exposing `openBrowserLogin`, `takeLoginCode`, `onLoginCode` (plus one since-removed
  Steam bridge method).
- `build` block: appId `com.worldofclaudecraft.desktop`; targets mac dmg+zip, win nsis+zip,
  linux AppImage+deb; `asarUnpack` of `node_modules/steamworks.js/dist/**`; `protocols`
  block for the `worldofclaudecraft` scheme. No signing, notarization, fuses, asarIntegrity,
  or publish/updater config.

---

## 2. Version currency and the upgrade (done)

Latest stable Electron on the research date is 43.0.0 (Chromium 150.0.7871.46,
Node 24.17.0, V8 15.0.245.13). Electron supports the latest three majors: 41
(EOL 2026-08-25), 42 (EOL 2026-10-20), 43 (EOL 2027-01-05). Electron 40 went EOL 2026-06-30.
Electron 44 is not out (alpha 2026-07-02, stable 2026-08-25). So 43 is the newest.

The `^42.4.1` pin was real and supported, but one major behind and on a short runway
(EOL 2026-10-20), and a caret on `^42` will not cross to 43.

Change applied (the whole "deps up to date" ask):

```diff
-    "electron": "^42.4.1",
-    "electron-builder": "^26.15.3",
+    "electron": "^43.0.0",
+    "electron-builder": "^26.15.6",
```

Then `npm install` regenerates `package-lock.json`.

Verification: `npm install --package-lock-only` resolved 695 packages with 0 vulnerabilities;
the lockfile moved electron 42.5.2 to 43.0.0 and electron-builder to 26.15.6. steamworks.js
is a Node-API (napi-rs) addon, so its prebuilt `.node` is ABI-stable across the Electron
major and needs no rebuild. A packaged-app launch could not be run in the headless research
environment, so this is verified at the dependency-resolution level, not a runtime smoke test.

Other deps, deliberately unchanged:

- `electron-builder`: `^26.15.3` already resolved to the newest 26.x (26.15.6); the pin bump
  is cosmetic. No 27.x stable exists (alpha only); do not adopt it yet.
- `steamworks.js ^0.4.0`: already the latest and canonical (ceifa) package. Likely removed
  entirely (see section 6).
- `@types/node ^25.9.2`: left as is. It is a single repo-wide devDependency and
  `electron/*.cjs` is untyped, so there is no runtime risk from it being a Node major ahead
  of Electron's bundled Node 24. Do not pin it down on Electron's account.

---

## 3. What is already done well

Verified strengths, worth preserving through any refactor:

- Isolation baseline: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`,
  `setMenu(null)`, `setWindowOpenHandler` denies all new windows (`main.cjs:88-102`). This is
  the single most load-bearing hardening and rules out the classic Electron RCE class.
- Modern custom protocol: `protocol.handle('app', ...)` (`main.cjs:38`), not the deprecated
  `register*`/`intercept*` family, with `registerSchemesAsPrivileged` requesting a minimal
  privilege set once before ready.
- Sound path-traversal guard: `fileInside()` (`main.cjs:31-34`) applied to both the
  requested candidate and the `index.html` fallback, on a `path.normalize`d path. Asset vs
  route is discriminated correctly (extensionless miss falls back to index.html; a missing
  `.js`/`.css` 404s instead of serving wrong-MIME HTML).
- Textbook single-instance plus deep-link: `requestSingleInstanceLock` with quit-on-loser,
  an argv `find(startsWith('worldofclaudecraft://'))` scan robust to argv reordering, the
  dev-vs-packaged `setAsDefaultProtocolClient` branch, and a macOS `open-url` handler
  registered before ready. Cold-start codes are buffered in `pendingLoginCode`.
- Tight deep-link validation: rejects anything whose protocol is not `worldofclaudecraft:`
  or hostname is not `desktop-login`, and requires a `code` param (`main.cjs:158-169`).
- Preload is minimal and sandbox-compliant: requires only `electron`, exposes wrapped
  `ipcRenderer.invoke/on` helpers (never the raw module), type-guards its inputs
  (`preload.cjs:1-15`). steamworks.js (since removed) was required in main only, never
  the preload.
- steamworks.js packaging was correct while it existed (since removed): `asarUnpack` of the
  prebuilt `.node` is exactly the required handling for an N-API addon that must not be
  electron-rebuilt. Relevant again only if an overlay/rich-presence slice is ever added.
- Distribution coverage is broad and the `files` allowlist is tight (dist, electron, icons,
  package.json), avoiding shipping source or dev files.

---

## 4. Findings that survived adversarial verification

Grouped by verified severity. Each item was checked for whether it truly applies to this
repo (Steam plus website distribution, tiny-deps doctrine) and whether the fix is current.

### Blocking (blocks shipping, not the code running)

- B1. No macOS code signing or notarization. There is no `mac.hardenedRuntime`, no
  entitlements plist, no `notarize` config. On current macOS this is decisive: macOS 15
  Sequoia removed the old right-click "Open anyway" Gatekeeper bypass, so an un-notarized
  `.app` is very hard for a user to launch, and Steam's own macOS policy also requires
  notarization. This blocks both the website DMG and the Steam mac build.
  Fix: set `mac.hardenedRuntime:true`, add `build/entitlements.mac.plist` with the Electron
  entitlements (`com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory`, and for a future Steam SDK build
  `com.apple.security.cs.disable-library-validation`), and enable electron-builder
  `mac.notarize` with an App Store Connect API key in CI (the legacy afterSign notarize
  script is no longer needed). Do not include the App Sandbox entitlement (Steam is
  incompatible with it).
  Requires: an Apple Developer account (99 USD/yr) and a Developer ID Application cert.
  Evidence: `package.json` build block has no `mac.notarize`/`afterSign`. Source:
  electron.build/docs/notarization, partner.steamgames.com/doc/store/application/platforms.

### Should-fix (security and distribution)

All pure code and config, no new dependency except electron-updater.

- S1. Permission handler is a deny-list, not deny-by-default. Anything not in the `denied`
  set is allowed (`main.cjs:71-76`). Invert to an allow-list, but carefully: the game
  legitimately uses `pointerLock` and `fullscreen`, so the allow-list is not empty. Deny
  everything else by default in both `setPermissionCheckHandler` and
  `setPermissionRequestHandler`. Source: electronjs.org security checklist item 4/5.

- S2. No `will-navigate` / `will-redirect` guard. `setWindowOpenHandler` governs only
  window.open/new windows, not top-level navigation, so nothing stops the main frame from
  being navigated away from `app://` (`main.cjs`, absent). Add both handlers on
  `mainWindow.webContents` and `preventDefault()` any navigation whose origin is not the app
  origin (or the dev-server origin in dev). Compare origins with `new URL()`, not
  `startsWith`. Source: security checklist item 13.

- S3. No Content-Security-Policy on the `app://` content. Attach a CSP as an HTTP response
  header inside `protocol.handle('app', ...)`, applied to every returned Response including
  the SPA `index.html` fallback and the 404, not a meta tag. `net.fetch`'s returned Response
  has immutable headers, so build a fresh Response with the header. Starting point:
  `default-src 'self'; connect-src 'self' https://<api-origin> wss:; img-src 'self' data:;
  script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'`
  (Three.js/WASM needs `wasm-unsafe-eval`). Source: security checklist item 7/16.

- S4. IPC handlers do not validate the sender frame. `desktop-login-take-code` and
  `desktop-login-open-browser` (`main.cjs:171-181`) mint or return sensitive values with no
  sender check. Add one shared `isTrustedSender(frame)` helper (frame origin is
  `app://worldofclaudecraft` or the dev URL) and apply it at the top of every handler,
  returning null/void otherwise. Risk is low today given sandbox plus contextIsolation plus
  no webviewTag, but it is cheap defense-in-depth and the documented pattern. Source:
  security checklist item 17. (A third, since-removed Steam handler was also covered at the
  time.)

- S5. Electron fuses not flipped and ASAR integrity off. Add electron-builder's built-in
  `electronFuses` config (no new dependency; it drives the transitive `@electron/fuses` and
  re-signs after flipping). Recommended values: disable `RunAsNode`, enable
  `EnableCookieEncryption`, disable `EnableNodeOptionsEnvironmentVariable`, disable
  `EnableNodeCliInspectArguments`, and enable `EnableEmbeddedAsarIntegrityValidation` plus
  `OnlyLoadAppFromAsar` together (integrity is bypassable via Electron's app-code search path
  unless `OnlyLoadAppFromAsar` removes the `app/` and `default_app.asar` fallbacks). Sequence
  this after code signing is in place, because on macOS the fuse flip re-signs the binary,
  and ASAR integrity only delivers real tamper protection once the binary is signed. Windows
  ASAR integrity needs Electron 30+ (satisfied by 43). Source:
  electron.build/docs/tutorials/adding-electron-fuses.

- S6. No auto-update for the website channel. Direct DMG/zip/AppImage/deb users are stranded
  on an unpatched Electron/Chromium with no update mechanism. Add `electron-updater` behind a
  build-time channel flag: enable it for the direct downloads (code signing required,
  HTTPS-only feed, provider generic HTTPS on your domain or GitHub Releases), and disable it
  in the Steam build. Steam owns updates for the Steam depot via SteamPipe; running two
  updaters against the Steam-managed install dir can corrupt it. Consider staged rollout
  (`stagingPercentage`) and, for extra safety on direct downloads, manifest signature
  verification. Source: electron.build/docs/features/auto-update.

### Nice-to-have (verified real, low priority)

- N1. `shell.openExternal` forwards any http/https via `startsWith` (`main.cjs:97-100`).
  Harden with real `new URL()` parsing and reject dangerous schemes explicitly. A host
  allowlist was checked and judged not warranted here; the scheme filter is the canonical
  mitigation and already rejects `file:`/custom schemes.
- N2. Set `webPreferences.spellcheck:false` (defaults on; triggers a dictionary download and
  red underlines in chat), set `webviewTag:false` explicitly, and disable autofill via
  `disableBlinkFeatures:'Autofill'` (removes a stray dropdown and repeated
  `Autofill.enable failed` console spam). Pure QoL/perf, no downside for a game.
- N3. Windows code signing for the website `.exe`. OV certs no longer earn immediate
  SmartScreen trust and EV needs a non-CI hardware token; the recommended path is Azure
  Artifact Signing (formerly Azure Trusted Signing), supported by electron-builder via
  `win.azureSignOptions`, immediate SmartScreen trust, CI-friendly, from about 9.99 USD/mo.
  Lower urgency on the Steam-launched path; important for direct downloads.
- N4. `decodeURIComponent` in the protocol handler can throw on a malformed percent-encoding
  (`main.cjs:40`). Wrap in try/catch and return the same 404 shape.
- N5. Dev launcher can orphan the Electron child if Vite crashes. Hoist the electron child to
  module scope and kill it in `stopAll` (guard for undefined). Optional: add an `fs.watch`
  on `electron/*.cjs` that restarts Electron on change (the one affordance electron-vite
  would give for free), keeping the dependency set flat.
- N6. `main.cjs`/`preload.cjs` are untyped and outside `tsc` in an otherwise TS-strict repo.
  Keep them CJS (main uses `__dirname`; at research time the CJS-native steamworks.js was a
  second reason), and add `// @ts-check`
  plus JSDoc as the zero-build minimum, or compile from TS via the existing esbuild path and
  a small dedicated tsconfig using Electron's `electron/main` and `electron/renderer` subpath
  types. Define one shared type for the `window.wocDesktop` surface consumed by `src/net`.
- N7. `backgroundThrottling` is implicit (defaults true). Make it an explicit decision: keep
  the default for battery friendliness, but ensure the WebSocket keepalive/heartbeat survives
  Chromium timer throttling when the window is backgrounded.
- N8. No crash reporting. Decide deliberately: either integrate `@sentry/electron`
  (native minidump plus JS) with `sendDefaultPii:false`, server-side scrubbing, consent-gated
  init, and no wallet address or login code in breadcrumbs; or ship none for v1. Do not enable
  Session Replay without heavy scrubbing. This must stay consistent with the app already
  hiding the wallet in desktop mode.

### Checked, no action (refuted by the verification pass)

These were raised and then dismissed, recorded so they are not re-litigated:

- `@types/node` pin: leave `^25`. It is a shared devDep and main is untyped `.cjs`, so no
  runtime risk. Do not align it to Electron's Node 24.
- `corsEnabled` on `app://`: required, not excessive. The renderer is served from `app://`
  and makes cross-origin fetch and WebSocket calls to the HTTPS API origin.
- Shipping `steam_appid.txt`: do not. Valve documents it as development-only; a shipped copy
  overrides the app id Steam provides and defeats Steam's ownership context.
- `window-all-closed` placement outside the single-instance `else`: leave it. Current Electron
  docs keep it at top level; the repo already matches best practice.
- electron-builder "behind": not behind. The caret already resolves to the newest 26.x, and
  26.15.3 is npm's `latest` dist-tag.
- steamworks.js caret risk (while it existed): none. The lockfile pinned exactly 0.4.0 with
  an integrity hash, so `npm ci` was deterministic. Moot now that the package is removed.

---

## 5. Distribution: Steam plus website (both channels)

### Shipping the one Electron bundle on Steam

You can ship the Electron bundle on Steam; it is the norm and needs no separate native build.

- Build electron-builder's unpacked `dir` output per OS (`win-unpacked`, `mac/YourApp.app`
  or `mac-universal`, `linux-unpacked`) and upload each to its own SteamPipe depot with
  `steamcmd` (or the `game-ci/steam-deploy` action). Upload the runnable app tree, never an
  NSIS or DMG installer (Steam replaces exactly what an installer does, and it diffs and
  patches individual files).
- Set a per-OS launch option in the Steamworks partner site pointing at that tree's
  executable: Windows `YourApp.exe` at the depot root; macOS the `.app` bundle (uploaded
  intact as a directory tree); Linux the unpacked launcher.
- Ship the whole `resources/` tree so `app.asar` and any `app.asar.unpacked/` native files
  travel together.

### Updates

Steam owns updates for the Steam depot (SteamPipe delta patching). Disable electron-updater
in the Steam build; keep it only on the website channel (S6). Two updaters fighting over the
Steam-managed install dir can corrupt it.

### Signing and notarization per OS

- macOS: Developer ID sign plus notarize plus Hardened Runtime, required by both Apple's
  current Gatekeeper and Steam's macOS policy. Do not rely on the Steam client's
  quarantine-skip behavior; it is undocumented and does nothing for a copied `.app`. This is
  B1.
- Windows: Authenticode sign (Azure Artifact Signing recommended). Lower urgency on the
  Steam-launched path (Steam is the trusted launcher and files carry no Mark-of-the-Web), but
  important for the website `.exe`, which does get SmartScreen and AV scrutiny. This is N3.
- Linux: no signing concept. Two real must-dos for Steam/Steam Deck instead:
  - Electron fails inside the Steam Linux Runtime (Pressure Vessel) because it is missing
    `libcups` (`libcups.so.2: cannot open shared object file`). Set the Linux launch option
    to run outside the Steam Linux Runtime so it uses host libraries.
  - The Chromium SUID sandbox helper is often not correctly configured under Steam
    (`chrome-sandbox ... is not configured correctly`). The common shipping fix is
    `--no-sandbox` in the Steam launch args, or a wrapper that fixes the `chrome-sandbox`
    perms. `--no-sandbox` disables the renderer sandbox; for a game client that is the usual
    choice, but flag it for a security reviewer.
  - Upload the `linux-unpacked` dir tree, not an AppImage (AppImage is for direct download;
    its FUSE mount adds a failure surface on SteamOS).

---

## 6. steamworks.js decision (no Steam SDK in v1)

Sign-in is email plus Discord only (the web flow) and Steam is distribution-only, so v1
ships with zero Steamworks SDK. `steamworks.js` and its `asarUnpack` entry are removed
(this also deleted the app's only native addon, simplifying signing and notarization),
and the Steam DRM wrapper is skipped (worthless for a free, server-authoritative MMO).
Distribution, install, and updates all work through SteamPipe depots with nothing
linked, which Valve explicitly supports. All Steam sign-in code that once existed in
the shell, preload, and server has been deleted; nothing ships or verifies Steam
tickets anywhere.

Optionally later, add only `steamworks.js` `restartAppIfNecessary` plus overlay and rich
presence (none of which is login), and guard `init()` so the same bundle no-ops when not
launched under Steam. That is additive and does not change distribution; gate it behind
CI that verifies the prebuilt addon loads under the exact Electron version.

The desktop login surface (used by BOTH email and Discord) is: `openDesktopLogin()`, the
`worldofclaudecraft://desktop-login?code=` deep link, `deliverLoginCode()` /
`pendingLoginCode`, and the `openBrowserLogin` / `takeLoginCode` / `onLoginCode` bridges.

---

## 7. Implementation sequence (all code steps landed)

The order the work landed in. Every code step below is DONE on the branch; the
implementation-status sections above record the details. What remains is maintainer
accounts and infrastructure (the provisioning table in `docs/desktop-release.md`).

1. Electron 43 bump (section 2). Done.
2. Removal of the Steam sign-in code (section 6). Done: sign-in is email plus Discord
   only, and the app's only native addon went with it.
3. Security hardening, no new deps (S1 to S5, plus N1, N2, N4, N5, N6). Done in the
   hardening pass; fuses and ASAR integrity verified on packaged builds.
4. macOS signing plus notarization (B1). Config, entitlements, and the ad-hoc fallback
   are done; the Developer ID certificate and notary API key remain with the maintainer.
5. Website auto-update (S6) and Windows signing (N3). Done in the ship-prep pass; the
   update feed host and the Azure Artifact Signing account remain with the maintainer.
6. Steam depot pipeline (section 5). Done (`npm run electron:build:steam` + the depot
   runbook); the Steam partner app and depots remain with the maintainer.
7. Crash reporting (N8) and backgroundThrottling (N7). Done: Crashpad local minidumps
   with an optional build-stamped https submit URL; throttling off for the game window.
   A thin steamworks.js overlay/rich-presence slice stays optional and unscheduled.

---

## Appendix A: full research reference

Condensed from the six research dimensions (version lifecycle, build/distribution, Steam,
tooling/structure, process model). Kept for the specifics and citations.

### Version lifecycle

- Latest stable Electron: 43.0.0 (Chromium 150.0.7871.46, Node 24.17.0, V8 15.0.245.13).
  releases.electronjs.org, releases.electronjs.org/release/v43.0.0.
- Support policy: latest three stable majors; a new major every 8 weeks, released the same
  day as the matching Chrome stable. electronjs.org/docs/latest/tutorial/electron-timelines.
- Supported majors and EOL: 41 (2026-08-25), 42 (2026-10-20), 43 (2027-01-05). 40 EOL
  2026-06-30. 44 not shipped (alpha 2026-07-02, stable 2026-08-25). releases.electronjs.org/schedule.

### Build and distribution

- electron-builder latest stable 26.15.6 (2026-06-26), actively maintained; v27 is alpha
  only. `^26.15.3` already resolves to 26.15.6. Stay on electron-builder; do not migrate to
  Forge for a small multi-target team. electron.build, github.com/electron-userland/electron-builder/releases.
- macOS notarization is built into electron-builder via `mac.notarize` (needs
  `mac.hardenedRuntime:true` plus entitlements), using notarytool; App Store Connect API key
  is the CI-preferred auth. electron.build/docs/notarization.
- Windows: OV certs no longer earn immediate SmartScreen trust; EV needs a hardware token
  (CI-hostile); Azure Artifact Signing (renamed from Azure Trusted Signing early 2026) is the
  recommended cloud path via `win.azureSignOptions`, immediate trust, CI-friendly, about
  9.99 USD/mo Basic. electron.build/docs/features/code-signing/code-signing-win,
  learn.microsoft.com/azure/trusted-signing/overview.
- ASAR integrity: enable `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`
  together via `electronFuses`; electron-builder re-signs after the flip.
  electron.build/docs/tutorials/adding-electron-fuses, electronjs.org/docs/latest/tutorial/asar-integrity.
- electron-updater security depends on code signing (mandatory on macOS via Squirrel.Mac,
  signature-validated on Windows NSIS); supports differential updates, staged rollout, and
  generic HTTPS / GitHub / S3 providers. Needed only for direct downloads, not Steam.
  electron.build/docs/features/auto-update.

### Steam integration

- Canonical package is `steamworks.js` by ceifa; latest 0.4.0 (2024-08-06); repo still
  maintained; the `@ai-zen` fork (0.3.6) is behind. greenworks is effectively dead. It is a
  napi-rs addon with ABI-stable prebuilt binaries that must not be electron-rebuilt.
  registry.npmjs.org/steamworks.js, github.com/ceifa/steamworks.js.
- SDK integration is never required to ship on Steam; the DRM wrapper is optional and not an
  anti-piracy solution. partner.steamgames.com/doc/sdk/api, /doc/features/drm.

### Tooling and structure

- ESM main has been stable since Electron 28. The `.cjs` main and preload in a
  `"type":"module"` project is intentional and reasonable, not a smell, because main uses
  `__dirname` (and at research time also synchronously required the CJS-native
  steamworks.js); keep them CJS. electronjs.org/docs/latest/tutorial/esm.
- Sandboxed preload may require only `electron` plus a small built-in allow-list; the repo
  preload is compliant. electronjs.org/docs/latest/tutorial/tutorial-preload.
- electron-vite (stable v5.0) would give TS, main/preload hot-reload, and dep externalization,
  but its renderer half collides with this repo's bespoke multi-entry Vite build (i18n, wiki,
  media manifest, sitemap) and adds a dependency; do not adopt it. Close the small TS and
  watch gaps with the existing esbuild path instead. electron-vite.org.

### Process model and misc

- `protocol.handle` is current; `register*`/`intercept*` are deprecated since Electron 25.
  electronjs.org/docs/latest/api/protocol.
- `will-navigate` fires before a main-frame navigation and `preventDefault()` blocks it;
  `setWindowOpenHandler` does not cover top-level navigation. `backgroundThrottling` and
  `spellcheck` default to true. electronjs.org/docs/latest/api/web-contents, /api/browser-window.
- Single-instance and deep-link registration must branch on dev vs packaged and register the
  macOS `open-url` handler before ready; the repo matches this.
  electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app.

## Appendix B: sources

- releases.electronjs.org (plus /schedule, /release/v43.0.0)
- electronjs.org/docs/latest/tutorial: security, fuses, esm, electron-timelines,
  tutorial-preload, process-model, launch-app-from-url-in-another-app, asar-integrity
- electronjs.org/docs/latest/api: protocol, browser-window, web-contents, app
- electron.build (cli, configuration, notarization, code-signing-win, adding-electron-fuses,
  auto-update)
- partner.steamgames.com/doc: sdk/uploading, store/application/platforms, sdk/api,
  features/drm
- Apple: support.apple.com/guide/security (Gatekeeper), developer.apple.com/developer-id
- Microsoft: learn.microsoft.com/azure/trusted-signing/overview
- ValveSoftware/steam-runtime#579 (Electron libcups in the Steam Linux Runtime)
- electron/electron#17972, electron-userland/electron-builder#4278 (chrome-sandbox SUID)

## Appendix C: how this was produced

A deterministic multi-agent research workflow (44 subagents, about 2.07M tokens, roughly 34
minutes) plus a dedicated Steam-distribution research agent. Structure: six parallel
web-research agents (version, build/dist, Steam, tooling, process, and a dedicated security
agent), three code-grounded audit agents that cross-referenced the research against the
actual files, and an adversarial verification pass that tried to refute each of the 32
candidate findings and independently re-checked the headline versions. Findings in this doc
are the ones that survived that pass. One caveat: the dedicated security-checklist research
agent failed its structured-output schema after the retry cap and returned no object; its
subject matter is fully covered here by the process-model research dimension and the
security-hardening audit, so there is no gap, but the security checklist items were not
independently re-fetched by a second agent the way the other dimensions were.
