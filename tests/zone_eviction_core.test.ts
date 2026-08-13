import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/render/terrain';
import { owningRectIndex, type WorldRect } from '../src/render/terrain_region_core';
import { ZONE_EVICTION_RADIUS, zonesEligibleForEviction } from '../src/render/zone_eviction_core';
import { distanceSqToZone, MAX_OUTDOOR_FOG_FAR } from '../src/render/zone_streaming';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';

// Terrain chunk ownership (terrain.ts's cellOwnerId) is nearest-rectangle: the
// 14 zone rectangles do not tile the world, so a zone also owns every
// unclaimed "gap" cell nearest to it, which can sit outside its own
// rectangle. Reproduces that exact grid/ownership math (not terrain.ts's
// internals, which are private) to measure the real worst case against the
// LIVE zone table, the way zone_eviction_core.ts's ZONE_EVICTION_RADIUS
// comment cites it.
function maxOwnedCellOvershoot(): number {
  const zoneRects: WorldRect[] = ZONES.map((zone) => ({
    minX: zone.xMin ?? STRIP_MIN_X,
    maxX: zone.xMax ?? STRIP_MAX_X,
    minZ: zone.zMin,
    maxZ: zone.zMax,
  }));
  const chunksX = Math.ceil((WORLD_MAX_X * 2) / CHUNK_SIZE);
  const chunksZ = Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / CHUNK_SIZE);
  let worst = 0;
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
      const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
      const owner = ZONES[owningRectIndex(x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2, zoneRects)];
      // The cell's farthest corner from its owner's rectangle: distanceSqToZone
      // is convex over an axis-aligned rectangle, so a corner always dominates.
      for (const [dx, dz] of [
        [0, 0],
        [CHUNK_SIZE, 0],
        [0, CHUNK_SIZE],
        [CHUNK_SIZE, CHUNK_SIZE],
      ]) {
        const distance = Math.sqrt(distanceSqToZone(owner, x0 + dx, z0 + dz));
        if (distance > worst) worst = distance;
      }
    }
  }
  return worst;
}

describe('constrained-memory zone eviction policy', () => {
  it('clears every owned-cell overshoot on the live zone table, so an evicted zone cannot still be visible when it is released', () => {
    // The real safety margin ZONE_EVICTION_RADIUS's comment cites: the
    // nearest chunk an eviction can actually remove may sit up to
    // maxOwnedCellOvershoot() closer than the radius alone suggests, so that
    // overshoot must not eat the whole margin over MAX_OUTDOOR_FOG_FAR (the
    // widest radius that can re-trigger a background prepare for the same
    // zone), or a player could see an evicted zone's ground before it rebuilds.
    const overshoot = maxOwnedCellOvershoot();
    expect(overshoot).toBeGreaterThan(0); // sanity: the gap-cell case is real, not vacuous
    expect(ZONE_EVICTION_RADIUS - overshoot).toBeGreaterThan(MAX_OUTDOOR_FOG_FAR);
  });

  it('never evicts the zone the camera currently occupies, however far its rectangle math would put it', () => {
    const eligible = zonesEligibleForEviction(
      ZONES,
      new Set(['drakelands']),
      'drakelands',
      0,
      0,
      100, // tiny radius: distance alone would clearly qualify it
    );
    expect(eligible).toEqual([]);
  });

  it('excludes zones inside the retention radius and returns only the rest', () => {
    // From the Eastbrook spawn (0, 0): eastbrook_vale contains the camera
    // (distance 0), mirefen_marsh's rectangle is 180 yd away, and
    // drakelands' is about 1829 yd away.
    const eligible = zonesEligibleForEviction(
      ZONES,
      new Set(['eastbrook_vale', 'mirefen_marsh', 'drakelands']),
      null,
      0,
      0,
    );
    expect(eligible).toEqual(['drakelands']);
  });

  it('sorts multiple eligible zones farthest first', () => {
    const eligible = zonesEligibleForEviction(
      ZONES,
      new Set(['frostveil', 'drakelands']),
      null,
      0,
      0,
      1000,
    );
    expect(eligible).toEqual(['drakelands', 'frostveil']);
  });

  it('never returns a zone that is not actually prepared', () => {
    const eligible = zonesEligibleForEviction(ZONES, new Set(), null, 0, 0, 0);
    expect(eligible).toEqual([]);
  });
});
