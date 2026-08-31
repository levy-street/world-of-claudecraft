// Rolling per-phase timing for the authoritative world loop.
//
// Pure + host-agnostic so a unit test can drive it directly: the loop feeds it
// millisecond durations per named phase and a fixed-size ring buffer per phase
// keeps the last `windowTicks` samples. Reads (percentiles/max) cost O(window)
// and the hot path (`add`/`commit`) allocates nothing, so leaving it always-on
// in the 20 Hz loop is cheap. This is the instrument that localizes a stutter
// to a phase (sim tick vs snapshot broadcast vs event routing).

export interface PhaseStats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface TickProfile {
  samples: number;
  windowTicks: number;
  phases: Record<string, PhaseStats>;
}

export interface TickProfilerSample {
  readonly slot: number;
  readonly id: number;
}

export function createTickSaveObserver(
  profiler: () => TickProfiler,
): (ms: number, sample: TickProfilerSample | undefined) => void {
  return (ms, sample) => {
    if (!sample) return;
    const target = profiler();
    target.addToSample(sample, 'saves', ms);
    target.addToSample(sample, 'total', ms);
  };
}

const EMPTY: PhaseStats = { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export class TickProfiler {
  readonly windowTicks: number;
  private readonly phaseNames: string[];
  private readonly rings = new Map<string, Float64Array>();
  private readonly sampleIds: Float64Array;
  private readonly cur = new Map<string, number>();
  private head = 0;
  private count = 0;
  private openSampleId = 1;

  // `total` and `ticksRun` are always tracked alongside the caller-named phases.
  constructor(phaseNames: readonly string[], windowTicks = 1200) {
    this.windowTicks = Math.max(1, Math.floor(windowTicks));
    this.phaseNames = [...phaseNames, 'total', 'ticksRun'];
    this.sampleIds = new Float64Array(this.windowTicks);
    for (const name of this.phaseNames) this.rings.set(name, new Float64Array(this.windowTicks));
  }

  // Accumulate a phase's duration (ms) within the tick currently assembling.
  // A phase may be added more than once per tick (e.g. several catch-up sim
  // ticks); the contributions sum.
  add(phase: string, ms: number): void {
    if (!this.rings.has(phase)) return; // unknown phase: ignore rather than grow unboundedly
    this.cur.set(phase, (this.cur.get(phase) ?? 0) + ms);
  }

  // Capture the sample currently assembling so work deferred to a microtask can
  // still be billed to the callback that enqueued it. The handle is intentionally
  // opaque to callers: addToSample validates it against the ring slot generation.
  currentSample(): TickProfilerSample {
    return { slot: this.head, id: this.openSampleId };
  }

  // Add to a captured sample, even after commit() has moved on. Returns false if
  // the sample has been reset or overwritten by the rolling window.
  addToSample(sample: TickProfilerSample, phase: string, ms: number): boolean {
    const ring = this.rings.get(phase);
    if (!ring) return false;
    if (sample.slot === this.head && sample.id === this.openSampleId) {
      this.cur.set(phase, (this.cur.get(phase) ?? 0) + ms);
      return true;
    }
    if (sample.slot < 0 || sample.slot >= this.windowTicks) return false;
    if (this.sampleIds[sample.slot] !== sample.id) return false;
    ring[sample.slot] += ms;
    return true;
  }

  // Drop every recorded sample and the in-progress scratch, starting a fresh
  // window. Used by an on-demand capture so the profile reflects only the ticks
  // inside the capture window, not whatever the always-on loop accumulated before.
  reset(): void {
    for (const ring of this.rings.values()) ring.fill(0);
    this.sampleIds.fill(0);
    this.head = 0;
    this.count = 0;
    this.openSampleId++;
    this.cur.clear();
  }

  /**
   * Close out the current sample: push each phase's accumulated ms into its ring,
   * record `totalMs` for the whole loop body, then reset the scratch state.
   *
   * `ticksRun` is the DIVISOR, and it is recorded because omitting it misleads.
   * A sample is one loop CALLBACK, not one sim tick, and `add` sums a phase over
   * every catch-up tick in that callback (see its note). So a phase's p99 is
   * routinely N times its p50 for no reason other than N ticks having run
   * together, and a reader with no divisor reads that as "this phase got slow".
   * That misreading is not hypothetical: it sent a production stall investigation
   * after the movement phase for a day. Percentiles of this series say how many
   * ticks the worst samples actually carried, which is the number that turns an
   * alarming p99 into an ordinary one (or confirms it is not).
   */
  commit(totalMs: number, ticksRun = 1): void {
    const slot = this.head;
    this.sampleIds[slot] = this.openSampleId;
    for (const name of this.phaseNames) {
      const ring = this.rings.get(name)!;
      ring[slot] =
        name === 'total' ? totalMs : name === 'ticksRun' ? ticksRun : (this.cur.get(name) ?? 0);
    }
    this.head = (this.head + 1) % this.windowTicks;
    this.count = Math.min(this.count + 1, this.windowTicks);
    this.openSampleId++;
    this.cur.clear();
  }

  private statsFor(name: string): PhaseStats {
    if (this.count === 0) return { ...EMPTY };
    const ring = this.rings.get(name);
    if (!ring) return { ...EMPTY };
    const values = Array.prototype.slice.call(ring, 0, this.count) as number[];
    let sum = 0;
    let max = 0;
    for (const v of values) {
      sum += v;
      if (v > max) max = v;
    }
    values.sort((a, b) => a - b);
    const at = (p: number) =>
      values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];
    return {
      mean: round2(sum / values.length),
      p50: round2(at(50)),
      p95: round2(at(95)),
      p99: round2(at(99)),
      max: round2(max),
    };
  }

  /**
   * Percentiles per phase. `only` narrows the readout to the named phases, and
   * that matters: statsFor copies a windowTicks-long ring into a JS array and
   * SORTS it, per phase, with no await to break it up. The /metrics collector
   * runs on every scrape and publishes a handful of phases, so computing all of
   * them (the detail phases are dozens, and empty unless a capture is running)
   * spends most of a contiguous block on results the caller discards.
   * An unknown name is skipped rather than reported as zero, so a caller cannot
   * mistake "not registered" for "never cost anything".
   */
  profile(only?: readonly string[]): TickProfile {
    const phases: Record<string, PhaseStats> = {};
    for (const name of only ?? this.phaseNames) {
      if (only && !this.rings.has(name)) continue;
      phases[name] = this.statsFor(name);
    }
    return { samples: this.count, windowTicks: this.windowTicks, phases };
  }

  /**
   * The exporter's readout: p95 + max per phase, in milliseconds, keyed by phase
   * name. Same `only` narrowing (and the same skip-not-zero rule) as `profile`.
   */
  phaseMillis(only?: readonly string[]): Record<string, { p95: number; max: number }> {
    const out: Record<string, { p95: number; max: number }> = {};
    for (const [name, stats] of Object.entries(this.profile(only).phases)) {
      out[name] = { p95: stats.p95, max: stats.max };
    }
    return out;
  }
}
