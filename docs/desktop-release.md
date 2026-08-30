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

## Running the desktop app locally

`npm run electron:dev` (`scripts/electron-dev.mjs`) is the whole dev loop: it starts
Vite with the desktop env baked in (`VITE_DESKTOP_APP`, the API origin, relative API
paths), builds the gitignored `electron/vendor` bundles the main process requires, then
launches Electron against the dev server. No `npm run build` is needed; the shell loads
the live Vite page and reloads with it. Env vars that matter on that command line:

- `VITE_DESKTOP_API_ORIGIN`: the API origin the shell talks to (default: production).
  `VITE_DESKTOP_API_ORIGIN=http://localhost:8787 npm run electron:dev` runs against a
  local `npm run server`.
- `WOC_DISTRIBUTION=website|steam|epic`: try a channel unpacked (see above).
- `WOC_DISABLE_GPU_FORCE=1`: skip every GPU lever for this launch (the discrete-GPU
  force on all platforms, the Linux PRIME relaunch, and the Linux GPU backend switches).
- `WOC_GPU_BACKEND=vulkan|opengl`: force the Linux GL backend for this launch, never
  judged into the memory (see "GPU backend on Linux" below); `vulkan` is also how to try
  Vulkan on a GPU the policy keeps Auto off (AMD, at the time of writing).

Where the shell writes: `main.log` (the rotating shell log, `electron/logging.cjs`)
and `desktop-prefs.json` (the shell's own prefs store, `electron/desktop_prefs.cjs`)
both live under the per-user profile directory; the exact paths per OS are listed in
"Error logging, crash dumps, privacy" below. An unpackaged dev run uses the same
profile directory as an installed build of the same package name, so a memory or a
preference recorded in dev is what the installed app reads next, and the other way
round; delete `desktop-prefs.json` to start from defaults.

## GPU backend on Linux

On Linux, Chromium's default WebGL backend is ANGLE over OpenGL, where every shader
program link resolves on the single GPU-process thread that presents frames: each link
is a 100 to 320 ms hitch the game cannot schedule around. ANGLE's Vulkan backend links
in about 10 ms and the hitches disappear (measured on an RTX 3090 and an Intel iGPU).
Windows already runs D3D11 and macOS Metal, so only Linux needs the lever.

The shell forces Vulkan with the Chromium switches (`VULKAN_BACKEND_SWITCHES` in
`electron/gpu_backend.cjs`: `--use-gl=angle`, `--use-angle=vulkan`, and the
`Vulkan,DefaultANGLEVulkan,VulkanFromANGLE` feature set) plus, on the top rung, the
ANGLE feature switch `--enable-angle-features=enableParallelCompileAndLink`
(`VULKAN_PARALLEL_COMPILE_SWITCH`), and nothing wider: no `--ignore-gpu-blocklist`, no
`--disable-gpu-driver-bug-workarounds`, and never `--disable-vulkan-surface` (headless
only). The ANGLE feature matters: ANGLE's Vulkan backend exposes
`KHR_parallel_shader_compile` only when it is on (an opt-in feature since 2023, never
defaulted), and without that extension the renderer runs its no-async-compile policy
(every program links synchronously on the GPU-process thread, every compile gate is
inert). `chrome://gpu` lists it under ANGLE Features as
`enableParallelCompileAndLink: Enabled` when the switch took.

### The ladder

Three rungs, best first (`GPU_BACKEND_RUNGS`), named for what they are so a stored
value reads without a decoder:

| rung | what it runs |
|---|---|
| `vulkan-parallel-compile` | Vulkan with the ANGLE parallel-compile feature |
| `vulkan-plain` | Vulkan without it (the feature is still opt-in upstream, and one rare late GPU-process crash was seen with it on Intel/Mesa) |
| `opengl` | Chromium's default backend, no switches |

### The policy: which machines Auto tries Vulkan on

Above the memory and the rescue below sits a third, simpler thing: the exclusion list in
`electron/gpu_backend_policy.cjs` (`AUTO_VULKAN_EXCLUSIONS`). The ladder's verdict only
knows the failures it can observe (a GPU process that dies, a software rasterizer, a
backend that did not bind); a driver that renders WRONG without dying is invisible to it,
and a Steam Deck (AMD APU, Mesa RADV) reported exactly that: the game came up on ANGLE
Vulkan and every texture was noise. Vulkan was only ever measured on NVIDIA and Intel, so
on hardware where it was not, Auto is CAPPED at OpenGL and Vulkan is one explicit choice
away (the `vulkan` setting, or `WOC_GPU_BACKEND=vulkan`).

- The evidence is `/sys/class/drm` (`linuxGpuAdapters`), read at the top of `main.cjs`
  before the switches are appended, the same source as the PRIME hybrid check. The
  adapters judged are the ones that will render: under the PRIME offload the card that
  does NOT drive the screen (what `DRI_PRIME=1` and the NVIDIA offload variables select,
  whichever vendor it is), else the card that drives the screen (`boot_vga`), else all of
  them (`renderingAdapters`); an unreadable `/sys` is no evidence and no cap.
- An entry names a PCI vendor, optionally one device id, and its reason and what would
  lift it. It is a decision with its evidence: add one when a machine renders wrong or
  dies on Vulkan in a way the ladder cannot catch, remove it once Vulkan is measured
  healthy there. The list ships with AMD (`0x1002`) on it.
- A capped launch (`decideGpuBackendLaunch` with `autoCeiling`, `capAutoLaunch`) is NOT the
  memory's: nothing is remembered and the counter does not move, so the policy leaves no
  trace of its own and the day an entry is lifted Auto resumes from whatever it remembered
  before (the top rung when nothing was). Auto is capped at the ceiling as well as above
  it, so a machine whose memory already said OpenGL still reads as held by the policy in
  the options row. The rescue still applies. `main.log` says `[gpu] backend launch: opengl (auto, capped at opengl:
  0x1002:0x163f excluded: ...)`, and the options row reads "Auto does not try Vulkan on
  this graphics card yet; pick Vulkan to try it" (`autoCapped` on
  `desktop-get-gpu-backend`).

### Two mechanisms, kept apart

The risk a forced Vulkan backend carries is that it has no OpenGL fallback of its own:
a machine without a working Vulkan driver lands on SwiftShader, or its GPU process dies
and Chromium then blocks the page from WebGL for the rest of the session, which is a
game that never renders. Two separate answers, and keeping them separate is the point:

**THE MEMORY** answers what Auto should attempt. It lives in `desktop-prefs.json`:

- `gpuBackendToAttempt`: the rung Auto starts on. ABSENT means the top rung, not the
  bottom one: a first launch is optimistic, and the rescue is what covers a machine
  that cannot follow.
- `gpuBackendProof`: the certainty beside the guess. `{ backend, appVersion, gpuAdapter }`,
  the adapter being the active GPU's `vendorId:deviceId` from `app.getGPUInfo` (the same on
  every backend, where the ANGLE renderer string names the backend and would read one card
  on OpenGL as another machine; empty reads as unknown, the same machine),
  written only by a HEALTHY session, absent meaning "no launch has ever succeeded here".
- `consecutiveGpuLaunchCrashes`, `launchesSinceBackendReprobe`: the two counters below.

**THE RESCUE** answers what to do when the GPU process dies at launch, and it runs in
EVERY mode, explicit player choices included: relaunch one rung down at once
(`relaunchOnLowerBackend`), so the player gets a running game inside the same launch
instead of a dead screen they cannot click out of. The chain caps itself on the
ladder's depth: a rescue may only target a rung BELOW the marker its process carries
(`WOC_GPU_BACKEND_RESCUED_TO`, which names the rung in full), so at most two relaunches
can ever spawn, with no counter to keep in step.

### What a session does

- The player's setting is `gpuBackend` (`auto` by default, or an explicit `vulkan` /
  `opengl`), exposed to the game over the preload bridge (`getGpuBackend` /
  `setGpuBackend`, channels `desktop-get-gpu-backend` / `desktop-set-gpu-backend`). It
  is stored, not applied live: the switches land before Electron's own startup, so a
  change takes effect at the next launch.
- `decideGpuBackendLaunch` picks the rung, first match wins: the rescue marker, then
  `WOC_GPU_BACKEND`, then `WOC_DISABLE_GPU_FORCE=1`, then an explicit setting, then the
  Auto memory. The launch carries `auto` (this launch belongs to the memory: no env
  override, no `WOC_DISABLE_GPU_FORCE=1`, no explicit setting), `rescued` (a rescue
  spawned it; it inherits `auto` from its chain) and `ladder` (Linux). Every memory write
  in `main.cjs` is gated on those flags, never on the setting alone: the setting reads
  Auto under every override, so `WOC_DISABLE_GPU_FORCE=1` used to demote the next
  ordinary launch.
- `judgeGpuBackendLaunch` answers the rung this launch ACTUALLY bound, from the WebGL
  renderer string the game reports over the preload bridge (`reportGpuRenderer`,
  channel `desktop-report-gpu-renderer`). On Linux `app.getGPUInfo('complete')` can
  leave `glRenderer` EMPTY on a perfectly healthy ANGLE Vulkan session (seen on
  Electron 43 / Chrome 150 with an RTX 3090), so the getGPUInfo reading only judges
  when it carries evidence of its own (`hasGetGpuInfoEvidence`: Chromium's
  `softwareRendering` flag, or a non-empty renderer string); an empty reading logs
  `[gpu] backend: waiting for the renderer's report` and leaves the launch unjudged.
  Judging is NOT remembering: a Vulkan launch that bound something that is NOT Vulkan
  (`backendDidNotBind`, by family) is rescued right now, whatever the mode, and only a
  healthy session writes the memory. A parallel-compile launch whose page reports the
  extension absent is healthy Vulkan: no rescue, the memory just remembers `vulkan-plain`.
- A session is HEALTHY once it has survived `SESSION_HEALTHY_AFTER_MS` (60 s) without a
  GPU-process death. The window is armed from the LAUNCH, not from the judgement, so a
  page that never reports its renderer cannot leave the session in "launch" state for
  its whole life and have a late crash treated as a launch failure. On an Auto launch, a
  healthy session clears the crash streak, remembers its rung, and writes the proof when
  it improves on the stored one or when the stored one describes another machine (a
  different adapter or app version). A RESCUED child gets the proof arm only: its
  parent's death already counted, and letting the child write the attempt demoted Auto on
  the very first death (through the child instead of the counter) and cleared the streak
  the parent had just started, so the threshold could never be reached.
- A GPU-process death BEFORE that is a launch failure: on an Auto parent (never a rescued
  child) the crash streak grows, and `MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES` (3) consecutive
  ones step the guess down, one count per process (the streak counts launches, not gone
  events). A `clean-exit` (the shell's own quit inside the window) or a `killed` reason
  (a kill from outside the process: the OS OOM killer, the shell's own shutdown) is not
  a crash: nothing is counted and nothing is rescued, since no rung below answers either
  and Chromium restarts the GPU process itself. A re-probe that dies above the remembered
  rung counts nothing; its rescued child lands ON the remembered rung, and if that dies
  too, that death counts (the rung compare in `demoteAfterRepeatedCrashes` is what tells
  the two kinds of child apart).
  Three, not one: a single death is what a transient compositor or driver hiccup
  produces, and demoting on it walked healthy machines down to the slowest backend. The
  PROOF is never touched by a crash. A death AFTER a healthy session is the rare late
  crash: Chromium restarts the GPU process itself, and nothing is counted or written.
- Auto climbs back on a cadence, and the proof is what sets it: with a valid proof
  ABOVE the remembered rung, every `REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES` (10) launches,
  aiming STRAIGHT at the proven rung rather than one rung at a time; otherwise (no proof,
  or one at or below the attempt, which is what a rescued child proving OpenGL leaves),
  every `REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES` (50), one rung at a time. A machine that
  has never run the higher rung is not worth a rescue relaunch every ten launches for
  life, and one that has is. Only Auto parents advance the counter (a rescue chain is one
  launch to the player). An app version the proof does not know re-opens the ladder at
  once.
- Coming back to `auto` from an explicit setting clears the GUESS and the counters and
  starts detection over; the PROOF survives, because a session that ran healthy here
  still ran healthy here.
- `WOC_GPU_BACKEND=vulkan|opengl` overrides the setting for that launch and is never
  judged into the memory; `WOC_DISABLE_GPU_FORCE=1` disables the lever with the others,
  and is never remembered either.
- The rescue hands the single-instance lock over once the child is spawned
  (`app.releaseSingleInstanceLock`, through `relaunchOnLowerBackend`'s `onSpawned`,
  never on a refused or failed spawn): a child requesting its own lock while the parent
  still held it would see itself as a second instance and quit.

### What the player sees

Graphics > System carries the backend picker on Linux desktop shells, and under its
buttons a line naming the rung the session is ACTUALLY running, with
`(unable to enable Vulkan)` appended when that fell short of the setting. A launch the
rescue moved off the player's choice also raises the boot GPU notice
(`src/ui/gpu_notice_toast.ts`, component `requested-backend`), so a player who never
opens the options still learns their choice did not take. Both read the same shell
answer: `active` and `requestedUnavailable` on `desktop-get-gpu-backend`, pushed again
on `desktop-gpu-backend-state` when the launch is judged.

### Settings that take effect at the next launch

The backend setting and the discrete-GPU opt-out are read before Electron's own startup,
so a setter persists them for the next launch and the running session keeps the old
value. Two things make that usable (`electron/launch_settings.cjs`):

- `desktop-get-launch-settings` answers what THIS process started with
  (`launchSettingsSnapshot`, taken right after the prefs load and frozen). The getters
  serve the STORED values, which a setter moves live, so the snapshot is the only way the
  game can tell "changed, restart to apply" from "already running". The game's registry
  of such settings is `NEXT_LAUNCH_SETTINGS` in `src/game/desktop_next_launch_settings.ts`;
  a new next-launch setting is one entry there.
- `desktop-restart-app` restarts the shell at the player's request (`restartApp`): the
  options window's restart strip (`src/ui/restart_strip.ts`, at the foot of the Graphics
  panel and of Interface > General) offers "Restart Game" whenever a stored value has
  moved off the snapshot, in place of an Apply that could not help. The child is spawned
  through `spawnDetachedSelf` from an environment stripped of what the shell's own
  relaunch levers planted (the rescue marker, and exactly the PRIME offload variables and
  X11 ozone argument the PRIME relaunch recorded adding in `WOC_PRIME_RELAUNCH_ADDED`; a
  `DRI_PRIME` or `--ozone-platform` the player set themselves stays), the single-instance
  lock is handed over on the child's `spawn` event, and this process quits through
  `app.quit` so the close-time bounds save runs. One restart is in flight at a time; a
  child that never starts answers false and the strip says so, this process keeps
  running, with its lock. The snapshot is what the PREFS said at launch: under
  `WOC_GPU_BACKEND` or `WOC_DISABLE_GPU_FORCE=1` the session runs the override, the
  snapshot still names the stored value, and a restart offered against it re-launches
  under the same override (those variables are the player's and are never stripped).

### Reading the log, and rescuing a stuck machine

`main.log` records `[gpu] backend launch: <rung> (<reason>)` at startup, then
`[gpu] backend bound: <rung> (asked for <rung>)` once judged, then either
`[gpu] session healthy on <rung>; memory updated` or, on a death,
`[gpu] GPU process gone at launch on <rung>` followed by the relaunch line.

A machine stuck on the wrong backend: start the game with `WOC_GPU_BACKEND=opengl` in the
environment, or quit and delete `desktop-prefs.json` (the defaults are `auto` with no
memory at all, which is one fresh optimistic launch that self-corrects). In the dev loop
(`npm run electron:dev`) a rescued launch takes the loop down once: the orchestrator tears
Vite down when its Electron child exits, and the relaunched process is left against a dead
dev server and never judges; only the crash streak moved, so the next `npm run
electron:dev` starts on the same rung until three such deaths in a row. On a desktop whose
NVIDIA card drives the screen next to an integrated GPU left enabled, the Linux PRIME
hybrid detection (`isLinuxHybridGpu`) reads `boot_vga` and skips the offload; should any
GPU lever still misfire in the dev loop, run it with `WOC_DISABLE_GPU_FORCE=1` (it skips
the PRIME config in `scripts/electron-dev.mjs` and every GPU lever in the shell) and pick
the backend with `WOC_GPU_BACKEND=vulkan`, which wins over the rescue env.

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
  holding window memory plus `gpuForceOptOut`, the Linux `gpuBackend` setting, and
  its GPU backend memory (see `electron/desktop_prefs.cjs` and "GPU backend on Linux").
  The in-game toggle (Options, Interface, "Use the Dedicated Gaming GPU")
  writes it, but a machine the GPU force prevents from booting can never reach
  that toggle. The supported rescue for "the game will not start at all on a
  hybrid-GPU machine": quit the game, edit the file so it contains
  `{"version":1,"gpuForceOptOut":true}` (or set just that field in the existing
  JSON), and relaunch; the next launch skips both GPU levers. The loader
  tolerates hand-edits, including a Windows editor's UTF-8 BOM; a corrupt or
  deleted file resolves to defaults, which is force ON. Faster one-launch
  variant needing no file edit: start the game with `WOC_DISABLE_GPU_FORCE=1`
  in the environment (strict `1`), which skips both levers (and the Linux GPU
  backend switches) for that launch without touching the stored preference;
  use it to boot far enough to flip the in-game toggle off for good.
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
   Then the GL backend: `[gpu] backend launch: vulkan-parallel-compile (auto, best
   rung)` on a first launch, `[gpu] backend bound: vulkan-parallel-compile (asked for
   vulkan-parallel-compile)` once the page reports its renderer, and a minute later
   `[gpu] session healthy on vulkan-parallel-compile; memory updated`, with the
   active renderer line naming Vulkan and the real adapter (see "GPU backend on
   Linux"). On a machine without a Vulkan driver, `[gpu] GPU process gone at launch
   on vulkan-parallel-compile`, then `[gpu] rescuing off vulkan-parallel-compile: the
   GPU process died at launch` and `[gpu] the GPU process died on
   vulkan-parallel-compile; starting a relaunch on vulkan-plain`; the child's `main.log`
   opens with `backend launch: vulkan-plain (rescued to vulkan-plain)`, a second
   rescue lands on `opengl (rescued to opengl)`, and there is never a third.
   Known follow-ups, not yet addressed: the relaunch's interaction with the
   second-instance deep-link path (`worldofclaudecraft://` login handoff) has not
   been verified against a login link that arrives during the brief relaunch
   window, and the Steam channel's process tracking (overlay, playtime) has not
   been verified against the parent exiting within milliseconds of launch.
3. Login both paths: email/password in-app, and Discord via the external browser +
   `worldofclaudecraft://desktop-login` deep link handoff (app focuses and enters
   the world; second-instance and cold-start deep links both work).
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
