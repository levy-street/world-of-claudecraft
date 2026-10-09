// The Sunken Bastion's storm rain plan (src/render/sunken_bastion/
// bastion_rain_core.ts): tier shedding of cosmetic density only, gusts that
// stay in range and swing, a slant that reads as wind without turning the rain
// sideways, motion-blur streak lengths, and splashes that land on the real
// floor (the stones, the swell) and never on a cliff lip.
import { describe, expect, it } from 'vitest';
import {
  bastionRainTier,
  packSplashHeights,
  planSplashHeights,
  RAIN_SPEED,
  rainGust,
  rainSlant,
  rainStreakLength,
  rainWind,
  unpackSplashHeight,
} from '../src/render/sunken_bastion/bastion_rain_core';
import {
  SUNKEN_BASTION_FIELD,
  SUNKEN_BASTION_SEA_LEVEL,
} from '../src/sim/content/sunken_bastion_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

describe('the Bastion storm rain plan', () => {
  it('sheds only density with the tier, and never stops raining', () => {
    const high = bastionRainTier(false, 1);
    const mid = bastionRainTier(false, 0.6);
    const low = bastionRainTier(true, 0.35);
    expect(high.streaks).toBeGreaterThan(mid.streaks);
    expect(mid.streaks).toBeGreaterThan(low.streaks);
    expect(low.streaks).toBeGreaterThan(200);
    expect(high.splashes).toBeGreaterThan(0);
    expect(low.splashes).toBe(0);
    expect(low.sheets).toBeGreaterThan(0);
  });

  it('gusts stay in range and actually swing over a minute', () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 120; t += 0.25) {
      const g = rainGust(t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  it('leans with the wind but never turns sideways', () => {
    for (let t = 0; t < 120; t += 0.5) {
      const w = rainWind(t);
      const slowest = rainSlant(RAIN_SPEED.min, w);
      expect(slowest).toBeGreaterThan(0.12);
      expect(slowest).toBeLessThan(0.62);
    }
  });

  it('draws motion-blurred streaks of about a yard or two', () => {
    expect(rainStreakLength(RAIN_SPEED.min, 0)).toBeGreaterThan(0.7);
    expect(rainStreakLength(RAIN_SPEED.max, 1)).toBeLessThan(2.6);
    expect(rainStreakLength(RAIN_SPEED.max, 1)).toBeGreaterThan(
      rainStreakLength(RAIN_SPEED.min, 0),
    );
  });

  it('lands splashes on the floor, on the swell over the void, never on a lip', () => {
    const grid = planSplashHeights(2);
    const packed = packSplashHeights(grid);
    let onFloor = 0;
    let onSea = 0;
    for (let j = 1; j + 1 < grid.rows; j += 3) {
      for (let i = 1; i + 1 < grid.cols; i += 3) {
        const k = j * grid.cols + i;
        const x = grid.minX + i * grid.step;
        const z = grid.minZ + j * grid.step;
        const floor = authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z);
        const decoded = unpackSplashHeight(packed[k * 4], packed[k * 4 + 1]);
        if (floor <= SUNKEN_BASTION_FIELD.voidHeight + 0.5) {
          expect(decoded).toBeCloseTo(SUNKEN_BASTION_SEA_LEVEL, 2);
          onSea++;
        } else {
          expect(Math.abs(decoded - floor)).toBeLessThan(0.01);
          onFloor++;
        }
        // A cell flagged for splashes has no step round it bigger than a hand.
        if (grid.flat[k]) {
          for (const n of [k - 1, k + 1, k - grid.cols, k + grid.cols]) {
            expect(Math.abs(grid.heights[n] - grid.heights[k])).toBeLessThan(0.6);
          }
        }
      }
    }
    expect(onFloor).toBeGreaterThan(500);
    expect(onSea).toBeGreaterThan(500);
    // The rampart's sea-side lip is not a landing spot.
    const lip = Math.round((65 - grid.minX) / grid.step);
    const row = Math.round((50 - grid.minZ) / grid.step);
    const edgeCells = [lip - 1, lip, lip + 1].map((c) => grid.flat[row * grid.cols + c]);
    expect(edgeCells).toContain(0);
  });
});
