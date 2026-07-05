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
channel (Steam is distribution only).

The build stamps `wocDesktop` into the packaged `package.json` (electron-builder
`extraMetadata`, wired in `scripts/electron-build.mjs` +
`scripts/electron-builder-config.mjs`): the `distribution` channel, the `apiOrigin`
the Vite bundle was baked with, the main-process-only `loginOrigin`, and the optional
`crashSubmitUrl`. The shell resolves the stamp at runtime in
`electron/desktop_config.cjs`, and a PACKAGED build ignores the `WOC_*` and
`VITE_DESKTOP_*` runtime env vars entirely (the stamp is final), so a local env var
cannot steer an installed app to another API, login page, updater state, or crash
endpoint. The updater runs only for a PACKAGED WEBSITE build; there is deliberately
no way to force it on in a Steam build. To try either channel unpacked, set
`WOC_DISTRIBUTION=website|steam` on `npm run electron:dev`.

`npm run electron:pack` / `electron:pack:steam` are the fast local variants
(`--dir`, host arch only, no installers). Release builds use the full arch matrix in
`package.json` `build`: macOS universal (dmg + zip), Windows x64 + arm64 (nsis + zip),
Linux x64 + arm64 (AppImage + deb). To smoke-test a packaged build against a local
server: `VITE_DESKTOP_API_ORIGIN=http://localhost:8787 npm run electron:pack` (a
BUILD-time value: baked into the bundle and stamped into the app).

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
| Update host: a static HTTPS host / bucket serving `https://updates.worldofclaudecraft.com/desktop/` | website auto-update feed + installer downloads | e.g. Cloudflare R2 bucket behind that hostname (any static host works; the app only GETs) |
| Steam partner account + app ID + three depot IDs | Steam distribution | partner.steamgames.com |
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

## Windows: Azure Artifact Signing

Signing activates when all four `WIN_SIGN_*` env vars are present at build time on a
Windows runner (injected as `win.azureSignOptions` by `scripts/electron-build.mjs`):

- `WIN_SIGN_PUBLISHER_NAME`: must EXACTLY match the certificate subject CN (the
  validated legal name).
- `WIN_SIGN_ENDPOINT`: the regional endpoint, e.g. `https://eus.codesigning.azure.net`.
- `WIN_SIGN_ACCOUNT_NAME`: the Artifact Signing account name.
- `WIN_SIGN_PROFILE_NAME`: the certificate profile name.

Auth comes from `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`
(electron-builder drives the TrustedSigning PowerShell module, which reads the
standard Azure EnvironmentCredential). Timestamping defaults to Microsoft's server.

SmartScreen reality: a newly signed app STILL shows "Windows protected your PC" until
the file hash + publisher accumulate reputation (weeks, hundreds of clean installs).
EV certificates no longer bypass this (Microsoft, 2026); do not buy one for that.
Reputation persists across releases signed with the same identity, so it fades.

## Linux

No artifact signing (electron-builder 26 has none built in; per-file signatures are
not customary). Publish SHA256 checksums next to the artifacts:
`shasum -a 256 release/*.AppImage release/*.deb > SHA256SUMS`. AppImage is the
auto-updatable target; deb users update manually or via a future repo.

## Publishing a website update

1. Bump `version` in `package.json` (the feed is version-ordered; see rollback).
2. Build on each OS runner with signing env present: `npm run electron:build`.
3. Upload from `release/` to the update host directory (keep filenames exactly):
   - macOS: `world-of-claudecraft-<v>-mac-universal.dmg` (download page),
     `...-mac-universal.zip` + `.zip.blockmap` (updater), `latest-mac.yml`.
   - Windows: with x64+arm64 and no `nsis` block, electron-builder's
     `buildUniversalInstaller` default (true) emits ONE combined NSIS installer
     covering both arches (not per-arch `-win-x64.exe` / `-win-arm64.exe`), plus
     its `.exe.blockmap` and `latest.yml`. Upload exactly what `release/` holds;
     verify the emitted installer filename and the `path` in `latest.yml` on the
     first Windows build. To ship separate per-arch installers instead, set
     `build.nsis.buildUniversalInstaller: false`.
   - Linux: `...-linux-x86_64.AppImage` (x64) / `...-linux-arm64.AppImage`
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
mac; Steam mac builds must ALSO be Developer ID signed + notarized). Output layouts
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
- No Steamworks SDK is linked, which Valve explicitly supports; consequences:
  no achievements/cloud/rich presence, and the Steam OVERLAY does not hook the game.
  Accepted for v1. If overlay/achievements are ever wanted, that is a steamworks.js
  (or successor) project with its own CI gate; do not bolt it on casually.
- Updates ship as new SteamPipe builds promoted to the default branch; the in-app
  updater is off in this channel (runtime stamp) AND the build has no publish feed
  (no app-update.yml), so there is nothing to disable manually. Steam policy is that
  updates flow through Steam; keep it that way.
- `steam_appid.txt` is not needed (SDK never initialized) and must not ship.

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
   `distribution`, and `updaterEnabled`.
2. GPU: log shows `[gpu] feature status` with hardware WebGL2 (no
   `software only`, no SwiftShader/llvmpipe renderer, no softwareRendering warning).
3. Login both paths: email/password in-app, and Discord via the external browser +
   `worldofclaudecraft://desktop-login` deep link handoff (app focuses and enters
   the world; second-instance and cold-start deep links both work).
4. Play 5 minutes: steady frame rate, alt-tab out/in does not hitch or freeze the
   world (backgroundThrottling stays off).
5. Website channel only: with a higher-version build on the feed, the update toast
   appears, "Restart now" applies it, and a player who quits instead gets it on next
   launch. Steam channel: confirm the log says the updater is disabled and no
   update network traffic occurs.
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
