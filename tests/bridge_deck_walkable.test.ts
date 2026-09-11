// Bridge_01's deck is WALKABLE, not a wall.
//
// The medieval-village bridge shipped with a Collision Master authoring that
// made every part of it solid: a deck slab, two end abutments, and two side
// railings. At any real placement scale the abutments stand several yards tall
// across both approaches, so running at the bridge stopped you dead and the
// deck was never reachable — the same "I can't walk up my own ramp" shape the
// stairs convention exists to avoid, one asset at a time.
//
// The deck is now an authored walkable ramp deck (sim/placement_ramps.ts) and
// only the railings stay solid, so you walk on and over the span and can still
// only leave it over the sides on purpose.

import { describe, expect, it } from 'vitest';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import { groundHeight, terrainHeight } from '../src/sim/world';
import type { WorldContent } from '../src/sim/types';

const SEED = 20061;
// A real placement from an authored map: detached (frozen seat) and scaled up,
// which is exactly where the abutments were tallest.
const BRIDGE = {
  assetId: 'medieval_village_v2/environment/Bridge_01',
  path: '/models/medieval_village_v2/environment/Bridge_01.glb',
  x: 154.673,
  z: 17.302,
  rotY: 0.7344782572578037,
  scale: 6.57,
  collide: true,
  collideRadius: 4,
  collisionMode: 'baked',
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  y: -3.16,
  detached: true,
  groundY: -6.0173122456675205,
} as unknown as NonNullable<WorldContent['placements']>[number];

// The authored deck top, in the same normalized model space as the override.
const DECK_MODEL_TOP = 1.2543;

describe('Bridge_01 deck', () => {
  it('raises the walkable floor across the span instead of blocking it', () => {
    const world: WorldContent = { ...BUILTIN_WORLD, placements: [BRIDGE] };
    setActiveWorldContent(world);
    try {
      const deckTop = BRIDGE.groundY! + BRIDGE.y! + DECK_MODEL_TOP * BRIDGE.scale;

      // The deck carries the floor at the span's centre.
      expect(placementRampFloorAt(world, SEED, BRIDGE.x, BRIDGE.z)).toBeCloseTo(deckTop, 2);
      // And it reaches the walkable ground the player actually stands on, so
      // crossing the span walks the deck rather than the riverbed under it.
      expect(groundHeight(BRIDGE.x, BRIDGE.z, SEED)).toBeCloseTo(deckTop, 2);
      expect(terrainHeight(BRIDGE.x, BRIDGE.z, SEED)).toBeLessThan(deckTop);

      const near = colliderInternalsForTest
        .staticWorldColliders(SEED)
        .filter(
          (c) =>
            Math.hypot(
              (c as { x: number }).x - BRIDGE.x,
              (c as { z: number }).z - BRIDGE.z,
            ) < 12,
        );
      // Only the two railings collide, and neither is a tall approach blocker:
      // a band this shallow is a rail you brush, not a wall you stop against.
      const bands = near.map((c) => {
        const b = c as { baseY?: number; hiY?: number };
        return b.hiY !== undefined && b.baseY !== undefined ? b.hiY - b.baseY : Infinity;
      });
      expect({ colliders: near.length, tall: bands.filter((h) => h > 2).length }).toEqual({
        colliders: 2,
        tall: 0,
      });
    } finally {
      setActiveWorldContent(null);
    }
  });
});
