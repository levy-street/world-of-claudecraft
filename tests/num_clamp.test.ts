import { describe, expect, it } from 'vitest';
import { clamp01 } from '../src/render/num_clamp';

describe('clamp01', () => {
  it('passes values already inside [0, 1] through unchanged', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(0.0001)).toBeCloseTo(0.0001);
  });

  it('clamps values below 0 to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(-1000)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(1000)).toBe(1);
    expect(clamp01(Infinity)).toBe(1);
  });

  it('is deterministic: the same input always yields the same output', () => {
    const inputs = [-3, -0.001, 0, 0.25, 0.999, 1, 4.2];
    const first = inputs.map(clamp01);
    const second = inputs.map(clamp01);
    expect(second).toEqual(first);
  });
});
