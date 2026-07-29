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
   web bundle (`npm run build:native`), zips `dist/`, uploads it to
   `s3://$OTA_S3_BUCKET/<prefix>/bundles/wocc-web-<version>.zip` (immutable,
   never overwritten without `--force`), and re-points
   `<prefix>/latest.json` at it (version, public zip URL, sha256 checksum,
   optional `minNativeVersion`).
2. `server/ota_updates.ts` (`POST /api/ota/updates`, registry RouteDef) is the
   Capgo self-hosted update-check endpoint. It reads `latest.json` from
   `OTA_MANIFEST_URL` through a 60 s single-flight cache, compares the
   manifest against the device's reported bundle/native versions, and answers
   either `{ version, url, checksum }` or the plugin's documented no-update
   body. `OTA_MANIFEST_URL` unset (or not https) keeps the whole feature dark
   (always "no update"). Manifest validation is strict and fail-closed: the
   bundle URL must be https AND live on the manifest's own origin (so a write
   into the manifest alone can never redirect installs to another host), the
   sha256 checksum is required, and any malformed field disables updates
   rather than serving an offer with a gate dropped.
3. `capacitor.config.ts` points the plugin at that endpoint with
   `autoUpdate: true`: the native side checks on launch/foreground (at most
   every 10 minutes), downloads the zip straight from S3/CDN in the
   background, and applies it on the next backgrounding.
4. `src/net/native_ota.ts` calls `CapacitorUpdater.notifyAppReady()` once at
   boot (`src/main.ts`). A bundle that never confirms within the plugin's
   ready timeout is rolled back to the previous bundle automatically; that is
   the crash-safety net, do not remove the call.

Bandwidth economics: the update CHECK is a tiny JSON POST against the game
server; the heavy zip download is served by S3/CloudFront, so game-server
bandwidth is untouched and there are no per-GB plugin-vendor fees. A cheaper
S3-compatible store (e.g. Cloudflare R2, zero egress fees) works unchanged:
the script only needs the AWS CLI pointed at it and a public base URL.

## One-time AWS setup (config steps)

1. Create a private S3 bucket, e.g. `wocc-ota-updates` (any region). Keep
   Block Public Access ON.
2. Serve it through CloudFront (recommended): a distribution with the bucket
   as origin via Origin Access Control, default cache policy CachingOptimized.
   The uploads carry their own `Cache-Control` (zips immutable, `latest.json`
   no-cache), so no custom cache policy is needed. Point a domain at it, e.g.
   `updates.worldofclaudecraft.com`; that is `OTA_PUBLIC_BASE_URL`.
   (Alternative without CloudFront: allow public read on `<prefix>/*` and use
   the bucket's regional URL as the base; plain S3 egress is pricier per GB.)
3. Create the publisher credentials (CI or a maintainer profile): an IAM user
   or role with, scoped to the bucket:
   `s3:PutObject`, `s3:GetObject` (rollback re-hashes the old zip) and
   `s3:ListBucket` limited to the `<prefix>/` keys (head-object existence
   checks answer 403 as "missing" without it, so ListBucket keeps the
   overwrite guard honest).
4. Set the env keys (see `.env.example`): `OTA_S3_BUCKET`,
   `OTA_PUBLIC_BASE_URL`, optionally `OTA_S3_PREFIX` (default `ota`) and
   `OTA_MIN_NATIVE_VERSION`, for the machine that runs the publish; and
   `OTA_MANIFEST_URL=https://<public base>/<prefix>/latest.json` on the game
   server, then restart it.

No bucket CORS configuration is needed: the zip is downloaded by native code,
not by the WebView, and the manifest is fetched server-side.

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
- The sim runs identically everywhere (one sim, three hosts), but the server
  rejects mixed world-layout epochs at the WS handshake, so an OTA bundle and
  the deployed server must come from compatible releases: publish the OTA
  bundle from the same release you deploy to the server.
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
  can ship JS to every install, so scope `s3:PutObject` tightly. For a
  stronger guarantee, the plugin supports signed bundles (`publicKey` in
  `capacitor.config.ts` with the private key held offline); adopt that if the
  publisher credential ever moves beyond a locked-down CI secret.

## CI/CD

Once comfortable with the manual flow, add a release-pipeline step after the
release is tagged and the server is deployed:

```yaml
- run: npm ci
- run: npm run ota:publish
  env:
    OTA_S3_BUCKET: ${{ vars.OTA_S3_BUCKET }}
    OTA_PUBLIC_BASE_URL: ${{ vars.OTA_PUBLIC_BASE_URL }}
    AWS_ACCESS_KEY_ID: ${{ secrets.OTA_AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.OTA_AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: ${{ vars.OTA_AWS_REGION }}
```

GitHub-hosted runners ship the AWS CLI and `zip` preinstalled. Prefer GitHub
OIDC role assumption (`aws-actions/configure-aws-credentials` with a role ARN)
over long-lived access keys once the flow settles; the publisher credential
can ship code to every install, so it should not be a standing secret.

## Verifying an update end to end

1. `curl -s $OTA_MANIFEST_URL` shows the new version/url/checksum.
2. `curl -s -X POST https://worldofclaudecraft.com/api/ota/updates \
   -H 'content-type: application/json' \
   -d '{"platform":"ios","version_name":"builtin","version_build":"0.31.0"}'`
   answers the offer; posting the published version back answers the
   no-update body.
3. On a device or simulator build: launch, background the app, foreground it;
   the footer version (`appVersionInfo`) shows the new bundle version. A
   deliberate bad bundle (e.g. a zip whose JS throws before boot) must revert
   to the previous version on the second launch; that exercises the
   `notifyAppReady` rollback net.

## Tests that pin this feature

- `tests/server/ota_updates.test.ts`: the endpoint (offer/no-update/gating,
  cache single-flight, fail-closed env gate, rate limiting, invalid input).
- `tests/native_ota.test.ts`: the `notifyAppReady` glue plus source pins on
  the `src/main.ts` wiring, `capacitor.config.ts` plugin block, and the
  `package.json` dependency.
- `tests/ota_publish.test.ts`: the publish planner (keys, URLs, manifest
  shape, validation) and CLI flag parsing.
