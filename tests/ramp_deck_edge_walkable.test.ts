// You can walk ON to an authored ramp deck, at any placement scale.
//
// Two things used to stop you at the bottom step of a Collision Master ramp:
//
//  1. The deck itself started above the model base. biome/city_stairs was
//     authored from y0 = 0.1895, so the bottom of the flight was a vertical
//     lip rather than a slope meeting the ground.
//  2. The movement gate treated that lip as a terrain cliff. Its authored-step
//     bypass is capped at MAX_STEP_HEIGHT, which is the right reach for stepping
//     ON TO A BOX but wrong for a ramp deck: the cap is in world yards while
//     the lip scales with the placement, so one asset walked fine at scale 1
//     and became a wall at scale 6, the size makers actually build at.
//
// A ramp deck is authored walkable ground whose whole purpose is to be walked
// onto, so its leading edge is never a wall now. Boxes keep the fixed reach.

import { describe, expect, it } from 'vitest';
import { ASSET_COLLISION_OVERRIDES } from '../src/sim/asset_collision_overrides.generated';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { WorldContent } from '../src/sim/types';

const SEED = 20061;

describe('authored ramp decks', () => {
  it('start at the model base, so the bottom of a flight is a slope not a lip', () => {
    for (const [assetId, override] of Object.entries(ASSET_COLLISION_OVERRIDES)) {
      for (const ramp of override.ramps ?? []) {
        // A deck may legitimately START high (a bridge span, a market stand's
        // counter). What it must not do is start a little high: a lip under a
        // yard of model height is an authoring slip, and it lands exactly where
        // the player tries to step on.
        const low = Math.min(ramp.y0, ramp.y1);
        expect(low < 0.05 || low > 1, `${assetId} deck starts at ${low}`).toBe(true);
      }
    }
  });

  it('lets a scaled-up staircase be walked onto from the ground', () => {
    const stairs = {
      assetId: 'biome/city_stairs',
      path: '/models/biome/city_stairs.glb',
      x: 40,
      z: 40,
      rotY: 0,
      scale: 6,
      collide: true,
      collideRadius: 4,
      collisionMode: 'baked',
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      y: 0,
    } as unknown as NonNullable<WorldContent['placements']>[number];
    const world: WorldContent = { ...BUILTIN_WORLD, placements: [stairs] };
    setActiveWorldContent(world);
    try {
      const ramp = ASSET_COLLISION_OVERRIDES['biome/city_stairs'].ramps![0];
      // The deck's low end now meets the seat instead of hanging above it, so
      // the step up from bare ground is nothing at all rather than a lip that
      // grows with the placement.
      const lip = Math.min(ramp.y0, ramp.y1) * stairs.scale;
      expect(lip).toBeLessThanOrEqual(MAX_STEP_HEIGHT);

      // and the deck genuinely slopes across the flight rather than sitting
      // flat. Sample the deck's OWN two ends: it carries a yaw (ry) inside the
      // model frame, so walking a world axis crosses it at an angle and only
      // ever sees part of the rise. Undo ry, then the placement transform.
      const deckEnd = (along: number): { x: number; z: number } => {
        const c = Math.cos(ramp.ry ?? 0);
        const sn = Math.sin(ramp.ry ?? 0);
        const ox = along * c + ramp.x;
        const oz = -along * sn + ramp.z;
        return { x: stairs.x + ox * stairs.scale, z: stairs.z + oz * stairs.scale };
      };
      const low = deckEnd(-ramp.hx * 0.98);
      const high = deckEnd(ramp.hx * 0.98);
      const floorLow = placementRampFloorAt(world, SEED, low.x, low.z);
      const floorHigh = placementRampFloorAt(world, SEED, high.x, high.z);
      expect(Number.isFinite(floorLow) && Number.isFinite(floorHigh)).toBe(true);
      // the full authored rise, carried across the deck
      const rise = (ramp.y1 - ramp.y0) * stairs.scale;
      expect(Math.abs(floorHigh - floorLow)).toBeGreaterThan(rise * 0.9);
    } finally {
      setActiveWorldContent(null);
    }
  });
});
