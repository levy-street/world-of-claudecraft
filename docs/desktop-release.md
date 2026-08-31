# Desktop release runbook (Electron: website download + Steam + Epic)

How to build, sign, publish, and verify the World of ClaudeCraft desktop app.
The longer companion explainer (what shipped, per-platform update/signing
mechanics, step-by-step release walkthroughs) is `docs/desktop-ship-notes.md`.
One codebase produces three distribution channels:

| Channel | Command | Output | Updates |
|---|---|---|---|
| website | `npm run electron:build` | `release/` installers + update feed files | in-app via electron-updater |
| steam | `npm run electron:build:steam` | `release-steam/` loose per-OS layouts | SteamPipe depots only (in-app updater OFF) |
| epic | `npm run electron:build:epic` | `release-epic/` loose Win+Mac layouts | Epic BPT only (in-app updater OFF) |

Sign-in is email and Discord only, identical to the web flow: email/password logs in
inside the app, and "Continue with Discord" opens the player's default browser on the
`/desktop-login` page, which hands a one-time code back to the app over the
`worldofclaudecraft://desktop-login` deep link. There is no Steam or Epic sign-in on
any channel; on the Steam channel the shell's one Steam surface is the account-link
ticket behind the Book of Deeds achievement mirror (`electron/steam.cjs`). Epic
account-link and achievement mirror surfaces live under
`docs/epic-games-integration/` (dark by default; see `DEPLOY.md`). Packaging,
BuildPatchTool upload, portal checklist, and server env keys are in this runbook
(Epic section below), `docs/epic-games-integration/bpt-upload.md`,
`docs/epic-games-integration/portal-checklist.md`, and `DEPLOY.md`. Live portal
and store work is tracked in
https://github.com/levy-street/world-of-claudecraft/issues/2708.

The build stamps `wocDesktop` into the packaged `package.json` (electron-builder
`extraMetadata`, wired in `scripts/electron-build.mjs` +
`scripts/electron-builder-config.mjs`): the `distribution` channel, the `apiOrigin`
the Vite bundle was baked with, the main-process-only `loginOrigin`, the optional
`crashSubmitUrl`, (steam channel only) the `steamAppId` fed by the
`WOC_STEAM_APP_ID` build env, and (epic channel only) the `epicProductId` /
`epicDeploymentId` / `epicClientId` fed by `WOC_EPIC_PRODUCT_ID` /
`WOC_EPIC_DEPLOYMENT_ID` / `WOC_EPIC_CLIENT_ID`. Website builds need no Steam or
Epic env. The shell resolves the stamp at runtime in `electron/desktop_config.cjs`,
and a PACKAGED build ignores the `WOC_*` and `VITE_DESKTOP_*` runtime env vars
entirely (the stamp is final), so a local env var cannot steer an installed app to
another API, login page, updater state, or crash endpoint. The updater runs only
for a PACKAGED WEBSITE build; there is deliberately no way to force it on in a
Steam or Epic build. To try a channel unpacked, set
`WOC_DISTRIBUTION=website|steam|epic` on `npm run electron:dev`. That env opt-in
is also what makes the $WOC Exchange visible in the dev shell: the Exchange gate
requires an explicit website verdict even on unpackaged checkouts
(`wocExchangeSupported` in `electron/desktop_config.cjs`), so without
`WOC_DISTRIBUTION=website` the dev shell shows no Exchange launcher.

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

`npm run electron:pack` / `electron:pack:steam` / `electron:pack:epic` are the fast
local variants (`--dir`, host arch only, no installers). Epic packs still require
the three `WOC_EPIC_*` build ids and emit Win+Mac dir layouts only (no linux).
Release builds use the full arch matrix in `package.json` `build`: macOS universal
(dmg + zip), Windows x64 + arm64 (nsis + zip), Linux x64 + arm64 (AppImage + deb)
for website; steam and epic override to loose `dir` targets (epic: no linux). To
smoke-test a packaged build against a local server:
`VITE_DESKTOP_API_ORIGIN=http://localhost:8787 npm run electron:pack` (a BUILD-time
value: baked into the bundle and stamped into the app; such a build lands on the
`dev` update channel automatically and cannot produce production feed files).

For a fast CSP regression check without packaging at all, run
`node scripts/csp_shell_smoke.mjs` against a running dev server: it attaches the real
`buildContentSecurityPolicy()` output (electron/shell_guards.cjs) to the dev document,
drives offline world entry in a real browser, and fails on any first-party CSP
violation. Only packaged builds serve the CSP, so this is the only pre-pack way to see
a policy break like the v0.39.0 zstd KTX2 world-entry hang. Its unit-level twin,
`tests/gltf_decoder_csp.test.ts`, welds the CSP to the vendored three decoder sources
and runs in every CI test pass.

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
| Epic org + product (+ sandboxes, clients, artifacts) | Epic Games Store distribution | [dev.epicgames.com/portal](https://dev.epicgames.com/portal) (see `docs/epic-games-integration/portal-checklist.md`) |
| Epic EOS client id/secret (+ `EPIC_ENABLED=1`, product/deployment ids) | Book of Deeds achievement mirror + account link (`server/epic/`) | game-server runtime env (see `DEPLOY.md`); never the BPT client secret |
| Epic BPT client id/secret + organization/artifact ids | BuildPatchTool binary upload to Dev sandbox | local shell only; never commit; see `docs/epic-games-integration/bpt-upload.md` |
| Optional: a crash-minidump endpoint (e.g. a Sentry project's minidump URL) | crash uploads | build env `WOC_CRASH_SUBMIT_URL` (https only) |
| Discord application registration, NAMED "World of ClaudeCraft" (the registration name is what Discord renders as "Playing X") | Discord Rich Presence (`electron/discord_presence.cjs`) | PROVISIONED 2026-08-15: the official application id ships baked in (`DEFAULT_DISCORD_APP_ID`, pinned to its literal in `tests/electron_discord_presence.test.ts`), so presence works out of the box in every build. `WOC_DISCORD_APP_ID` remains the operator override at shell launch (`resolveDiscordClientId`); a set-but-invalid value (for example `WOC_DISCORD_APP_ID=off`) resolves to inert, which is both the typo failure mode and the opt-out for forks. App Verification status on the portal does not gate rich presence |

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
- The Epic account-link routes and Book of Deeds achievement mirror
  (`server/epic/`), env-gated OFF until `EPIC_ENABLED=1` is set (`DEPLOY.md`).
  Dark default answers `epic.disabled` and advertises `epic.enabled: false`;
  linking is cosmetic only (no login with Epic).

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
- Windows: the Key-Vault-signed per-arch NSIS installers (`build.nsis.
  buildUniversalInstaller: false`, one `-win-x64.exe` and one `-win-arm64.exe`
  instead of a single dual-arch exe) + their `.exe.blockmap` files + the
  per-arch zips, `SHA256SUMS-windows`, and `latest.yml` (both installers list
  in the SAME feed file; Windows update-info filenames carry no arch suffix).
  The job verifies every installer is Authenticode-signed
  (`Get-AuthenticodeSignature` must report `Valid`) before uploading and
  refuses to run at all without the Azure Key Vault secrets, so an unsigned
  build can never publish. Because the installers' exact filenames are
  defined by what electron-builder emits, the job takes the artifact list from
  `latest.yml` (and rejects a `dev*.yml` misbake) instead of pinning literal
  names like the linux/mac jobs do; it iterates every file the feed
  references, so it verifies and uploads both arches without change.

The platform jobs are independent: a mac signing failure never blocks the
Linux publish and vice versa.

Triggers:

- Pushing a release tag `v<version>` (the tagged commit must be on `main` and the
  tag must match `package.json` `version`; the workflow hard-fails on a mismatch
  so a half-bumped release cannot publish). The download page's version derives
  from `package.json` at build time, so there is no second constant to keep in
  step with the tag.
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

1. Bump `version` in `package.json` (the feed is version-ordered; see rollback).
   `DESKTOP_VERSION` in `src/game/desktop_download.ts` derives from it at build
   time through the `__APP_VERSION__` define, so the download page links follow
   the bump on their own; `scripts/release_version.mjs prepare` rewrites the
   static hrefs in `index.html` and `play.html` (the no-JS fallback) to the same
   version, and `tests/desktop_download_dom.test.ts` pins them against the
   module. Artifact names key off `package.json` `version` too. The page
   offers macOS (dmg), Windows (the x64 NSIS installer; `build.nsis.
   buildUniversalInstaller: false` makes electron-builder emit one installer per
   arch instead of a single dual-arch exe, and the download page links x64,
   matching every other channel's precedent of running Windows-on-ARM visitors
   under x64 emulation), and Linux (AppImage).
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
     bypassed: `build.nsis.buildUniversalInstaller: false` makes electron-builder
     build a SEPARATE installer per arch instead of one dual-arch exe:
     `world-of-claudecraft-<v>-win-x64.exe` and `...-win-arm64.exe`, each with
     its own `.exe.blockmap`. Both artifacts write into the SAME `latest.yml`
     (Windows update-info filenames carry no arch suffix): its `files:` list
     carries one entry per arch (x64 sorts first, so the legacy top-level
     `path`/`sha512` fields point at the x64 installer), and electron-updater
     on each running install downloads the entry matching its own arch. Upload
     every `.exe` + `.exe.blockmap` pair `release/` holds, plus `latest.yml`;
     verify both installer filenames and the `files:` entries in `latest.yml`
     on the first Windows build after this change.
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

Linux deep-link caveat: `worldofclaudecraft://` is owned by a `.desktop` entry, not by
an OS registry, so `electron/linux_url_handler.cjs` runs before
`app.setAsDefaultProtocolClient` on both Linux channels. On the AppImage it writes
`~/.local/share/applications/world-of-claudecraft-appimage.desktop` (the entry electron-builder
bakes into the squashfs is never installed unless the player has AppImageLauncher), runs
`update-desktop-database` when those entry bytes change, and always re-runs
`xdg-mime default`. It then repoints `CHROME_DESKTOP` at
whichever entry belongs to the channel it is running as: ours on an AppImage run, the deb's
(`world-of-claudecraft.desktop`, installed by dpkg) otherwise. That matters, because pointing
it at ours unconditionally would make a deb launch register the AppImage's entry, which is the
same shadowing the distinct filename exists to prevent, reached through `CHROME_DESKTOP`
instead of the desktop-file ID.

The repoint is needed at all because Electron resolves the name it hands `xdg-settings` from
that variable, and with no `desktopName` in `package.json` the name it infers comes from
`app.name` (`World of ClaudeCraft.desktop`), which matches no file on disk. The deb's basename
MUST keep tracking `executableName`: `tests/electron_linux_url_handler.test.ts` derives it from
`package.json` `name` AND pins that no `executableName` / `desktopName` override exists, so
either kind of rename fails there rather than silently breaking Discord login.

Deliberate narrowings worth knowing before changing any of it:
- `CHROME_DESKTOP` is set only when the entry actually exists on disk (ours or the
  deb's), and is restored immediately after the registration call. Setting it
  unconditionally would make a Steam depot, an Epic package, or a dev run point
  `xdg-settings` at a dangling name, which can REPLACE a working association; leaving it
  set leaks our app identity to every child process, including the browser opened for
  the Discord login itself.
- The entry is written temp-then-`rename` (with `wx` on the temp), so a concurrent second
  instance cannot leave a torn file and a symlink at either path is refused or replaced rather
  than followed.
- The AppImage entry is `world-of-claudecraft-appimage.desktop`, deliberately NOT the deb's
  basename. Same basename means the same desktop-file ID, and a user-level file wins outright,
  so reusing it would let one AppImage run replace the deb's entry everywhere; with `TryExec`
  that becomes a silent removal once the AppImage is deleted, and `apt reinstall` cannot fix it
  because the shadowing file is in `$HOME`. `CHROME_DESKTOP` is pointed at whichever entry
  actually exists, ours first, the deb's second.
- The association (`update-desktop-database` and `xdg-mime`) runs AFTER
  `app.setAsDefaultProtocolClient`, never alongside it. Electron's Linux path shells out to
  `xdg-settings`, which runs `xdg-mime default` itself against the same unlocked
  read-modify-write file; on a torn read `xdg-settings` restores the ORIGINAL association and
  fails, which is exactly the broken state this exists to remove.
- An unchanged entry still re-runs `xdg-mime default`, while `update-desktop-database`
  is reserved for changed desktop-entry bytes. The file being identical does not mean the
  association survived: another app can claim the scheme and a desktop environment can reset
  `mimeapps.list`, and without the re-assert that breaks Discord login permanently with no
  relaunch that recovers it.
- Not `app.setDesktopName()`, the public API for the same value: it also drives the
  Wayland app id and X11 `WM_CLASS`, which electron-builder independently writes as
  `StartupWMClass` from `productName`. Changing one without the other breaks the
  window-to-launcher association that works today.

An AppImageLauncher user ends up with two entries (theirs, `appimagekit_*.desktop`, plus
ours); ours takes the scheme default, which is the working one. All of it is best-effort:
a player with no `xdg-utils` or a read-only home still signs in with a username and
password, which never leaves the shell.

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

Steam-on-Linux caveat: Steam preloads `gameoverlayrenderer.so` into every native Linux game
it launches, and with that library mapped Chromium's GPU process cannot start. The browser
process retries, gives up, and dies on a `CHECK`:

```
FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc] GPU process isn't usable. Goodbye.
```

`SIGTRAP`, no window, no `main.log`. To a player that is Steam's launching spinner, forever.
`electron/steam_overlay_guard.cjs` appends `--disable-gpu-sandbox` when, and only when, the
overlay is actually preloaded. Measured on a Steam Deck with the overlay in place: no flags
crashes; `--disable-gpu-sandbox`, `--no-sandbox` and `--in-process-gpu` all boot. The narrowest
one ships, because the RENDERER sandbox is the boundary that contains page content and it stays
on. It boots on real hardware rather than falling back to software (3 runs of 3 reported the
Deck's AMD adapter `0x1002:0x1435` active, with `webgl`, `gpu_compositing` and `rasterization`
all `enabled`), which is the thing to re-check if this is ever changed: a "fix" that silently
swapped in SwiftShader would be worse than the crash.

Two things that look like fixes and are not, both measured rather than assumed:
- **Stripping the overlay from `LD_PRELOAD`.** It cannot be done from inside the app, since
  `ld.so` reads the variable at exec time. Every shape of re-exec fails: a detached parent exits
  at once and Steam reads that as the game closing; a parent blocked in `spawnSync` cannot run a
  signal handler, and the child lands in its own `app-world-of-claudecraft-<pid>.scope` while the
  parent stays in `app-steam@autostart.service`, so Steam's stop kills the parent and strands the
  game; a supervising parent can forward signals but is itself an Electron process with the
  overlay mapped, so it dies of the crash it exists to avoid.
- **Turning the overlay off in Steam.** It does not stop the injection. With `AllowOverlay=0` on
  the shortcut, Steam still handed the launch both `gameoverlayrenderer.so` paths. Do not ship a
  Linux depot betting on the Steamworks per-app overlay setting.

Verify a Steam launch by grepping `main.log` for `[steam] Steam overlay detected` (pinned by
`tests/electron_steam_overlay_guard.test.ts`, so a reword cannot break the procedure quietly).
Steam injects the overlay into depot builds as well as non-Steam shortcuts, and the crash
reproduces on a non-AppImage binary, so this is very unlikely to be AppImage-specific. It has
NOT been verified on a real depot launch though: running `linux-unpacked/` standalone is not a
faithful stand-in (Steam launches it through `reaper`, potentially inside the Steam Linux
Runtime container, and the layout expects env that the AppImage's AppRun sets). Confirm on an
actual depot build before trusting this section for the Steam channel.

Adjacent, and worth knowing before it is rediscovered the hard way: the PRIME relaunch above
spawns `detached` and exits the parent, which is the thing Steam reads as the game closing. It
fires whenever `/sys/class/drm` holds two or more `card*` entries, so a hybrid laptop launched
through Steam takes that path and Steam stops tracking the process that survives. A Steam Deck
reports one card, so it does not arise there.

## Epic Games Store

Build: `npm run electron:build:epic` on a Windows runner and a macOS runner
(signing env still applies on mac; Epic mac builds must ALSO be Developer ID
signed + notarized, same as Steam). The build refuses to run without all three
non-empty build ids (whitespace-only refused too):

| Build env | Stamped into `wocDesktop` |
|---|---|
| `WOC_EPIC_PRODUCT_ID` | `epicProductId` |
| `WOC_EPIC_DEPLOYMENT_ID` | `epicDeploymentId` |
| `WOC_EPIC_CLIENT_ID` | `epicClientId` |

Server-only secrets (`EPIC_CLIENT_SECRET`, BPT client secret) never land in the
client stamp. Website and steam builds need none of the `WOC_EPIC_*` vars.
Publish is always null on this channel (`publish: null`); there is no
`app-update.yml` and electron-updater never runs (Epic BuildPatchTool owns
patches). Output layouts in `release-epic/`:

- `mac-universal/World of ClaudeCraft.app` (one universal `.app`)
- `win-unpacked/` (x64; Windows-on-ARM runs it via emulation)

There is **no Linux** epic target or depot (v1 ships Windows + macOS only).
Linux players stay on the website AppImage/deb or Steam.

Launch relative paths for BPT `-AppLaunch` (inside each BuildRoot):

| OS | BuildRoot (upload the loose tree) | AppLaunch (relative to BuildRoot) |
|---|---|---|
| Windows | `release-epic/win-unpacked/` | `World of ClaudeCraft.exe` |
| macOS | `release-epic/mac-universal/` | `World of ClaudeCraft.app/Contents/MacOS/World of ClaudeCraft` (exact nested MacOS binary name as emitted; confirm on first pack) |

Rules that keep this working:

- Upload **loose directory trees** only (BPT `UploadBinary` over `BuildRoot`).
  Never upload website NSIS/DMG/AppImage/deb installers, steam `release-steam/`
  trees, git checkouts, `.env` files, or server secrets as the EGS binary.
- Mac: upload the loose `.app` tree (or its parent layout that still contains
  the bundle). Prefer a macOS host so Apple symlinks and the notarized seal
  stay intact (same class of hazard as Steam mac depot uploads).
- Updates ship as new BPT binaries labeled and promoted through Epic Release
  Management (Dev sandbox first, then Live when ready). The in-app updater is
  off on this channel (runtime stamp) AND the build has no publish feed.
- Desktop Epic shell: `electron/epic.cjs` is the only main-process surface
  (capability + link proof + settle). Missing native EOS degrades to null;
  website/steam packages never load it. Achievements reach Epic through the
  **server** mirror (`server/epic/`), not client-reported unlocks.
- Unpackaged dev only: `WOC_DISTRIBUTION=epic` and `WOC_EPIC_DEV=1` on
  `npm run electron:dev` (optional id overrides). Packaged stamps ignore
  runtime `WOC_*` channel escapes.
- Fast local dir pack (host arch, still needs the three ids):
  `npm run electron:pack:epic`.

Full BuildPatchTool install, credential placeholders, sandbox vs Live,
fail-closed upload script, and portal checklist:

- `docs/epic-games-integration/bpt-upload.md`
- `docs/epic-games-integration/portal-checklist.md`
- Optional operator script: `node scripts/epic-bpt-upload.mjs` (or
  `npm run epic:bpt-upload`). Not part of `npm test` / `npm run gate` / default
  CI. Fails closed when BPT credentials or product/artifact ids are missing.
  No live upload until the maintainer provides real org credentials and runs
  it deliberately.

Cannot complete a real BPT upload or store submission until the Epic org and
product exist. Coding and merge stay dark-safe without those credentials.

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
- Desktop prefs and the GPU-force no-boot rescue: the shell persists its own
  small store as `desktop-prefs.json` under the per-user profile directory
  (`app.getPath('userData')`: macOS
  `~/Library/Application Support/world-of-claudecraft/`; Windows
  `%APPDATA%\world-of-claudecraft\`; Linux `~/.config/world-of-claudecraft/`),
  holding window memory plus `gpuForceOptOut` (see `electron/desktop_prefs.cjs`).
  The in-game toggle (Options, Interface, "Use the Dedicated Gaming GPU")
  writes it, but a machine the GPU force prevents from booting can never reach
  that toggle. The supported rescue for "the game will not start at all on a
  hybrid-GPU machine": quit the game, edit the file so it contains
  `{"version":1,"gpuForceOptOut":true}` (or set just that field in the existing
  JSON), and relaunch; the next launch skips both GPU levers. The loader
  tolerates hand-edits, including a Windows editor's UTF-8 BOM; a corrupt or
  deleted file resolves to defaults, which is force ON. Faster one-launch
  variant needing no file edit: start the game with `WOC_DISABLE_GPU_FORCE=1`
  in the environment (strict `1`), which skips both levers for that launch
  without touching the stored preference; use it to boot far enough to flip
  the in-game toggle off for good.
- V8 code cache: the app:// scheme registers `codeCache: true` (electron/main.cjs,
  pinned key by key in `tests/electron_scheme_privileges.test.ts`), so Chromium
  persists compiled bytecode for the bundled scripts under the per-user profile
  (`Code Cache/`, sibling of the log paths above) to cut cold-start compile time.
  Known integrity tradeoff: the `onlyLoadAppFromAsar` and
  `enableEmbeddedAsarIntegrityValidation` fuses do not cover this cache, so it is a
  user-writable input to the JS engine outside the asar integrity envelope. Accepted
  because poisoning it requires same-user code execution and the payload executes
  inside the OS-sandboxed renderer (sandbox and context isolation stay on), not the
  main process; the cache holds application bytecode only, never player data.

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
   On Linux, hybrid-graphics laptops (NVIDIA Optimus, AMD/Intel Mesa PRIME) have no
   per-app OS preference and the Chromium switch is a no-op (the GPU adapter is
   resolved by the driver's client library at dynamic-link time, before Chromium
   parses its switches). Setting the PRIME render-offload environment variables
   (`DRI_PRIME=1` for Mesa; `__NV_PRIME_RENDER_OFFLOAD=1` /
   `__GLX_VENDOR_LIBRARY_NAME=nvidia` / `__EGL_VENDOR_LIBRARY_FILENAMES=<nvidia glvnd
   EGL ICD json>` / `__VK_LAYER_NV_optimus=NVIDIA_only` for the NVIDIA proprietary
   driver) in the running main process does NOT reach the GPU process either:
   Electron's Linux GPU process forks from a zygote that already exec'd (and
   snapshotted its environ) before any main-process JS runs, so a process.env write
   there is invisible to it. Which variable does the lifting depends on the path
   Chromium takes (both measured on real hybrid hardware): under the
   `--ozone-platform=x11` backend the shell forces, ANGLE binds through GLX and the
   `__NV_PRIME_RENDER_OFFLOAD` + `__GLX_VENDOR_LIBRARY_NAME` pair selects the
   adapter; on EGL paths (a player-forced Wayland ozone) that pair is a decoy (it
   flips `glxinfo` while the unmasked renderer stays on the iGPU) and
   `__EGL_VENDOR_LIBRARY_FILENAMES` is the lever. The EGL entry is only ever set
   when the NVIDIA ICD json actually exists, because glvnd treats it as a
   replacement of its vendor list and naming a missing file would leave a
   non-NVIDIA machine with no EGL vendors at all. The same hardware also
   crash-loops the GPU process on a Wayland session once PRIME offload is
   requested (falls back to software rendering, worse than the iGPU), so Chromium
   must additionally be forced onto the X11 Ozone backend, which (like the env
   vars) only works as a real argv flag present before Electron's own startup,
   never an `appendSwitch` call in the running process.
   `main.cjs` therefore calls `relaunchForLinuxPrime` as the very first thing it
   does (before crash reporting, logging, or any window): on a HYBRID Linux
   machine (two or more GPUs under `/sys/class/drm` whose display card, the one
   sysfs marks `boot_vga`, is not the NVIDIA one; single-GPU machines, and desktops
   where the NVIDIA card already drives the screen next to an enabled integrated
   GPU, are left completely untouched: on the latter the offload env fails every
   EGL display type and Chromium disables the GPU for the session), it re-execs
   the app with the PRIME variables baked into
   the new process's environment from birth plus `--ozone-platform=x11` appended
   to argv, and the original process exits immediately. The spawn source is
   `$APPIMAGE` (the outer AppImage file, the same source electron-updater restarts
   from) when set, because inside an AppImage `process.execPath` lives in a FUSE
   mount that dies with the exiting parent; other installs re-exec the binary
   itself. An explicit player `--ozone-platform` choice is never overridden (a
   bare `--ozone-platform-hint` deliberately does not count), and no env name the
   player's own environment already set (their own `prime-run` wrapper) is ever
   replaced: with no marker and every variable present, no relaunch happens at
   all. The relaunch marker does NOT permanently suppress re-execs: a marked
   process whose argv lost the ozone flag (electron-updater's restart-to-update
   respawns with the current env but empty argv) relaunches once more purely to
   restore the flag. The dev loop (`npm run electron:dev`) pre-applies the same
   configuration to the electron it spawns, so no relaunch happens there and the
   Vite teardown-on-exit logic keeps working.
   Verify with `ps -o pid,ppid,cmd -C world-of-claudecraft` (or the AppImage/binary
   name) showing the relaunched PID's parent already exited, and `[gpu] running as
   PRIME-relaunched child` in `main.log` (the child writes it; the parent exits
   before file logging exists).
   Known follow-ups, not yet addressed: the relaunch's interaction with the
   second-instance deep-link path (`worldofclaudecraft://` login handoff) has not
   been verified against a login link that arrives during the brief relaunch
   window, and the Steam channel's process tracking (overlay, playtime) has not
   been verified against the parent exiting within milliseconds of launch.
3. Login both paths: email/password in-app, and Discord via the external browser +
   `worldofclaudecraft://desktop-login` deep link handoff (app focuses and enters
   the world; second-instance and cold-start deep links both work).
   On Linux run this on a machine with NO prior install and no AppImageLauncher (a
   stock SteamOS or Bazzite box is the realistic case): the AppImage must register its
   own handler on first launch. Confirm with
   `xdg-mime query default x-scheme-handler/worldofclaudecraft` returning
   `world-of-claudecraft-appimage.desktop` (the AppImage entry is deliberately NOT the deb's
   basename), then `gio open "worldofclaudecraft://desktop-login?code=x"` reaching the running
   game. Use `gio open`, not `xdg-open`: on stock SteamOS, which is the box this step names,
   `xdg-open` takes its KDE branch and calls a `kfmclient` that is not installed, so it fails
   for reasons unrelated to the handler. `gio open` is also the path a GTK browser takes.
   A regression here shows up as the OS "choose an application" dialog, which cannot select an
   AppImage at all.
4. Play 5 minutes: steady frame rate, alt-tab out/in does not hitch or freeze the
   world (backgroundThrottling stays off).
5. Website channel only: with a higher-version build on the feed, the update toast
   appears, "Restart now" applies it, and a player who quits instead gets it on next
   launch; after the restart the log's startup banner still shows the production
   `apiOrigin` channel (`updateChannel: latest`). Steam and Epic channels: confirm
   the log says the updater is disabled and no update network traffic occurs
   (SteamPipe / BPT own patches).
6. $WOC Exchange gating: on the website channel, an online character with a
   linked wallet sees the Exchange launcher (server `WOC_MARKET_ENABLED=1`);
   on the Steam and Epic channels no Exchange UI exists anywhere (no launcher,
   no menu entry, no trade-window $WOC arm), even with a linked wallet, since
   tradeable-token functionality violates both stores' terms. The gate is the
   `desktop-exchange-capability` IPC over the distribution stamp
   (`electron/desktop_config.cjs` `wocExchangeSupported`, consumed by
   `src/game/woc_market_wiring.ts`); for this gate specifically, a build with
   an absent or unknown stamp behaves like a store build (the wallet-connect
   and updater gates read the collapsed channel and are unchanged). On the
   website channel the launcher appears one IPC round trip after world entry,
   so give it a beat before calling it missing. The shell startup banner logs
   `wocExchangeEnabled` per channel, so the log alone answers this step (on an
   unstamped build `distribution` collapses to website while
   `wocExchangeEnabled` correctly says false). Also smoke one signature on the
   website channel: starting a listing (or paying a bond) must hand off to the
   default browser for the wallet signature and complete on return, the same
   handoff the Claudium checkout uses.
7. Crash surfaces: `kill -SEGV <renderer pid>` THREE times within a minute (a
   task-manager "end task" is classified as a benign `killed` exit and does not
   trigger recovery). The first two SEGVs each produce a log entry and a bounded
   auto-reload; the third reaches the localized Reload/Quit dialog (the auto-
   reload budget is 2 per 60s, electron/diagnostics.cjs). Each SEGV lands a
   minidump in crashDumps.
8. `npm test` green at the built commit; `tests/electron_*.test.ts` cover the
   shell's pure logic.

## Version pinning

Electron is `^43.0.0` (current stable, EOL 2027-01-05; the lockfile pins the exact
patch). Before bumping to 44 (stable ~2026-08-25): audit renderer `clipboard` usage
(removed from renderers in 44) and drop any 32-bit expectations. electron-builder
stays on 26.x (27 is an ESM-only alpha); electron-updater 6.x (7 is an ESM alpha).
