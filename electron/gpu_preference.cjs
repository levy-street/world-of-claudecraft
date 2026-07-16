const { execFileSync: nodeExecFileSync } = require('node:child_process');
const nodePath = require('node:path');

// Force the app onto the discrete (high-performance) GPU on hybrid systems, with ZERO
// user action. This is the fix for the "good GPU renders at ~13 FPS" reports: on an
// NVIDIA/AMD Optimus laptop Chromium's GPU process binds ONE adapter at startup and very
// commonly picks the integrated GPU (the internal panel is wired to the iGPU; an external
// monitor is wired to the dGPU, which is why "it works on my monitor"). The game client
// requests powerPreference:'high-performance', but on Windows that per-context hint does
// NOT switch adapters (Chrome binds one adapter for the whole GPU process), so we force it
// at the process/OS level here instead. Two independent levers, because neither is a
// guarantee on its own:
//
//  1. Chromium command-line switch. force-high-performance-gpu makes the GPU process ask
//     DXGI for the high-performance adapter at startup. Chromium 150 (Electron 43) registers
//     the switch name with HYPHENS in gpu/config/gpu_switches.cc; Electron's own docs spell
//     it with underscores. Chromium matches switch names EXACTLY (it does not fold
//     underscores to hyphens), so we append BOTH spellings; an unrecognized switch is a
//     silent no-op. This takes effect the current launch, but is not reliable on every
//     Windows/driver combo (electron/electron#31355), hence lever 2.
//
//  2. Windows per-app GPU preference (the OS-authoritative lever, and the one that fixes it
//     for good). Setting GpuPreference=2 on the HKCU\Software\Microsoft\DirectX\
//     UserGpuPreferences value NAMED by the app's own exe path is what Settings > System >
//     Display > Graphics > High performance sets, and on Windows 10 20H1+ / Windows 11 it
//     OVERRIDES the NVIDIA Control Panel. That ONE value packs other semicolon-separated
//     per-app tokens too (the Windows 11 "Optimizations for windowed games" toggle stores
//     SwapEffectUpgradeEnable=1; per-app Auto HDR stores AutoHDREnable tokens), so we never
//     replace the value wholesale: the stored data is queried first and only the
//     GpuPreference token is replaced (or appended), preserving the user's other per-app
//     graphics settings. Electron's child processes (GPU, renderer, utility) share this exe
//     path, so the preference steers all of them; the NSIS install path is stable across
//     auto-updates, so the entry persists. HKCU needs no elevation. We write only when the
//     value is missing or not already high-performance, so an already-correct launch does no
//     work. Writing at module load (before the GPU process spawns) makes it effective the
//     current launch too, not just the next one. This lever runs only in PACKAGED builds: an
//     unpackaged dev run would key the preference to the checkout's node_modules electron
//     binary (one orphan entry per worktree, steering everything else launched from that
//     shared binary); only the stable installed exe path is worth pinning.
//
// The arg-building, query parsing, and token merging are pure and dependency-injected so
// tests exercise them without a real registry or a real Electron app.

const USER_GPU_PREFERENCES_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
// GpuPreference values: 0 = let Windows decide, 1 = power saving (integrated), 2 = high
// performance (discrete). We always force 2 so the discrete GPU is never bypassed.
const HIGH_PERFORMANCE_PREFERENCE = 'GpuPreference=2;';
// Both spellings on purpose: the hyphen form is the real Chromium 150 switch name, the
// underscore form is what Electron's docs list. Appending both survives either matcher.
const HIGH_PERF_GPU_SWITCHES = ['force-high-performance-gpu', 'force_high_performance_gpu'];

/** argv for `reg query` of this exe's stored preference (throws via reg if the value is absent). */
function buildRegQueryArgs(exePath) {
  return ['query', USER_GPU_PREFERENCES_KEY, '/v', exePath];
}

/** argv for `reg add` that stores `data` for this exe's preference value (idempotent via /f). */
function buildRegWriteArgs(exePath, data = HIGH_PERFORMANCE_PREFERENCE) {
  return ['add', USER_GPU_PREFERENCES_KEY, '/v', exePath, '/t', 'REG_SZ', '/d', data, '/f'];
}

/**
 * Extract the stored string data for the queried value from `reg query /v` output. The value
 * line looks like `    <exe path>    REG_SZ    <data>`; the exe path contains spaces, so we
 * anchor on the type column (REG_SZ, or REG_EXPAND_SZ for a hand-edited value) instead of
 * splitting on whitespace. Returns '' when the output holds no such line.
 */
function parseRegQueryData(regQueryStdout) {
  const match = String(regQueryStdout ?? '').match(/\bREG_(?:EXPAND_)?SZ\s+([^\r\n]+)/);
  return match ? match[1].trim() : '';
}

/**
 * Merge GpuPreference=2 into the stored per-app value, preserving every OTHER token. Windows
 * packs multiple semicolon-separated key=value tokens into this one value (the Windows 11
 * "Optimizations for windowed games" toggle stores SwapEffectUpgradeEnable=1; per-app Auto
 * HDR stores AutoHDREnable tokens), so replacing the whole string would silently delete the
 * user's other per-app graphics settings. The GpuPreference token is replaced in place
 * (case-insensitively, and duplicates collapse to one) or appended when absent; every other
 * token keeps its position.
 */
function mergeHighPerformancePreference(existingData) {
  const tokens = String(existingData ?? '')
    .split(';')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const merged = [];
  let replaced = false;
  for (const token of tokens) {
    if (/^GpuPreference=/i.test(token)) {
      if (!replaced) {
        merged.push('GpuPreference=2');
        replaced = true;
      }
      continue;
    }
    merged.push(token);
  }
  if (!replaced) merged.push('GpuPreference=2');
  return `${merged.join(';')};`;
}

/**
 * True when the `reg query` output already pins the high-performance GPU (GpuPreference=2).
 * The negative lookahead keeps a hypothetical "=20" from matching; real values are 0, 1, or 2.
 */
function alreadyHighPerformance(regQueryStdout) {
  return /GpuPreference=2(?![0-9])/.test(String(regQueryStdout ?? ''));
}

function defaultRegExe(env) {
  const root = env?.SystemRoot || 'C:\\Windows';
  // Always a Windows path (this branch only runs on win32); win32.join keeps it correct
  // regardless of the host that exercises it (macOS/Linux CI would otherwise use "/").
  return nodePath.win32.join(root, 'System32', 'reg.exe');
}

/**
 * Force the discrete GPU. Appends the Chromium switches on every platform (harmless on a
 * single-GPU machine, honored on macOS dual-GPU), then, on Windows only, writes the
 * OS-authoritative per-app preference. Never throws: a failed switch or a failed registry
 * write is logged and swallowed so the app always boots. MUST be called before app 'ready'
 * (so the switches are read) and before the first window (so the registry write beats the
 * GPU process on the current launch).
 */
function forceHighPerformanceGpu(deps = {}) {
  const app = deps.app;
  const platform = deps.platform ?? process.platform;
  const execFileSync = deps.execFileSync ?? nodeExecFileSync;
  const env = deps.env ?? process.env;
  const log = deps.log;

  for (const name of HIGH_PERF_GPU_SWITCHES) {
    try {
      app?.commandLine?.appendSwitch(name);
    } catch (err) {
      log?.warn?.('[gpu] could not append switch', name, err);
    }
  }

  if (platform !== 'win32') return;
  // Packaged builds only: an unpackaged dev run resolves the exe to the checkout's
  // node_modules electron binary, so the entry would be an orphan keyed per worktree AND
  // would force the discrete GPU for anything else launched from that shared binary.
  if (app?.isPackaged !== true) return;

  let exePath;
  try {
    exePath = app?.getPath ? app.getPath('exe') : process.execPath;
  } catch {
    exePath = process.execPath;
  }
  if (!exePath) return;

  const reg = deps.regExe ?? defaultRegExe(env);
  const runOpts = { timeout: 4000, windowsHide: true };

  let existingData = '';
  try {
    const stdout = execFileSync(reg, buildRegQueryArgs(exePath), {
      ...runOpts,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (alreadyHighPerformance(stdout)) return; // already pinned; nothing to do
    existingData = parseRegQueryData(stdout);
  } catch {
    // Missing value/key (reg exits non-zero) or reg unavailable: fall through and write.
  }

  try {
    const data = mergeHighPerformancePreference(existingData);
    execFileSync(reg, buildRegWriteArgs(exePath, data), { ...runOpts, stdio: 'ignore' });
    log?.info?.('[gpu] pinned app to the high-performance GPU (Windows per-app preference)', {
      exePath,
    });
  } catch (err) {
    log?.warn?.('[gpu] could not set the Windows per-app GPU preference', err);
  }
}

module.exports = {
  USER_GPU_PREFERENCES_KEY,
  HIGH_PERFORMANCE_PREFERENCE,
  HIGH_PERF_GPU_SWITCHES,
  buildRegQueryArgs,
  buildRegWriteArgs,
  parseRegQueryData,
  mergeHighPerformancePreference,
  alreadyHighPerformance,
  forceHighPerformanceGpu,
};
