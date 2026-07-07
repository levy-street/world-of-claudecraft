import { describe, expect, it } from 'vitest';
import {
  GauntletTraceBatcher,
  shapeLocalFromFraction,
  TRACE_FLUSH_MS,
  TRACE_MAX_BATCH_POINTS,
  TRACE_SAMPLE_MS,
  traceBatchNumbers,
} from '../src/ui/gauntlet_trace_core';

// The sigils trial streams quantized shape-local points to the sim. These are
// the pure quantization + batch-capping helpers behind that stream (shared by
// the in-world slab input path); the pointer handling is exercised in the
// browser suite, but the math is unit-safe.

describe('shapeLocalFromFraction', () => {
  it('maps a centered surface fraction to the shape-local center', () => {
    expect(shapeLocalFromFraction(0.5)).toBeCloseTo(0.5, 6);
  });

  it('clamps the padded margins to the 0..1 unit-square rails', () => {
    // The drawable area is inset by the frame padding, so fractions inside the pad
    // clamp to the nearest edge rather than reading past the square.
    expect(shapeLocalFromFraction(0)).toBe(0);
    expect(shapeLocalFromFraction(1)).toBe(1);
    expect(shapeLocalFromFraction(-0.5)).toBe(0);
    expect(shapeLocalFromFraction(1.5)).toBe(1);
  });

  it('is monotonic across the drawable band', () => {
    expect(shapeLocalFromFraction(0.3)).toBeLessThan(shapeLocalFromFraction(0.7));
  });
});

describe('traceBatchNumbers', () => {
  it('flattens points into the [x0,y0,x1,y1,...] wire order', () => {
    const pts = [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ];
    expect(traceBatchNumbers(pts, 24)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('caps a batch at max points so it never exceeds the server 64-number ceiling', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i / 40, y: i / 40 }));
    const out = traceBatchNumbers(pts, 24);
    expect(out.length).toBe(48); // 24 points * 2 numbers
    expect(out.length).toBeLessThanOrEqual(64);
  });

  it('returns an empty batch for no points', () => {
    expect(traceBatchNumbers([], 24)).toEqual([]);
  });
});

describe('GauntletTraceBatcher', () => {
  it('throttles move samples to the sample cadence but never a stroke start', () => {
    const b = new GauntletTraceBatcher();
    b.sample(0.1, 0.1, 1000, false); // stroke start: always recorded
    b.sample(0.2, 0.2, 1000 + TRACE_SAMPLE_MS - 1, true); // too soon: dropped
    b.sample(0.3, 0.3, 1000 + TRACE_SAMPLE_MS, true); // on cadence: recorded
    expect(b.drain(true, 2000)).toEqual([0.1, 0.1, 0.3, 0.3]);
  });

  it('holds a small batch until the flush cadence elapses, then releases it', () => {
    const b = new GauntletTraceBatcher();
    b.sample(0.1, 0.1, 1000, false);
    // The first flush of a stroke is prompt (the cadence measures from the
    // LAST flush, and there is none yet), like the old trace window.
    expect(b.drain(false, 1000)).toEqual([0.1, 0.1]);
    b.sample(0.5, 0.5, 1040, true);
    expect(b.drain(false, 1000 + TRACE_FLUSH_MS - 1)).toEqual([]);
    expect(b.drain(false, 1000 + TRACE_FLUSH_MS)).toEqual([0.5, 0.5]);
    // Drained: nothing left even when forced.
    expect(b.drain(true, 5000)).toEqual([]);
  });

  it('releases a full batch immediately and caps it at the wire ceiling', () => {
    const b = new GauntletTraceBatcher();
    for (let i = 0; i < TRACE_MAX_BATCH_POINTS; i++)
      b.sample(i / 100, i / 100, 1000 + i * TRACE_SAMPLE_MS, i > 0);
    const out = b.drain(false, 1000 + TRACE_MAX_BATCH_POINTS * TRACE_SAMPLE_MS);
    expect(out.length).toBe(TRACE_MAX_BATCH_POINTS * 2);
    expect(out.length).toBeLessThanOrEqual(64);
  });

  it('force-drains the tail on stroke end and clears state on reset', () => {
    const b = new GauntletTraceBatcher();
    b.sample(0.4, 0.6, 1000, false);
    expect(b.drain(true, 1001)).toEqual([0.4, 0.6]);
    b.sample(0.7, 0.7, 1002, false);
    b.reset();
    expect(b.drain(true, 5000)).toEqual([]);
  });
});
