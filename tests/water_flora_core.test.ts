import { describe, expect, it } from 'vitest';
import { waterFloraRegions } from '../src/render/water_flora_core';
import { WORLD_MAX_X, ZONES } from '../src/sim/data';

const SEED = 42;

// Reeds ring a lake out to lake.radius * 1.7, and lakes sit inside their zone,
// so a placement may poke past the rect by at most 0.7 x the largest radius.
const maxLakeRadius = Math.max(...ZONES.flatMap((z) => (z.lakes ?? []).map((l) => l.radius)));
const MARGIN = maxLakeRadius * 0.7 + 1;

function zoneRect(zoneId: string): { x0: number; x1: number; z0: number; z1: number } {
  const zone = ZONES.find((z) => z.id === zoneId);
  expect(zone, `region for unknown zone ${zoneId}`).toBeDefined();
  const def = zone as (typeof ZONES)[number];
  return {
    x0: (def.xMin ?? -WORLD_MAX_X) - MARGIN,
    x1: (def.xMax ?? WORLD_MAX_X) + MARGIN,
    z0: def.zMin - MARGIN,
    z1: def.zMax + MARGIN,
  };
}

describe('water flora placement core', () => {
  const regions = waterFloraRegions(SEED);

  it('is deterministic for a fixed seed', () => {
    expect(waterFloraRegions(SEED)).toEqual(regions);
  });

  it('reproduces the pre-split placement walk exactly (the move pin)', () => {
    // The walk moved verbatim out of water_flora.ts; this census pins it so a
    // future edit cannot silently reshape the world's water dressing. Minted
    // from the shipped walk at seed 42; re-mint only for a deliberate,
    // reviewed placement change. Re-minted once for Gull Mere (R55, the
    // farshore lagoon): one new region, 3 lilies and 5 reeds on the new
    // water, and farshore_isle becomes the walk's last zone. The first-spot
    // coordinate pin is untouched, so the pre-existing walk is proven
    // unmoved.
    expect(regions.length).toBe(10);
    expect(regions.reduce((n, r) => n + r.lilies.length, 0)).toBe(75);
    expect(regions.reduce((n, r) => n + r.reeds.length, 0)).toBe(131);
    const first = regions[0].lilies[0] ?? regions[0].reeds[0];
    expect(first.x).toBeCloseTo(-97.7536, 3);
    expect(first.z).toBeCloseTo(98.1021, 3);
    expect(regions[regions.length - 1].zoneId).toBe('farshore_isle');
  });

  it('places flora on the temperate lakes', () => {
    expect(regions.length).toBeGreaterThan(2);
    const spots = regions.reduce((n, r) => n + r.lilies.length + r.reeds.length, 0);
    expect(spots).toBeGreaterThan(20);
  });

  it('skips the frozen, molten, and self-dressing realms', () => {
    const ids = new Set(regions.map((r) => r.zoneId));
    expect(ids.has('willowfen')).toBe(false);
    expect(ids.has('palmreach')).toBe(false);
    for (const zone of ZONES) {
      if (zone.biome === 'frost' || zone.biome === 'ember') {
        expect(ids.has(zone.id), `${zone.id} grows no water flora`).toBe(false);
      }
    }
  });

  it('every region stays inside its own zone rectangle: the footprint the cull relies on', () => {
    // This is the point of the per-zone split: a region whose placements leak
    // into another zone would rebuild the world-spanning footprint that made
    // the old single-mesh layout uncullable (10.96M triangles from anywhere).
    for (const region of regions) {
      const rect = zoneRect(region.zoneId);
      for (const spot of [...region.lilies, ...region.reeds]) {
        expect(
          spot.x >= rect.x0 && spot.x <= rect.x1 && spot.z >= rect.z0 && spot.z <= rect.z1,
          `${region.zoneId} spot at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}) outside its rect`,
        ).toBe(true);
      }
    }
  });
});
