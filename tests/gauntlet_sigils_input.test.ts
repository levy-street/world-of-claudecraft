import { describe, expect, it } from 'vitest';
import { shapeLocalFromFraction, traceBatchNumbers } from '../src/ui/gauntlet_sigils_window';

// The sigils trace panel streams quantized shape-local points to the sim. These are
// the pure quantization + batch-capping helpers behind that stream; the panel's DOM
// and pointer handling are exercised in the browser suite, but the math is unit-safe.

describe('shapeLocalFromFraction', () => {
  it('maps a centered canvas fraction to the shape-local center', () => {
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
