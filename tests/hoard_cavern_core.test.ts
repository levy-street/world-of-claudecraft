import { describe, expect, it } from 'vitest';
import {
  buildHoardCavernShellPlan,
  hoardCavernSceneryVisible,
} from '../src/render/hoard_cavern_core';
import { buildHoardValleyPlan, type HoardValleyLayoutInput } from '../src/render/hoard_valley_core';

const layout: HoardValleyLayoutInput = {
  zMin: -19,
  zMax: 140,
  floorHalfX: 34,
  shellPolygon: [
    { x: 9, z: -19 },
    { x: 9, z: 10 },
    { x: 34, z: 45 },
    { x: 34, z: 140 },
    { x: -34, z: 140 },
    { x: -34, z: 45 },
    { x: -9, z: 10 },
    { x: -9, z: -19 },
  ],
  dais: { x: 0, z: 120, r: 13 },
};

describe('collapsed hoard cavern', () => {
  it('cuts away intersecting roofs from raised and diagonal cameras, then restores the underside', () => {
    const origin = { x: 10000, y: -3, z: 400 };
    const bounds = { min: { x: -12, y: 13, z: -20 }, max: { x: 12, y: 18, z: 0 } };
    const target = { x: 10000, y: 0, z: 390 };
    expect(hoardCavernSceneryVisible({ x: 10000, y: 20, z: 390 }, target, origin, bounds)).toBe(
      false,
    );
    expect(hoardCavernSceneryVisible({ x: 10018, y: 25, z: 370 }, target, origin, bounds)).toBe(
      false,
    );
    expect(hoardCavernSceneryVisible({ x: 10000, y: 4, z: 382 }, target, origin, bounds)).toBe(
      true,
    );
    expect(
      hoardCavernSceneryVisible({ x: 10000, y: 25, z: 430 }, { ...target, z: 435 }, origin, bounds),
    ).toBe(true);
  });
  const valley = buildHoardValleyPlan({ layout, zoneId: 'amberfall', seed: 123, low: false });
  it('covers the arrival but preserves an open central sky above combat', () => {
    const shell = buildHoardCavernShellPlan(layout, valley);
    expect(shell).toEqual(buildHoardCavernShellPlan(layout, valley));
    expect(shell.roofEndZ).toBeLessThan(valley.revealZ - 10);
    const roof = shell.entryRoof;
    expect(roof.length).toBeGreaterThan(2);
    for (const ledge of roof) {
      expect(ledge.z).toBeLessThan(shell.roofEndZ);
      expect(ledge.y - ledge.scaleY).toBeGreaterThan(12);
    }
    expect(
      shell.ledges.filter(
        (ledge) => ledge.z > valley.revealZ && ledge.z < layout.zMax - 5 && Math.abs(ledge.x) < 20,
      ),
    ).toHaveLength(0);
  });
  it('suspends roots at the wall instead of across the fight lane', () => {
    const { roots } = buildHoardCavernShellPlan(layout, valley);
    expect(roots.length).toBeGreaterThan(10);
    for (const strand of roots) {
      expect(strand.start[1]).toBeGreaterThan(strand.end[1]);
      expect(strand.end[1]).toBeGreaterThanOrEqual(6);
      expect(Math.abs(strand.end[0])).toBeGreaterThan(8);
    }
  });
  it('retains the enclosing shell on low', () => {
    const low = buildHoardValleyPlan({ layout, zoneId: 'amberfall', seed: 123, low: true });
    expect(buildHoardCavernShellPlan(layout, low)).toEqual(
      buildHoardCavernShellPlan(layout, valley),
    );
  });
});
