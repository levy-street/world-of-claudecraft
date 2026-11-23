import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  eastbrookGrassExclusions,
  insideEastbrookGrassExclusion,
} from '../src/render/foliage_core';
import { BASE_WORLD, setActiveWorldContent } from '../src/sim/data';
import { distancePointToObb, FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';

beforeEach(() => setActiveWorldContent(BASE_WORLD));
afterEach(() => setActiveWorldContent(null));

/** Points on the old palisade ring, every quarter yard, all the way round. */
function oldRingSamples(): { x: number; z: number }[] {
  const { center } = FENBRIDGE_LAYOUT.civic;
  const { radius } = FENBRIDGE_LAYOUT.wall;
  const count = Math.ceil((2 * Math.PI * radius) / 0.25);
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI;
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  });
}

describe('Fenbridge layout-driven grass exclusions', () => {
  it('covers every canonical footprint, repeated boardwalk, and quest pickup', () => {
    const exclusions = eastbrookGrassExclusions([], true);
    const ids = new Set(exclusions.map((exclusion) => exclusion.id));

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(ids.has(building.id), building.id).toBe(true);
      expect(ids.has(`${building.id}:serviceApron`), building.id).toBe(true);
    }
    expect(ids.has(FENBRIDGE_LAYOUT.civic.cistern.id)).toBe(true);
    expect(ids.has(FENBRIDGE_LAYOUT.civic.provisionStall.id)).toBe(true);
    expect(ids.has(FENBRIDGE_LAYOUT.civic.musterBoard.id)).toBe(true);
    for (const boardwalk of FENBRIDGE_LAYOUT.repeated.boardwalks) {
      expect(ids.has(boardwalk.id)).toBe(true);
      expect(
        insideEastbrookGrassExclusion(exclusions, boardwalk.position.x, boardwalk.position.z, 0.2),
      ).toBe(true);
    }
    for (const order of FENBRIDGE_LAYOUT.repeated.musterOrders) {
      expect(ids.has(order.id)).toBe(true);
      expect(
        insideEastbrookGrassExclusion(exclusions, order.position.x, order.position.z, 0.2),
      ).toBe(true);
    }
  });

  it('clears no palisade or gate footing: grass grows across the old ring all the way round', () => {
    // Fenbridge stands open. The ring's sixteen wing OBBs and eight gate-jamb
    // OBBs used to clear a band of grass round the town; now no exclusion is
    // keyed to a wing or a jamb, and no point of the old ring line (gates
    // included) sits inside any exclusion, at the padding the grass uses,
    // except where a grand building now stands across the line: there the
    // grass clears for the building's own drawn reach, never for a wing.
    const exclusions = eastbrookGrassExclusions([], true);
    expect(
      exclusions.filter(
        (exclusion) =>
          exclusion.id.startsWith('fenbridge_palisade_wing') || exclusion.id.includes('_jamb_'),
      ),
    ).toEqual([]);
    const samples = oldRingSamples();
    expect(samples.length).toBeGreaterThan(700);
    const covered = samples.filter((point) =>
      insideEastbrookGrassExclusion(exclusions, point.x, point.z, 0.35),
    );
    const underBuilding = (point: { x: number; z: number }) =>
      FENBRIDGE_LAYOUT.buildings.some(
        (building) => distancePointToObb(point, building.reach) <= 0.35 + 1e-9,
      );
    expect(covered.filter((point) => !underBuilding(point))).toEqual([]);
    // the grand buildings cross the line in places, and well over half the
    // ring still grows grass
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.length / samples.length).toBeLessThan(0.4);
  });

  it('never injects fixed Fenbridge coordinates into a custom world', () => {
    const exclusions = eastbrookGrassExclusions([], false);
    const fenbridgeIds = new Set([
      ...FENBRIDGE_LAYOUT.buildings.map((building) => building.id),
      ...FENBRIDGE_LAYOUT.repeated.boardwalks.map((boardwalk) => boardwalk.id),
    ]);
    expect(exclusions.some((exclusion) => fenbridgeIds.has(exclusion.id))).toBe(false);
    expect(insideEastbrookGrassExclusion(exclusions, 0, 303, 0.5)).toBe(false);
  });
});
