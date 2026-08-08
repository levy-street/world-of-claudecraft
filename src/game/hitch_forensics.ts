// Hitch forensics: a rolling snapshot-diff that gives a production hitch its
// own embedded diagnosis. The perf monitor feeds a compact state vector at its
// 1 Hz tick; this core advances a baseline every sampleEveryMs and, when the
// worst frame inside the closed interval crossed the hitch threshold, stores
// ONLY the fields that changed between the two bracketing snapshots. A crowd
// storm reads as { views: 30 -> 71, programs: +12 }, a GC stall as an empty
// diff with a heap drop, a streaming stall as gpuQueue sync time jumping: the
// diagnosis rides the ?perf report (and later the fleet telemetry) instead of
// needing a reproduction. Deliberately clock-agnostic and allocation-light:
// the caller passes `now`, and between boundaries samples are absorbed into a
// running worst-frame with no state copies.

export type HitchForensicsState = Record<string, number | string>;

export interface HitchForensicsRecord {
  /** Sample time that closed the interval. */
  atMs: number;
  /** Worst frame gap observed anywhere inside the interval. */
  worstFrameMs: number;
  /** Distance between the two bracketing snapshots. */
  intervalMs: number;
  /** Changed fields only; empty means the stall came from outside the vector. */
  diff: Record<string, { from: number | string; to: number | string }>;
}

const DEFAULT_HITCH_FRAME_MS = 150;
const DEFAULT_SAMPLE_EVERY_MS = 5000;
const DEFAULT_LIMIT = 12;

export interface HitchForensics {
  /** Feed one caller tick: absorbs until the interval closes. */
  sample(now: number, worstFrameMs: number, state: HitchForensicsState): void;
  records(): HitchForensicsRecord[];
  reset(): void;
}

export function createHitchForensics(opts?: {
  hitchFrameMs?: number;
  sampleEveryMs?: number;
  limit?: number;
}): HitchForensics {
  const hitchFrameMs = opts?.hitchFrameMs ?? DEFAULT_HITCH_FRAME_MS;
  const sampleEveryMs = opts?.sampleEveryMs ?? DEFAULT_SAMPLE_EVERY_MS;
  const limit = Math.max(1, opts?.limit ?? DEFAULT_LIMIT);
  const ring: HitchForensicsRecord[] = [];
  let baseline: HitchForensicsState | null = null;
  let baselineAt = 0;
  let intervalWorstMs = 0;

  const diffStates = (
    from: HitchForensicsState,
    to: HitchForensicsState,
  ): HitchForensicsRecord['diff'] => {
    const diff: HitchForensicsRecord['diff'] = {};
    for (const key of Object.keys(to)) {
      if (from[key] !== to[key] && from[key] !== undefined) {
        diff[key] = { from: from[key], to: to[key] };
      }
    }
    return diff;
  };

  return {
    sample(now, worstFrameMs, state): void {
      if (!baseline) {
        baseline = { ...state };
        baselineAt = now;
        intervalWorstMs = 0;
        return;
      }
      if (Number.isFinite(worstFrameMs) && worstFrameMs > intervalWorstMs) {
        intervalWorstMs = worstFrameMs;
      }
      if (now - baselineAt < sampleEveryMs) return;
      if (intervalWorstMs >= hitchFrameMs) {
        ring.push({
          atMs: now,
          worstFrameMs: intervalWorstMs,
          intervalMs: now - baselineAt,
          diff: diffStates(baseline, state),
        });
        if (ring.length > limit) ring.splice(0, ring.length - limit);
      }
      baseline = { ...state };
      baselineAt = now;
      intervalWorstMs = 0;
    },
    records(): HitchForensicsRecord[] {
      return ring.map((record) => ({ ...record, diff: { ...record.diff } }));
    },
    reset(): void {
      ring.length = 0;
      baseline = null;
      baselineAt = 0;
      intervalWorstMs = 0;
    },
  };
}
