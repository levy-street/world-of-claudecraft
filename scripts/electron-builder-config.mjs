// Pure construction of the EFFECTIVE electron-builder configuration for one
// desktop distribution channel. The static, channel-independent config stays in
// package.json's "build" block (single visible source of truth); this module
// derives the per-channel variant from it:
//
//  - every channel: stamps `extraMetadata.wocDesktop` into the packaged
//    package.json (distribution + the web origins the Vite bundle was baked
//    with + optional crash submit URL), which is how the shipped main process
//    (electron/desktop_config.cjs) knows what it is at runtime, how the
//    auto-updater stays OFF in Steam builds, and why a packaged build never
//    honors the VITE_DESKTOP_* runtime env pair.
//  - website: the publish feed gains an explicit update channel derived from
//    the baked apiOrigin (electron/update_guard.cjs): the production origin
//    publishes 'latest' (latest-mac.yml and friends, the feed shipped installs
//    read), any other origin publishes 'dev' (dev-mac.yml and friends), so a
//    dev or staging build can never emit the feed files a production install
//    consumes. Requesting the production channel with a non-production origin
//    throws: that mistake must die at build time, not on players' machines.
//  - steam: publish is nulled (no app-update.yml is emitted, electron-updater
//    has nothing to read even if it were reached), and every OS targets 'dir'
//    because SteamPipe depots upload the loose installed layout (mac: the
//    signed .app; win: win-unpacked; linux: linux-unpacked), never installers.
//  - windows signing: two routes, each injected only when the caller resolved
//    a complete credential set from the environment, so unsigned local builds
//    never trip the signing step. Azure Trusted Signing (WIN_SIGN_*) injects
//    win.azureSignOptions and wins when both are configured; the Azure Key
//    Vault certificate route (AZURE_KEY_VAULT_* + AZURE_TENANT_ID/CLIENT_*)
//    injects the AzureSignTool hook via win.signtoolOptions.
//
// Kept free of child_process/fs so tests/electron_builder_config.test.ts can pin
// the channel differences directly.

import {
  apiOriginKey,
  isProductionApiOrigin,
  PRODUCTION_API_ORIGIN,
  updateChannelForOrigin,
} from '../electron/update_guard.cjs';

const UPDATE_CHANNELS = new Set(['latest', 'dev']);

export function azureSignOptionsFromEnv(env = {}) {
  const options = {
    publisherName: env.WIN_SIGN_PUBLISHER_NAME,
    endpoint: env.WIN_SIGN_ENDPOINT,
    codeSigningAccountName: env.WIN_SIGN_ACCOUNT_NAME,
    certificateProfileName: env.WIN_SIGN_PROFILE_NAME,
  };
  const values = Object.values(options);
  if (values.every((value) => typeof value === 'string' && value !== '')) return options;
  return null;
}

// The other Windows signing route: an Azure KEY VAULT certificate driven by
// the AzureSignTool hook (scripts/electron-win-sign.mjs) via
// win.signtoolOptions, as opposed to the Trusted Signing account/profile
// shape azureSignOptionsFromEnv covers. Returns the signtoolOptions block only
// when the complete credential set is present, so unsigned local builds never
// trip the hook. The hook reads the credentials from env at sign time; only
// the module path and the single-pass sha256 pin land in the derived config
// (which is written to a tmp file, so no secret may ever ride in it).
export function keyVaultSignConfigFromEnv(env = {}) {
  const required = [
    'AZURE_KEY_VAULT_URL',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_KEY_VAULT_CERTIFICATE',
  ];
  if (!required.every((name) => typeof env[name] === 'string' && env[name] !== '')) return null;
  return {
    sign: './scripts/electron-win-sign.mjs',
    // One signing pass per file: the default ['sha1', 'sha256'] dual-signing
    // would re-invoke the hook for a sha1 pass AzureSignTool cannot append.
    signingHashAlgorithms: ['sha256'],
  };
}

// Collapse [{target, arch}] entries to bare target names so `pack` mode builds
// only the host arch: the full arch matrix (mac universal, win/linux x64+arm64)
// is a RELEASE concern, and a local --dir verification pack should stay fast.
function stripArch(targets) {
  if (!Array.isArray(targets)) return targets;
  return targets.map((entry) =>
    entry && typeof entry === 'object' && 'target' in entry ? entry.target : entry,
  );
}

export function desktopBuilderConfig({
  base,
  distribution,
  mode = 'build',
  apiOrigin = '',
  loginOrigin = '',
  crashSubmitUrl = '',
  azureSign = null,
  keyVaultSign = null,
  updateChannel = null,
  steamAppId = '',
  steamworksInstalled = null,
}) {
  if (distribution !== 'website' && distribution !== 'steam') {
    throw new Error(`unknown desktop distribution: ${distribution}`);
  }
  const config = structuredClone(base);
  config.extraMetadata = {
    ...(config.extraMetadata ?? {}),
    wocDesktop: {
      distribution,
      ...(apiOrigin ? { apiOrigin } : {}),
      ...(loginOrigin ? { loginOrigin } : {}),
      ...(crashSubmitUrl ? { crashSubmitUrl } : {}),
      // The Steamworks app id electron/steam.cjs initializes with; stamped
      // for the steam channel only (website builds never touch Steam). The
      // steam branch below refuses to build without a numeric id, so the
      // stamp is unconditional here.
      ...(distribution === 'steam' ? { steamAppId } : {}),
    },
  };
  if (distribution === 'website' && config.publish) {
    // A non-empty origin that does not parse would strand the install it
    // bakes: the channel would fail safe to 'dev' while the runtime guard
    // normalizes its own side to production, refusing every stamped update on
    // that install's track forever. That mistake dies here instead (a missing
    // origin stays fail-safe: it only happens on direct calls, never through
    // scripts/electron-build.mjs, which always resolves one).
    if (apiOrigin !== '' && apiOriginKey(apiOrigin) === null) {
      throw new Error(
        `desktop website builds need a parseable http(s) VITE_DESKTOP_API_ORIGIN ` +
          `to pick an update track; got "${apiOrigin}"`,
      );
    }
    // The update-track split: default the channel from the baked origin, and
    // hard-fail the one dangerous combination (production feed files for an
    // artifact not baked with the production origin). The reverse cross,
    // updateChannel 'dev' with a production origin, is allowed on purpose: it
    // stages a production artifact on the dev track for update-pipeline tests.
    // An empty updateChannel means "not requested" (set-but-empty env vars are
    // common in CI matrices), so it derives like null does.
    const channel = updateChannel || updateChannelForOrigin(apiOrigin);
    if (!UPDATE_CHANNELS.has(channel)) {
      throw new Error(`unknown desktop update channel: ${channel}`);
    }
    if (channel === 'latest' && !isProductionApiOrigin(apiOrigin)) {
      throw new Error(
        `refusing to emit production update-feed files: baked API origin "${apiOrigin}" ` +
          `is not ${PRODUCTION_API_ORIGIN}`,
      );
    }
    config.publish = { ...config.publish, channel };
  }
  // Windows signing routes, mutually exclusive with Trusted Signing first:
  // both resolvers require a complete env set, so at most one is normally
  // non-null, and if an operator ever configures both, the native Trusted
  // Signing path wins over the custom hook.
  if (azureSign) {
    config.win = { ...(config.win ?? {}), azureSignOptions: azureSign };
  } else if (keyVaultSign) {
    config.win = {
      ...(config.win ?? {}),
      signtoolOptions: { ...(config.win?.signtoolOptions ?? {}), ...keyVaultSign },
    };
  }
  if (distribution === 'steam') {
    // A packaged depot cannot recover the app id from env (electron/steam.cjs
    // closes that hatch), so a missing or garbage id would ship a depot that
    // inits Steam with the Spacewar dev id (480) and mints link tickets the
    // server rejects. That mistake must die at build time, not on players'
    // machines; a deliberate Spacewar test depot passes WOC_STEAM_APP_ID=480
    // explicitly. The unpackaged dev loop never runs this script.
    if (!/^\d+$/.test(steamAppId) || Number(steamAppId) <= 0) {
      throw new Error(
        `steam channel builds need a positive numeric WOC_STEAM_APP_ID in the build env; ` +
          `got "${steamAppId}". Without it the packaged depot would init Steam with the ` +
          'Spacewar dev id (480) and link tickets would verify against the wrong app. ' +
          'App id 0 is not a real Steam app, so a set-but-zero id is refused too.',
      );
    }
    // steamworks.js is an optionalDependency, so a plain server/web install (or
    // a failed native prebuild) can drop it silently, and electron/steam.cjs
    // then degrades to null on every path. A depot packaged from such a tree
    // would ship WITHOUT Steam and nobody would notice, so the steam channel
    // refuses to build here. The presence probe is INJECTED (this module stays
    // free of fs, like stampChannelFeedFiles): scripts/electron-build.mjs wires
    // the real node_modules check, and the config tests pass a fake. An absent
    // probe (null) is a pure config derivation, so it never runs.
    if (typeof steamworksInstalled === 'function' && !steamworksInstalled()) {
      throw new Error(
        'steam channel build needs the steamworks.js optional dependency, but it is ' +
          'not installed under node_modules/steamworks.js. Reinstall it (npm install ' +
          'steamworks.js) before packaging the Steam depot; otherwise the build would ' +
          'ship without Steam.',
      );
    }
    config.publish = null;
    config.directories = { ...(config.directories ?? {}), output: 'release-steam' };
    // One depot per OS: mac ships a single universal .app (Steam has no mac
    // arch selector), win and linux ship x64 (Steam's depot arch filter is
    // 32/64-bit only; win-arm64 runs the x64 build under emulation).
    config.mac = { ...(config.mac ?? {}), target: [{ target: 'dir', arch: ['universal'] }] };
    config.win = { ...(config.win ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
    config.linux = { ...(config.linux ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
    // steamworks.js rides the Steam depot ONLY: the base files whitelist
    // excludes node_modules entirely (main-process deps are esbuild-vendored),
    // but a napi native module cannot be bundled, so the steam channel
    // re-includes exactly this package and asar-unpacks its dist/** (the
    // .node binaries plus the steam_api dynamic libraries must load from real
    // disk; electron-builder redirects the in-asar require automatically).
    // Website artifacts stay byte-identical to a pre-Steam build.
    config.files = [...(config.files ?? []), 'node_modules/steamworks.js/**'];
    config.asarUnpack = [
      ...(Array.isArray(config.asarUnpack) ? config.asarUnpack : []),
      'node_modules/steamworks.js/dist/**',
    ];
  }
  if (mode === 'pack') {
    for (const os of ['mac', 'win', 'linux']) {
      if (config[os]?.target) config[os] = { ...config[os], target: stripArch(config[os].target) };
    }
  }
  return config;
}

// Whether a file in the electron-builder output directory is one of this
// channel's update-feed files (latest-mac.yml, latest.yml,
// latest-linux-arm64.yml, ...). Other ymls electron-builder leaves there
// (builder-debug.yml) are not feed files and must not be stamped.
export function isChannelFeedFile(fileName, channel) {
  if (typeof fileName !== 'string' || typeof channel !== 'string' || channel === '') return false;
  if (!UPDATE_CHANNELS.has(channel)) return false;
  return new RegExp(`^${channel}(-[a-z0-9-]+)?\\.yml$`).test(fileName);
}

// Stamp the baked API origin into one update-feed file's yml text so the
// runtime cross-track guard (electron/update_guard.cjs evaluateUpdateOffer)
// can refuse an artifact baked for another backend. electron-updater hands
// the parsed yml through as the UpdateInfo object, so the extra key rides
// along to the running app. Replaces any existing stamp; idempotent.
export function stampFeedFile(text, apiOrigin) {
  if (typeof apiOrigin !== 'string' || apiOrigin === '') {
    throw new Error('stampFeedFile needs the baked apiOrigin');
  }
  const lines = String(text)
    .split('\n')
    .filter((line) => !line.startsWith('wocApiOrigin:'));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\nwocApiOrigin: ${JSON.stringify(apiOrigin)}\n`;
}

// Stamp every one of the channel's feed files in the electron-builder output
// directory, returning the stamped names (empty when there is no channel, no
// directory, or no feed file: steam and pack builds). The fs functions are
// injected so this module stays free of node imports and
// tests/electron_builder_config.test.ts can drive the whole orchestration
// against a temp directory, not just the per-file helpers.
export function stampChannelFeedFiles({ outDir, channel, apiOrigin, fs, joinPath }) {
  if (typeof channel !== 'string' || channel === '') return [];
  if (!fs.existsSync(outDir)) return [];
  const names = fs.readdirSync(outDir).filter((name) => isChannelFeedFile(name, channel));
  for (const name of names) {
    const feedPath = joinPath(outDir, name);
    fs.writeFileSync(feedPath, stampFeedFile(fs.readFileSync(feedPath, 'utf8'), apiOrigin));
  }
  return names;
}
