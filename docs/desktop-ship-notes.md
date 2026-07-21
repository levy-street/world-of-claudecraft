# Desktop ship notes: what landed, and how everything works per platform

Companion to `docs/desktop-release.md` (the terse operational runbook) and
`ELECTRON-DESKTOP-AUDIT.md` (the decision log). This file is the explainer: what
the production-readiness change contains, and the per-platform mechanics of
auto-update, signing, and releasing, with the details an operator or reviewer
needs. Commit range: `1a82ad62..3d4e49b8` on `feature/electron-steam-desktop`
(the ship-prep commits through `99453151`, the docs, and the two independent
re-verification fix commits `8bae7110` + `3d4e49b8`).

## What shipped (summary)

- **Two distribution channels from one codebase.** `npm run electron:build`
  (website, self-updating installers) and `npm run electron:build:steam`
  (SteamPipe depot layouts, updater hard-off). The build stamps `wocDesktop`
  into the packaged `package.json` (the `distribution` channel, the web
  origins the bundle was baked with, the optional crash-submit URL, and on the
  steam channel the `steamAppId`), resolved
  at runtime by `electron/desktop_config.cjs`. Dev env overrides
  (`WOC_DISTRIBUTION`, `WOC_CRASH_SUBMIT_URL`, `VITE_DESKTOP_API_ORIGIN`,
  `VITE_DESKTOP_LOGIN_ORIGIN`) apply ONLY to unpackaged checkouts; an
  installed build's stamp is final.
- **The app stopped shipping the repo's server/web node_modules.** electron-
  builder's dependency collection was packing pg, three, ws and friends into the
  asar (~1,244 entries). `build.files` now excludes node_modules on the website channel (the steam
  channel re-includes exactly `node_modules/steamworks.js/**`, a napi native
  module that cannot be esbuild-bundled, asar-unpacked to load from disk); the
  two main-process runtime deps (electron-log, electron-updater) are esbuild-
  bundled into gitignored `electron/vendor/` by `scripts/electron-vendor.mjs`,
  and a packaged build loads ONLY the in-asar vendor bundle for them (no
  node_modules fallback; `tests/electron_vendor_loading.test.ts` pins it).
- **Every error surface is caught and logged.** Rotating 5 MB file log;
  Crashpad minidumps for all processes from before the first window; main-
  process uncaughtException (log + dialog + exit) and unhandledRejection;
  child-process-gone; renderer page errors relayed with full stacks through the
  bridge (`wocDesktop.reportRendererError`; the preload cannot see main-world
  errors under contextIsolation, proven with a live Electron 43 probe);
  renderer console warn/error mirroring (session-capped); bounded renderer
  crash auto-reload, then a localized Reload/Quit dialog whose strings are the
  renderer's own t() translations pushed over IPC.
- **Auto-update on the website channel** (see mechanics below), silent
  everywhere else, with an i18n toast driven by a pure, tested reducer.
- **Signing/notarization config for all platforms**, activated purely by env
  vars, with a working ad-hoc fallback for local unsigned builds (separate
  entitlements variant so production keeps library validation ON).
- **Release config**: mac universal, win x64+arm64, linux x64+arm64, stable
  artifact names, asar-integrity fuse enabled and verified, `--publish never`
  so CI tokens cannot trigger accidental uploads.
- **Review trail**: malware audit PASS; privacy-security review, qa-checklist
  gate, and an adversarial coverage review all clean with every finding
  (blocking, should-fix, and nit) applied, including closing a packaged-build
  env escape hatch that could have re-enabled the updater on Steam. A later
  independent multi-agent re-verification of the whole range confirmed the
  result and landed the remaining fixes (`8bae7110`, `3d4e49b8`): the web
  origins joined the stamp (closing the `VITE_DESKTOP_*` runtime-env hatch on
  packaged builds), crash-dialog strings re-push once the stored locale
  loads, packaged vendor-only dependency loading, secret redaction on error
  source URLs, explicit `webSecurity` pins, and hardened control-char /
  console-message handling; the vendored bundles were verified byte-for-byte
  against the npm registry tarballs.

Verified on packaged macOS builds via the new log file: correct channel banner
for both channels, hardware GPU (ANGLE Metal), updater lifecycle, feed-file
generation (`latest-mac.yml` + blockmap + embedded `app-update.yml`), zero
node_modules in the asar, all seven fuses set.

## How auto-update works

### The common machinery (website channel only)

1. At build time, electron-builder bakes `resources/app-update.yml` into the
   app (from `build.publish`: generic provider, feed URL
   `https://updates.worldofclaudecraft.com/desktop`), and the publish channel
   is derived from the baked API origin (`electron/update_guard.cjs`): the
   production origin emits the `latest` feed files, any other origin (dev,
   staging, localhost smoke packs) emits `dev` ones, and each emitted feed
   file is stamped with the `wocApiOrigin` its artifact was baked with.
2. At runtime, `electron/updater.cjs` initializes ONLY when the build is
   packaged AND stamped `website`. It checks the feed 15 seconds after launch
   and every 4 hours: it GETs the yml of the channel derived from its OWN
   baked origin (production installs: `latest*.yml`; anything else:
   `dev*.yml`), compares the version there against the running
   `app.getVersion()`, and only ever moves FORWARD (no downgrades).
3. If newer AND the feed file's `wocApiOrigin` stamp matches the install's own
   baked origin (a missing stamp, from a pre-split feed file, is accepted; a
   mismatch is REFUSED with a loud `main.log` entry, so a wrong-track artifact
   can never flip an install to another backend), it downloads in the
   background (delta via blockmap when the host supports HTTP range requests,
   full download otherwise), verifies the SHA512 from the yml, then emits
   `update-downloaded`. The player sees a toast: "Restart now" calls
   `quitAndInstall`; ignoring it still installs on next quit
   (`autoInstallOnAppQuit`). Failed checks (offline, host down) only log.
4. Staged rollout: hand-edit `stagingPercentage: N` into the uploaded yml; each
   install hashes a persistent per-machine ID against N. Rollback: you MUST
   publish a higher version; machines that took a bad build will not downgrade.

### macOS

- The updater consumes the ZIP target (never the dmg); the dmg exists only for
  the download page. `latest-mac.yml` lists the universal zip.
- HARD REQUIREMENT: the running app must be signed with a real Developer ID
  AND notarized, or the update will not apply. Squirrel.Mac additionally
  validates that the downloaded update is signed by the SAME identity as the
  running app, which is the real trust anchor of the whole chain. This is why
  no public mac build ships unsigned.
- Apply mechanics: on install, Electron's ShipIt helper swaps the .app and
  relaunches. Nothing to configure.

### Windows

- The updater consumes the NSIS installer (`latest.yml` carries per-arch
  entries for x64 and arm64; each install picks its own). Squirrel.Windows is
  not used or supported.
- Deltas via the `.exe.blockmap` sidecar; treat as best-effort.
- The install is per-user (no UAC prompt on update). The downloaded installer
  runs silently on restart/quit.
- Signing is strongly recommended but not a technical gate for updates; an
  unsigned update applies, at the cost of SmartScreen noise and zero tamper
  protection. Ship signed (see below).

### Linux

- Only the AppImage self-updates: the updater downloads the new AppImage
  (embedded blockmap for deltas), replaces the file on disk, and relaunches.
  It requires actually running AS an AppImage (the `APPIMAGE` env var, set
  automatically); the raw unpacked binary logs an updater error and skips.
- The .deb does NOT auto-update; users on deb update manually (or via a future
  apt repo). Integrity for AppImage updates = HTTPS + the yml SHA512 (Linux has
  no OS code-sign gate).

### Steam (all platforms)

- The in-app updater does not exist in this channel twice over: the runtime
  stamp disables it AND the build has no `app-update.yml` (publish is nulled).
- Updates ship by uploading a new SteamPipe build for the three depots and
  setting it live on the default branch; the Steam client delta-patches
  automatically. Valve's guideline is explicit that updates must flow through
  Steam, which is exactly what the split guarantees.

## How signing works

### macOS (Developer ID + notarization)

- What happens: electron-builder signs every nested Mach-O (frameworks,
  helpers, the main binary) with the Developer ID Application certificate,
  applies the hardened runtime with our entitlements
  (`build/entitlements.mac.plist`: `allow-jit` +
  `allow-unsigned-executable-memory`, nothing else in production), then
  submits to Apple's notary service (notarytool) and staples the ticket.
  Ordering matters and is handled for us: the Electron fuses are flipped
  BEFORE signing, so the signature seals the fused binary; the asar hash lives
  in Info.plist (`ElectronAsarIntegrity`) and is likewise sealed, which is what
  makes the `enableEmbeddedAsarIntegrityValidation` fuse meaningful. One fuse
  is deliberately left at its default: `loadBrowserProcessSpecificV8Snapshot`
  only switches WHICH snapshot file the browser process loads, and this app
  ships no custom per-process V8 snapshot, so flipping it would change nothing
  while adding a startup file dependency.
- What activates it: `CSC_LINK` (base64 or path of the .p12) +
  `CSC_KEY_PASSWORD`, or `CSC_NAME` (keychain identity), plus notarization
  creds `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` (App Store
  Connect API key; the `APPLE_ID` + app-specific-password + `APPLE_TEAM_ID`
  trio also works). No env vars = the LOCAL fallback: ad-hoc signing
  (`mac.identity=-`) with `build/entitlements.mac.adhoc.plist` (adds
  `disable-library-validation`, required because ad-hoc signatures carry no
  team ID). Ad-hoc builds launch on the build machine but are not
  distributable: current macOS blocks unnotarized quarantined downloads.
- Verify a real build with `codesign --verify --deep --strict <app>` and
  `spctl -a -t exec -vv <app>` ("Notarized Developer ID").

### Windows (Azure Artifact Signing)

- What happens: during a build on a Windows runner, electron-builder invokes
  Microsoft's TrustedSigning PowerShell module, which signs the .exe/installer
  with a short-lived (72 h) certificate from an HSM-backed profile and
  RFC 3161-timestamps it (signatures stay valid after the cert rotates).
- What activates it: the four non-secret identifiers `WIN_SIGN_PUBLISHER_NAME`
  (must equal the validated legal name / cert CN), `WIN_SIGN_ENDPOINT`,
  `WIN_SIGN_ACCOUNT_NAME`, `WIN_SIGN_PROFILE_NAME` (injected as
  `win.azureSignOptions` by the build script), plus service-principal auth via
  `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` (role: Trusted
  Signing Certificate Profile Signer). Absent env = unsigned build, which is
  fine locally.
- Reality check: signing does NOT skip SmartScreen's "unrecognized app"
  warning for a new publisher; reputation accrues over weeks of clean installs
  and persists across releases. EV certificates no longer help; do not buy one
  for that reason.

### Linux

- No code signing (electron-builder has none for AppImage/deb, and per-file
  signatures are not customary). Publish a `SHA256SUMS` file next to the
  artifacts. The update path's integrity is the https feed + yml SHA512.

## How to release, step by step

### Website channel

1. Bump `version` in `package.json` (semver; the feed is strictly
   version-ordered).
2. On each OS runner, with that platform's signing env set:
   `npm run electron:build`. Outputs land in `release/`.
3. Upload to the update host directory (keep exact filenames):
   - mac: `world-of-claudecraft-<v>-mac-universal.dmg` (download page),
     `...-mac-universal.zip` + `.zip.blockmap` + `latest-mac.yml` (updater).
   - win: the combined NSIS installer electron-builder emits by default for
     x64+arm64 (see `docs/desktop-release.md` for the buildUniversalInstaller
     detail) plus its `.exe.blockmap` and `latest.yml`.
   - linux: `...-linux-x86_64.AppImage` (x64) and `...-linux-arm64.AppImage`,
     the debs (`...-amd64.deb`, `...-arm64.deb`) for the download page, and BOTH
     per-arch feed files `latest-linux.yml` (x64) and `latest-linux-arm64.yml`
     (arm64); without the arm64 feed, arm64 AppImage installs cannot self-update.
4. Optional staged rollout: add `stagingPercentage` to the ymls, raise it as
   confidence grows, remove to finish.
5. Verify with the post-release checklist in `docs/desktop-release.md`
   (launch, both logins, update check against the new feed, log file, GPU
   line, crash surfaces).
6. If the release is bad: stop the bleed by setting `stagingPercentage: 0`,
   then ship a HIGHER fixed version. Never re-upload the same version.

To dry-run the update flow before the real host exists: build with the publish
URL temporarily pointed at any static server you control (edit
`build.publish.url`, or serve `release/` locally over https), install the app,
bump the version, rebuild, upload, and watch the toast + install cycle.

### Steam channel

1. Same version bump. On each OS runner: `npm run electron:build:steam`.
   Outputs land in `release-steam/` as loose installed layouts (mac: one
   universal `.app`; win/linux: `win-unpacked/` / `linux-unpacked/`, x64).
2. SteamPipe upload with three depots (win / mac / linux, OS-filtered), one
   package, one launch option per OS. Upload the mac depot from a macOS or
   Linux machine ONLY (Windows destroys the framework symlinks and with them
   the notarized signature), and upload the loose `.app`, never a zip/dmg.
3. Set the new build live on the default branch in the partner site. Steam
   clients delta-patch on their own.
4. Do not apply the Valve DRM wrapper on any platform. `steam_appid.txt` must
   not ship (`electron/steam.cjs` passes the app id straight to `init`). The
   Steamworks SDK loads on this channel only to mint the account-link ticket
   for the Book of Deeds achievement mirror; distribution and updates still
   need none of it, and the overlay stays unhooked.
5. The mac Steam build must still be Developer ID signed + notarized, so run
   the steam build with the mac signing env present.

## Details worth knowing (grab bag)

- **Log files** (paths follow the package NAME): mac
  `~/Library/Logs/world-of-claudecraft/main.log`, win
  `%APPDATA%\world-of-claudecraft\logs\main.log`, linux
  `~/.config/world-of-claudecraft/logs/main.log`. 5 MB rotation, one `.old`.
  The startup banner logs version, channel, updater state, crash-dump dir, and
  the log path itself. Ask players to attach it to bug reports.
- **Crash minidumps** accumulate under the Crashpad dir printed in the banner
  (`app.getPath('crashDumps')`). Local-only by default. To enable uploads,
  stamp `WOC_CRASH_SUBMIT_URL` (https) at build time; any multipart minidump
  receiver works, including a Sentry project's `/minidump/` ingest URL, no SDK
  needed. Minidumps contain process memory: access-control the endpoint,
  set retention, and disclose in the privacy policy first.
- **DevTools in a shipped build**: F12, Cmd+Option+I, or Ctrl+Shift+I toggles
  a detached inspector; `WOC_OPEN_DEVTOOLS=1` opens it at launch.
- **Sign-in**: email and Discord only, exactly the web flow (email/password
  in-app; Discord via the default browser and the deep link below). There is
  no Steam sign-in on any channel.
- **Deep link**: `worldofclaudecraft://desktop-login?code=...` completes the
  browser login handoff (cold start and second-instance both handled).
- **Inspect a build's channel**: `npx asar extract-file <app>/Contents/
  Resources/app.asar package.json` (run OUTSIDE the repo root: it writes
  `package.json` to the cwd) and read `wocDesktop`.
- **Dev loops**: `npm run electron:dev` (Vite + live shell);
  `npm run electron:pack` / `electron:pack:steam` for fast host-arch `--dir`
  verification builds. `WOC_DISTRIBUTION=steam npm run electron:dev` exercises
  the steam runtime path unpackaged.
- **Production server dependency**: the packaged app calls
  `https://worldofclaudecraft.com` from origin `app://worldofclaudecraft`;
  production must be running this branch's server (CORS reflection for that
  origin) or every REST call fails. The log file shows the CORS errors
  plainly until then. Deploying is the standard server update in `DEPLOY.md`
  (ssh, `cd /opt/eastbrook`, `sudo git pull`,
  `sudo docker compose up -d --build`); the branch's server
  carries all desktop support already (CORS in `server/web_login_guard.ts`,
  the `/desktop-login` handoff in `server/desktop_login.ts`, the
  desktop-origin Turnstile admission in `server/turnstile.ts`). See the
  "Deploying the game server" section of `docs/desktop-release.md`.
- **Electron lifecycle**: pinned to 43.x (current stable; EOL 2027-01-05).
  Before the 44 bump (~Aug 2026): audit renderer `clipboard` usage (removed
  from renderers in 44) and drop 32-bit assumptions. electron-builder stays on
  26.x (27 is an ESM-only alpha); electron-updater on 6.x.
- **What was NOT verified locally** (needs the CI runners / maintainer):
  actual Windows and Linux builds + launches, a real signed+notarized mac
  build, a full universal-arch `electron:build`, an end-to-end update apply
  (requires a signed build + a live feed), and the two login paths + the
  `worldofclaudecraft://desktop-login` deep-link handoff AGAINST PRODUCTION
  (blocked until this branch's server deploys and production reflects CORS for
  the `app://` origin; both flows have packaged-build evidence against a local
  server from the earlier shell passes). Everything else in this file has
  packaged-build evidence behind it.
