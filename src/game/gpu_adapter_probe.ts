// One-time WebGPU probe for the adapter the browser hands a page that ASKS for
// the discrete GPU. Read beside the WebGL renderer string in a perf report, it
// answers the question that string alone cannot: whether a hybrid laptop is
// rendering the game on its integrated part while a discrete GPU sits idle.
//
// Nothing here touches the renderer, WebGL, or the sim, and nothing here is on
// the boot-critical path: start() returns synchronously, the caller never
// awaits it, and a report sent before the probe settles simply carries null.
// WebGPU is absent, blocked, or broken on a large slice of the fleet, so every
// arm is defensive by design: no navigator.gpu, a null adapter, an insecure
// context, a driver that throws, and a promise that never settles all resolve
// to null, and nothing is EVER logged (a diagnostic that spams a player's
// console is worse than the missing dimension).

/** Wire and column bound, matching the server's textIn clamp for this field. */
export const GPU_ADAPTER_DESCRIPTION_MAX = 160;
/**
 * A hanging requestAdapter is a real failure mode (a wedged or resetting
 * driver), and this probe must never keep a pending promise alive for the
 * session. Generous next to the work, short next to the first report at 75s.
 */
export const GPU_ADAPTER_PROBE_TIMEOUT_MS = 2000;

// Structural stand-ins for the WebGPU types, declared locally so this module
// needs no lib.dom WebGPU typings and so a test can hand it a fake.
export interface GpuAdapterInfoLike {
  description?: unknown;
  vendor?: unknown;
  architecture?: unknown;
  device?: unknown;
}

export interface GpuAdapterLike {
  info?: GpuAdapterInfoLike;
  requestAdapterInfo?: () => unknown;
}

export interface GpuLike {
  requestAdapter?: (options?: { powerPreference?: string }) => unknown;
}

export interface GpuAdapterProbeDeps {
  /** Explicit null means "no WebGPU"; absent means read navigator.gpu. */
  gpu?: GpuLike | null;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface GpuAdapterProbe {
  /** Fire and forget. Returns immediately; never throws, never awaits. */
  start(): void;
  /** The description, or null until (and unless) the probe settles with one. */
  value(): string | null;
}

/**
 * The adapter's own words, clamped.
 *
 * `description` is the one human-readable field, but Chrome leaves it empty on
 * some platforms, so the vendor/architecture/device triple is the fallback:
 * "nvidia ampere" still identifies the part well enough for the server's
 * bucketing, where an empty string would identify nothing.
 */
export function describeGpuAdapterInfo(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const record = info as GpuAdapterInfoLike;
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const joined = [record.vendor, record.architecture, record.device]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(' ');
  const text = description || joined;
  return text ? text.slice(0, GPU_ADAPTER_DESCRIPTION_MAX) : null;
}

function navigatorGpu(): GpuLike | null {
  try {
    return (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu ?? null;
  } catch {
    // Reading navigator.gpu can itself throw behind a hardened or shimmed
    // navigator; there is no diagnostic worth a console line here.
    return null;
  }
}

/**
 * Resolve the high-performance adapter's description, or null.
 *
 * Never rejects and never logs: every failure mode is the same answer, an
 * absent dimension, and a report is worth more than a diagnostic about why one
 * field of it is empty.
 */
export async function probeGpuHighPerformanceAdapter(
  deps: GpuAdapterProbeDeps = {},
): Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? GPU_ADAPTER_PROBE_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let timerSet = false;
  try {
    const gpu = deps.gpu !== undefined ? deps.gpu : navigatorGpu();
    const requestAdapter = gpu?.requestAdapter;
    if (!gpu || typeof requestAdapter !== 'function') return null;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimer(() => resolve(null), timeoutMs);
      timerSet = true;
    });
    // The whole chain is one already-caught promise, so a synchronous throw
    // from requestAdapter, a rejection, and a throwing adapter.info getter all
    // land on the same null.
    const described = (async () => {
      const adapter = (await requestAdapter.call(gpu, { powerPreference: 'high-performance' })) as
        | GpuAdapterLike
        | null
        | undefined;
      if (!adapter) return null;
      // adapter.info is the current shape; requestAdapterInfo() is the older
      // one still shipping in browsers this probe must not throw on.
      const info =
        adapter.info ??
        (typeof adapter.requestAdapterInfo === 'function'
          ? await adapter.requestAdapterInfo()
          : null);
      return describeGpuAdapterInfo(info);
    })().catch(() => null);
    return await Promise.race([described, timedOut]);
  } catch {
    return null;
  } finally {
    // Always cleared, including on the arm the probe won: a 2s timer left
    // pending would hold the callback (and, under a fake clock, the test).
    if (timerSet) clearTimer(timer);
  }
}

/**
 * The one-shot probe the perf reporter owns: started once at reporter start
 * (which is itself post-entry), read by every beacon built afterwards.
 */
export function createGpuAdapterProbe(deps: GpuAdapterProbeDeps = {}): GpuAdapterProbe {
  let started = false;
  let description: string | null = null;
  return {
    start(): void {
      if (started) return;
      started = true;
      try {
        void probeGpuHighPerformanceAdapter(deps).then(
          (value) => {
            description = value;
          },
          () => {},
        );
      } catch {
        // probeGpuHighPerformanceAdapter cannot throw synchronously, but this
        // is the boot path: the caller gets a no-op either way.
      }
    },
    value: () => description,
  };
}
