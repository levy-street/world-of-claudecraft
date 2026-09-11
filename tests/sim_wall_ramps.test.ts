// City Build wall decks and stairs through the REAL placement-ramps resolver
// (src/sim/placement_ramps.ts): a flat walk deck raises the walkable floor to
// the wall top, and a stair deck rises linearly from the ground end to the
// wall end, exactly as playtest movement will sample it.

import { describe, expect, it } from 'vitest';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { PlacedAsset, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 20061;

function contentWith(placements: PlacedAsset[]): WorldContent {
  return { placements } as unknown as WorldContent;
}

function placed(p: Partial<PlacedAsset>): PlacedAsset {
  return {
    x: 0,
    z: 0,
    rotY: 0,
    scale: 1,
    collide: true,
    collideRadius: 2,
    ...p,
  } as PlacedAsset;
}

describe('wall walk decks', () => {
  it('a flat top deck raises the walkable floor to the wall top', () => {
    const content = contentWith([
      placed({
        x: 100,
        z: 200,
        scale: 3,
        ramps: [{ x: 0, z: 0, hx: 1.1, hz: 0.2, y0: 2.25, y1: 2.25 }],
      }),
    ]);
    const floor = placementRampFloorAt(content, SEED, 100, 200);
    expect(floor).toBeCloseTo(terrainHeight(100, 200, SEED) + 2.25 * 3, 3);
    // Off the deck footprint: no raised floor.
    expect(placementRampFloorAt(content, SEED, 100, 210)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('a stair deck (ry pi/2, ascending model -Z) rises toward the wall end', () => {
    // Stair at origin, rotY 0: model -Z is the wall (top) end.
    const content = contentWith([
      placed({
        scale: 3,
        scaleY: 1.5,
        ramps: [{ x: 0, z: 0, hx: 1.125, hz: 0.55, ry: Math.PI / 2, y0: 0, y1: 1.1 }],
      }),
    ]);
    const base = (z: number) =>
      placementRampFloorAt(content, SEED, 0, z) - terrainHeight(0, 0, SEED);
    const nearTop = base(-3); // model z = -1 after scale 3
    const middle = base(0);
    const nearBottom = base(3);
    expect(nearTop).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(nearBottom);
    // Top lands at y1 * sy = 1.1 * (3 * 1.5) at the extreme -Z edge.
    const topEdge = base(-1.125 * 3 + 0.01);
    expect(topEdge).toBeCloseTo(1.1 * 4.5, 1);
    expect(nearBottom).toBeLessThan(1.2);
  });
});
