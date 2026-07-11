// Achieved sim tick rate (ticks per wall-clock second) for the world loop.
//
// The loop's cost instruments (tickMsAvg, TickProfiler) time the callback BODY,
// so when the event loop saturates and the dt clamp discards wall time they can
// look healthy while the wall-clock sim rate sags below TICK_RATE (the v0.22
// incident blind spot). This meter counts committed sim ticks against the wall
// clock over a short sliding window, so the reported rate reflects what players
// actually experience. Pure + host-agnostic like TickProfiler: the loop feeds
// it (nowMs, ticksRun) once per callback and the hot path allocates nothing.

/** hrtime nanoseconds to fractional milliseconds. Converting in bigint first
 *  keeps the value Float64-exact to the microsecond for ~285 years of uptime
 *  (Number(ns)/1e6 would lose integer precision after ~104 days). */
export function hrtimeToMs(ns: bigint): number {
  return Number(ns / 1000n) / 1000;
}

export class TickRateMeter {
  private readonly windowMs: number;
  private readonly minElapsedMs: number;
  private readonly capacity: number;
  // How far past the window edge the coverage anchor may reach (see rate()):
  // generous for timer jitter (5 nominal callbacks), tight enough that one
  // multi-second stall cannot drag the anchor and understate the CURRENT rate
  // for long after recovery.
  private readonly straddleCapMs = 250;
  private readonly times: Float64Array;
  private readonly counts: Float64Array;
  private head = 0;
  private count = 0;
  // Wall time measurement began. The first record() only anchors: its ticks
  // accrued before we started counting, so including them would overstate.
  private anchorMs: number | null = null;

  constructor(windowMs = 3000, minElapsedMs = 1000, capacity?: number) {
    this.windowMs = Math.max(1, windowMs);
    this.minElapsedMs = Math.max(1, minElapsedMs);
    // Nominal callbacks arrive every 50ms; 2x headroom means the ring normally
    // never wraps and the exact-coverage path below is the one that runs.
    this.capacity = Math.max(2, capacity ?? Math.ceil(this.windowMs / 25));
    this.times = new Float64Array(this.capacity);
    this.counts = new Float64Array(this.capacity);
  }

  /** One call per loop callback with the sim ticks it committed. */
  record(nowMs: number, ticks: number): void {
    if (!Number.isFinite(nowMs) || !Number.isFinite(ticks) || ticks < 0) return;
    if (this.anchorMs === null) {
      this.anchorMs = nowMs;
      return;
    }
    this.times[this.head] = nowMs;
    this.counts[this.head] = ticks;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Ticks per wall-clock second over the sliding window, or null while the
   *  meter is still warming up (nothing measured, or < minElapsedMs of data).
   *  nowMs is the current wall time (>= the newest record), as in the loop's
   *  record-then-rate call pattern; reading into the past is not supported. */
  rate(nowMs: number): number | null {
    if (this.anchorMs === null || !Number.isFinite(nowMs)) return null;
    if (nowMs - this.anchorMs < this.minElapsedMs) return null;
    const windowStart = nowMs - this.windowMs;
    let sum = 0;
    let scanned = 0;
    let boundaryMs = windowStart;
    let oldestT = nowMs;
    let oldestTicks = 0;
    for (; scanned < this.count; scanned++) {
      const idx = (this.head - 1 - scanned + this.capacity) % this.capacity;
      const t = this.times[idx];
      if (t <= windowStart) {
        boundaryMs = t;
        break;
      }
      sum += this.counts[idx];
      oldestT = t;
      oldestTicks = this.counts[idx];
    }
    let start: number;
    if (scanned < this.count) {
      // The first excluded entry marks exactly where the included batches'
      // accrual began, so anchor coverage there rather than at the window
      // edge: crediting a straddling batch's ticks against a flat windowMs
      // reads a healthy jittered loop as 20.1-20.7 Hz (upward-only bias that
      // also masks small sags). The cap bounds how far one pathologically
      // long straddle (a multi-second stall) can drag the anchor.
      start = Math.max(boundaryMs, windowStart - this.straddleCapMs);
    } else if (this.count < this.capacity) {
      // complete history since the anchor (nothing evicted yet)
      start = Math.max(this.anchorMs, windowStart);
    } else {
      // the ring wrapped, so coverage before the oldest stored entry is lost;
      // anchor the measurement at that entry and drop its (unattributable) ticks
      sum -= oldestTicks;
      start = oldestT;
    }
    const elapsed = nowMs - start;
    if (elapsed <= 0) return null;
    return (sum * 1000) / elapsed;
  }
}
