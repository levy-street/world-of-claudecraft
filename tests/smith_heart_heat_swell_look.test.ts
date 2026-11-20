// The Guardian of the Heat's pass-4 looks, pinned to the sim: the Molten
// Swells' wall stands exactly in the box the sim strikes (heat_geometry.ts
// inWave) at every front, its scorched trail fades once its lane is gone; the
// thrown Hearthseeds' meteors leave the hands on the Throw clip's release and
// land exactly on their seed's spot at the sim's landing time (seedFlight),
// the clip itself ships in the guardian's GLB beside its nine.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEAT_SWELL_LOOK,
  SWELL_LIP_V,
  SWELL_PROFILE,
  swellDroop,
  swellFootprint,
  swellTrailFade,
} from '../src/render/smith_heart_fx/heat_swell_core';
import { swellCurlGeometry } from '../src/render/smith_heart_fx/heat_swell_fx';
import { inWave, HEAT_TUNING as T } from '../src/sim/encounters/smith_heart';

const _ROOT = join(__dirname, '..');

describe('the Molten Swells: the wall is the hit area', () => {
  it('keeps the profile inside the box: z from the back foot to the front line, y 0..1', () => {
    for (const [z, y] of SWELL_PROFILE) {
      expect(z).toBeGreaterThanOrEqual(-1);
      expect(z).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // The foot on the floor (at most a yard or so behind the front line),
    // the back foot at the box's back.
    expect(SWELL_PROFILE[0][1]).toBe(0);
    expect(SWELL_PROFILE[0][0]).toBeGreaterThan(-0.2);
    expect(SWELL_PROFILE[SWELL_PROFILE.length - 1]).toEqual([-1, 0]);
    // The lip hooks right to the front line.
    const lip = SWELL_PROFILE[Math.round(SWELL_LIP_V * (SWELL_PROFILE.length - 1))];
    expect(lip[0]).toBe(0);
    expect(lip[1]).toBeGreaterThan(0.5);
  });

  it('builds a wall whose every vertex lies in the unit box (scaled by half width, height, depth)', () => {
    const g = swellCurlGeometry();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(1 + 1e-6);
      expect(p.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(p.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      expect(p.getZ(i)).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(p.getZ(i)).toBeLessThanOrEqual(1e-6);
    }
    // Its ends roll down to the floor.
    expect(swellDroop(1)).toBe(0);
    expect(swellDroop(0)).toBe(1);
    g.dispose();
  });

  it('stands at every front exactly where the sim strikes', () => {
    const facing = 0.7;
    const s = Math.sin(facing);
    const c = Math.cos(facing);
    for (let front = 0; front <= T.laneLength + T.waveDepth; front += 0.5) {
      const f = swellFootprint(front, T.laneLength);
      const simFront = Math.min(front, T.laneLength);
      expect(f.far).toBeCloseTo(simFront, 9);
      // Points inside the drawn box are struck; just outside it, not.
      for (const along of [f.near + 0.01, (f.near + f.far) / 2, f.far - 0.01]) {
        if (f.far - f.near < 0.05) continue;
        for (const across of [-T.laneHalf + 0.01, 0, T.laneHalf - 0.01])
          expect(
            inWave(0, 0, facing, simFront, s * along + c * across, c * along - s * across),
          ).toBe(true);
      }
      if (f.far > 0.1) {
        expect(inWave(0, 0, facing, simFront, s * (f.far + 0.05), c * (f.far + 0.05))).toBe(false);
        expect(
          inWave(
            0,
            0,
            facing,
            simFront,
            s * f.near + c * (T.laneHalf + 0.05),
            c * f.near - s * (T.laneHalf + 0.05),
          ),
        ).toBe(false);
      }
      if (f.near > 0.1)
        expect(inWave(0, 0, facing, simFront, s * (f.near - 0.05), c * (f.near - 0.05))).toBe(
          false,
        );
    }
  });

  it('leaves a scorched trail that fades out after its lane goes', () => {
    expect(swellTrailFade(0)).toBe(1);
    expect(swellTrailFade(HEAT_SWELL_LOOK.trailSeconds / 2)).toBeLessThan(0.5);
    expect(swellTrailFade(HEAT_SWELL_LOOK.trailSeconds)).toBe(0);
    expect(HEAT_SWELL_LOOK.height).toBeGreaterThan(T.waveDepth);
  });
});
