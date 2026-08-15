import { describe, expect, it } from 'vitest';
import { clamp01 } from '../src/ui/clamp';

describe('clamp01', () => {
  it('clamps values below 0 up to 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.0001)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });

  it('clamps values above 1 down to 1', () => {
    expect(clamp01(1.0001)).toBe(1);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Infinity)).toBe(1);
  });

  it('passes mid-range values through unchanged', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(0.123)).toBe(0.123);
  });

  it('matches the original Math.max(0, Math.min(1, v)) NaN passthrough', () => {
    // Math.min/Math.max both propagate NaN, so the original inline helper
    // returned NaN for a NaN input rather than clamping it; the shared
    // helper must preserve that behavior exactly, not silently start
    // coercing NaN to 0 or 1.
    expect(clamp01(NaN)).toBeNaN();
  });
});
