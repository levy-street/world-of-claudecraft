// Sugarglass Sigils trace pipeline core (pure, DOM-free). The player traces the
// etched outline on the in-world lectern slab; the SIM owns all scoring. This
// module holds the shape-local quantization and the sample/flush batcher that
// stream trace points to the wire, extracted from the old 2D trace window so
// the slab input path reuses the exact same math (and the same unit tests).
//
// Coordinates: the interaction surface is a square whose drawable etching is
// inset by the shared pad fraction on each side (the outline never touches the
// rim). shapeLocalFromFraction maps a 0..1 surface fraction into the shape's
// 0..1 unit square through that inset; the venue draws the outline through the
// SAME inset, so what the finger touches is what the sim grades.

import { GAUNTLET_VENUE } from '../sim/content/gauntlet';

// Trace sampling: ~30Hz point capture, flushed in <=24-point batches (48
// numbers, under the server's 64-number cap) at ~250ms. A pointer resting
// still adds nothing.
export const TRACE_SAMPLE_MS = 33;
export const TRACE_FLUSH_MS = 250;
export const TRACE_MAX_BATCH_POINTS = 24;

// The etching's inset within the interaction square (one source of truth in
// the venue data so the slab mesh draws the outline through the same inset).
const PAD_FRAC = GAUNTLET_VENUE.sigils.slab.padFrac;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Map a 0..1 surface fraction to a shape-local 0..1 coordinate (the drawable
 * area is inset by PAD_FRAC on each side). Pure so the quantization is
 * unit-testable. */
export function shapeLocalFromFraction(frac: number): number {
  const inner = 1 - 2 * PAD_FRAC;
  return clamp01(inner > 0 ? (frac - PAD_FRAC) / inner : 0);
}

/** Flatten up to `max` sampled points into the wire's [x0,y0,x1,y1,...] batch. The
 * cap keeps a batch at 2*max numbers, under the server's hard 64-number ceiling. */
export function traceBatchNumbers(
  points: readonly { x: number; y: number }[],
  max: number,
): number[] {
  const take = points.slice(0, max);
  const out: number[] = [];
  for (const p of take) out.push(p.x, p.y);
  return out;
}

// Shared empty drain result so the per-frame "nothing due" path allocates nothing.
const EMPTY: number[] = [];

/**
 * The sample/flush batcher behind the trace stream. Callers pass the clock in
 * (this module stays pure): sample() throttles move samples to ~30Hz, drain()
 * releases a wire batch on the flush cadence (or immediately when forced on
 * stroke end) and returns a shared empty array when nothing is due.
 */
export class GauntletTraceBatcher {
  private buffer: { x: number; y: number }[] = [];
  private lastSampleMs = 0;
  private lastFlushMs = 0;

  /** Record a shape-local point. Move samples throttle; a stroke start never does. */
  sample(x: number, y: number, nowMs: number, throttled: boolean): void {
    if (throttled && nowMs - this.lastSampleMs < TRACE_SAMPLE_MS) return;
    this.lastSampleMs = nowMs;
    this.buffer.push({ x, y });
  }

  /** Release the pending batch when due (flush cadence, a full batch, or force). */
  drain(force: boolean, nowMs: number): number[] {
    if (this.buffer.length === 0) return EMPTY;
    if (
      !force &&
      nowMs - this.lastFlushMs < TRACE_FLUSH_MS &&
      this.buffer.length < TRACE_MAX_BATCH_POINTS
    )
      return EMPTY;
    const pts = traceBatchNumbers(this.buffer, TRACE_MAX_BATCH_POINTS);
    this.buffer.length = 0;
    this.lastFlushMs = nowMs;
    return pts;
  }

  reset(): void {
    this.buffer.length = 0;
    this.lastSampleMs = 0;
    this.lastFlushMs = 0;
  }
}
