'use strict';

// Keep compiled shader programs between sessions.
//
// Chromium stores linked WebGL programs in a GPU disk cache (`<userData>/GPUCache`) and
// reuses them in later sessions, which on Windows skips the FXC compile (about 40 ms for a
// hit against 300 ms and more cold for a game program on an RTX 3060, D3D11). By default it
// never writes a program linked through KHR_parallel_shader_compile, which is how the game
// prewarms nearly all of them: Blink wraps each such link in a completion query that the
// GPU process resolves in MakeCurrent(), before the ScopedCacheUse that installs the
// disk-write callback exists, so the program lands in the in-memory cache only and ANGLE
// never stores it again. The Chromium feature ANGLEPerContextBlobCache (disabled by
// default) gives ANGLE per-context callbacks that carry the disk write themselves, which
// persists every link path (measured on Linux GL and on Windows D3D11).
//
// `gpu-disk-cache-size-kb` lifts the 6 MB default: an Ultra tour writes about 7 to 8 MB of
// entries, and Chromium trims to the cap minus 1 MB once a session passes about 5.5
// minutes. The value also caps the GPU process's in-memory program cache, and the whole
// disk cache is read into it at startup, so it is sized for several tours, not unbounded.
//
// Windows and Linux only: both were measured, macOS (ANGLE Metal) was not. The feature's
// callbacks were the subject of two use-after-free fixes (crbug.com/500187083 and
// crbug.com/517018374, in gles2_cmd_decoder_passthrough.cc MarkContextLost), first shipped
// together in Chromium 150.0.7871.212, so an older embedded Chromium keeps the feature off
// (a floor only: a newer Chromium is re-checked by hand at each Electron upgrade,
// docs/desktop-release.md, "Shader disk cache").
//
// Off switches, each for one launch at a time and read before app 'ready':
// WOC_DISABLE_SHADER_DISK_CACHE=1 in the environment, `shaderDiskCacheOptOut: true` in
// desktop-prefs.json (electron/desktop_prefs.cjs), or the no-GPU-lever rescue
// WOC_DISABLE_GPU_FORCE=1, which already skips every other GPU lever.

const { appendEnabledFeatures } = require('./chromium_features.cjs');

const SHADER_DISK_CACHE_FEATURE = 'ANGLEPerContextBlobCache';
const GPU_DISK_CACHE_SIZE_SWITCH = 'gpu-disk-cache-size-kb';
const GPU_DISK_CACHE_SIZE_KB = 65536;
const SHADER_DISK_CACHE_DISABLE_ENV = 'WOC_DISABLE_SHADER_DISK_CACHE';
const SHADER_DISK_CACHE_PLATFORMS = Object.freeze(['win32', 'linux']);
const MIN_CHROMIUM_WITH_BLOB_CACHE_FIXES = '150.0.7871.212';

/**
 * Whether `version` (a dotted Chromium version) is at or above `minimum`. Anything that is
 * not four numeric parts reads as NOT at the floor: an unverifiable Chromium keeps the
 * feature off.
 */
function chromiumAtLeast(version, minimum) {
  const parse = (v) => (typeof v === 'string' ? v.split('.').map(Number) : []);
  const have = parse(version);
  const need = parse(minimum);
  if (have.length !== 4 || have.some((n) => !Number.isInteger(n) || n < 0)) return false;
  for (let i = 0; i < 4; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

/**
 * Whether THIS launch enables the shader disk cache, and why, first match wins: an
 * unmeasured platform, a Chromium without the callback fixes, the dedicated env, the
 * no-GPU-lever rescue env, the stored opt-out. Both env values are strict '1', like
 * WOC_DISABLE_GPU_FORCE, so a stray value cannot half-arm them.
 */
function decideShaderDiskCache({ platform, chromeVersion, env, prefs }) {
  if (!SHADER_DISK_CACHE_PLATFORMS.includes(platform)) {
    return { enabled: false, reason: `platform ${platform}` };
  }
  if (!chromiumAtLeast(chromeVersion, MIN_CHROMIUM_WITH_BLOB_CACHE_FIXES)) {
    return {
      enabled: false,
      reason: `chromium ${chromeVersion ?? 'unknown'} is older than ${MIN_CHROMIUM_WITH_BLOB_CACHE_FIXES}`,
    };
  }
  const environment = env ?? {};
  if (environment[SHADER_DISK_CACHE_DISABLE_ENV] === '1') {
    return { enabled: false, reason: `${SHADER_DISK_CACHE_DISABLE_ENV}=1` };
  }
  if (environment.WOC_DISABLE_GPU_FORCE === '1') {
    return { enabled: false, reason: 'WOC_DISABLE_GPU_FORCE=1' };
  }
  if (prefs?.shaderDiskCacheOptOut === true) {
    return { enabled: false, reason: 'setting shaderDiskCacheOptOut' };
  }
  return { enabled: true, reason: 'default' };
}

/**
 * Append the two switches for an enabled decision, nothing otherwise. The feature is MERGED
 * into `enable-features` with whatever the shell (the Linux Vulkan rungs) or the player's
 * own command line already enables. A size the player passed on the command line is kept.
 * Must run before app 'ready' (Chromium reads its command line there).
 */
function applyShaderDiskCacheSwitches(app, decision) {
  if (decision?.enabled !== true) return;
  const commandLine = app.commandLine;
  appendEnabledFeatures(commandLine, [SHADER_DISK_CACHE_FEATURE]);
  const sizeGiven =
    typeof commandLine.hasSwitch === 'function' &&
    commandLine.hasSwitch(GPU_DISK_CACHE_SIZE_SWITCH);
  if (!sizeGiven) {
    commandLine.appendSwitch(GPU_DISK_CACHE_SIZE_SWITCH, String(GPU_DISK_CACHE_SIZE_KB));
  }
}

module.exports = {
  MIN_CHROMIUM_WITH_BLOB_CACHE_FIXES,
  chromiumAtLeast,
  GPU_DISK_CACHE_SIZE_KB,
  GPU_DISK_CACHE_SIZE_SWITCH,
  SHADER_DISK_CACHE_DISABLE_ENV,
  SHADER_DISK_CACHE_FEATURE,
  SHADER_DISK_CACHE_PLATFORMS,
  applyShaderDiskCacheSwitches,
  decideShaderDiskCache,
};
