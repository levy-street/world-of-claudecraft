// The shader warm worker's scheduler: which request to submit next, and how
// many links to keep in flight. Host-agnostic (RENDER_PURE_CORES): no GL, no
// worker globals, an injected clock; the worker (shader_warm_worker.ts)
// drives it from its tick and reports settles back.
//
// Admission is the boot lane's AIMD budget (adaptive_link_budget_core.ts),
// one link per unit: the window grows on fast settles and halves on slow
// ones, so the worker keeps a couple of links in flight on a driver that
// serializes them (the POC's N=2 kept the main thread near 60 fps on Linux
// GL) and more where they overlap. What "fast" and "slow" mean is the
// relative judge's (shader_warm_settle_judge_core.ts): a settle is read
// against what THIS driver costs for a link it has to itself, per thousand
// characters of GLSL, never against a millisecond bound. The absolute
// bounds this config used to carry (150 and 400 ms, read off other
// machines: a cold `physical` links in 11 ms on Apple Metal, 120 ms on
// Linux NVIDIA GL, 225 to 740 ms on Windows D3D11) pinned the D3D11 window
// at one link for the whole session, on the one backend that overlaps
// links (measured 2026-08-30, RTX 3060, Chrome 152).
//
// Order within the window: the highest priority first (the queue's
// GPU_WORK_PRIORITY classes), then arrival order.

import {
  type AdaptiveLinkBudget,
  type AdaptiveLinkBudgetClock,
  type AdaptiveLinkBudgetConfig,
  type AdaptiveLinkBudgetSnapshot,
  createAdaptiveLinkBudget,
} from './adaptive_link_budget_core';
import type { ShaderWarmSource, ShaderWarmStatsMessage } from './shader_warm_protocol';
import {
  createRelativeSettleJudge,
  type RelativeSettleJudge,
  type RelativeSettleJudgeSnapshot,
} from './shader_warm_settle_judge_core';

/** The unit the judge prices a link in: thousands of GLSL characters, the
 *  vertex and fragment text together. Link time follows it within a size
 *  class (the judge compares like with like; 8 to 10 ms per thousand on
 *  D3D11 across 2.4k to 15.6k characters, 2026-08-30). */
export const SHADER_WARM_WEIGHT_CHARS = 1_000;

export function shaderWarmWeightOf(vertex: string, fragment: string): number {
  return (vertex.length + fragment.length) / SHADER_WARM_WEIGHT_CHARS;
}

/** The scheduler request a warm message's source becomes: its id and
 *  priority, priced by its text. */
export function warmRequestOf(
  source: Pick<ShaderWarmSource, 'id' | 'priority' | 'vertex' | 'fragment'>,
): WarmSchedulerRequest {
  return {
    id: source.id,
    priority: source.priority,
    weight: shaderWarmWeightOf(source.vertex, source.fragment),
  };
}

/** The stats message the worker posts: the scheduler's readout plus the
 *  host's own counts. The judge's etalon rides it so a capture can say what
 *  a link costs on this machine. */
export function warmStatsOf(
  snapshot: WarmSchedulerSnapshot,
  host: { inFlight: number; warmed: number; failed: number; retained: number },
): ShaderWarmStatsMessage {
  return {
    kind: 'stats',
    pending: snapshot.pending,
    inFlight: host.inFlight,
    windowLinks: snapshot.budget.windowLinks,
    state: snapshot.budget.state,
    warmed: host.warmed,
    failed: host.failed,
    retained: host.retained,
    cancelled: snapshot.cancelled,
    backoffCount: snapshot.budget.backoffCount,
    maxWindowObserved: snapshot.budget.maxWindowObserved,
    etalonMsPerKchar: snapshot.judge.etalonMsPerWeight,
    soloSamples: snapshot.judge.soloSamples,
  };
}

/** The window starts at ONE link: the judge's etalon is the cost of a link
 *  the driver has to itself, and the first link is the only one sure to be
 *  alone. No absolute settle bounds: the judge reads every settle. */
export const SHADER_WARM_WINDOW_CONFIG: AdaptiveLinkBudgetConfig = {
  initialWindowLinks: 1,
  minWindowLinks: 1,
  maxWindowLinks: 4,
  initialLinkEstimate: 1,
  increaseLinks: 1,
  noProgressMs: 4_000,
  maxSleepMs: 16,
};

/** The window cap per platform class: a phone's GPU is shared with the
 *  compositor and its driver compiles the slowest, so it never holds more
 *  than two links in flight. */
export const SHADER_WARM_MAX_WINDOW_DESKTOP = 4;
export const SHADER_WARM_MAX_WINDOW_MOBILE = 2;

/** Programs the worker keeps alive after their resolve, per platform class:
 *  none. Measured on 2026-08-28 (tmp/hitch-inventory/rig/eviction_poc.mjs,
 *  Intel Mesa and NVIDIA 3090, every cache the flags can disable disabled):
 *  a program the worker deleted right after its resolve, and one whose
 *  worker context was lost, link on the main context as fast as one the
 *  worker kept (10 ms against 283 ms cold on the iGPU, 6 against 140 on the
 *  3090). The hit lives in the driver's in-memory cache, keyed on the
 *  source, not in the program object. Keeping programs would only hold GPU
 *  memory in a second context. The cap stays a knob (the init message) for a
 *  platform that proves otherwise (the shareable test asks the testers). */
export const SHADER_WARM_RETAINED_DESKTOP = 0;
export const SHADER_WARM_RETAINED_MOBILE = 0;

/** A link in flight past this is failed and dropped: the driver never
 *  flipped its completion, or a throttled worker timer stopped polling it.
 *  The AIMD's own no-progress bound, so one wedged link cannot close
 *  admission for good. */
export const SHADER_WARM_LINK_DEADLINE_MS = SHADER_WARM_WINDOW_CONFIG.noProgressMs;

export interface WarmSchedulerRequest {
  id: number;
  priority: number;
  /** `shaderWarmWeightOf` the sources; 1 when the caller did not say. */
  weight?: number;
}

export interface WarmSchedulerSnapshot {
  pending: number;
  inFlight: number;
  paused: boolean;
  submitted: number;
  settled: number;
  failed: number;
  cancelled: number;
  budget: AdaptiveLinkBudgetSnapshot;
  judge: RelativeSettleJudgeSnapshot;
}

export interface WarmScheduler {
  enqueue(request: WarmSchedulerRequest): void;
  /** Drops a request that has not been submitted yet; an in-flight one runs
   *  to its settle (a driver link is not cancellable). Returns the ids that
   *  were still pending. */
  cancel(ids: readonly number[]): number[];
  pause(): void;
  resume(): void;
  paused(): boolean;
  /** The next request to submit, when the window and the pause allow one;
   *  null otherwise. Taking it marks it submitted. */
  takeNext(): WarmSchedulerRequest | null;
  markSettled(id: number): void;
  markFailed(id: number): void;
  pendingCount(): number;
  inFlightCount(): number;
  /** Anything left to do: a pending request or a link in flight. */
  active(): boolean;
  snapshot(): WarmSchedulerSnapshot;
}

export function createWarmScheduler(
  clock: AdaptiveLinkBudgetClock,
  maxWindow: number = SHADER_WARM_MAX_WINDOW_DESKTOP,
  config: AdaptiveLinkBudgetConfig = SHADER_WARM_WINDOW_CONFIG,
): WarmScheduler {
  const judge: RelativeSettleJudge = createRelativeSettleJudge();
  const budget: AdaptiveLinkBudget = createAdaptiveLinkBudget(
    {
      ...config,
      maxWindowLinks: Math.max(config.minWindowLinks, Math.min(config.maxWindowLinks, maxWindow)),
      judgeSettlement: judge.judge,
    },
    clock,
  );
  const pending: WarmSchedulerRequest[] = [];
  const inFlight = new Set<number>();
  let paused = false;
  let submitted = 0;
  let settled = 0;
  let failed = 0;
  let cancelled = 0;
  const key = (id: number): string => String(id);
  const insert = (request: WarmSchedulerRequest): void => {
    // Stable by priority: a new request goes after every pending one of the
    // same or higher priority.
    let at = pending.length;
    while (at > 0 && (pending[at - 1]?.priority ?? 0) < request.priority) at--;
    pending.splice(at, 0, request);
  };
  return {
    enqueue(request) {
      if (inFlight.has(request.id) || pending.some((item) => item.id === request.id)) return;
      insert(request);
    },
    cancel(ids) {
      const dropped: number[] = [];
      for (const id of ids) {
        const at = pending.findIndex((item) => item.id === id);
        if (at < 0) continue;
        pending.splice(at, 1);
        dropped.push(id);
        cancelled++;
      }
      return dropped;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    paused: () => paused,
    takeNext() {
      if (paused || pending.length === 0 || !budget.canSubmit()) return null;
      const request = pending.shift();
      if (!request) return null;
      inFlight.add(request.id);
      budget.markSubmitted(key(request.id), request.weight);
      // One link per unit, charged as such: the AIMD prices the window in links.
      budget.markSyncEnd(key(request.id), 1);
      submitted++;
      return request;
    },
    markSettled(id) {
      if (!inFlight.delete(id)) return;
      settled++;
      budget.markSettled(key(id));
    },
    markFailed(id) {
      if (!inFlight.delete(id)) return;
      failed++;
      budget.markFailed(key(id));
    },
    pendingCount: () => pending.length,
    inFlightCount: () => inFlight.size,
    active: () => pending.length > 0 || inFlight.size > 0,
    snapshot() {
      return {
        pending: pending.length,
        inFlight: inFlight.size,
        paused,
        submitted,
        settled,
        failed,
        cancelled,
        budget: budget.snapshot(),
        judge: judge.snapshot(),
      };
    },
  };
}
