// The desktop shell's "host essentials" probe: a small, periodically refreshed
// cache of host facts the BROWSER SANDBOX CANNOT SEE (physical memory, this
// app's own working sets, the battery state, and the Windows power plan, power
// mode, GPU-scheduling and Game Mode settings), read over the shell bridge and
// attached to every automatic perf report as top-level scalars.
//
// Modelled on src/game/gpu_adapter_probe.ts: start() returns synchronously, the
// caller never awaits it, nothing here touches the renderer or the sim, and
// value() is a SYNCHRONOUS read of the last settled answer. A report built
// before the first fetch settles, or on web and mobile where there is no
// bridge at all, simply carries null and the payload omits the fields.
//
// Everything the bridge returns is re-validated here. The shell already folds
// the two power settings to closed vocabularies and rounds the memory figures,
// but this module is what stands between a buggy (or tampered) shell and the
// perf-report payload: unknown keys are never copied through, numbers must be
// finite and non-negative, enums must be inside the vocabulary, and booleans
// must be strictly boolean. The result is that a compromised shell can suppress
// these dimensions but cannot inject arbitrary ones.

import { type DesktopHostEssentials, desktopBridge } from '../runtime';

/** The closed power-PLAN vocabulary, kept equal to the shell's
 *  (electron/host_essentials.cjs POWER_PLANS) and the server's
 *  (server/perf_report_host.ts) by tests/host_essentials_vocabulary_parity.test.ts. */
export const HOST_POWER_PLANS = [
  '',
  'balanced',
  'high_performance',
  'power_saver',
  'ultimate',
  'other',
] as const;

/** The closed power-MODE vocabulary (the Windows 10/11 slider overlay). */
export const HOST_POWER_MODES = [
  '',
  'best_efficiency',
  'balanced',
  'better_performance',
  'best_performance',
  'other',
] as const;

/** Upper bound on the two HOST memory fields: 4 TiB, the shell's own clamp. */
export const HOST_MEM_MAX_MB = 4_194_304;

/** The tighter upper bound on the three APP working-set fields: 64 GiB. They
 *  measure this app's own processes, not the machine, so they get a ceiling a
 *  real reading can never approach; the server applies the same pair of
 *  ceilings on ingest and
 *  tests/host_essentials_vocabulary_parity.test.ts pins the two equal. */
export const APP_MEM_MAX_MB = 65_536;

/**
 * How often the probe re-reads the shell. Deliberately SHORTER than the perf
 * reporter's 5-minute repeat cadence, so every beacon after the first sees a
 * reading taken within its own interval rather than one from two intervals ago
 * (the battery state and the power mode both change during a session).
 */
export const HOST_ESSENTIALS_REFRESH_MS = 4 * 60_000;
/**
 * How long after start() the FIRST fetch happens. Not zero on purpose:
 * startPerfReporter runs just after world entry, which is still a busy stretch
 * of frames, and nothing here is urgent (the first beacon is 75 s out).
 */
export const HOST_ESSENTIALS_FIRST_DELAY_MS = 8_000;

export type HostEssentials = DesktopHostEssentials;

type TimerHandle = ReturnType<typeof setTimeout>;

/** The one bridge method this module needs, structurally: a test hands a fake,
 *  and the real `DesktopBridge` satisfies it. */
export interface HostEssentialsBridgeLike {
  getHostEssentials?: () => Promise<unknown>;
}

export interface HostEssentialsProbeDeps {
  /** Explicit null means "no shell bridge"; absent means read the real one. */
  bridge?: HostEssentialsBridgeLike | null;
  /** The bridge method itself, for tests. Absent means read it off the bridge. */
  getHostEssentials?: () => Promise<unknown>;
  firstDelayMs?: number;
  refreshMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface HostEssentialsProbe {
  /** Fire and forget. Returns immediately; never throws, never awaits. */
  start(): void;
  /** Stop refreshing. Idempotent; the last cached value stays readable. */
  stop(): void;
  /** The last settled reading, or null until (and unless) one settles. */
  value(): HostEssentials | null;
}

function finiteMb(value: unknown, maxMb: number = HOST_MEM_MAX_MB): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(maxMb, Math.round(value));
}

function strictBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function choice<T extends string>(value: unknown, vocabulary: readonly T[]): T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : ('' as T);
}

/**
 * Narrow whatever the bridge answered into the exact ten fields, or null when
 * it answered nothing object-shaped. Key by key, never a spread: an extra key
 * from a future (or tampered) shell must not reach the perf payload, where it
 * would be posted verbatim to an endpoint that accepts anonymous reports.
 */
export function narrowHostEssentials(raw: unknown): HostEssentials | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    hostMemTotalMb: finiteMb(record.hostMemTotalMb),
    hostMemFreeMb: finiteMb(record.hostMemFreeMb),
    appWorkingSetMb: finiteMb(record.appWorkingSetMb, APP_MEM_MAX_MB),
    appRendererWsMb: finiteMb(record.appRendererWsMb, APP_MEM_MAX_MB),
    appGpuWsMb: finiteMb(record.appGpuWsMb, APP_MEM_MAX_MB),
    hostOnBattery: strictBoolean(record.hostOnBattery),
    hostPowerPlan: choice(record.hostPowerPlan, HOST_POWER_PLANS),
    hostPowerMode: choice(record.hostPowerMode, HOST_POWER_MODES),
    hostHags: strictBoolean(record.hostHags),
    hostGameMode: strictBoolean(record.hostGameMode),
  };
}

/**
 * The fields a perf-report payload spreads in, as top-level scalars. A null
 * probe value, and every individually absent field, is OMITTED rather than sent
 * as null, so a web payload stays byte-identical to what it was before this
 * dimension existed and the server can ignore the whole block for a non-shell
 * report.
 */
export function hostEssentialsPayloadFields(
  essentials: HostEssentials | null,
): Record<string, string | number | boolean> {
  if (!essentials) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(essentials)) {
    if (value === null || value === undefined) continue;
    out[key] = value as string | number | boolean;
  }
  return out;
}

/**
 * The probe the perf reporter owns: started once at reporter start (which is
 * itself post-entry), stopped in its teardown, read synchronously by every
 * beacon built in between.
 */
export function createHostEssentialsProbe(deps: HostEssentialsProbeDeps = {}): HostEssentialsProbe {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as TimerHandle));
  const firstDelayMs = deps.firstDelayMs ?? HOST_ESSENTIALS_FIRST_DELAY_MS;
  const refreshMs = deps.refreshMs ?? HOST_ESSENTIALS_REFRESH_MS;

  let started = false;
  let stopped = false;
  let timer: unknown = null;
  let cached: HostEssentials | null = null;

  function resolveGetter(): (() => Promise<unknown>) | null {
    if (deps.getHostEssentials) return deps.getHostEssentials;
    try {
      const bridge: HostEssentialsBridgeLike | null =
        deps.bridge !== undefined ? deps.bridge : desktopBridge();
      const method = bridge?.getHostEssentials;
      // Bound to the bridge: the preload object's methods are plain closures
      // today, but an unbound call is the kind of thing that breaks silently.
      return typeof method === 'function'
        ? () => method.call(bridge as object) as Promise<unknown>
        : null;
    } catch {
      return null;
    }
  }

  function schedule(delay: number): void {
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      refresh();
    }, delay);
  }

  function refresh(): void {
    if (stopped) return;
    const getter = resolveGetter();
    if (!getter) {
      // No bridge, or a shell older than this channel: nothing will ever
      // change that within a session, so stop asking rather than spin a timer.
      return;
    }
    try {
      void Promise.resolve(getter()).then(
        (raw) => {
          if (stopped) return;
          const narrowed = narrowHostEssentials(raw);
          // A failed collection answers null; the PREVIOUS reading is kept
          // rather than dropped, because a stale power mode is better evidence
          // than none and the memory figures are rounded anyway.
          if (narrowed) cached = narrowed;
        },
        () => {},
      );
    } catch {
      // A bridge that throws synchronously is the same absent dimension.
    }
    schedule(refreshMs);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      schedule(firstDelayMs);
    },
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
    value: () => cached,
  };
}
