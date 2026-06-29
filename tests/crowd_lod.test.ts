import { describe, expect, it } from 'vitest';
import {
  CROWD_LOD_HARD_RIGS,
  CROWD_LOD_MIN_LOD_SQ_SCALE,
  CROWD_LOD_MIN_SHADOW_SQ_SCALE,
  CROWD_LOD_SOFT_RIGS,
  crowdLodSqScale,
} from '../src/render/crowd_lod';

describe('crowdLodSqScale', () => {
  const floor = CROWD_LOD_MIN_SHADOW_SQ_SCALE;

  it('is a no-op (1.0) at and below the soft knee', () => {
    expect(crowdLodSqScale(0, floor)).toBe(1);
    expect(crowdLodSqScale(CROWD_LOD_SOFT_RIGS, floor)).toBe(1);
    expect(crowdLodSqScale(CROWD_LOD_SOFT_RIGS - 1, floor)).toBe(1);
  });

  it('reaches exactly the floor at and beyond the hard knee', () => {
    expect(crowdLodSqScale(CROWD_LOD_HARD_RIGS, floor)).toBeCloseTo(floor, 12);
    expect(crowdLodSqScale(CROWD_LOD_HARD_RIGS + 100, floor)).toBeCloseTo(floor, 12);
  });

  it('ramps linearly and monotonically across the knee', () => {
    const mid = (CROWD_LOD_SOFT_RIGS + CROWD_LOD_HARD_RIGS) / 2;
    expect(crowdLodSqScale(mid, floor)).toBeCloseTo(1 + (floor - 1) * 0.5, 12);
    let prev = Number.POSITIVE_INFINITY;
    for (let rigs = CROWD_LOD_SOFT_RIGS; rigs <= CROWD_LOD_HARD_RIGS; rigs++) {
      const s = crowdLodSqScale(rigs, floor);
      expect(s).toBeLessThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(floor);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
  });

  it('never widens a range (scale stays within [floor, 1]) for either floor', () => {
    for (const f of [CROWD_LOD_MIN_SHADOW_SQ_SCALE, CROWD_LOD_MIN_LOD_SQ_SCALE]) {
      for (const rigs of [0, 8, 16, 24, 32, 48, 80, 200]) {
        const s = crowdLodSqScale(rigs, f);
        expect(s).toBeGreaterThanOrEqual(f);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is NaN-safe (a non-finite count yields full detail)', () => {
    expect(crowdLodSqScale(Number.NaN, floor)).toBe(1);
  });

  it('degrades safely if the knee window is empty (soft >= hard)', () => {
    expect(crowdLodSqScale(50, floor, 40, 40)).toBe(floor);
  });
});
