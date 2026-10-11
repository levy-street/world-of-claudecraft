'use strict';

// "Host essentials": the small snapshot of host facts the BROWSER SANDBOX
// CANNOT SEE, collected by the desktop shell and attached to every automatic
// perf report as top-level scalars (src/game/desktop_host_essentials.ts ->
// src/game/perf_reporter.ts -> server/perf_report_host.ts). Web and mobile
// reports simply lack them.
//
// This is deliberately NOT the host diagnostic (electron/host_diag.cjs). That
// one is a player-triggered, multi-second, PowerShell-backed report a person
// mails to support. This one is four registry values and three Electron
// getters, cheap enough to refresh every few minutes for the life of a session,
// and it never spawns PowerShell: reg.exe only, through the sanctioned process
// module (electron/gpu_preference.cjs queryRegValue), whose EXACT allowlist of
// (key, valueName) pairs is the same set of constants this module imports and
// reads, so neither side can drift from the other.
//
// PRIVACY is what shapes every field here. The perf-report endpoint accepts
// ANONYMOUS posts, so nothing may carry a machine-identifying figure:
//  - the memory sizes are rounded hard (256 MB total, 64 MB free), because an
//    exact byte count of installed RAM is a fingerprint-grade number, and the
//    three app working sets round to 16 MB so no figure in the row is left at
//    full entropy;
//  - the power plan and power mode are folded to a CLOSED VOCABULARY here, in
//    the shell, and the raw GUID is never stored, never returned, and never
//    sent: a custom power plan's GUID is unique to one machine. This is the
//    same posture the repo already takes on refreshHz (server/perf_report.ts
//    rounds it to whole Hz for exactly this reason).
//
// Pure and dependency-injected through a `deps = {}` bag, in the same house
// style as electron/gpu_preference.cjs and electron/host_diag.cjs: no electron
// import at module top (main.cjs passes app/powerMonitor/process in), so
// tests/electron_host_essentials.test.ts drives the whole flow against fakes.

// --- Registry addresses (constants, never derived) ---------------------------
//
// IMPORTED, never re-declared: gpu_preference.cjs owns these five (key,
// valueName) pairs because that is where the reader's EXACT allowlist enforces
// them, and a second copy here is exactly the drift that would let this module
// ask for something the allowlist refuses (or, worse, let the allowlist grow to
// cover a read nobody makes). One definition, imported by the caller.
const {
  ACTIVE_OVERLAY_AC_VALUE,
  ACTIVE_OVERLAY_DC_VALUE,
  ACTIVE_POWER_SCHEME_VALUE,
  AUTO_GAME_MODE_VALUE,
  GAME_BAR_KEY,
  GRAPHICS_DRIVERS_KEY,
  HW_SCH_MODE_VALUE,
  POWER_SCHEMES_KEY,
  queryRegValue,
} = require('./gpu_preference.cjs');

// --- The closed vocabularies -------------------------------------------------
//
// Kept equal, by test, to the client narrowing (src/game/desktop_host_essentials.ts)
// and the server narrowing (server/perf_report_host.ts): see
// tests/host_essentials_vocabulary_parity.test.ts. '' is "unknown, or not
// Windows" and is a member of both vocabularies.

/** Windows' four well-known power PLANS. Anything else folds to 'other'. */
const POWER_PLAN_BY_GUID = Object.freeze({
  '381b4222-f694-41f0-9685-ff5bb260df2e': 'balanced',
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'high_performance',
  'a1841308-3541-4fab-bc81-f71556f20b4a': 'power_saver',
  'e9a42b02-d5df-448d-aa00-03f14749eb61': 'ultimate',
});

const POWER_PLANS = Object.freeze([
  '',
  'balanced',
  'high_performance',
  'power_saver',
  'ultimate',
  'other',
]);

/**
 * The Windows 10/11 power-MODE slider, which rides as an OVERLAY on top of the
 * plan above. This map is the same one the shipped host diagnostic uses
 * (electron/host_diag/win/collectors/Power.ps1 $overlayNames), deliberately: a
 * support engineer reading a saved diagnostic and an analyst reading the fleet
 * table must be looking at the same four buckets, and
 * tests/host_essentials_vocabulary_parity.test.ts parses that .ps1 and asserts
 * the two maps agree. The all-zero GUID is Windows' own spelling of "the
 * balanced overlay", not a missing reading.
 */
const POWER_MODE_BY_GUID = Object.freeze({
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'best_efficiency',
  '00000000-0000-0000-0000-000000000000': 'balanced',
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f': 'better_performance',
  'ded574b5-45a0-4f42-8737-46345c09c238': 'best_performance',
});

const POWER_MODES = Object.freeze([
  '',
  'best_efficiency',
  'balanced',
  'better_performance',
  'best_performance',
  'other',
]);

/** Lowercase, braces and surrounding whitespace off: how a GUID is compared. */
function normalizeGuid(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/^\{|\}$/g, '')
        .toLowerCase()
    : '';
}

/**
 * A power-PLAN reading folded to the closed vocabulary. The raw GUID goes no
 * further than this function: null (the read failed, or this is not Windows)
 * answers '', a known GUID answers its name, and anything else answers 'other'
 * rather than the custom plan's machine-identifying GUID.
 */
function foldPowerPlanGuid(reading) {
  if (!reading || reading.absent === true || reading.type !== 'sz') return '';
  const guid = normalizeGuid(reading.value);
  if (!guid) return '';
  return POWER_PLAN_BY_GUID[guid] ?? 'other';
}

/**
 * A power-MODE overlay reading folded to the closed vocabulary. An ABSENT value
 * reads 'balanced', matching Power.ps1's treatment of the all-zero GUID: a
 * machine whose slider was never moved simply has no overlay value, and that is
 * the balanced overlay rather than an unknown one. A failed READ (null) still
 * answers '', because there the machine's state is genuinely unknown.
 */
function foldPowerModeGuid(reading) {
  if (!reading) return '';
  if (reading.absent === true) return 'balanced';
  if (reading.type !== 'sz') return '';
  const guid = normalizeGuid(reading.value);
  if (!guid) return 'balanced';
  return POWER_MODE_BY_GUID[guid] ?? 'other';
}

/**
 * Hardware-accelerated GPU scheduling, by the SAME rule as the host
 * diagnostic's Gpu.ps1: HwSchMode 2 is on, 1 is off, and every other reading
 * (absent, a foreign type, a failed read, off Windows) is null rather than a
 * guess.
 */
function foldHagsReading(reading) {
  if (!reading || reading.absent === true || reading.type !== 'dword') return null;
  if (reading.value === 2) return true;
  if (reading.value === 1) return false;
  return null;
}

/**
 * Windows Game Mode, by the SAME rule as Gpu.ps1: the value ABSENT is the
 * Windows default, which is ON, and so is an explicit 1; 0 is off. A failed
 * READ is null, because "we could not look" is not "it is on" (Gpu.ps1's catch
 * arm answers 'on' there; this layer keeps the two apart, which is the one
 * deliberate refinement of that rule).
 */
function foldGameModeReading(reading) {
  if (!reading) return null;
  if (reading.absent === true) return true;
  if (reading.type !== 'dword') return null;
  return reading.value !== 0;
}

// --- Rounding ----------------------------------------------------------------

/** The largest total we will report, in MB (4 TiB). */
const HOST_MEM_TOTAL_MAX_MB = 4_194_304;
/** Installed RAM, rounded to the nearest 256 MB: a fleet reads a memory CLASS. */
const HOST_MEM_TOTAL_STEP_MB = 256;
/** Free RAM moves constantly, so a finer 64 MB step is not a fingerprint. */
const HOST_MEM_FREE_STEP_MB = 64;
/** The largest app working set we will report, in MB (64 GiB): far above any
 *  real Electron process, far below the 4 TiB host ceiling, so one absurd
 *  anonymous value cannot skew a future aggregate over these columns. */
const APP_MEM_MAX_MB = 65_536;
/** App working sets round to 16 MB. They are OUR OWN memory use rather than a
 *  property of the machine, so the step is not a privacy floor; it is simply
 *  the reason these three stopped being the only unrounded, highest-entropy
 *  numbers in an otherwise coarsened row. A fleet reads them in hundreds of
 *  megabytes, so nothing an analyst asks of them survives at finer grain. */
const APP_MEM_STEP_MB = 16;

/** Kilobytes (what Electron's memory APIs speak) to megabytes, or null. */
function kbToMb(kilobytes) {
  if (typeof kilobytes !== 'number' || !Number.isFinite(kilobytes) || kilobytes < 0) return null;
  return kilobytes / 1024;
}

/** Round to the nearest `step` and clamp into 0..HOST_MEM_TOTAL_MAX_MB. */
function roundMb(megabytes, step) {
  if (megabytes === null) return null;
  const rounded = Math.round(megabytes / step) * step;
  return Math.min(HOST_MEM_TOTAL_MAX_MB, Math.max(0, rounded));
}

/** An app-process working set, rounded to APP_MEM_STEP_MB and clamped into
 *  0..APP_MEM_MAX_MB. */
function appMb(kilobytes) {
  const mb = kbToMb(kilobytes);
  if (mb === null) return null;
  const rounded = Math.round(mb / APP_MEM_STEP_MB) * APP_MEM_STEP_MB;
  return Math.min(APP_MEM_MAX_MB, Math.max(0, rounded));
}

// --- Electron readings -------------------------------------------------------

/** Read one API, answering null instead of throwing: one wedged getter must not
 *  cost the whole snapshot (the same helper host_diag.cjs keeps locally). */
function safeRead(read) {
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/**
 * app.getAppMetrics(), reduced to the three memory figures a perf report wants:
 * the app's TOTAL working set, its largest renderer ('Tab') and its GPU
 * process. Deliberately a small local reducer rather than a reuse of
 * host_diag.cjs reduceAppMetrics: that one builds a per-process LIST with peak
 * and CPU columns for a file a human reads, which is a different shape from
 * three scalars and would have to be re-reduced here anyway. CPU is not read at
 * all: percentCPUUsage is measured since the PREVIOUS call, so a periodic
 * snapshot would report whatever window happened to fall between two refreshes.
 */
function reduceAppMemory(metrics) {
  if (!Array.isArray(metrics)) {
    return { appWorkingSetMb: null, appRendererWsMb: null, appGpuWsMb: null };
  }
  let totalKb = null;
  let rendererKb = null;
  let gpuKb = null;
  for (const entry of metrics) {
    if (!entry || typeof entry !== 'object') continue;
    const workingSetKb = entry.memory?.workingSetSize;
    if (typeof workingSetKb !== 'number' || !Number.isFinite(workingSetKb) || workingSetKb < 0) {
      continue;
    }
    totalKb = (totalKb ?? 0) + workingSetKb;
    // The LARGEST tab, not the first: a session can hold several renderers
    // (a wallet handoff page, a devtools host), and the game is the big one.
    if (entry.type === 'Tab' && (rendererKb === null || workingSetKb > rendererKb)) {
      rendererKb = workingSetKb;
    }
    if (entry.type === 'GPU' && (gpuKb === null || workingSetKb > gpuKb)) gpuKb = workingSetKb;
  }
  return {
    appWorkingSetMb: appMb(totalKb),
    appRendererWsMb: appMb(rendererKb),
    appGpuWsMb: appMb(gpuKb),
  };
}

/**
 * The LIVE half: memory, this app's process metrics, and the battery state.
 * Cheap (no process spawn, no registry) and re-read on every snapshot. Every
 * getter is individually guarded, so a wedged or missing API yields null for
 * its own field and nothing else.
 */
function readLiveHostEssentials(deps = {}) {
  const proc = deps.process ?? process;
  const memoryInfo = safeRead(() => proc.getSystemMemoryInfo?.());
  const metrics = safeRead(() => deps.app?.getAppMetrics?.());
  const onBattery = safeRead(() => deps.powerMonitor?.isOnBatteryPower?.());
  return {
    hostMemTotalMb: roundMb(kbToMb(memoryInfo?.total), HOST_MEM_TOTAL_STEP_MB),
    hostMemFreeMb: roundMb(kbToMb(memoryInfo?.free), HOST_MEM_FREE_STEP_MB),
    ...reduceAppMemory(metrics),
    hostOnBattery: typeof onBattery === 'boolean' ? onBattery : null,
  };
}

/**
 * The STATIC half: the four registry reads, in PARALLEL (four short reg.exe
 * runs, each independently bounded and independently allowed to fail). Windows
 * only: every other platform answers the same "nothing to say" shape without
 * running anything, which is exactly what a macOS or Linux row should carry.
 *
 * WHICH overlay value is read depends on the CURRENT battery state, because
 * Windows stores the AC slider and the DC slider apart; `deps.onBattery` comes
 * from the live half so the two agree inside one snapshot.
 */
async function readStaticHostEssentials(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const none = { hostPowerPlan: '', hostPowerMode: '', hostHags: null, hostGameMode: null };
  if (platform !== 'win32') return none;
  const read = deps.queryRegValue ?? queryRegValue;
  const onBattery =
    typeof deps.onBattery === 'boolean'
      ? deps.onBattery
      : safeRead(() => deps.powerMonitor?.isOnBatteryPower?.()) === true;
  const overlayValueName = onBattery ? ACTIVE_OVERLAY_DC_VALUE : ACTIVE_OVERLAY_AC_VALUE;
  try {
    const [plan, mode, hags, gameMode] = await Promise.all([
      read({ key: POWER_SCHEMES_KEY, valueName: ACTIVE_POWER_SCHEME_VALUE }, deps),
      read({ key: POWER_SCHEMES_KEY, valueName: overlayValueName }, deps),
      read({ key: GRAPHICS_DRIVERS_KEY, valueName: HW_SCH_MODE_VALUE }, deps),
      read({ key: GAME_BAR_KEY, valueName: AUTO_GAME_MODE_VALUE }, deps),
    ]);
    return {
      hostPowerPlan: foldPowerPlanGuid(plan),
      hostPowerMode: foldPowerModeGuid(mode),
      hostHags: foldHagsReading(hags),
      hostGameMode: foldGameModeReading(gameMode),
    };
  } catch {
    // queryRegValue never rejects, so this is only reachable through an
    // injected seam; a failed collection is still just an absent dimension.
    return none;
  }
}

/**
 * The ONE cache here, and it is an anti-hammering guard rather than a
 * freshness policy: a snapshot younger than this is returned as-is, so a
 * misbehaving (or compromised) renderer cannot turn the IPC channel into a
 * reg.exe spawn loop. It is far shorter than the game probe's own 4-minute
 * refresh cadence, so an honest caller never sees a stale reading because of
 * it.
 */
const HOST_ESSENTIALS_MIN_INTERVAL_MS = 60_000;

/**
 * The snapshot source the IPC handler owns. NEVER invoked on the startup path:
 * the first call is the renderer's first request, minutes into a session, so
 * nothing here can cost a boot millisecond or delay the first frame.
 *
 * ONE snapshot is the live readings plus the four registry reads, taken
 * together, so the power-mode read always matches the battery state reported
 * beside it. Two guards sit in front of it: a snapshot younger than
 * HOST_ESSENTIALS_MIN_INTERVAL_MS is returned unchanged, and a request that
 * arrives while one is in flight awaits that SAME promise rather than starting
 * a second set of reg.exe processes.
 */
function createHostEssentials(deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const minIntervalMs = deps.minIntervalMs ?? HOST_ESSENTIALS_MIN_INTERVAL_MS;
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  async function collect() {
    const live = readLiveHostEssentials(deps);
    const statics = await readStaticHostEssentials({
      ...deps,
      onBattery: live.hostOnBattery === true,
    });
    return { ...live, ...statics };
  }

  return {
    async snapshot() {
      if (cached && now() - cachedAt < minIntervalMs) return cached;
      if (inFlight) return await inFlight;
      inFlight = collect()
        .then((value) => {
          cached = value;
          cachedAt = now();
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return await inFlight;
    },
  };
}

module.exports = {
  APP_MEM_MAX_MB,
  APP_MEM_STEP_MB,
  ACTIVE_OVERLAY_AC_VALUE,
  ACTIVE_OVERLAY_DC_VALUE,
  ACTIVE_POWER_SCHEME_VALUE,
  AUTO_GAME_MODE_VALUE,
  GAME_BAR_KEY,
  GRAPHICS_DRIVERS_KEY,
  HOST_ESSENTIALS_MIN_INTERVAL_MS,
  HOST_MEM_FREE_STEP_MB,
  HOST_MEM_TOTAL_MAX_MB,
  HOST_MEM_TOTAL_STEP_MB,
  HW_SCH_MODE_VALUE,
  POWER_MODES,
  POWER_MODE_BY_GUID,
  POWER_PLANS,
  POWER_PLAN_BY_GUID,
  POWER_SCHEMES_KEY,
  createHostEssentials,
  foldGameModeReading,
  foldHagsReading,
  foldPowerModeGuid,
  foldPowerPlanGuid,
  normalizeGuid,
  reduceAppMemory,
  readLiveHostEssentials,
  readStaticHostEssentials,
  roundMb,
};
