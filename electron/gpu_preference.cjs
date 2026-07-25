const { execFileSync: nodeExecFileSync, spawn: nodeSpawn } = require('node:child_process');
const { existsSync: nodeExistsSync, readdirSync: nodeReaddirSync } = require('node:fs');
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
//  3. Linux PRIME render-offload via a self-relaunch. On a Linux hybrid-graphics laptop
//     (NVIDIA Optimus, AMD/Intel Mesa PRIME) there is no per-app OS-level preference to write
//     (no registry equivalent) and force-high-performance-gpu is a no-op: the driver decides
//     which adapter serves EGL/GLX at DYNAMIC-LINK time, before Chromium's own switch parsing
//     ever runs. The standard offload contract (what `prime-run`/`optirun` wrapper scripts
//     set) is a handful of environment variables read by the vendor's client driver when it
//     resolves the GPU vendor library: DRI_PRIME=1 (Mesa: AMD/Intel PRIME offload, ignored by
//     the NVIDIA proprietary driver), and for NVIDIA's proprietary PRIME render offload,
//     __NV_PRIME_RENDER_OFFLOAD=1 plus __GLX_VENDOR_LIBRARY_NAME=nvidia (GLX) and
//     __VK_LAYER_NV_optimus=NVIDIA_only (Vulkan, which Chromium's ANGLE backend can select).
//     Mutating process.env for these at this call site (before app.whenReady(), same as the
//     other two levers) does NOT work on Linux, unlike on Windows/macOS: Chromium's GPU
//     process here is forked from an ALREADY-RUNNING zygote, and that zygote fork/exec'd off
//     an environ snapshot the zygote took at ITS OWN exec, at the very first line of the
//     Electron binary, before any of this script's JS ever ran. The zygote fork protocol
//     passes argv and file descriptors, not the browser process's live environment, so a
//     later process.env write in the main process is simply invisible to it (measured against
//     real hybrid hardware: a variable set here changes nothing, while the identical variable
//     set in the PARENT shell before the binary even starts changes GPU behavior immediately).
//     The only lever early enough is to re-exec the whole process before Electron's own
//     startup: relaunchForLinuxPrime spawns a fresh child (same binary, same argv) with the
//     PRIME variables baked into ITS environ from birth, so the zygote it starts (and every
//     GPU/renderer/utility process that zygote later forks) inherits them for real. The
//     caller must invoke this and, if it returns true, exit immediately without creating any
//     window or spawning the GPU process itself. Four constraints shape the details:
//     (a) HYBRID-GATED: the relaunch only happens when /sys/class/drm exposes two or more
//         GPUs (isLinuxHybridGpu). A single-GPU machine gets neither the extra spawn nor a
//         forced --ozone-platform=x11 (which would silently move native-Wayland players onto
//         XWayland for no benefit, and would strand a Wayland-only setup with no XWayland).
//     (b) APPIMAGE-AWARE SPAWN SOURCE: in an AppImage, process.execPath points INSIDE the
//         runtime's FUSE mount, and that mount's daemon is the runtime process, which
//         unmounts and exits the moment its child (this process) exits; a child spawned from
//         execPath loses its own binary mid-startup (measured: killing the runtime yields
//         EIO on already-open fds). So the spawn source is env.APPIMAGE (the outer file,
//         same source electron-updater restarts from) whenever it is set, execPath otherwise.
//     (c) THE SKIP CONDITION COVERS BOTH HALVES of the fix, env AND argv. The env half
//         propagates by inheritance but the argv half does not: electron-updater's
//         restart-to-update respawns the app with the CURRENT env (marker and PRIME vars
//         included) and EMPTY argv, so a marker-only skip would leave the updated process
//         running PRIME without --ozone-platform=x11, the exact Wayland crash-loop state
//         documented below. Once the marker is present, the relaunch re-fires if and only
//         if argv still lacks an explicit --ozone-platform choice; every relaunch produces
//         a child that HAS one, so this cannot loop.
//     (d) A caller-supplied override already present in the parent environment (say, the
//         player already launches via their own `prime-run`) is left untouched per name,
//         and with no marker and every variable already present the relaunch is skipped
//         entirely (that environment is wholly the player's own choice).
//     The variables themselves are safe to set on any hybrid machine: a machine missing the
//     corresponding vendor library never resolves those names and they sit inert (mirrors
//     the "append both switch spellings, harmless if unmatched" posture above). The ONE
//     exception is __EGL_VENDOR_LIBRARY_FILENAMES, which glvnd treats as a REPLACEMENT of
//     its EGL vendor list, not an addition: naming a json that does not exist leaves EGL
//     with zero vendors and no GL at all, so that entry is included only when the file
//     actually exists (buildLinuxPrimeEnv's fileExists gate).
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

// The Linux PRIME render-offload variables (see lever 3 above): Mesa's DRI_PRIME plus
// NVIDIA's proprietary-driver offload set. Exported so a caller can log or pin exactly
// which names this module sets.
//
// Which variable does the lifting depends on the path Chromium takes, both measured on real
// hybrid hardware (Intel Arrow Lake iGPU + NVIDIA RTX 5090 Laptop, proprietary driver 580,
// Electron 43): under the --ozone-platform=x11 flow this module forces, ANGLE binds through
// GLX (renderer strings report desktop "OpenGL", not "OpenGL ES") and the GLX pair
// (__NV_PRIME_RENDER_OFFLOAD + __GLX_VENDOR_LIBRARY_NAME) selects the adapter; the same set
// minus the EGL line still lands on the NVIDIA GPU there. On EGL paths (a player-forced
// Wayland ozone), the GLX pair is a decoy (it flips `glxinfo` to NVIDIA while the unmasked
// WebGL renderer stays on the iGPU) and __EGL_VENDOR_LIBRARY_FILENAMES, pointed at the
// NVIDIA GLVND EGL ICD json, is the lever that moves the renderer. So the EGL entry is
// belt-and-suspenders for the shipped flow and load-bearing for the EGL one; it stays, but
// gated on the json actually existing (see lever 3 (d) and buildLinuxPrimeEnv), because on a
// machine without the NVIDIA driver glvnd would otherwise be left with ZERO EGL vendors.
// DRI_PRIME remains the whole story for the Mesa-hybrid AMD/Intel case, which never touches
// EGL vendor selection.
const LINUX_PRIME_ENV = Object.freeze({
  DRI_PRIME: '1',
  __NV_PRIME_RENDER_OFFLOAD: '1',
  __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
  __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json',
  __VK_LAYER_NV_optimus: 'NVIDIA_only',
});

// Same hardware test found the packaged app's GPU process crash-loops on a Wayland session
// once PRIME offload is requested (exit_code=8704, "not compatible with Vulkan"), silently
// falling back to software rendering, which is worse than the iGPU it started on. Chromium
// picks its Ozone backend before any main-script JS runs (an appendSwitch call at this
// call site, same as the PRIME env, measurably does nothing: verified against the same
// hardware), so relaunchForLinuxPrime adds this as a real argv flag on the relaunched
// process instead. Never added when the player's own argv already makes an EXPLICIT
// --ozone-platform=... choice (that wins). A bare --ozone-platform-hint does NOT suppress
// it: a hint is a preference Chromium lets an explicit flag override, and honoring a
// hint-of-wayland while injecting PRIME would recreate the crash-loop.
const LINUX_OZONE_X11_ARG = '--ozone-platform=x11';

/**
 * Whether argv already contains an explicit --ozone-platform choice (the exact flag or its
 * =value form). --ozone-platform-hint deliberately does not count; see LINUX_OZONE_X11_ARG.
 */
function hasExplicitOzonePlatformArg(argv) {
  return (argv ?? []).some((a) => a === '--ozone-platform' || a.startsWith('--ozone-platform='));
}

/**
 * The env additions needed to request PRIME render offload, skipping any name the caller's
 * environment already sets (a player who already launches via their own `prime-run` or has
 * hand-picked `__GLX_VENDOR_LIBRARY_NAME` keeps their own value). The
 * __EGL_VENDOR_LIBRARY_FILENAMES entry is additionally skipped when the json it names does
 * not exist on this machine: glvnd treats that variable as a REPLACEMENT of its vendor
 * list, so naming a missing file would leave EGL with zero vendors and no GL at all
 * (every non-NVIDIA machine lacks the file). `fileExists` is injectable for tests. Returns
 * only the NEW entries to apply, never mutates `existingEnv`.
 */
function buildLinuxPrimeEnv(existingEnv, fileExists = nodeExistsSync) {
  const env = existingEnv ?? {};
  const additions = {};
  for (const [name, value] of Object.entries(LINUX_PRIME_ENV)) {
    if (env[name] !== undefined) continue;
    if (name === '__EGL_VENDOR_LIBRARY_FILENAMES' && !fileExists(value)) continue;
    additions[name] = value;
  }
  return additions;
}

// Marks a process whose environment THIS module configured (as opposed to a player's own
// prime-run/wrapper env): set on the child's env before spawn. It is deliberately NOT a
// blanket "never relaunch again" switch, because the env half of the fix propagates by
// inheritance while the argv half does not: electron-updater's restart-to-update respawns
// the app with the current env (marker included) and EMPTY argv, and that process still
// needs --ozone-platform=x11 re-applied (see lever 3 (c)). Loop safety comes from the argv
// check instead: every relaunch produces a child whose argv carries an explicit
// --ozone-platform, and a marked process with one never relaunches.
const PRIME_RELAUNCH_MARKER = 'WOC_PRIME_RELAUNCHED';

/**
 * Whether this process should re-exec itself with the Linux PRIME env applied.
 * - Marker present (this env was configured by a previous relaunch, then possibly inherited
 *   through an updater restart): relaunch only if argv still lacks an explicit
 *   --ozone-platform choice, i.e. only to restore the argv half. Cannot loop: the relaunch
 *   always yields a child with an explicit --ozone-platform in argv.
 * - No marker: relaunch if at least one PRIME variable is missing. A player who already
 *   launches via their own `prime-run` (every variable present, no marker) gets a no-op
 *   skip: that environment is wholly their own choice, flag included or not.
 */
function shouldRelaunchForLinuxPrime(env, argv, fileExists = nodeExistsSync) {
  if (env?.[PRIME_RELAUNCH_MARKER] === '1') return !hasExplicitOzonePlatformArg(argv);
  return Object.keys(buildLinuxPrimeEnv(env, fileExists)).length > 0;
}

/**
 * True when /sys/class/drm exposes two or more GPU card devices, the hybrid-graphics case
 * this whole lever exists for. Needs no Electron API (getGPUInfo needs app ready, far too
 * late to decide a relaunch), so it can run at the very top of main. On any read failure
 * (exotic sandbox, no /sys) it returns false: when we cannot tell, we impose neither the
 * extra spawn nor a forced X11 backend on the player. `readdir` is injectable for tests.
 */
function isLinuxHybridGpu(readdir = nodeReaddirSync) {
  try {
    const cards = readdir('/sys/class/drm').filter((name) => /^card\d+$/.test(name));
    return cards.length >= 2;
  } catch {
    return false;
  }
}

/**
 * Re-exec the current process (same argv, PRIME env baked into the child's environment from
 * birth). See lever 3 in the file header for why an in-process process.env mutation cannot
 * work here: only an environment present before Electron's own startup (before the zygote's
 * exec) ever reaches the GPU process. Hybrid-gated (lever 3 (a)); the spawn source is
 * env.APPIMAGE when set, because in an AppImage process.execPath dies with the parent's
 * FUSE mount (lever 3 (b)). Detached + unref'd so the parent can exit without waiting on
 * the child; stdio inherited so the player's console output is uninterrupted. Returns true
 * when a relaunch was spawned, in which case the CALLER must exit immediately via
 * process.exit(0), which stops the main script before any further statement runs (app.exit
 * also works but only after the app module is usable; process.exit needs nothing). Returns
 * false (nothing to do) on any other platform, on a non-hybrid machine, when this process
 * is already correctly configured, or if the spawn itself fails.
 */
function relaunchForLinuxPrime(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const log = deps.log;

  if (platform !== 'linux') return false;
  const isHybrid = deps.isHybridGpu ?? isLinuxHybridGpu;
  if (!isHybrid()) return false;
  const fileExists = deps.fileExists ?? nodeExistsSync;
  const baseArgv = deps.argv ?? process.argv.slice(1);
  if (!shouldRelaunchForLinuxPrime(env, baseArgv, fileExists)) return false;

  const spawnFn = deps.spawn ?? nodeSpawn;
  // In an AppImage, execPath points inside the runtime's FUSE mount, which dies the moment
  // this process exits; the outer AppImage file (env.APPIMAGE, the same source
  // electron-updater restarts from) survives and brings up a fresh runtime + mount.
  const execPath = deps.execPath ?? process.execPath;
  const appImage =
    typeof env.APPIMAGE === 'string' && nodePath.isAbsolute(env.APPIMAGE) ? env.APPIMAGE : null;
  const spawnTarget = appImage ?? execPath;
  // A Wayland session's GPU process crash-loops once PRIME offload is requested unless
  // Chromium is forced onto the X11 Ozone backend (see LINUX_OZONE_X11_ARG above); never
  // added when the player's own argv already makes an explicit --ozone-platform choice.
  const argv = hasExplicitOzonePlatformArg(baseArgv)
    ? baseArgv
    : [...baseArgv, LINUX_OZONE_X11_ARG];
  const additions = buildLinuxPrimeEnv(env, fileExists);
  const childEnv = { ...env, ...additions, [PRIME_RELAUNCH_MARKER]: '1' };

  try {
    const child = spawnFn(spawnTarget, argv, {
      env: childEnv,
      stdio: 'inherit',
      detached: true,
    });
    child.unref?.();
    log?.info?.('[gpu] relaunching for Linux PRIME render offload', {
      spawnTarget,
      added: Object.keys(additions),
    });
    return true;
  } catch (err) {
    log?.warn?.('[gpu] could not relaunch for Linux PRIME render offload', err);
    return false;
  }
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
 *
 * Does NOT handle Linux: relaunchForLinuxPrime is a separate, earlier call the caller must
 * make (and act on) before this function, since it requires a full process re-exec rather
 * than an in-process env mutation (see lever 3 in the file header for why).
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
  LINUX_PRIME_ENV,
  LINUX_OZONE_X11_ARG,
  PRIME_RELAUNCH_MARKER,
  buildLinuxPrimeEnv,
  hasExplicitOzonePlatformArg,
  isLinuxHybridGpu,
  shouldRelaunchForLinuxPrime,
  relaunchForLinuxPrime,
  buildRegQueryArgs,
  buildRegWriteArgs,
  parseRegQueryData,
  mergeHighPerformancePreference,
  alreadyHighPerformance,
  hasUnparseableValueType,
  summarizeGpuDevices,
  forceHighPerformanceGpu,
};
