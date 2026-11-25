// The Gale Crossing's look (render/smith_heart_fx/breath_crossing_fx_core.ts):
// the road of wind drawn along the ride's own arc (the current a body rides
// is exactly where the sim carries it), its strands wound round it, rising
// out of the pad and settling where the body is set down.

import { describe, expect, it } from 'vitest';
import {
  CROSSING_LOOK,
  crossingPath,
  crossingRoads,
  crossingStrand,
} from '../src/render/smith_heart_fx/breath_crossing_fx_core';
import { CORNICE_CROSSING } from '../src/sim/content/smith_heart_layout';
import { CROSSING_TUNING } from '../src/sim/encounters/smith_heart/breath_crossing_ids';
import { rideArc } from '../src/sim/encounters/smith_heart/breath_isle_geometry';

describe('the Gale Crossing look', () => {
  it('draws the road on the ride arc itself, lifted to a body middle', () => {
    const C = CORNICE_CROSSING;
    const path = crossingPath(C.out, C.arrive, 60);
    expect(path).toHaveLength(CROSSING_LOOK.samples + 1);
    for (const [i, p] of path.entries()) {
      const a = rideArc(
        { x: C.out.x, y: 60, z: C.out.z },
        { x: C.arrive.x, y: 60, z: C.arrive.z },
        i / CROSSING_LOOK.samples,
        CROSSING_TUNING.apex,
      );
      expect(p.x).toBeCloseTo(a.x, 6);
      expect(p.z).toBeCloseTo(a.z, 6);
      expect(p.y).toBeCloseTo(a.y + CROSSING_LOOK.lift, 6);
    }
    expect(path[0].x).toBeCloseTo(C.out.x, 6);
    expect(path[path.length - 1].x).toBeCloseTo(C.arrive.x, 6);
    // Over the chasm it rides high (the apex).
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(60 + CROSSING_TUNING.apex);
  });

  it('winds each strand round the road within its radius, tight at both ends', () => {
    const { out, home } = crossingRoads(60);
    for (const road of [out, home])
      for (let k = 0; k < CROSSING_LOOK.strands; k++) {
        const s = crossingStrand(road, k);
        expect(s).toHaveLength(road.length);
        for (let i = 0; i < s.length; i++) {
          const d = Math.hypot(s[i].x - road[i].x, s[i].y - road[i].y, s[i].z - road[i].z);
          expect(d).toBeLessThanOrEqual(CROSSING_LOOK.radius + 1e-6);
        }
        const mid = Math.floor(s.length / 2);
        const dEnd = Math.hypot(s[0].x - road[0].x, s[0].y - road[0].y, s[0].z - road[0].z);
        const dMid = Math.hypot(
          s[mid].x - road[mid].x,
          s[mid].y - road[mid].y,
          s[mid].z - road[mid].z,
        );
        expect(dEnd).toBeLessThan(dMid);
      }
  });
});
