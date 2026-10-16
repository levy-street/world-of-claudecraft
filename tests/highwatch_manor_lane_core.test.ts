import { describe, expect, it } from 'vitest';
import { insideHighwatchManorGround } from '../src/render/foliage_core';
import {
  MANOR_LANE,
  MANOR_PORTAL_PATH,
  manorLaneFlags,
  manorPortalPathFlags,
  onHighwatchManorLane,
} from '../src/render/highwatch_manor_lane_core';
import { streetlampPlacements } from '../src/sim/colliders';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';
import { roadDistance, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
const smithy = HIGHWATCH_BUILDINGS_BY_ID.highwatch_smithy;
const mid = (MANOR_LANE.z0 + MANOR_LANE.z1) / 2;

describe('the Highwatch manor lane', () => {
  it('runs from the Sanctum road to the garden gate, along the wall and outside the reach', () => {
    // its road end on the road's shoulder, its gate end across the gate's opening
    expect(roadDistance(MANOR_LANE.x0, mid)).toBeLessThan(2);
    expect(MANOR_LANE.x0).toBeLessThan(manor.position.x - 2.6);
    expect(MANOR_LANE.x1).toBeGreaterThanOrEqual(manor.position.x + 2.6);
    // outside the manor's reach (the model's garden wall) and clear of the smithy's
    expect(MANOR_LANE.z1).toBeLessThan(manor.reach.center.z - manor.reach.halfDepth);
    expect(MANOR_LANE.z0).toBeGreaterThan(smithy.reach.center.z + smithy.reach.halfDepth + 2);
  });

  it('keeps clear of every road lamp', () => {
    for (const lamp of streetlampPlacements(WORLD_SEED)) {
      const dx = Math.max(MANOR_LANE.x0 - lamp.x, 0, lamp.x - MANOR_LANE.x1);
      const dz = Math.max(MANOR_LANE.z0 - lamp.z, 0, lamp.z - MANOR_LANE.z1);
      expect(Math.hypot(dx, dz), `lamp ${lamp.x}, ${lamp.z}`).toBeGreaterThan(0.5);
    }
  });

  it('lays its flags inside the lane with joints between them, on walkable ground', () => {
    const flags = manorLaneFlags();
    expect(flags.length).toBeGreaterThan(40);
    for (const f of flags) {
      expect(f.x0).toBeGreaterThanOrEqual(MANOR_LANE.x0);
      expect(f.x1).toBeLessThanOrEqual(MANOR_LANE.x1);
      expect(f.z0).toBeGreaterThanOrEqual(MANOR_LANE.z0);
      expect(f.z1).toBeLessThanOrEqual(MANOR_LANE.z1);
      expect(f.x1 - f.x0).toBeGreaterThan(0.1);
    }
    // no two flags overlap (the paving never fights itself)
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        const a = flags[i];
        const b = flags[j];
        const overlap =
          Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) &&
          Math.min(a.z1, b.z1) > Math.max(a.z0, b.z0);
        expect(overlap, `${i} ${j}`).toBe(false);
      }
    }
    // the ground under it climbs to the road gently (a walkable grade all the way)
    for (let x = MANOR_LANE.x0; x < MANOR_LANE.x1 - 1; x += 1) {
      const rise = Math.abs(
        terrainHeight(x + 1, mid, WORLD_SEED) - terrainHeight(x, mid, WORLD_SEED),
      );
      expect(rise, `x ${x}`).toBeLessThan(0.6);
    }
  });

  it('grows no grass or scrub through its paving, and only there', () => {
    expect(onHighwatchManorLane(10, mid)).toBe(true);
    expect(insideHighwatchManorGround(10, mid)).toBe(true);
    expect(onHighwatchManorLane(10, MANOR_LANE.z0 - 0.5)).toBe(false);
    expect(insideHighwatchManorGround(10, MANOR_LANE.z0 - 0.5)).toBe(false);
  });

  it('paves a walkable way up the bank behind the east wing to the portal bench', () => {
    const p = MANOR_PORTAL_PATH;
    const x = (p.x0 + p.x1) / 2;
    // from the manor's ground up to the bench's lip by the crystal cave portal at (10, 770)
    expect(terrainHeight(x, p.z0, WORLD_SEED)).toBeCloseTo(12.5, 0);
    expect(terrainHeight(x, p.z1, WORLD_SEED)).toBeGreaterThan(16.5);
    expect(Math.hypot(x - 10, p.z1 - 770)).toBeLessThan(6.5);
    // a walkable grade the whole way (the climb limit is 1.5)
    for (let z = p.z0; z < p.z1 - 0.5; z += 0.5) {
      const rise = terrainHeight(x, z + 0.5, WORLD_SEED) - terrainHeight(x, z, WORLD_SEED);
      expect(rise / 0.5, `z ${z}`).toBeLessThan(1.1);
    }
    // clear of the chapel's east wall (the model's x -22.8, world 8.7) and the library's north
    expect(p.x1).toBeLessThan(manor.position.x - 22.8 - 1);
    expect(p.z0).toBeGreaterThan(manor.position.z + 5.6);
    const flags = manorPortalPathFlags();
    expect(flags.length).toBeGreaterThan(8);
    for (const f of flags)
      expect(onHighwatchManorLane((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2)).toBe(true);
  });
});
