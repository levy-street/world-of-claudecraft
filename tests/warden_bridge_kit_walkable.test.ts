// The Warden bridge kit (deepglass/bridge_deck|lamp|pylon, built by
// scripts/assets/deepglass/dg_bridge.py) is walked ON, not into: each module's
// installed override carries a flat walkable DECK at the authored walkway
// height (70 yd above the pier feet, norm 1 via asset_scale.ts), so a module
// seated on the fjord bed lifts the floor to its deck and a maker's line of
// butted modules is a bridge the player strides across effortlessly. Parapets
// stay solid (a rail you brush), the walkway itself never blocks.

import { describe, expect, it } from 'vitest';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import { groundHeight, groundHeightAtBody, terrainHeight } from '../src/sim/world';
import { targetHeightFor } from '../src/render/asset_scale';
import type { WorldContent } from '../src/sim/types';

const SEED = 20061;
const DECK_TOP = 70.0;
const MODULE = 12.0;

function module(variant: string, x: number, z: number, groundY: number) {
  return {
    assetId: `deepglass/bridge_${variant}`,
    path: `/models/deepglass/bridge_${variant}.glb`,
    x,
    z,
    rotY: 0,
    scale: 1,
    collide: true,
    collideRadius: 4, // the map pipeline always stamps one on a colliding placement
    collisionMode: 'baked',
    detached: true,
    groundY,
  } as unknown as NonNullable<WorldContent['placements']>[number];
}

describe('Warden bridge kit', () => {
  it('keeps every module at its authored size (scale 1 = 8 yd square, 85 yd piers)', () => {
    for (const [v, maxDim] of [
      ['deck', 72.21],
      ['lamp', 74.85],
      ['pylon', 79.22],
    ] as const) {
      expect(targetHeightFor(`/models/deepglass/bridge_${v}.glb`)).toBeCloseTo(maxDim, 3);
    }
  });

  it('lifts the walkable floor to the deck of every variant, and never blocks the walkway', () => {
    const seat = -55; // Tidehold's sea floor
    const placements = [
      module('deck', 0, 0, seat),
      module('lamp', MODULE, 0, seat),
      module('pylon', MODULE * 2, 0, seat),
    ];
    const world: WorldContent = { ...BUILTIN_WORLD, placements };
    setActiveWorldContent(world);
    try {
      const deckTop = seat + DECK_TOP;
      for (const p of placements) {
        // Centre, and a point near the module's end so butted modules meet.
        for (const dx of [0, MODULE / 2 - 0.3]) {
          expect(placementRampFloorAt(world, SEED, p.x + dx, p.z)).toBeCloseTo(deckTop, 2);
          expect(groundHeight(p.x + dx, p.z, SEED)).toBeCloseTo(deckTop, 2);
        }
        // The deck is a floor over the water, not the seabed under it.
        expect(terrainHeight(p.x, p.z, SEED)).toBeLessThan(deckTop);
        // A body UNDER the span (a swimmer at the waterline) keeps the seabed:
        // the deck 70 yd overhead is not its floor, so the piers are passable.
        // A body on the deck keeps the deck.
        const seabed = terrainHeight(p.x, p.z, SEED);
        expect(groundHeightAtBody(p.x, p.z, SEED, -2)).toBeCloseTo(seabed, 2);
        expect(groundHeightAtBody(p.x, p.z, SEED, deckTop)).toBeCloseTo(deckTop, 2);
        expect(groundHeightAtBody(p.x, p.z, SEED, deckTop + 6)).toBeCloseTo(deckTop, 2);
      }
      // Nothing solid stands on the walkway line between the parapets: the
      // only colliders in the deck band are the parapets (|z| > 3) and, on the
      // pylon module, the towers (same lane) and a lintel over head height.
      const near = colliderInternalsForTest
        .staticWorldColliders(SEED)
        .filter((c) => Math.abs((c as { x: number }).x - MODULE) < MODULE * 2);
      expect(near.length).toBeGreaterThan(0);
      for (const c of near as unknown as { z: number; y?: number; hy?: number; halfHeight?: number }[]) {
        const onWalkway = Math.abs(c.z) < 2.5;
        if (!onWalkway) continue;
        // Anything on the walkway line must clear the head (the lintel) or sit
        // under the deck (piers/slab).
        const top = (c.y ?? 0) + (c.hy ?? c.halfHeight ?? 0);
        const bottom = (c.y ?? 0) - (c.hy ?? c.halfHeight ?? 0);
        expect(bottom >= deckTop + 4 || top <= deckTop).toBe(true);
      }
    } finally {
      setActiveWorldContent(BUILTIN_WORLD);
    }
  });
});
