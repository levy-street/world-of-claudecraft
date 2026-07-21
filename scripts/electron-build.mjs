import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  azureSignOptionsFromEnv,
  desktopBuilderConfig,
  isChannelFeedFile,
  keyVaultSignConfigFromEnv,
  stampChannelFeedFiles,
} from './electron-builder-config.mjs';
import { buildElectronVendor } from './electron-vendor.mjs';

// Usage: node scripts/electron-build.mjs [pack|build] [website|steam]
//  - pack: --dir only (fast local verification); build: full installers.
//  - website (default): the direct-download channel; keeps the publish feed, so
//    the packaged app self-updates via electron-updater.
//  - steam: the SteamPipe channel; publish nulled, 'dir' targets per OS, output
//    in release-steam/, and the runtime stamp turns the in-app updater OFF
//    (Steam depots are the only update path there; see docs/desktop-release.md).
const mode = process.argv[2] ?? 'build';
if (!['pack', 'build'].includes(mode)) {
  console.error(`unknown electron build mode: ${mode}`);
  process.exit(1);
}
const distribution = process.argv[3] ?? 'website';
if (!['website', 'steam'].includes(distribution)) {
  console.error(`unknown desktop distribution: ${distribution}`);
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBuilderCommand =
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const defaultOrigin = 'https://worldofclaudecraft.com';
// Resolve the web origins ONCE: apiOrigin feeds both the Vite client build and
// the wocDesktop stamp below (so the packaged main process always agrees with
// what the bundle was baked with); loginOrigin is stamped for the main process
// only. A packaged build ignores VITE_DESKTOP_* from runtime env;
// electron/desktop_config.cjs reads the stamp instead. Set-but-empty env vars
// (CI matrices) mean "unset", hence || rather than ??.
const apiOrigin = process.env.VITE_DESKTOP_API_ORIGIN || defaultOrigin;
const loginOrigin = process.env.VITE_DESKTOP_LOGIN_ORIGIN || apiOrigin;
const env = {
  ...process.env,
  VITE_DESKTOP_APP: '1',
  VITE_DESKTOP_API_ORIGIN: apiOrigin,
};

// A macOS build with no real Developer ID configured must still LAUNCH. On Apple Silicon
// the kernel SIGKILLs any invalidly-signed binary, and the electronFuses flip
// (package.json build.electronFuses) rewrites the Electron executable, which invalidates the
// prebuilt ad-hoc signature and the surrounding bundle seal. When no real signing certificate
// is present, tell electron-builder to ad-hoc sign the whole bundle itself via mac.identity
// "-": its @electron/osx-sign pass runs AFTER the fuse flip and re-seals every nested binary,
// producing a valid ad-hoc signature that launches with no manual `codesign` step.
//
// This is scoped to LOCAL/UNSIGNED test builds and never weakens the production signing
// path: a real identity is signalled by CSC_LINK (a .p12 path/base64) or CSC_NAME (an
// identity name), the two standard electron-builder inputs used in CI. When either is set,
// this override is skipped and the real certificate signs the app. A local Developer ID
// discovered only from the keychain (no CSC_* env) is also forced to ad-hoc here (matching
// electron-builder's own mac.identity "-" semantics); to produce a real-signed build locally,
// set CSC_NAME to that identity. macOS-only: mac signing is a no-op on other hosts.
// The ad-hoc path also swaps in the adhoc entitlements variant: an ad-hoc
// signature has no team ID, so hardened runtime + library validation would
// refuse to load the nested Electron frameworks; the production plist keeps
// library validation ON (privacy-security-review finding).
const macSigningConfigured = Boolean(process.env.CSC_LINK) || Boolean(process.env.CSC_NAME);
const adhocMacSign =
  process.platform === 'darwin' && !macSigningConfigured
    ? [
        '--config.mac.identity=-',
        '--config.mac.entitlements=build/entitlements.mac.adhoc.plist',
        '--config.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist',
      ]
    : [];

function run(command, args) {
  // On Windows the npm and electron-builder launchers are .cmd batch shims, and
  // Node 20.12+/22 (the CVE-2024-27980 hardening) refuses to spawn a batch file
  // without a shell: spawnSync returns EINVAL with a null status and nothing on
  // stderr. Route through the shell there, quoting any argument with spaces
  // ourselves because shell mode joins argv without re-quoting. The sign hook's
  // azuresigntool call stays shell-less on purpose (it is a real .exe and its
  // argv carries the client secret, which must never pass through cmd.exe).
  const useShell = process.platform === 'win32';
  const shellArgs = useShell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const result = spawnSync(command, shellArgs, {
    env,
    stdio: 'inherit',
    cwd: root,
    shell: useShell,
  });
  if (result.error) {
    console.error(`electron-build: failed to spawn ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ['run', 'build']);

// The desktop bundle ships no node_modules (build.files excludes them: the
// repo's production deps are server/web packages the client must not carry), so
// the main-process runtime deps are esbuild-bundled into electron/vendor/ here.
buildElectronVendor();

// Derive the per-channel electron-builder config from package.json's "build"
// block and hand it over as an explicit --config file (which REPLACES the
// package.json block, so the derived config is always a superset of it).
const base = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).build;
const config = desktopBuilderConfig({
  base,
  distribution,
  mode,
  apiOrigin,
  loginOrigin,
  crashSubmitUrl: process.env.WOC_CRASH_SUBMIT_URL ?? '',
  azureSign: process.platform === 'win32' ? azureSignOptionsFromEnv(process.env) : null,
  // The Azure Key Vault certificate route (the AzureSignTool hook); the config
  // derivation prefers azureSign when both credential sets are present.
  keyVaultSign: process.platform === 'win32' ? keyVaultSignConfigFromEnv(process.env) : null,
  // The update track defaults from apiOrigin (production origin publishes the
  // 'latest' feed, anything else 'dev'); WOC_UPDATE_CHANNEL=dev stages a
  // production-origin artifact on the dev track for update-pipeline testing.
  // The one dangerous combination, 'latest' with a non-production origin,
  // makes desktopBuilderConfig throw before anything is built. Set-but-empty
  // means "unset" (derive from the origin), hence || rather than ??.
  updateChannel: process.env.WOC_UPDATE_CHANNEL || null,
  // The real Steamworks app id for a depot build (stamped into wocDesktop for
  // electron/steam.cjs). desktopBuilderConfig refuses a steam channel build
  // without a numeric id, so a depot can never silently ship on the Spacewar
  // dev id (480); website builds ignore it.
  steamAppId: process.env.WOC_STEAM_APP_ID || '',
  // steamworks.js is an optionalDependency, so guard the steam channel against a
  // tree where its native install silently failed: the depot would otherwise
  // ship without Steam. desktopBuilderConfig invokes this only for the steam
  // channel, so website builds never touch node_modules here.
  steamworksInstalled: () =>
    existsSync(path.join(root, 'node_modules/steamworks.js/package.json')) &&
    existsSync(path.join(root, 'node_modules/steamworks.js/dist')),
});
const configDir = mkdtempSync(path.join(tmpdir(), 'woc-eb-'));
const configPath = path.join(configDir, 'electron-builder.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

// Feed files accumulate across local builds sharing one output dir, and a
// stale one from a differently-baked earlier build would be re-stamped below
// with THIS build's origin, misdescribing the artifact it points at. Remove
// both channels' feed files up front; electron-builder regenerates the
// current channel's set.
const outDir = path.join(root, config.directories?.output ?? 'release');
if (config.publish?.channel && existsSync(outDir)) {
  for (const name of readdirSync(outDir)) {
    if (!isChannelFeedFile(name, 'latest') && !isChannelFeedFile(name, 'dev')) continue;
    rmSync(path.join(outDir, name));
    console.log(`[electron-build] removed stale feed file ${name}`);
  }
}

// --publish never: artifact upload is a deliberate, documented manual step
// (docs/desktop-release.md); without this, electron-builder auto-publishes on
// CI when a token env var happens to be present.
run(electronBuilderCommand, [
  ...(mode === 'pack' ? ['--dir'] : []),
  '--config',
  configPath,
  '--publish',
  'never',
  ...adhocMacSign,
]);
// The derived config holds no secrets, but do not litter the tmpdir on the
// success path (run() exits the process on failure, skipping this).
rmSync(configDir, { recursive: true, force: true });

// Stamp every emitted update-feed file with the baked API origin so the
// running app can refuse a cross-track artifact (electron/update_guard.cjs).
// Steam builds publish nothing and pack builds emit no feed files, so this is
// a no-op there.
const feedChannel = config.publish?.channel;
if (feedChannel) {
  const stamped = stampChannelFeedFiles({
    outDir,
    channel: feedChannel,
    apiOrigin,
    fs: { existsSync, readdirSync, readFileSync, writeFileSync },
    joinPath: path.join,
  });
  for (const name of stamped) console.log(`[electron-build] stamped wocApiOrigin into ${name}`);
  if (mode === 'build' && stamped.length === 0) {
    console.warn(
      `[electron-build] no ${feedChannel}*.yml feed files found in ${outDir}; ` +
        'nothing stamped (expected for target sets with no updatable artifact)',
    );
  }
}
