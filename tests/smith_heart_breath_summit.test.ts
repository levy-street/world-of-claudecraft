// The Storm Cornice as an open summit (the Breath's third pass of 2026-11-03,
// presentation: heart_walls_core.ts heartSummitOpen / heartSummitCap,
// heart_mountain_core.ts, breath_summit_core.ts):
//   - past the Cornice's open rim the mountain falls away under its floor,
//     only the climb's head and the Heart's crown keep their rock;
//   - no rock of a lower floor stands over the Cornice's horizon near it;
//   - the floating isles hang in open air (no rock under or beside them),
//     inside the field's bounds and the instance slot's band;
//   - the cloud sea lies under every walk it spreads over (it covers none),
//     the far peaks stand far out of it.

import { describe, expect, it } from 'vitest';
import {
  BREATH_CLOUD_SEA,
  BREATH_FAR_PEAKS,
  breathSeaClearOfWalks,
  planBreathFarPeaks,
} from '../src/render/smith_heart/breath_summit_core';
import {
  HEART_MOUNTAIN_CHASM,
  heartMountainHeight,
} from '../src/render/smith_heart/heart_mountain_core';
import {
  HEART_ISLE_AIR,
  HEART_SUMMIT_CAP,
  heartFloorClearance,
  heartOpenAir,
  heartSummitCap,
  heartSummitOpen,
} from '../src/render/smith_heart/heart_walls_core';
import { BREATH, BREATH_ISLES, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';

const C = BREATH.cornice;
const at = (deg: number, past: number) => {
  const a = (deg * Math.PI) / 180;
  const e = 1 + past / ((C.rx + C.rz) * 0.5);
  return { x: C.x + Math.sin(a) * C.rx * e, z: C.z + Math.cos(a) * C.rz * e };
};

describe('the Storm Cornice: an open summit', () => {
  it('falls away past the open rim; the climb head and the Heart crown keep their rock', () => {
    for (const deg of [0, 30, 160, 200, 340]) {
      const p = at(deg, 16);
      const c = heartFloorClearance(p.x, p.z);
      expect(heartSummitOpen(p.x, p.z, c.floor), `${deg}`).toBe(1);
      expect(heartMountainHeight(p.x, p.z), `${deg}`).toBeLessThan(C.h - 8);
    }
    // The climb's head (west) and the Heart's crown (east) stay closed.
    expect(heartSummitOpen(at(270, 10).x, at(270, 10).z, C.h)).toBe(0);
    expect(heartSummitOpen(at(95, 10).x, at(95, 10).z, C.h)).toBe(0);
    // A floor under the Cornice's height is never the summit's.
    expect(heartSummitOpen(at(0, 10).x, at(0, 10).z, C.h - 20)).toBe(0);
  });

  it('caps every rock near it under its horizon, the far ridges free', () => {
    for (const deg of [10, 150, 210, 330])
      for (const past of [5, 20, HEART_SUMMIT_CAP.reach]) {
        const p = at(deg, past);
        expect(heartSummitCap(p.x, p.z)).toBeLessThanOrEqual(C.h - HEART_SUMMIT_CAP.under + 1e-6);
        expect(heartMountainHeight(p.x, p.z)).toBeLessThan(C.h - HEART_SUMMIT_CAP.under + 1e-6);
      }
    const far = at(180, HEART_SUMMIT_CAP.reach + HEART_SUMMIT_CAP.blend + 5);
    expect(heartSummitCap(far.x, far.z)).toBe(Number.POSITIVE_INFINITY);
  });

  it('hangs each isle in open air, inside the bounds and the slot band', () => {
    const b = SMITH_HEART_FIELD.bounds;
    for (const isle of BREATH_ISLES) {
      expect(heartOpenAir(isle.x, isle.z, isle.r + HEART_ISLE_AIR - 1), isle.id).toBe(true);
      expect(heartMountainHeight(isle.x, isle.z), isle.id).toBe(HEART_MOUNTAIN_CHASM);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = isle.x + Math.sin(a) * (isle.r + 6);
        const z = isle.z + Math.cos(a) * (isle.r + 6);
        expect(heartMountainHeight(x, z), `${isle.id} ${k}`).toBe(HEART_MOUNTAIN_CHASM);
      }
      // Walkable: inside the field's bounds and well inside the instance
      // slot's band (past local z 250 a body is the next slot's).
      expect(isle.z + isle.r).toBeLessThanOrEqual(b.maxZ);
      expect(isle.z + isle.r).toBeLessThan(240);
      expect(isle.x - isle.r).toBeGreaterThanOrEqual(b.minX);
      // High over the Cornice (seen against the sky from it).
      expect(isle.h).toBeGreaterThan(C.h + 20);
    }
  });

  it('lays the cloud sea under every walk it covers, the far peaks far out', () => {
    expect(breathSeaClearOfWalks()).toBe(true);
    for (const d of BREATH_CLOUD_SEA) expect(d.y).toBeLessThan(C.h - 40);
    const peaks = planBreathFarPeaks();
    expect(peaks).toHaveLength(BREATH_FAR_PEAKS.count);
    for (const p of peaks) {
      expect(Math.hypot(p.x - C.x, p.z - C.z)).toBeGreaterThanOrEqual(BREATH_FAR_PEAKS.near - 1);
      expect(p.z).toBeGreaterThan(C.z + C.rz + 100);
    }
  });
});
