// The Ignivar dressing props collide exactly where they render: every
// floor-standing placement yields a full-height OBB with the prop's true
// footprint, overhead chains and trim beams stay non-blocking, the derived
// interior set actually carries the prop colliders, and no spawn point
// (player entry or dormant pack) is buried inside one.
import { describe, expect, it } from 'vitest';
import type { Collider, ObbCollider } from '../src/sim/colliders';
import { DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../src/sim/dungeon_layout';
import { IGNIVAR_WATER_CLEANSE_RADIUS } from '../src/sim/encounters/ignivar';
import {
  IGNIVAR_NON_COLLIDING_PROPS,
  IGNIVAR_PROP_COLLIDER_FOOTPRINT,
  IGNIVAR_PROP_NATIVE,
  ignivarPropColliders,
  ignivarPropPlacements,
} from '../src/sim/ignivar_props';
import { derivedInteriorColliders } from '../src/sim/interior_collider_sets';

/** Every room carrying a hand-placed floor pass rides the same contracts;
 *  per-room floors pin the pass sizes so a gutted bake fails loudly. */
const ROOMS = [
  {
    interior: 'ignivar_approach',
    layout: IGNIVAR_FORGE_APPROACH_LAYOUT,
    minFloorProps: 15,
    minSpawnPoints: 4,
  },
  {
    interior: 'ignivar_depths',
    layout: IGNIVAR_SECOND_WING_LAYOUT,
    minFloorProps: 20,
    minSpawnPoints: 3,
  },
] as const;

function pointInObb(collider: ObbCollider, x: number, z: number, pad = 0): boolean {
  // Same local-frame transform as the engine's OBB samplers in colliders.ts.
  const dx = x - collider.x;
  const dz = z - collider.z;
  const cos = Math.cos(-collider.rot);
  const sin = Math.sin(-collider.rot);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return Math.abs(localX) <= collider.hw + pad && Math.abs(localZ) <= collider.hd + pad;
}

const obbs = (colliders: Collider[]): ObbCollider[] =>
  colliders.filter((collider): collider is ObbCollider => collider.type === 'obb');

describe('ignivar prop colliders', () => {
  it('gives every floor prop an OBB matching its rendered footprint', () => {
    for (const room of ROOMS) {
      const placements = ignivarPropPlacements(room.interior, room.layout);
      const colliders = obbs(ignivarPropColliders(room.interior, room.layout));
      // Filter through the module's own non-colliding set, so a new
      // walk-over prop kind (the lava gutters were the first) can never
      // drift this census out of step with the derivation it checks.
      const floorProps = placements.filter(
        (placement) => placement.y === 0 && !IGNIVAR_NON_COLLIDING_PROPS.has(placement.key),
      );
      expect(floorProps.length, room.interior).toBeGreaterThanOrEqual(room.minFloorProps);
      expect(colliders.length, room.interior).toBe(floorProps.length);
      for (const placement of floorProps) {
        const native = IGNIVAR_PROP_NATIVE[placement.key];
        const footprint = IGNIVAR_PROP_COLLIDER_FOOTPRINT[placement.key] ?? 1;
        const match = colliders.find(
          (collider) =>
            collider.x === placement.x &&
            collider.z === placement.z &&
            collider.rot === placement.ry &&
            Math.abs(collider.hw - (native.len * placement.scale * footprint) / 2) < 1e-9 &&
            Math.abs(collider.hd - (native.dep * placement.scale * footprint) / 2) < 1e-9,
        );
        expect(
          match,
          `${room.interior}: ${placement.key} at (${placement.x}, ${placement.z})`,
        ).toBeDefined();
        // Architecture, not parkour: full-height blockers.
        expect(match?.moveTopY).toBeUndefined();
        expect(match?.standable).toBeUndefined();
      }
    }
  });

  it('keeps chains and beam trim non-blocking, and quiet rooms empty', () => {
    for (const room of ROOMS) {
      const placements = ignivarPropPlacements(room.interior, room.layout);
      expect(placements.some((placement) => placement.key === 'chain')).toBe(true);
      const colliders = ignivarPropColliders(room.interior, room.layout);
      for (const collider of obbs(colliders)) {
        for (const placement of placements) {
          if (placement.key !== 'chain' && placement.key !== 'chain_hanging') continue;
          expect(collider.x === placement.x && collider.z === placement.z).toBe(false);
        }
      }
    }
    expect(ignivarPropColliders('crypt', ROOMS[0].layout)).toEqual([]);
  });

  it('rides the derived interior collider set', () => {
    for (const room of ROOMS) {
      const derived = derivedInteriorColliders(null, room.interior, {});
      const props = obbs(ignivarPropColliders(room.interior, room.layout));
      for (const prop of props) {
        expect(
          derived.some(
            (collider) => collider.type === 'obb' && collider.x === prop.x && collider.z === prop.z,
          ),
          `${room.interior}: derived set missing prop collider at (${prop.x}, ${prop.z})`,
        ).toBe(true);
      }
    }
  });

  it('never buries a spawn point inside a prop collider', () => {
    for (const room of ROOMS) {
      const colliders = obbs(ignivarPropColliders(room.interior, room.layout));
      const dungeon = Object.values(DUNGEONS).find((entry) => entry.interior === room.interior);
      expect(dungeon, room.interior).toBeDefined();
      const points: Array<{ label: string; x: number; z: number }> = [];
      if (dungeon?.entry) points.push({ label: 'player entry', ...dungeon.entry });
      for (const spawn of dungeon?.spawns ?? [])
        points.push({ label: `spawn ${spawn.mobId}`, x: spawn.x, z: spawn.z });
      for (const npc of dungeon?.npcs ?? [])
        points.push({ label: `npc ${npc.npcId}`, x: npc.x, z: npc.z });
      expect(points.length, room.interior).toBeGreaterThanOrEqual(room.minSpawnPoints);
      for (const point of points) {
        for (const collider of colliders) {
          expect(
            pointInObb(collider, point.x, point.z, 0.6),
            `${room.interior}: ${point.label} at (${point.x}, ${point.z}) is inside a prop collider at (${collider.x}, ${collider.z})`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps the water pump conduit collider small enough to stand in the cleanse pool', () => {
    // The four pumps ARE the water conduits: a player must be able to reach the
    // active pump's cleanse pool to soak the mechanic. Its central collider has
    // to stay well inside IGNIVAR_WATER_CLEANSE_RADIUS so the water is always
    // physically reachable, whatever the approach angle.
    const pumps = ignivarPropPlacements('ignivar', IGNIVAR_LAYOUT).filter(
      (placement) => placement.key === 'water_pump',
    );
    expect(pumps.length).toBe(4);
    const native = IGNIVAR_PROP_NATIVE.water_pump;
    const footprint = IGNIVAR_PROP_COLLIDER_FOOTPRINT.water_pump ?? 1;
    for (const pump of pumps) {
      const hw = (native.len * pump.scale * footprint) / 2;
      const hd = (native.dep * pump.scale * footprint) / 2;
      // Collider corner plus a generous body radius still lands inside the pool.
      expect(Math.hypot(hw, hd) + 0.75).toBeLessThan(IGNIVAR_WATER_CLEANSE_RADIUS);
    }
  });
});
