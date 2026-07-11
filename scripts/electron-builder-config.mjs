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
//  - windows signing: Azure Artifact Signing options are injected only when the
//    caller resolved a complete set from the environment, so unsigned local
//    builds never trip the signing step.
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
  updateChannel = null,
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
  if (azureSign) {
    config.win = { ...(config.win ?? {}), azureSignOptions: azureSign };
  }
  if (distribution === 'steam') {
    config.publish = null;
    config.directories = { ...(config.directories ?? {}), output: 'release-steam' };
    // One depot per OS: mac ships a single universal .app (Steam has no mac
    // arch selector), win and linux ship x64 (Steam's depot arch filter is
    // 32/64-bit only; win-arm64 runs the x64 build under emulation).
    config.mac = { ...(config.mac ?? {}), target: [{ target: 'dir', arch: ['universal'] }] };
    config.win = { ...(config.win ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
    config.linux = { ...(config.linux ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
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
