import { describe, expect, it } from 'vitest';
import { HOARD_TIDE_MASTERS, renderHoardTideSamples } from '../scripts/sfx/hoard_tide_samples.mjs';

describe('Original tide sample authoring', () => {
  it('produces deterministic non-silent bounded samples for each distinct phase', () => {
    for (const master of HOARD_TIDE_MASTERS) {
      const first = renderHoardTideSamples(master.key, master.duration, 4000);
      expect(first).toEqual(renderHoardTideSamples(master.key, master.duration, 4000));
      expect(first.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.7)).toBe(true);
      expect(first.some((value) => Math.abs(value) > 0.08)).toBe(true);
    }
  });
  it('wraps the surf loop across an overlapping window without a fade-to-silence seam', () => {
    const samples = renderHoardTideSamples('hoard_tide_rush', 4);
    expect(Math.abs(samples[0] - samples[samples.length - 1])).toBeLessThan(0.12);
    const energy = samples.slice(-1000).reduce((sum, value) => sum + value * value, 0);
    expect(energy).toBeGreaterThan(1);
  });
});
