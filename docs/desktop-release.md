# Desktop release runbook (Electron: website download + Steam)

How to build, sign, publish, and verify the World of ClaudeCraft desktop app.
The longer companion explainer (what shipped, per-platform update/signing
mechanics, step-by-step release walkthroughs) is `docs/desktop-ship-notes.md`.
One codebase produces two distribution channels:

| Channel | Command | Output | Updates |
|---|---|---|---|
| website | `npm run electron:build` | `release/` installers + update feed files | in-app via electron-updater |
| steam | `npm run electron:build:steam` | `release-steam/` loose per-OS layouts | SteamPipe depots only (in-app updater OFF) |

Sign-in is email and Discord only, identical to the web flow: email/password logs in
inside the app, and "Continue with Discord" opens the player's default browser on the
`/desktop-login` page, which hands a one-time code back to the app over the
`worldofclaudecraft://desktop-login` deep link. There is no Steam sign-in on any
channel; on the Steam channel the shell's one Steam surface is the account-link
ticket behind the Book of Deeds achievement mirror (`electron/steam.cjs`).

The build stamps `wocDesktop` into the packaged `package.json` (electron-builder
`extraMetadata`, wired in `scripts/electron-build.mjs` +
`scripts/electron-builder-config.mjs`): the `distribution` channel, the `apiOrigin`
the Vite bundle was baked with, the main-process-only `loginOrigin`, the optional
`crashSubmitUrl`, and (steam channel only) the `steamAppId` fed by the
`WOC_STEAM_APP_ID` build env. The shell resolves the stamp at runtime in
`electron/desktop_config.cjs`, and a PACKAGED build ignores the `WOC_*` and
`VITE_DESKTOP_*` runtime env vars entirely (the stamp is final), so a local env var
cannot steer an installed app to another API, login page, updater state, or crash
endpoint. The updater runs only for a PACKAGED WEBSITE build; there is deliberately
no way to force it on in a Steam build. To try either channel unpacked, set
`WOC_DISTRIBUTION=website|steam` on `npm run electron:dev`.

Update tracks (prod/dev split): the publish channel is derived from the baked
`apiOrigin` by one rule shared between build and runtime
(`electron/update_guard.cjs`). A build baked with the production origin publishes
and reads the `latest` channel (`latest-mac.yml`, `latest.yml`,
`latest-linux*.yml`); a build baked with ANY other origin (dev, staging, a
localhost smoke pack) publishes and reads the `dev` channel (`dev-mac.yml` and
friends), which production installs never request. Three layers keep the tracks
apart: the build throws if the production channel is requested for a
non-production origin (`scripts/electron-builder-config.mjs`); every emitted feed
file is stamped with the `wocApiOrigin` its artifact was baked with; and the
running app refuses to download an update whose stamp differs from its own baked
origin (loud `[updater] REFUSED` entry in `main.log`), so even a feed file
renamed onto the wrong track cannot flip an install to another backend.
`WOC_UPDATE_CHANNEL=dev` on a production-origin build is the one supported
cross: it emits a production-origin artifact's feed files on the dev track to
exercise the publish pipeline end to end (no install ever downloads such an
artifact: dev-origin installs refuse its production origin stamp, which is the
fail-safe direction). Never rename `dev*.yml` files to `latest*.yml` on the
update host. Dev installs made BEFORE the track split read the `latest`
channel like everything else did, so they will auto-update onto production
builds; give dev testers a fresh post-split dev build rather than expecting
their old installs to stay on dev.

`npm run electron:pack` / `electron:pack:steam` are the fast local variants
(`--dir`, host arch only, no installers). Release builds use the full arch matrix in
`package.json` `build`: macOS universal (dmg + zip), Windows x64 + arm64 (nsis + zip),
Linux x64 + arm64 (AppImage + deb). To smoke-test a packaged build against a local
server: `VITE_DESKTOP_API_ORIGIN=http://localhost:8787 npm run electron:pack` (a
BUILD-time value: baked into the bundle and stamped into the app; such a build
lands on the `dev` update channel automatically and cannot produce production
feed files).

Build each OS on its own runner (mac artifacts on macOS, Windows artifacts on Windows,
Linux artifacts on Linux). Cross-building is not part of this runbook.

## What the maintainer must provision (one-time)

| Item | Used for | Where it goes |
|---|---|---|
| Apple Developer Program membership (USD 99/yr) | macOS signing + notarization | developer.apple.com |
| Developer ID Application certificate (.p12 export) | macOS signing | CI secret `CSC_LINK` (base64) + `CSC_KEY_PASSWORD` |
| App Store Connect API key (Team Key, App Manager role) | notarization (notarytool) | CI secrets `APPLE_API_KEY` (path to .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Azure subscription + Artifact Signing account (Basic, USD 9.99/mo, 5000 sigs) | Windows signing | account + certificate profile in the Azure portal (needs identity validation; individuals: US/Canada only, orgs also EU/UK) |
| Azure service principal with "Trusted Signing Certificate Profile Signer" role | CI auth for signing | CI secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| Alternative: a code-signing certificate in Azure Key Vault (Route B, what CI uses) | Windows signing via AzureSignTool | CI secrets `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_CERTIFICATE` (plus the service principal secrets above, granted vault sign/get access) |
| Update host: a static HTTPS host / bucket serving `https://updates.worldofclaudecraft.com/desktop/` | website auto-update feed + installer downloads | e.g. Cloudflare R2 bucket behind that hostname (any static host works; the app only GETs) |
| Steam partner account + app ID + three depot IDs | Steam distribution | partner.steamgames.com |
| Steamworks publisher Web API key (+ `STEAM_ENABLED=1`, `STEAM_APP_ID`) | the Book of Deeds achievement mirror + account link (`server/steam/`) | game-server runtime env `STEAM_WEB_API_KEY` (see `DEPLOY.md`) |
| Optional: a crash-minidump endpoint (e.g. a Sentry project's minidump URL) | crash uploads | build env `WOC_CRASH_SUBMIT_URL` (https only) |

Never commit any of these values; they are env vars in CI or the local shell.

## Deploying the game server (required before any public desktop release)

The desktop app is served from the private origin `app://worldofclaudecraft` and
calls `https://worldofclaudecraft.com`, so production must run this branch's server
before a public desktop build ships. The server side is already on the branch and
needs no desktop-specific configuration: deploy it like any server update
(`DEPLOY.md`, "Updating the game": ssh to the box, `cd /opt/eastbrook`,
`sudo git pull`, `sudo docker compose up -d --build`). What the branch's server
carries for desktop:

- CORS reflection for the desktop origins (`DESKTOP_APP_ORIGINS` in
  `server/web_login_guard.ts`, reflected by `maybeCors` in `server/main.ts`). Until
  deployed, every REST call from an installed app fails and its `main.log` fills with
  CORS errors (the realm WebSocket is not Origin-gated).
- The `/desktop-login` browser handoff and its one-time-code exchange
  (`server/desktop_login.ts`), which the Discord sign-in path uses (in-app
  email/password posts `/api/login` directly and never touches it).
- The desktop-origin Turnstile admission (`server/turnstile.ts`): the widget cannot
  run at `app://`, so desktop-Origin requests are admitted without it; a documented,
  accepted softening of the bot gate for the desktop origins only.
- The Steam account-link routes and the Book of Deeds achievement mirror
  (`server/steam/`), env-gated OFF until `STEAM_ENABLED=1` is set (`DEPLOY.md`,
  operational notes).

Verify after deploying (should print the origin back):

```bash
curl -s -D - -o /dev/null -H "Origin: app://worldofclaudecraft" \
  https://worldofclaudecraft.com/api/project-stats | grep -i access-control-allow-origin
```

## macOS: signing + notarization

Config already in the repo: `hardenedRuntime: true`, entitlements
(`build/entitlements.mac.plist`: `allow-jit` + `allow-unsigned-executable-memory`
only; library validation stays ON in production), universal dmg + zip targets, and
the `enableEmbeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar` fuses. Local
ad-hoc builds automatically swap in `build/entitlements.mac.adhoc.plist` (adds
`disable-library-validation`, which team-ID-less ad-hoc signatures need to load
the nested Electron frameworks).

- Signing activates automatically when `CSC_LINK` + `CSC_KEY_PASSWORD` (or `CSC_NAME`
  for a keychain identity) are set. Without them, local builds fall back to AD-HOC
  signing (`--config.mac.identity=-`, wired in `scripts/electron-build.mjs`) so a dev
  build still launches on Apple Silicon. Ad-hoc builds are for local testing only:
  on current macOS (15+) an unnotarized quarantined download shows "damaged / can't
  be opened" and only launches via System Settings > Privacy & Security > Open Anyway
  or `xattr -r -d com.apple.quarantine <app>`.
- Notarization activates automatically when the `APPLE_API_KEY` + `APPLE_API_KEY_ID`
  + `APPLE_API_ISSUER` env vars are present (electron-builder submits via notarytool
  and staples the ticket). `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
  `APPLE_TEAM_ID` also work.
- HARD DEPENDENCY: macOS auto-update does not apply unless the app is signed with a
  real Developer ID AND notarized. The updater consumes the ZIP target (which is why
  zip stays in the mac target list). Ship no public mac build without both.
- Verify after a signed build: `codesign --verify --deep --strict "release/mac-universal/World of ClaudeCraft.app"`
  and `spctl -a -t exec -vv <app>` says "accepted, source=Notarized Developer ID".

## Windows: Azure signing (two routes)

Route A, Azure Artifact Signing (Trusted Signing, electron-builder native):
activates when all four `WIN_SIGN_*` env vars are present at build time on a
Windows runner (injected as `win.azureSignOptions` by `scripts/electron-build.mjs`):

- `WIN_SIGN_PUBLISHER_NAME`: must EXACTLY match the certificate subject CN (the
  validated legal name).
- `WIN_SIGN_ENDPOINT`: the regional endpoint, e.g. `https://eus.codesigning.azure.net`.
- `WIN_SIGN_ACCOUNT_NAME`: the Artifact Signing account name.
- `WIN_SIGN_PROFILE_NAME`: the certificate profile name.

Auth comes from `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`
(electron-builder drives the TrustedSigning PowerShell module, which reads the
standard Azure EnvironmentCredential). Timestamping defaults to Microsoft's server.

Route B, Azure Key Vault certificate (what CI uses): activates when the five
`AZURE_*` env vars below are all present (and the `WIN_SIGN_*` set is not; Route A
wins if both are configured). `scripts/electron-builder-config.mjs` injects the
custom sign hook `scripts/electron-win-sign.mjs` as `win.signtoolOptions.sign`
(pinned to a single sha256 pass); electron-builder invokes the hook for every
signable file it emits (the NSIS installer, the app exe inside the per-arch zips,
the uninstaller), and the hook shells out to the
[AzureSignTool](https://github.com/vcsjones/AzureSignTool) dotnet global tool:

- `AZURE_KEY_VAULT_URL`: the vault URL, e.g. `https://<vault>.vault.azure.net`.
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`: the service
  principal with certificate/key access to the vault.
- `AZURE_KEY_VAULT_CERTIFICATE`: the certificate NAME inside the vault (not a URL).
- Optional: `CODE_SIGN_TIMESTAMP_URL` (only honored when it is an http(s) URL,
  otherwise the hook defaults to `http://timestamp.digicert.com`),
  `CODE_SIGN_FILE_DIGEST` and `CODE_SIGN_TIMESTAMP_DIGEST` (default `sha256`).

Note: `WINDOWS_PUBLISHER_NAME` and `CSC_NAME` are NOT read by the Key Vault route.
`CSC_NAME` is a macOS keychain identity concept, and the publisher name plays no
part in an AzureSignTool invocation; `WINDOWS_PUBLISHER_NAME` should simply match
the certificate subject CN so humans comparing the installer's signature details
against the secret see the same name.

SmartScreen reality: a newly signed app STILL shows "Windows protected your PC" until
the file hash + publisher accumulate reputation (weeks, hundreds of clean installs).
EV certificates no longer bypass this (Microsoft, 2026); do not buy one for that.
Reputation persists across releases signed with the same identity, so it fades.

## Linux

No artifact signing (electron-builder 26 has none built in; per-file signatures are
not customary). Publish SHA256 checksums next to the artifacts (the CI publish
does this as `SHA256SUMS-linux`; manually:
`shasum -a 256 release/*.AppImage release/*.deb > SHA256SUMS-linux`). AppImage is the
auto-updatable target; deb users update manually or via a future repo. The
website download page offers the AppImage (not the deb): it runs on immutable
Fedora atomic desktops (Bazzite, Steam Deck) with no system install, just
`chmod +x` and launch, which the deb cannot do there.

## Publishing from CI (all three platforms)

The `.github/workflows/desktop-publish.yml` workflow publishes all three
platforms automatically:

- Linux: AppImage + deb (x64 + arm64), `SHA256SUMS-linux`, and both per-arch
  feed files. No signing.
- macOS: the signed + notarized universal dmg + zip + blockmap,
  `SHA256SUMS-mac`, and `latest-mac.yml`. The job verifies the signature
  (`codesign --verify --deep --strict`, `spctl -a -t exec`) before uploading
  and refuses to run at all without the Apple secrets, so an ad-hoc build can
  never publish.
- Windows: the Key-Vault-signed universal NSIS installer (one exe covering
  x64 + arm64) + its `.exe.blockmap` + the per-arch zips, `SHA256SUMS-windows`,
  and `latest.yml`. The job verifies the installer is Authenticode-signed
  (`Get-AuthenticodeSignature` must report `Valid`) before uploading and
  refuses to run at all without the Azure Key Vault secrets, so an unsigned
  build can never publish. Because the universal installer's exact filename is
  defined by what electron-builder emits, the job takes the artifact list from
  `latest.yml` (and rejects a `dev*.yml` misbake) instead of pinning literal
  names like the linux/mac jobs do.

The platform jobs are independent: a mac signing failure never blocks the
Linux publish and vice versa.

Triggers:

- Pushing a release tag `v<version>` (the tagged commit must be on `main`, the tag
  must match `package.json` `version`, and `DESKTOP_VERSION` must match too; the
  workflow hard-fails on any mismatch so a half-bumped release cannot publish).
- Manual `workflow_dispatch` (Actions tab, "Desktop publish", pick a branch).
  By default this is a DRY RUN: it builds, signs, verifies, and checksums
  exactly like a release, then attaches the artifacts to the workflow run
  (7-day retention) for inspection instead of uploading, so the whole pipeline
  can be rehearsed without touching the live host. Tick "publish" to really
  upload (the backfill path). The same version lockstep guard runs; only the
  tag and main-ancestry checks are skipped.

Within each job, versioned artifacts upload first and the feed files
(`latest-linux.yml` + `latest-linux-arm64.yml`, `latest-mac.yml`) last, so
installed apps are never offered an update whose file is not yet downloadable.
Versioned artifacts upload with immutable cache headers; checksum and feed
files are near-uncached, matching the existing host convention.

One-time provisioning (maintainer):

1. Cloudflare R2: create a bucket (any name, e.g. `woc-desktop-updates`) and
   connect the custom domain `updates.worldofclaudecraft.com` to it (R2 bucket
   settings, Custom Domains; the zone must be on the same Cloudflare account).
   Objects are uploaded under the `desktop/` prefix, matching the
   `/desktop/` path the feed URL and download page already use.
2. R2 API token: create an "Object Read and Write" API token scoped to that one
   bucket (Cloudflare dashboard, R2, Manage API Tokens). Note the Access Key ID,
   Secret Access Key, and your Cloudflare account id.
3. GitHub repo secrets (Settings, Secrets and variables, Actions), R2 set:
   `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. GitHub repo secrets, Apple set (all five required or the mac job refuses to
   run; sourced from the same credentials the manual mac build uses):
   - `CSC_LINK`: the Developer ID Application `.p12` as base64
     (`base64 -i <cert>.p12 | pbcopy`).
   - `CSC_KEY_PASSWORD`: the `.p12` password.
   - `APPLE_API_KEY_P8`: the raw text content of the App Store Connect API key
     `.p8` file (the workflow writes it to disk and points `APPLE_API_KEY` at
     it; note the manual flow passes a file path here instead).
   - `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: as in the manual flow.
5. GitHub repo secrets, Azure set (the five required ones or the windows job
   refuses to run): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_CERTIFICATE`, plus the optional
   `CODE_SIGN_TIMESTAMP_URL`, `CODE_SIGN_FILE_DIGEST`,
   `CODE_SIGN_TIMESTAMP_DIGEST` (see "Windows: Azure signing", Route B;
   `WINDOWS_PUBLISHER_NAME` and `CSC_NAME` are not consumed by this path).
6. Public read: the custom domain makes the bucket publicly readable through
   that hostname only, which is exactly what the updater and download page need;
   do not additionally enable the `r2.dev` public URL.

Verify after the first publish:

```bash
curl -sI https://updates.worldofclaudecraft.com/desktop/latest-linux.yml | head -1
curl -sI https://updates.worldofclaudecraft.com/desktop/latest-mac.yml | head -1
curl -s https://updates.worldofclaudecraft.com/desktop/SHA256SUMS-linux
```

Users verify a download against the published checksums with
`sha256sum -c SHA256SUMS-linux --ignore-missing` (or `shasum -a 256 -c
SHA256SUMS-mac --ignore-missing` on macOS) from their download directory.

## Publishing a website update

1. Bump `version` in `package.json` (the feed is version-ordered; see rollback),
   and match `DESKTOP_VERSION` in `src/game/desktop_download.ts` so the download
   page links point at the new build (the static hrefs in `index.html` are the
   no-JS fallback; keep them on the same version). The page offers macOS (dmg),
   Windows (the combined x64/arm64 NSIS installer), and Linux (AppImage).
2. Build on each OS runner with signing env present: `npm run electron:build`,
   with `VITE_DESKTOP_API_ORIGIN` unset or set to the production origin. All
   three platforms are built and published by CI on the release tag (see
   "Publishing from CI"); CI leaves the origin unset, so it always bakes
   production. A
   production release MUST emit `latest*.yml` feed files (`latest.yml` on
   Windows, `latest-mac.yml`, `latest-linux*.yml`); if the build produced
   `dev*.yml` instead, it was baked with a non-production origin: rebuild, do
   not rename (renamed files still carry the `wocApiOrigin` stamp and every
   production install will refuse them). The CI jobs pin the exact `latest*`
   filenames they upload, so a dev-channel misbake fails their artifact check
   instead of publishing.
   One-time cleanup with the first track-split release: audit the production
   update host and delete any `latest*.yml` (and its artifacts) that this
   release did not produce. Feed files published before the split carry no
   `wocApiOrigin` stamp and the runtime guard accepts unstamped files for back
   compat, so a leftover pre-split dev-baked `latest*.yml` is the one artifact
   the guard cannot refuse; from this release on, every feed file on the host
   is stamped and the acceptance window can later be tightened to stamped-only.
3. Upload from `release/` to the update host directory (keep filenames exactly):
   - macOS: handled by CI; the manual list, should CI ever be bypassed:
     `world-of-claudecraft-<v>-mac-universal.dmg` (download page),
     `...-mac-universal.zip` + `.zip.blockmap` (updater), `latest-mac.yml`.
   - Windows: handled by CI (which takes the artifact list from `latest.yml`,
     see "Publishing from CI"). For a manual upload, should CI ever be
     bypassed: with x64+arm64 and no `nsis` block, electron-builder's
     `buildUniversalInstaller` default (true) emits ONE combined NSIS installer
     covering both arches (not per-arch `-win-x64.exe` / `-win-arm64.exe`), plus
     its `.exe.blockmap` and `latest.yml`. Upload exactly what `release/` holds;
     verify the emitted installer filename and the `path` in `latest.yml` on the
     first Windows build. To ship separate per-arch installers instead, set
     `build.nsis.buildUniversalInstaller: false`.
   - Linux: handled by CI (see "Publishing from CI" above); the manual list,
     should CI ever be bypassed: `...-linux-x86_64.AppImage` (x64) /
     `...-linux-arm64.AppImage`
     (electron-builder names the x64 AppImage `x86_64`; blockmap data is
     embedded), the debs `...-linux-amd64.deb` (x64) / `...-linux-arm64.deb` for
     the download page, plus BOTH per-arch feed files `latest-linux.yml` (x64)
     and `latest-linux-arm64.yml` (arm64). Omitting the arm64 feed means arm64
     AppImage installs can never self-update.
4. The running app checks 15 seconds after launch and every 4 hours
   (`electron/updater.cjs`), downloads in the background, toasts the player
   ("restart now" or install-on-quit), and applies deltas via blockmap when the host
   supports HTTP range requests (best-effort; full download is the fallback).

Staged rollout: after uploading, hand-edit `stagingPercentage: N` (0-100) into the
`latest*.yml` you want to stage; each install hashes a persistent per-machine UUID
against N, so the cohort is stable. Raise N to widen, delete the line to finish.

Rollback: you cannot re-publish the same or a lower version; installs that already
took the bad build compare versions and will NOT downgrade. Pulling a bad release =
publish a HIGHER version containing the fix (and/or drop `stagingPercentage` to 0 to
stop further spread while you build it).

Linux AppImage caveat: the updater requires the `APPIMAGE` env (set automatically
when running a real AppImage); running the raw unpacked binary logs an updater error
and skips, by design.

## Steam

Build: `npm run electron:build:steam` on each OS runner (signing env still applies on
mac; Steam mac builds must ALSO be Developer ID signed + notarized). Set
`WOC_STEAM_APP_ID` in the build env so the stamp carries the real app id: the build
refuses to run without a numeric id, because a packaged depot without the stamp
would init Steam with the Spacewar fallback id (480) and link tickets would verify
against the wrong app. Output layouts
in `release-steam/`:

- `mac-universal/World of ClaudeCraft.app` (one universal .app)
- `win-unpacked/` (x64; Windows-on-ARM runs it via emulation)
- `linux-unpacked/` (x64)

Depot layout (one app, three depots, one package):

| Depot | Content root | OS filter |
|---|---|---|
| `<appid>1` | `win-unpacked/*` | Windows, 64-bit |
| `<appid>2` | `World of ClaudeCraft.app` (the loose bundle) | macOS |
| `<appid>3` | `linux-unpacked/*` | Linux, 64-bit |

Launch options (one per OS): Windows `World of ClaudeCraft.exe`; macOS
`World of ClaudeCraft.app` (app-bundle launch picks the best arch on Apple Silicon);
Linux `world-of-claudecraft` (the executable inside linux-unpacked).

Rules that keep this working:
- Upload the mac depot from a macOS or Linux machine (a Windows upload destroys the
  symlinks inside `Electron Framework.framework` and the signature with them).
  Upload the loose `.app` directory; never a zip or dmg (SteamPipe installs files
  as-is and preserves the notarized signature).
- Do NOT apply the Valve DRM wrapper on any platform (it rewrites the exe like a
  packer, is unavailable for mac, and Valve itself calls it weak).
- The Steamworks SDK loads on this channel only to mint the account-link
  ticket: `electron/steam.cjs` lazily requires `steamworks.js`, which rides the
  steam depot alone, asar-unpacked (`scripts/electron-builder-config.mjs`);
  website builds never load it. Achievements reach Steam through the SERVER'S
  Book of Deeds mirror (`server/steam/`), not the client SDK; cloud and rich
  presence stay unused, and the Steam OVERLAY is not hooked (nothing calls an
  overlay enable). Gate: `tests/electron_steam.test.ts`.
- Updates ship as new SteamPipe builds promoted to the default branch; the in-app
  updater is off in this channel (runtime stamp) AND the build has no publish feed
  (no app-update.yml), so there is nothing to disable manually. Steam policy is that
  updates flow through Steam; keep it that way.
- `steam_appid.txt` is not needed (`electron/steam.cjs` passes the app id
  straight to `init`) and must not ship.

## Error logging, crash dumps, privacy

- Shell log file (rotating, 5 MB + one archive; paths follow the package NAME,
  verified on a packaged build): macOS
  `~/Library/Logs/world-of-claudecraft/main.log`; Windows
  `%USERPROFILE%\AppData\Roaming\world-of-claudecraft\logs\main.log`; Linux
  `~/.config/world-of-claudecraft/logs/main.log`. Contains the startup banner
  (version/channel/updater state), GPU status (including a warning if WebGL fell
  back to software), updater activity, renderer console warnings/errors, uncaught
  renderer errors (clamped + secret-redacted, capped per session), and crash/
  recovery events. Ask players to attach it to bug reports.
- Native crash minidumps (Crashpad, all processes) accumulate under the directory
  logged at startup (`app.getPath('crashDumps')`). By default nothing is uploaded
  anywhere. If `WOC_CRASH_SUBMIT_URL` (https) is set at BUILD time, dumps upload
  compressed + rate-limited to that endpoint; any multipart minidump receiver works,
  including a Sentry project's `/minidump/` ingest URL, with no SDK added.
- Privacy: logs stay on the player's machine; the only optional transmission is the
  minidump upload above. Minidumps are process-memory snapshots and CAN contain
  whatever was in memory at crash time (including a session token), so before
  enabling the upload: put the ingest endpoint behind access control, restrict who
  can read dumps, set a retention window, and disclose the upload in the privacy
  policy. The log redaction strips bearer tokens and obvious credential patterns
  before writing.

## Post-release verification checklist (each OS, each channel)

1. Fresh install, launch: window appears, no Gatekeeper/SmartScreen block (signed
   builds), log file created, startup banner shows the right `version`,
   `distribution`, `updaterEnabled`, and `updateChannel` (`latest` on a
   production build, `dev` on anything else).
2. GPU: log shows `[gpu] feature status` with hardware WebGL2 (no
   `software only`, no SwiftShader/llvmpipe renderer, no softwareRendering warning).
   The shell forces the high-performance GPU automatically at startup:
   `electron/gpu_preference.cjs` (called from `electron/main.cjs` before app ready)
   appends the Chromium `force-high-performance-gpu` switch on every platform, and
   packaged Windows builds also merge `GpuPreference=2` into the app exe entry under
   HKCU DirectX `UserGpuPreferences`, preserving the user's other per-app tokens.
   A hybrid-GPU machine that still reports the integrated adapter in
   `[gpu] feature status` is therefore a regression, not a user misconfiguration.
   Pinned by `tests/electron_gpu_preference.test.ts`.
   On the website NSIS channel the uninstaller now removes that per-app value on a
   real uninstall (the `customUnInstall` hook in `build/installer.nsh`, pinned by
   `tests/desktop_uninstall_cleanup.test.ts`), so no dangling `UserGpuPreferences`
   entry survives for a deleted exe path; it is left in place during auto-updates so
   the Settings > Graphics entry does not flicker. The Steam depots have no
   uninstaller hook, so a Steam uninstall leaves the value behind as a harmless
   per-user orphan. Support triage, the verified configurations where the per-app
   preference does NOT win (fall back to the Chromium switch, and confirm with
   `[gpu] feature status`): Windows 10 1803 to 1909 honors the value but a
   conflicting NVIDIA Control Panel profile can still win, so the Chromium switch is
   the working lever there; Windows 11 with an attached eGPU can ignore the per-app
   preference while the eGPU is connected; pre-1803 Windows 10 ignores the key
   entirely.
3. Login both paths: email/password in-app, and Discord via the external browser +
   `worldofclaudecraft://desktop-login` deep link handoff (app focuses and enters
   the world; second-instance and cold-start deep links both work).
4. Play 5 minutes: steady frame rate, alt-tab out/in does not hitch or freeze the
   world (backgroundThrottling stays off).
5. Website channel only: with a higher-version build on the feed, the update toast
   appears, "Restart now" applies it, and a player who quits instead gets it on next
   launch; after the restart the log's startup banner still shows the production
   `apiOrigin` channel (`updateChannel: latest`). Steam channel: confirm the log
   says the updater is disabled and no update network traffic occurs.
6. Crash surfaces: `kill -SEGV <renderer pid>` THREE times within a minute (a
   task-manager "end task" is classified as a benign `killed` exit and does not
   trigger recovery). The first two SEGVs each produce a log entry and a bounded
   auto-reload; the third reaches the localized Reload/Quit dialog (the auto-
   reload budget is 2 per 60s, electron/diagnostics.cjs). Each SEGV lands a
   minidump in crashDumps.
7. `npm test` green at the built commit; `tests/electron_*.test.ts` cover the
   shell's pure logic.

## Version pinning

Electron is `^43.0.0` (current stable, EOL 2027-01-05; the lockfile pins the exact
patch). Before bumping to 44 (stable ~2026-08-25): audit renderer `clipboard` usage
(removed from renderers in 44) and drop any 32-bit expectations. electron-builder
stays on 26.x (27 is an ESM-only alpha); electron-updater 6.x (7 is an ESM alpha).
