// Placed-asset distance tiers (SPACEY, 2026-09-18: "keep the same topo for all
// the models at 100yds and 200yds but make the billboards imposters for
// 200yds+ (was 300) ... when models phase out they should pop out gentle with a fade
// look"): the pure decisions behind the imposter swap and the cross-fade in
// render/placed_assets.ts.

import { describe, expect, it } from 'vitest';
import {
  batchKey,
  PLACED_FADE_SECONDS,
  PLACED_IMPOSTER_DIST,
  PLACED_LOD_HYSTERESIS,
  placedImposterLevel,
  stepFade,
} from '../src/render/placed_batch_core';

describe('placed-asset imposter tier', () => {
  it('keeps every batch key as before (no geometry tier keys)', () => {
    expect(batchKey('/models/props/well.glb', 0, true)).toBe('/models/props/well.glb#0');
    expect(batchKey('/models/props/well.glb', 2, false)).toBe('/models/props/well.glb#2:nc');
  });

  it('keeps full geometry to 200 yd and swaps to the sprite past it', () => {
    const d2 = (d: number): number => d * d;
    expect(PLACED_IMPOSTER_DIST).toBe(200);
    expect(placedImposterLevel(d2(100), 0)).toBe(0);
    expect(placedImposterLevel(d2(199), 0)).toBe(0);
    expect(placedImposterLevel(d2(201), 0)).toBe(1);
    expect(placedImposterLevel(d2(400), 0)).toBe(1);
  });

  it('comes back to geometry only inside the hysteresis band', () => {
    const d2 = (d: number): number => d * d;
    expect(placedImposterLevel(d2(190), 1)).toBe(1);
    expect(placedImposterLevel(d2(PLACED_IMPOSTER_DIST / PLACED_LOD_HYSTERESIS - 1), 1)).toBe(0);
    expect(PLACED_LOD_HYSTERESIS).toBeGreaterThan(1);
  });
});

describe('cross-fade steps', () => {
  it('ramps 0..1 over PLACED_FADE_SECONDS and clamps at the ends', () => {
    expect(PLACED_FADE_SECONDS).toBeGreaterThan(0.2);
    expect(PLACED_FADE_SECONDS).toBeLessThan(1);
    let v = 0;
    let t = 0;
    while (v < 1 && t < 10) {
      v = stepFade(v, 1, 0.1);
      t += 0.1;
    }
    expect(v).toBe(1);
    expect(t).toBeLessThanOrEqual(PLACED_FADE_SECONDS + 0.11);
    expect(stepFade(1, 0, PLACED_FADE_SECONDS / 2)).toBeCloseTo(0.5, 5);
    expect(stepFade(0.1, 0, 5)).toBe(0);
    expect(stepFade(0.9, 1, 5)).toBe(1);
  });
});
