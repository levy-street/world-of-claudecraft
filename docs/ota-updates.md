# OTA updates for the native mobile shells (self-hosted Capgo)

The iOS and Android shells (Capacitor, `ios/` + `android/`) ship the built web
assets inside the store binary. The `@capgo/capacitor-updater` plugin lets a
published app replace those web assets over the air, so a JS/content fix
reaches phones in minutes instead of a store review cycle. Native code
(plugins, the shells themselves) still requires a store release; the existing
store-update prompt (`src/ui/native_update_prompt.ts`) covers that path.

This deployment is fully self-hosted: bundles live in an S3 bucket the project
owns, the update check is answered by the game server, and nothing talks to
the Capgo cloud (no API key in the apps, `statsUrl: ''` disables telemetry).
The plugin itself is MPL-2.0; self-hosting is a documented, supported mode.

## How the pieces fit

1. `scripts/ota/publish_bundle.mjs` (`npm run ota:publish`) builds the NATIVE
   web bundle (`npm run build:native`), zips `dist/`, and uploads THREE kinds
   of artifact: the zip to
   `s3://$OTA_S3_BUCKET/<prefix>/bundles/wocc-web-<version>.zip` (immutable,
   never overwritten without `--force`); one content-addressed blob per unique
   dist file under `<prefix>/files/<sha256>` (via `aws s3 sync`, so a blob
   already in the bucket is never re-uploaded and an incremental publish moves
   only what changed); and the immutable per-file manifest document
   `<prefix>/manifests/wocc-web-<version>.manifest.json` (one
   `{ file_name, file_hash, download_url }` entry per dist file). It then
   re-points `<prefix>/latest.json` at all of it (version, public zip URL,
   sha256 checksum, `fileManifestUrl`, optional `minNativeVersion`).
2. `server/ota_updates.ts` (`POST /api/ota/updates`, registry RouteDef) is the
   Capgo self-hosted update-check endpoint. It reads `latest.json` from
   `OTA_MANIFEST_URL` through a 60 s single-flight cache, compares the
   manifest against the device's reported bundle/native versions, and answers
   either an offer or the plugin's documented no-update body. An offer is
   `{ version, url, checksum }` plus, when `latest.json` advertises a
   `fileManifestUrl`, the embedded `manifest` entry list (read through its own
   60 s cached read and serialized once per version, never per request).
   `OTA_MANIFEST_URL` unset (or not https) keeps the whole feature dark
   (always "no update"). Validation is strict and fail-closed: the bundle URL
   and `fileManifestUrl` must be https AND live on the manifest's own origin
   (so a write into the manifest alone can never redirect installs to another
   host), the sha256 checksum is required, and any malformed `latest.json`
   field disables updates rather than serving an offer with a gate dropped.
   The per-file entry list is all-or-nothing: one malformed entry (a traversal
   path, a bad hash, an off-origin URL) drops the WHOLE list and the offer
   degrades to the proven zip, never to a partially validated file list.
3. `capacitor.config.ts` points the plugin at that endpoint with
   `autoUpdate: true`: the native side checks on launch/foreground (at most
   every 10 minutes), downloads the zip straight from S3/CDN in the
   background, and applies it on the next backgrounding (unless the visible
   gate in step 5 pulls the apply forward).
4. `src/net/native_ota.ts` calls `CapacitorUpdater.notifyAppReady()` once at
   boot (`src/main.ts`). A bundle that never confirms within the plugin's
   ready timeout is rolled back to the previous bundle automatically; that is
   the crash-safety net, do not remove the call. The same module carries the
   other two duck-typed plugin calls the gate uses: `watchOtaUpdates`
   (download progress/complete/failed listeners) and `applyPendingOtaUpdate`
   (the plugin's `reload()`, an immediate WebView-reload apply).
5. **The visible update gate.** `src/net/ota_update_gate.ts` (wired in
   `src/main.ts`, painted by `src/ui/ota_update_overlay.ts`) turns the silent
   default into a visible flow on the shells. Pre-world, a running download
   shows a modal with live percent progress and a "continue without
   updating" escape; when the download completes and the player has neither
   dismissed the modal nor entered the world, the staged bundle is applied
   immediately via `reload()` instead of waiting for a backgrounding. When
   the server rejects a stale bundle's world-layout epoch
   (`ONLINE_WORLD_INCOMPATIBLE_MESSAGE`) while a download is in flight or
   staged, the gate replaces the dead-end fatal overlay: progress, then
   auto-apply, and the resume marker survives so the reload lands back in the
   world on the new bundle. In-world sessions are never interrupted: the
   overlay stays hidden and the apply falls back to the plugin's
   apply-on-background behavior.

Bandwidth economics: the update CHECK is a tiny JSON POST against the game
server; the heavy zip download is served by the bundle host, so game-server
bandwidth is untouched and there are no per-GB plugin-vendor fees. The host is
Cloudflare R2 (zero egress fees), which is load-bearing rather than a
preference, because of the payload size below.

**Payload size and the differential channel.** `webDir` is `dist` and nothing
trims assets for a native build (`VITE_NATIVE_APP` only flips runtime flags),
so a BUNDLE is the whole `dist` (hundreds of MB, of which only `dist/assets`,
tens of MB, is JS and CSS). What a DEVICE downloads is much smaller: the offer
embeds the per-file manifest, and the plugin (6.1+ for the manifest flow;
the shells ship 8.x) assembles the new bundle by reusing every file whose
sha256 it already has, from the store binary's own embedded assets or its
local delta cache, and downloads only the rest, each blob straight from
R2/CDN. A routine code fix therefore transfers roughly the changed JS plus
touched assets, not the whole bundle. The one heavy payload the GAME SERVER
now carries is the offer body itself: the embedded manifest runs to ~1.7 MB
raw on the real dist, so the endpoint prebuilds the body AND its gzip
(~280 KB) once per version, serves the compressed form to gzip-capable
callers (every real device), embeds it only for plugins that can consume it,
and caps manifest-bearing offers per IP (past the budget, and under the
`OTA_DELTA_DISABLED=1` ops kill switch, the offer degrades to the zip). The
zip fallback remains full-size and is the reason R2's zero-egress pricing is
load-bearing rather than a preference. Serving `public/` media from the CDN
at runtime so a bundle carries only `dist/assets` remains the follow-up that
also shrinks the STORE binaries; the delta channel only shrinks updates.

## One-time setup

The bundle host already exists. `https://updates.worldofclaudecraft.com` is the
Cloudflare R2 bucket `worldofclaudecraft-updates` (public via a Cloudflare custom
domain), which serves desktop Electron updates under `desktop/`. OTA publishes to
the SAME bucket under a separate `ota/` prefix, so there is no new bucket, no new
CDN, no new DNS, and no ACM certificate to create. Two properties that already
hold and that OTA depends on: Cloudflare does not edge-cache the `no-cache`
manifests (`cf-cache-status` reads DYNAMIC on the existing desktop manifest) while
it does cache the immutable zips, and the manifest and the bundles it points at
share one origin, which the server requires.

What is actually left to do:

1. Create an R2 API token scoped to `worldofclaudecraft-updates` with Object
   Read and Write. Read is not optional: `--rollback` re-downloads an old zip to
   re-derive its checksum, and the existence probe behind the never-overwrite
   guard is a `head-object`. R2 tokens are S3-compatible key pairs, so they are
   consumed as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
2. Configure the publish machine. R2 needs an endpoint override and a region,
   neither of which the CLI can infer, so use a dedicated profile:

   ```ini
   # ~/.aws/config
   [profile wocc-ota]
   region = auto
   ```

   Then export the token plus `AWS_PROFILE=wocc-ota` and the `OTA_*` publish
   values from `.env.example` (`OTA_S3_BUCKET`, `OTA_PUBLIC_BASE_URL`,
   `OTA_S3_ENDPOINT_URL`, optionally `OTA_S3_PREFIX` and
   `OTA_MIN_NATIVE_VERSION`). Also set
   `request_checksum_calculation = when_required` and
   `response_checksum_validation = when_required` in the profile: R2 does not
   implement the newer S3 default integrity checksums, and these are
   Cloudflare's documented settings for aws-cli 2.23 and later, already used by
   the desktop publish workflow (`.github/workflows/desktop-publish.yml`).
   Verified end to end against R2 on aws-cli 2.27.25: upload, head-object,
   delete, and content-type/cache-control preservation on the `ota/` prefix.
3. Set `OTA_MANIFEST_URL=https://updates.worldofclaudecraft.com/ota/latest.json`
   on the game server and restart it. The value must be https and must share its
   origin with the bundle URLs inside the manifest. It also has to be listed in
   the game service `environment:` block in `docker-compose.yml`, which uses an
   explicit allowlist and no `env_file`; a value present only in the host `.env`
   never reaches the process (pinned by `tests/deploy_ota_updates.test.ts`).

No CORS configuration is needed: the zip is downloaded by native code, not by
the WebView, and the manifest is fetched server-side.

The publish credential is deploy tooling, never game-server config: the game
server only ever needs `OTA_MANIFEST_URL`, and must never hold a token that can
write the bucket.

## Publishing a bundle (runbook)

```
# from the repo root, on the release commit
npm run ota:publish                     # builds native dist, zips, uploads, re-points latest.json
npm run ota:publish -- --dry-run        # everything except the uploads
npm run ota:publish -- --skip-build     # reuse an existing dist/ (must be a build:native output)
npm run ota:publish -- --rollback 0.32.0  # re-point latest.json at an already-published version
```

The bundle version defaults to `package.json` `version` (override with
`--version x.y.z`). Devices pick the update up on their next check (launch or
foregrounding, at most every 10 minutes) and apply it when next backgrounded.

Rules of the road:

- Publish only `build:native` output. A plain `npm run build` bundle carries
  the wrong flags (`VITE_NATIVE_APP`, API origin) and would break the apps;
  the script builds correctly by default.
- The compatibility rule is the world-layout EPOCH, not the release. The server
  requires the first WebSocket frame's discriminator to equal
  `auth-world-<ONLINE_WORLD_LAYOUT_VERSION>` exactly (`src/world_api.ts`) and
  rejects anything else outright, so a bundle only has to agree with the running
  server on that constant, which changes rarely and only when the authoritative
  town layout does. Practical consequence, and the reason OTA is worth having: a
  JS, UI, or content fix can be built from the currently DEPLOYED commit and
  published on its own, with no server deploy and no restart. Ordering only
  becomes load-bearing on a release that bumps the epoch (or the sibling
  `STABLE_TIMER_WIRE_VERSION`), where the server must be deployed first.
  `npm run ota:publish` does not check this; the CI workflow does, via
  `scripts/ota/check_server_layout.mjs`, so prefer the workflow for real
  publishes and run that script by hand before a manual one.
- Keep a hotfix bundle close to the deployed commit anyway, for a softer reason:
  server-sent player strings are re-localized by a client-side matcher
  (`src/ui/server_i18n.ts`), so a bundle far ahead of the server can expect
  strings the older server does not emit yet. That degrades to untranslated text
  rather than a failure, but it is avoidable.
- Each publish needs its own version, strictly greater than what devices are
  running: the offer is only made when the published version compares greater,
  and the never-overwrite guard refuses to reuse a version. So a hotfix on top
  of a deployed 0.32.1 publishes as 0.32.2.
- The delta channel's mechanics: the FIRST manifest-bearing publish uploads
  every blob once (the full dist, one object per unique sha256); later
  publishes sync only new hashes. Blobs are content-addressed and shared
  across versions, so they accumulate in `<prefix>/files/`; old manifests
  keep working (that is what makes `--rollback` cheap), and pruning
  unreferenced blobs is a deliberate manual chore, not part of a publish. A
  `--rollback` target published before the delta channel existed simply gets
  no `fileManifestUrl` and devices take the zip.
- `--force` overwrites objects uploaded with an IMMUTABLE cache-control (the
  zip and the per-file manifest document), so CDNs and the game server's own
  day-long file-manifest cache can serve the stale copy long after the
  overwrite. Prefer publishing a new version over forcing; if a force is
  unavoidable, expect mixed results until caches age out (the server picks up
  a forced manifest within a day, or immediately on a process restart).
- If a bundle needs native changes (a new Capacitor plugin, shell config),
  ship the store release FIRST, then publish with
  `--min-native <that store version>` so old shells are never handed a bundle
  they cannot run; they keep getting the store-update prompt instead.
- Store policy: OTA updates of the JS/asset layer inside the WebView are the
  sanctioned use of Apple guideline 3.3.2 and Play's equivalent, provided an
  update never changes the app's purpose or unlocks review-dodging features.
  Keep OTA for fixes and content, not for feature gating around review.
- `capacitor.config.ts` hardcodes the production `updateUrl`, so ANY native
  build (dev/staging included) checks production for updates; the version
  compare makes that a no-op in practice, but point the config at a staging
  endpoint if you ever need to exercise staging bundles on device.
- The check endpoint shares the per-IP anonymous public-read budget. If a 429
  ever hits a device, the plugin stops checking until the app restarts;
  harmless (the next launch checks again), but worth knowing when many players
  share one carrier-grade-NAT IP.
- The bucket is the trust root: anyone who can write `latest.json` plus a zip
  can ship JS to every install, so keep the R2 token scoped to this one bucket
  and treat it like a code-signing key. Note it also has write access to the
  `desktop/` prefix that serves Electron updates, so it is doubly worth
  protecting. For a stronger guarantee, the plugin supports signed bundles
  (`publicKey` in `capacitor.config.ts` with the private key held offline);
  adopt that if the publisher credential ever moves beyond a locked-down CI
  secret.
- A broken publish is SILENT on the server side. A manifest that fails
  validation (bad field, a bundle URL on another origin) caches as a successful
  "no update" for 60 s with no log line at all, and a cold fetch failure is
  swallowed the same way; only a manifest that was once good and later fails
  logs anything ("cached read refresh failed"). So the post-publish `curl`
  checks below are the only signal that a publish actually worked. Treat them
  as part of the runbook, not as optional verification.

## Publishing from CI (the normal path)

`.github/workflows/ota-publish.yml` is the intended way to publish. It reuses the
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET`
secrets the desktop publish workflow already uses for this bucket, so it needs no
new credential.

To run it: **Actions**, "OTA publish", **Run workflow**. Pick the ref (that ref IS
the bundle), leave `publish` unticked for a rehearsal, then run it again ticked to
upload. From a terminal:

```
gh workflow run ota-publish.yml --ref main -f publish=true -f min_native=0.32.0
gh run watch
```

Note that `workflow_dispatch` workflows only appear once the file is on the
DEFAULT branch, so this becomes available after the release carrying it merges to
main.

Three deliberate differences from Desktop publish:

- **Dispatch only, no tag trigger.** A tag says code was merged, never that a
  server runs it, and an OTA bundle must agree with the running server. A human
  picks the moment. There is also no main-ancestry guard, because a hotfix bundle
  is legitimately built from a branch off the deployed release.
- **Dry run by default.** A stray click builds, zips, checksums, and prints the
  keys and URLs it would write, uploading nothing.
- **A layout-epoch preflight.** The run opens one credential-free WebSocket to
  the live server and refuses to publish unless the server accepts this
  checkout's discriminator. It fails closed: a rate-limited or timed-out probe is
  inconclusive, which is not permission to publish. `skip_server_check` exists
  for when the probe itself is broken, not as a routine override.

After a real publish the run verifies the update host serves the new version AND
that the game server offers it, polling for the 60 second manifest cache. That
check is the point: a bad publish is otherwise completely silent.

Rollback is not an input, on purpose. The plugin already reverts a bundle that
fails to boot, so the manual path is for a bundle that boots but is wrong:
`npm run ota:publish -- --rollback <version>` from a terminal.

R2 has no OIDC federation equivalent, so this does mean a standing repository
secret that can ship JavaScript to every install and overwrite the desktop update
feed. Keep it scoped to the one bucket and rotate it on any suspicion.

## Verifying an update end to end

1. `curl -s $OTA_MANIFEST_URL` shows the new version/url/checksum plus the
   `fileManifestUrl`, and fetching THAT URL returns the entry list.
2. `curl -s -X POST https://worldofclaudecraft.com/api/ota/updates \
   -H 'content-type: application/json' \
   -d '{"platform":"ios","version_name":"builtin","version_build":"0.31.0"}'`
   answers the offer, which must carry a `manifest` array (a delta-bearing
   publish whose offer lacks it means the entry list failed the server's
   validation and devices are silently taking the full zip); posting the
   published version back answers the no-update body.
3. On a device or simulator build: launch, background the app, foreground it;
   the footer version (`appVersionInfo`) shows the new bundle version. A
   deliberate bad bundle (e.g. a zip whose JS throws before boot) must revert
   to the previous version on the second launch; that exercises the
   `notifyAppReady` rollback net.

## Tests that pin this feature

- `tests/server/ota_updates.test.ts`: the endpoint (offer/no-update/gating,
  cache single-flight, fail-closed env gate, rate limiting, invalid input),
  plus the delta channel: per-entry validation (all-or-nothing), the embedded
  `manifest` on offers, zip-only degradation, and the serialize-once body.
- `tests/native_ota.test.ts`: the duck-typed plugin glue (`notifyAppReady`,
  `watchOtaUpdates`, `applyPendingOtaUpdate`) plus source pins on the
  `src/main.ts` wiring (boot confirm AND the gate install/disconnect arm),
  `capacitor.config.ts` plugin block, and the `package.json` dependency.
- `tests/ota_update_gate.test.ts`: the visible-gate state machine (progress,
  dismiss, auto-apply, in-world suppression, the incompatible-version
  takeover and its fatal-mode dead ends).
- `tests/ota_update_overlay.test.ts`: the overlay painter (mount/update in
  place, progressbar semantics, continue action, fatal copy).
- `tests/ota_publish.test.ts`: the publish planner (keys, URLs, manifest
  shape, validation, the per-file entry builder and its unsafe-path guards),
  CLI flag parsing, and the R2 endpoint override.
- `tests/deploy_ota_updates.test.ts`: the deploy contract, chiefly that
  `OTA_MANIFEST_URL` is in the compose environment allowlist (without it the
  feature stays dark no matter what the host `.env` says) and that the publish
  credentials are NOT handed to the game server, plus the workflow contract
  (dispatch-only, dry-run default, preflight wired, post-publish verification).
- `tests/ota_server_layout.test.ts`: the layout-epoch probe, including the pins
  on the two server rejection literals it distinguishes, and the load-bearing
  negative case that every other answer is inconclusive rather than compatible.
