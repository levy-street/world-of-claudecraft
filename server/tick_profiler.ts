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

const EMPTY: PhaseStats = { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export class TickProfiler {
  readonly windowTicks: number;
  private readonly phaseNames: string[];
  private readonly rings = new Map<string, Float64Array>();
  private readonly cur = new Map<string, number>();
  private head = 0;
  private count = 0;

  // `total` is always tracked alongside the caller-named phases.
  constructor(phaseNames: readonly string[], windowTicks = 1200) {
    this.windowTicks = Math.max(1, Math.floor(windowTicks));
    this.phaseNames = [...phaseNames, 'total'];
    for (const name of this.phaseNames) this.rings.set(name, new Float64Array(this.windowTicks));
  }

  // Accumulate a phase's duration (ms) within the tick currently assembling.
  // A phase may be added more than once per tick (e.g. several catch-up sim
  // ticks); the contributions sum.
  add(phase: string, ms: number): void {
    if (!this.rings.has(phase)) return; // unknown phase: ignore rather than grow unboundedly
    this.cur.set(phase, (this.cur.get(phase) ?? 0) + ms);
  }

  // Drop every recorded sample and the in-progress scratch, starting a fresh
  // window. Used by an on-demand capture so the profile reflects only the ticks
  // inside the capture window, not whatever the always-on loop accumulated before.
  reset(): void {
    for (const ring of this.rings.values()) ring.fill(0);
    this.head = 0;
    this.count = 0;
    this.cur.clear();
  }

  // Close out the current tick: push each phase's accumulated ms into its ring,
  // recording `totalMs` for the whole loop body, then reset the scratch state.
  commit(totalMs: number): void {
    for (const name of this.phaseNames) {
      const ring = this.rings.get(name)!;
      ring[this.head] = name === 'total' ? totalMs : (this.cur.get(name) ?? 0);
    }
    this.head = (this.head + 1) % this.windowTicks;
    this.count = Math.min(this.count + 1, this.windowTicks);
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

  profile(): TickProfile {
    const phases: Record<string, PhaseStats> = {};
    for (const name of this.phaseNames) phases[name] = this.statsFor(name);
    return { samples: this.count, windowTicks: this.windowTicks, phases };
  }
}
