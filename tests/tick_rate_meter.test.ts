import { describe, expect, it } from 'vitest';
import { hrtimeToMs, TickRateMeter } from '../server/tick_rate_meter';

// Drive the meter like the world loop does: one record(nowMs, ticksRun) per
// timer callback. The meter's job is the achieved sim ticks per wall-clock
// second, so every scenario here is expressed in wall time.

/** Feed one record every `stepMs` carrying `ticks`, starting after the anchor. */
function feed(m: TickRateMeter, fromMs: number, toMs: number, stepMs: number, ticks = 1): number {
  let t = fromMs;
  for (; t <= toMs; t += stepMs) m.record(t, ticks);
  return t - stepMs; // last recorded timestamp
}

describe('TickRateMeter', () => {
  it('returns null before any record and during the warm-up window', () => {
    const m = new TickRateMeter();
    expect(m.rate(0)).toBeNull();
    m.record(0, 1); // anchor only: its ticks accrued before measurement began
    expect(m.rate(0)).toBeNull();
    feed(m, 50, 900, 50);
    expect(m.rate(900)).toBeNull(); // < 1s measured
  });

  it('reports the nominal rate for a healthy 20 Hz loop', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    expect(m.rate(3000)).toBeCloseTo(20, 1);
  });

  it('reports an accurate rate as soon as the warm-up elapses', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 1000, 50);
    expect(m.rate(1000)).toBeCloseTo(20, 1);
  });

  it('sees through catch-up bursts (uneven ticks per callback, same rate)', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    // alternating starved/burst callbacks: 0,2,0,2,... every 50ms is still 20/s
    let ticks = 0;
    for (let t = 50; t <= 3000; t += 50) {
      m.record(t, ticks);
      ticks = ticks === 0 ? 2 : 0;
    }
    expect(m.rate(3000)).toBeCloseTo(20, 0);
  });

  it('reports the sagging rate when the clamp discards wall time (v0.22 shape)', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    // saturated loop: callbacks fire late (every 100ms) and only 1 tick lands
    feed(m, 100, 3000, 100);
    expect(m.rate(3000)).toBeCloseTo(10, 1);
  });

  it('slides the window: an old sag stops dragging the current rate down', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 100, 3000, 100); // 10 Hz for 3s
    feed(m, 3050, 6100, 50); // healthy 20 Hz for the next 3s
    expect(m.rate(6100)).toBeCloseTo(20, 1);
  });

  it('blends partial-window mixes instead of snapping', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50); // 20 Hz
    feed(m, 3100, 4500, 100); // 10 Hz for 1.5s
    const mixed = m.rate(4500);
    expect(mixed).not.toBeNull();
    expect(mixed!).toBeGreaterThan(10);
    expect(mixed!).toBeLessThan(20);
  });

  it('stays accurate when the ring overflows (coverage shrinks, rate does not skew)', () => {
    const m = new TickRateMeter(3000, 1000, 8); // tiny ring: 8 entries << 60/window
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    expect(m.rate(3000)).toBeCloseTo(20, 1);
  });

  it('does not flutter above the nominal rate under timer jitter', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    // deterministic jitter on the 50ms cadence; window-edge batch attribution
    // must not credit a straddling batch against a flat window (upward bias).
    // Read right after each record, exactly like the production loop.
    const jitter = [10, -10, 6, -6, 0];
    let i = 0;
    for (let t = 50; t <= 9000; t += 50) {
      const ts = t + jitter[i++ % jitter.length];
      m.record(ts, 1);
      if (ts < 4000) continue;
      const r = m.rate(ts);
      expect(r).not.toBeNull();
      expect(r!).toBeGreaterThan(19.5);
      expect(r!).toBeLessThanOrEqual(20.15);
    }
  });

  it('shows the sag right after a stall, then recovers within one window', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 1000, 50); // healthy
    m.record(8000, 10); // 7s stall, then one clamped catch-up burst
    feed(m, 8050, 9000, 50); // healthy again
    const justAfter = m.rate(9000);
    expect(justAfter).not.toBeNull();
    expect(justAfter!).toBeGreaterThan(5);
    expect(justAfter!).toBeLessThan(15);
    feed(m, 9050, 11500, 50);
    expect(m.rate(11500)).toBeCloseTo(20, 1);
  });

  it('ignores a non-finite timestamp instead of poisoning the window', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    m.record(Number.NaN, 1_000_000); // unguarded, NaN never falls out of the window scan
    expect(m.rate(3000)).toBeCloseTo(20, 1);
  });

  it('ignores negative tick counts', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    m.record(3010, -1000); // unguarded, this would crater the sum
    expect(m.rate(3010)).toBeCloseTo(20, 1);
  });

  it('ignores non-finite tick counts', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    m.record(3010, Number.POSITIVE_INFINITY); // unguarded, rate() would return Infinity
    expect(m.rate(3010)).toBeCloseTo(20, 1);
  });

  it('returns null rather than a junk rate for a non-finite read time', () => {
    const m = new TickRateMeter();
    m.record(0, 1);
    feed(m, 50, 3000, 50);
    expect(m.rate(Number.NaN)).toBeNull();
  });
});

describe('hrtimeToMs', () => {
  it('converts hrtime nanoseconds to fractional milliseconds', () => {
    expect(hrtimeToMs(0n)).toBe(0);
    expect(hrtimeToMs(1_500_000n)).toBe(1.5);
    expect(hrtimeToMs(50_000_000n)).toBe(50);
  });

  it('stays exact at uptimes where Number(ns)/1e6 would lose precision', () => {
    // 2^53 ns (~104 days) is where the naive Number(ns)/1e6 starts rounding
    const ns = 2n ** 53n + 1_500_000n; // 9_007_199_256_240_992 ns
    expect(hrtimeToMs(ns)).toBe(9_007_199_256.24);
    // a 50ms hrtime step must still convert to exactly 50ms at this uptime
    expect(hrtimeToMs(ns + 50_000_000n) - hrtimeToMs(ns)).toBeCloseTo(50, 6);
  });
});
