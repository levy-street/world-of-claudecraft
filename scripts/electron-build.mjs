import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { azureSignOptionsFromEnv, desktopBuilderConfig } from './electron-builder-config.mjs';
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
// electron/desktop_config.cjs reads the stamp instead.
const apiOrigin = process.env.VITE_DESKTOP_API_ORIGIN ?? defaultOrigin;
const loginOrigin = process.env.VITE_DESKTOP_LOGIN_ORIGIN ?? apiOrigin;
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
  const result = spawnSync(command, args, { env, stdio: 'inherit', cwd: root });
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
});
const configDir = mkdtempSync(path.join(tmpdir(), 'woc-eb-'));
const configPath = path.join(configDir, 'electron-builder.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

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
