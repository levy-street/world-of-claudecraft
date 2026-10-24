import { describe, expect, it } from 'vitest';
import {
  FEATURE_PROMOTIONS,
  paintedTownBuildingPlacements,
  paintedTownsOldKitPlacements,
} from '../src/editor/feature_prop_placements';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import { WORLD_SEED } from '../src/sim/world_seed';

// Studio's paintedTowns family (editor/feature_prop_placements.ts): a document
// that promotes it owns every painted town's buildings as its own placements,
// and the family stands the town views, the record colliders and the walk-in
// floors down. So a building the promotion silently skipped (its model has no
// TOWN_BUILDING_NATURAL row) would vanish from such a document, and an old
// conversion the lift missed would stand a kit house inside a painted one.

const BUILDINGS = PAINTED_TOWNS.flatMap((town) => town.buildings);
const KIT = PAINTED_TOWNS.flatMap((town) => town.replacedKitBuildings);
const DECOR = PAINTED_TOWNS.flatMap((town) => town.replacedDecorProps);

describe("Studio's painted towns family", () => {
  it('is a promoted family that lifts the old conversions first', () => {
    const family = FEATURE_PROMOTIONS.find((candidate) => candidate.flag === 'paintedTowns');
    expect(family?.placements).toBe(paintedTownBuildingPlacements);
    expect(family?.supersedes).toBe(paintedTownsOldKitPlacements);
  });

  it('promotes every painted building as exactly one placement at its own seat', () => {
    expect(BUILDINGS.length).toBeGreaterThan(0);
    const placements = paintedTownBuildingPlacements(WORLD_SEED);
    expect(placements).toHaveLength(BUILDINGS.length);
    for (const building of BUILDINGS) {
      const assetId = building.assetId.replace(/^\/models\//, '').replace(/\.glb$/i, '');
      const matches = placements.filter(
        (placement) =>
          placement.assetId === assetId &&
          Math.abs(placement.x - building.placement.x) < 1e-9 &&
          Math.abs(placement.z - building.placement.z) < 1e-9,
      );
      expect(matches, building.id).toHaveLength(1);
      const [placement] = matches;
      expect(placement.y, building.id).toBeCloseTo(building.placement.lift, 9);
      expect(placement.rotY ?? 0, building.id).toBeCloseTo(building.placement.rotation, 9);
      expect(placement.collide, building.id).toBe(true);
      expect(placement.collisionMode, building.id).toBe('baked');
    }
  });

  it("lifts the old conversion of every town's replaced kit records and hex decor rows", () => {
    const lifted = paintedTownsOldKitPlacements(WORLD_SEED);
    expect(KIT.length).toBeGreaterThan(0);
    // a kit record converts to its house (or the chapel's parts) over its footprint
    for (const record of KIT) {
      const reach = Math.max(record.w, record.d);
      const near = lifted.filter(
        (placement) => Math.hypot(placement.x - record.x, placement.z - record.z) <= reach,
      );
      expect(near.length, `${record.kind} at ${record.x}, ${record.z}`).toBeGreaterThan(0);
    }
    // a decor row converts to exactly one placement on its own spot
    for (const row of DECOR) {
      const on = lifted.filter(
        (placement) => Math.abs(placement.x - row.x) < 1e-9 && Math.abs(placement.z - row.z) < 1e-9,
      );
      expect(on, `${row.key} at ${row.x}, ${row.z}`).toHaveLength(1);
    }
    // and nothing a town did not replace
    for (const placement of lifted) {
      const fromKit = KIT.some(
        (record) =>
          Math.hypot(placement.x - record.x, placement.z - record.z) <=
          Math.max(record.w, record.d),
      );
      const fromDecor = DECOR.some(
        (row) => Math.abs(placement.x - row.x) < 1e-9 && Math.abs(placement.z - row.z) < 1e-9,
      );
      expect(fromKit || fromDecor, `${placement.assetId} at ${placement.x}, ${placement.z}`).toBe(
        true,
      );
    }
  });
});
