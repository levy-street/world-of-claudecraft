import { describe, expect, it } from 'vitest';
import {
  eastbrookGrassExclusions,
  insideEastbrookGrassExclusion,
} from '../src/render/foliage_core';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';

describe('Fenbridge layout-driven grass exclusions', () => {
  it('covers every canonical footprint, repeated boardwalk, gate jamb, and quest pickup', () => {
    const exclusions = eastbrookGrassExclusions([], true);
    const ids = new Set(exclusions.map((exclusion) => exclusion.id));

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(ids.has(building.id), building.id).toBe(true);
      expect(ids.has(`${building.id}:serviceApron`), building.id).toBe(true);
    }
    expect(ids.has(FENBRIDGE_LAYOUT.civic.cistern.id)).toBe(true);
    expect(ids.has(FENBRIDGE_LAYOUT.civic.provisionStall.id)).toBe(true);
    expect(ids.has(FENBRIDGE_LAYOUT.civic.musterBoard.id)).toBe(true);
    for (const wall of FENBRIDGE_LAYOUT.wall.segments) expect(ids.has(wall.id)).toBe(true);
    for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
      for (const jamb of gate.arch.jambs) expect(ids.has(jamb.id)).toBe(true);
    }
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

  it('never injects fixed Fenbridge coordinates into a custom world', () => {
    const exclusions = eastbrookGrassExclusions([], false);
    const fenbridgeIds = new Set([
      ...FENBRIDGE_LAYOUT.buildings.map((building) => building.id),
      ...FENBRIDGE_LAYOUT.wall.segments.map((wall) => wall.id),
      ...FENBRIDGE_LAYOUT.repeated.boardwalks.map((boardwalk) => boardwalk.id),
    ]);
    expect(exclusions.some((exclusion) => fenbridgeIds.has(exclusion.id))).toBe(false);
    expect(insideEastbrookGrassExclusion(exclusions, 0, 303, 0.5)).toBe(false);
  });
});
