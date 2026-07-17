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
//  1. Chromium command-line switch. force-high-performance-gpu makes the GPU process bind
//     the default ANGLE/EGL display to the adapter IDXGIFactory6::EnumAdapterByGpuPreference
//     tags as high performance. BOTH spellings are live, at two different layers, so never
//     "clean up" either one: the HYPHEN form is the real browser-side switch (Chromium 150
//     gpu/config/gpu_switches.cc), which gpu_process_host.cc translates into the workaround
//     string on the GPU-process command line; the UNDERSCORE form is that workaround's own
//     NAME (gpu/config/gpu_workaround_list.txt), which the browser forwards verbatim and the
//     GPU process parses directly (GpuDriverBugList::AppendWorkaroundsFromCommandLine).
//     Chromium matches switch names EXACTLY (no underscore folding) and ignores unknown
//     switches, so appending both is harmless and survives either matcher moving. The switch
//     silently no-ops when Chromium's GPU info collection sees one adapter or IDXGIFactory6
//     is unavailable (electron/electron#31355), hence lever 2.
//
//  2. Windows per-app GPU preference (the OS-authoritative lever, and the one that fixes it
//     for good). Setting GpuPreference=2 on the HKCU\Software\Microsoft\DirectX\
//     UserGpuPreferences value NAMED by the app's own exe path is what Settings > System >
//     Display > Graphics > High performance sets, and on Windows 10 20H1+ / Windows 11 it
//     OVERRIDES the NVIDIA Control Panel. That ONE value packs other semicolon-separated
//     per-app tokens too (the Windows 11 "Optimizations for windowed games" toggle stores
//     SwapEffectUpgradeEnable=1; per-app Auto HDR stores AutoHDREnable tokens; Windows 11's
//     "Specific GPU" choice stores GpuPreference=1073741824 plus a SpecificAdapter=VEN&DEV&
//     SUBSYS token), so we never replace the value wholesale: the stored data is queried
//     first and only the GpuPreference token is replaced (or appended), preserving the
//     user's other per-app graphics settings (a SpecificAdapter token left dangling next to
//     GpuPreference=2 is simply ignored by Windows). The SAME key also holds the user's
//     machine-wide Graphics toggles under the special value name DirectXUserGlobalSettings;
//     we only ever address the value named by our exe path, never that one. Windows is read
//     lazily, per process, at D3D/DXGI initialization, keyed by the exe path, which is what
//     makes the before-GPU-process write effective the same launch.
//     Accepted theoretical hazards, deliberately not coded around ("REG_SZ" as an exe-path
//     component, embedded newlines in hand-edited data, REG_EXPAND_SZ rewritten as REG_SZ,
//     8.3/symlink path drift vs Windows Settings): each needs a hand-edited registry or an
//     absurd install path, and the worst outcome is a malformed token Windows ignores next
//     to a still-valid GpuPreference=2.
//     Electron's child processes (GPU, renderer, utility) share this exe
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
 * Parses the stored data first and compares whole semicolon-separated tokens,
 * case-insensitively, exactly like mergeHighPerformancePreference tokenizes: a raw substring
 * match over the whole stdout would false-positive on a hypothetical sibling token that merely
 * ENDS in "GpuPreference=2" and would miss a hand-edited "gpupreference=2".
 */
function alreadyHighPerformance(regQueryStdout) {
  return parseRegQueryData(regQueryStdout)
    .split(';')
    .map((token) => token.trim())
    .some((token) => /^GpuPreference=2$/i.test(token));
}

function defaultRegExe(env) {
  const root = env?.SystemRoot || 'C:\\Windows';
  // Always a Windows path (this branch only runs on win32); win32.join keeps it correct
  // regardless of the host that exercises it (macOS/Linux CI would otherwise use "/").
  return nodePath.win32.join(root, 'System32', 'reg.exe');
}

/**
 * True when a thrown `reg query` error means "the value (or key) does not exist": reg.exe
 * exits 1 for a missing value, which execFileSync surfaces as status 1 with no signal. Every
 * OTHER failure (timeout kill, reg.exe missing/blocked, access denied) leaves the stored
 * value in an UNKNOWN state, and writing from an assumed-empty state on unknown would
 * silently delete the user's sibling per-app tokens; those failures must skip the write.
 */
function isRegValueAbsent(err) {
  return err?.status === 1 && !err?.killed && !err?.signal;
}

/**
 * True when a SUCCESSFUL `reg query` returned a value we cannot parse: a type other than
 * REG_SZ / REG_EXPAND_SZ (say a hand-edited REG_MULTI_SZ). parseRegQueryData returns '' for
 * those, and overwriting would both change the value's type and destroy its data, so the
 * write is skipped. An empty parse WITHOUT a foreign type token is just an empty REG_SZ
 * value, which is safe to overwrite.
 */
function hasUnparseableValueType(regQueryStdout) {
  return /\bREG_(?!SZ\b|EXPAND_SZ\b)[A-Z_]+/.test(String(regQueryStdout ?? ''));
}

// Vendor ids as getGPUInfo reports them: NVIDIA 0x10de, AMD 0x1002, Intel 0x8086,
// Microsoft 0x1414 (the WARP software adapter).
const DISCRETE_VENDOR_IDS = [0x10de, 0x1002];
const INTEGRATED_OR_SOFTWARE_VENDOR_IDS = [0x8086, 0x1414];

/**
 * Compact, loggable summary of Electron's getGPUInfo gpuDevice list. `discreteInactive` is
 * the smoking gun for the hybrid-laptop wrong-adapter case: an NVIDIA/AMD adapter is present
 * but INACTIVE while the active adapter is Intel or the Microsoft WARP device, meaning
 * neither the per-app OS preference nor the Chromium switch took effect on this machine.
 * Deliberately conservative: an active AMD adapter never flags (AMD APU + NVIDIA dGPU rigs
 * would false-positive), so a miss is possible but a false alarm is not. Pure for tests.
 */
function summarizeGpuDevices(gpuDevices) {
  const devices = (Array.isArray(gpuDevices) ? gpuDevices : []).map((d) => ({
    vendorId: `0x${(d?.vendorId ?? 0).toString(16).padStart(4, '0')}`,
    deviceId: `0x${(d?.deviceId ?? 0).toString(16).padStart(4, '0')}`,
    active: d?.active === true,
  }));
  const raw = Array.isArray(gpuDevices) ? gpuDevices : [];
  const discreteInactive =
    raw.some((d) => d?.active !== true && DISCRETE_VENDOR_IDS.includes(d?.vendorId)) &&
    raw.some((d) => d?.active === true && INTEGRATED_OR_SOFTWARE_VENDOR_IDS.includes(d?.vendorId));
  return { devices, discreteInactive };
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
  // Both calls are synchronous on the boot path by design (the write must beat the GPU
  // process spawn to count for THIS launch), so the timeout bounds the worst-case boot
  // stall: 2 x 1500 ms, with 10x-plus headroom over reg.exe's normal sub-100 ms runs.
  const runOpts = { timeout: 1500, windowsHide: true };

  let existingData = '';
  try {
    const stdout = execFileSync(reg, buildRegQueryArgs(exePath), {
      ...runOpts,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (alreadyHighPerformance(stdout)) return; // already pinned; nothing to do
    if (hasUnparseableValueType(stdout)) {
      // The value exists but with a type we cannot round-trip: rewriting would destroy it.
      log?.warn?.('[gpu] per-app GPU preference has an unexpected value type; leaving it');
      return;
    }
    existingData = parseRegQueryData(stdout);
  } catch (err) {
    if (!isRegValueAbsent(err)) {
      // Timeout, reg.exe missing/blocked, access denied: the stored value is UNKNOWN, and
      // writing from an assumed-empty state could delete the user's sibling tokens
      // (SwapEffectUpgradeEnable, AutoHDREnable). Skip; next launch retries.
      log?.warn?.('[gpu] could not read the per-app GPU preference; skipping the write', err);
      return;
    }
    // Missing value/key (reg exits 1): fall through and write the fresh preference.
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
  hasUnparseableValueType,
  summarizeGpuDevices,
  forceHighPerformanceGpu,
};
