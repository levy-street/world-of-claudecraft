import { describe, expect, it } from 'vitest';
import {
  LEAN_DRESSING_KEEP_RATE,
  LEAN_DRESSING_MIN_INSTANCES,
  leanDressingKeepCount,
  leanDressingKeeps,
  thinLeanDressing,
} from '../src/render/zone_dressing_lod_core';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('leanDressingKeepCount', () => {
  it('keeps every instance off the lean tiers', () => {
    for (const total of [0, 1, 6, 7, 40, 127]) {
      expect(leanDressingKeepCount(total, false)).toBe(total);
    }
  });

  it('keeps the configured share on a lean tier', () => {
    expect(leanDressingKeepCount(40, true)).toBe(Math.round(40 * LEAN_DRESSING_KEEP_RATE));
    expect(leanDressingKeepCount(69, true)).toBe(Math.round(69 * LEAN_DRESSING_KEEP_RATE));
  });

  it('never thins a family below the floor, and never thins one already under it', () => {
    expect(leanDressingKeepCount(LEAN_DRESSING_MIN_INSTANCES, true)).toBe(
      LEAN_DRESSING_MIN_INSTANCES,
    );
    expect(leanDressingKeepCount(3, true)).toBe(3);
    expect(leanDressingKeepCount(0, true)).toBe(0);
    // 8 * 0.5 = 4 would fall under the floor, so the floor wins.
    expect(leanDressingKeepCount(8, true)).toBe(LEAN_DRESSING_MIN_INSTANCES);
  });

  it('is monotone: a bigger family never keeps fewer instances', () => {
    let previous = 0;
    for (let total = 0; total <= 200; total++) {
      const keep = leanDressingKeepCount(total, true);
      expect(keep).toBeGreaterThanOrEqual(previous);
      expect(keep).toBeLessThanOrEqual(total);
      previous = keep;
    }
  });
});

describe('leanDressingKeeps', () => {
  it('answers true exactly keepCount times, whatever the family size', () => {
    for (const total of [1, 5, 12, 47, 69, 127]) {
      for (const keepCount of [0, 1, Math.floor(total / 3), Math.floor(total / 2), total]) {
        const kept = range(total).filter((i) => leanDressingKeeps(i, total, keepCount));
        expect(kept).toHaveLength(Math.min(keepCount, total));
      }
    }
  });

  it('spreads the survivors instead of keeping a prefix', () => {
    const kept = range(40).filter((i) => leanDressingKeeps(i, 40, 20));
    expect(kept).toHaveLength(20);
    // An even stride never leaves a run longer than one dropped neighbour.
    let longestGap = 0;
    for (let i = 1; i < kept.length; i++) longestGap = Math.max(longestGap, kept[i] - kept[i - 1]);
    expect(longestGap).toBeLessThanOrEqual(2);
    // And it reaches both ends of the band.
    expect(kept[0]).toBeLessThan(2);
    expect(kept[kept.length - 1]).toBeGreaterThan(37);
  });

  it('keeps everything when the count meets the family size, and nothing at zero', () => {
    expect(range(9).filter((i) => leanDressingKeeps(i, 9, 9))).toEqual(range(9));
    expect(range(9).filter((i) => leanDressingKeeps(i, 9, 0))).toEqual([]);
    expect(leanDressingKeeps(0, 0, 0)).toBe(false);
  });
});

describe('thinLeanDressing', () => {
  it('returns the source array untouched off the lean tiers', () => {
    const spots = range(40).map((i) => ({ id: i }));
    expect(thinLeanDressing(spots, false)).toBe(spots);
  });

  it('thins a lean tier to the keep count, in source order', () => {
    const spots = range(69).map((i) => ({ id: i }));
    const kept = thinLeanDressing(spots, true);
    expect(kept).toHaveLength(leanDressingKeepCount(69, true));
    expect(kept.map((s) => s.id)).toEqual([...kept.map((s) => s.id)].sort((a, b) => a - b));
    for (const s of kept) expect(spots).toContain(s);
  });

  it('leaves a family at or under the floor whole even on a lean tier', () => {
    const spots = range(LEAN_DRESSING_MIN_INSTANCES).map((i) => ({ id: i }));
    expect(thinLeanDressing(spots, true)).toBe(spots);
    expect(thinLeanDressing([], true)).toEqual([]);
  });

  it('is deterministic: the same family thins to the same instances', () => {
    const spots = range(47).map((i) => ({ id: i }));
    expect(thinLeanDressing(spots, true)).toEqual(thinLeanDressing(spots, true));
  });
});
