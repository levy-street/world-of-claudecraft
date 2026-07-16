import { describe, expect, it } from 'vitest';
import { type Collider, resolvePosition } from '../src/sim/colliders';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { DUNGEON_WALL_HW, INFERNAL_ABYSS_LAYOUT, layoutColliders } from '../src/sim/dungeon_layout';
import { authoredWallSegments, inAnyRoom } from '../src/sim/dungeon_rooms';
import { infernalLavaAt } from '../src/sim/instances/infernal_abyss_hazards';

const rooms = INFERNAL_ABYSS_LAYOUT.rooms ?? [];
const doors = INFERNAL_ABYSS_LAYOUT.doors ?? [];
const decor = INFERNAL_ABYSS_LAYOUT.decor ?? [];

function blocks(collider: Collider, x: number, z: number, radius: number): boolean {
  if (collider.type === 'circle') {
    return Math.hypot(x - collider.x, z - collider.z) < collider.r + radius;
  }
  return (
    Math.abs(x - collider.x) < collider.hw + radius &&
    Math.abs(z - collider.z) < collider.hd + radius
  );
}

function reachableGridTargets(targets: ReadonlyArray<readonly [number, number]>): Set<number> {
  const colliders = layoutColliders(INFERNAL_ABYSS_LAYOUT);
  const bodyRadius = 0.45;
  const key = (x: number, z: number): string => `${x},${z}`;
  const queue: Array<readonly [number, number]> = [[0, -15]];
  const visited = new Set([key(0, -15)]);
  const reached = new Set<number>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [x, z] = queue[cursor];
    targets.forEach(([tx, tz], index) => {
      if (Math.abs(x - tx) <= 1 && Math.abs(z - tz) <= 1) reached.add(index);
    });
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      const nextKey = key(nx, nz);
      if (visited.has(nextKey) || !inAnyRoom(rooms, nx, nz)) continue;
      if (colliders.some((collider) => blocks(collider, nx, nz, bodyRadius))) continue;
      visited.add(nextKey);
      queue.push([nx, nz]);
    }
  }
  return reached;
}

describe('Infernal Abyss authored layout', () => {
  it('contains the complete main descent and both optional side rooms', () => {
    expect(rooms.map((room) => room.id)).toEqual([
      'ashen_descent_entrance',
      'chainscar_descent',
      'lower_forge_junction',
      'lava_maze_approach',
      'lava_maze',
      'lost_armory',
      'pyre_golem_crucible',
      'infernal_forge',
      'gladiator_pit',
      'maw_approach',
      'maw_bridge',
      'heart_cairn_vestibule',
      'heart_cairn_gate',
      'heart_cairn_lower',
      'heart_cairn_boss_arena',
      'heart_cairn_crown',
    ]);
    expect(Math.min(...rooms.map((room) => room.x0))).toBeGreaterThanOrEqual(-82);
    expect(Math.max(...rooms.map((room) => room.x1))).toBeLessThanOrEqual(72);
    expect(INFERNAL_ABYSS_LAYOUT.dais).toEqual({ x: 0, z: 222, r: 18 });
    expect(INFERNAL_ABYSS_LAYOUT.barriers).toHaveLength(14);
  });

  it('aligns each door to a room boundary and cuts a matching wall opening', () => {
    const walls = authoredWallSegments(rooms, doors, DUNGEON_WALL_HW);
    for (const door of doors) {
      const horizontal = door.hw > door.hd;
      const alignedRooms = rooms.filter((room) =>
        horizontal
          ? (room.z0 === door.z || room.z1 === door.z) &&
            door.x - door.hw >= room.x0 &&
            door.x + door.hw <= room.x1
          : (room.x0 === door.x || room.x1 === door.x) &&
            door.z - door.hd >= room.z0 &&
            door.z + door.hd <= room.z1,
      );
      expect(alignedRooms.length).toBeGreaterThanOrEqual(1);
      expect(
        walls.some((wall) => blocks({ type: 'obb', ...wall, rot: 0 }, door.x, door.z, 0)),
      ).toBe(false);
    }
    // Literal segment-count pin: a door that stops cutting its opening (or a
    // room edge that stops emitting walls) changes this count.
    expect(walls).toHaveLength(63);
  });

  it('stays inside the shared instance-footprint envelope with margin', () => {
    // updateInstances' instanceContains window is |x| < 120, |z| < 250 around
    // the instance origin. Every room (and so every spawn, hazard, and lore
    // object) must sit inside it or players at the far end read as "outside
    // the instance" (occupancy, corpse-run, and the lava containment gate).
    for (const room of rooms) {
      expect(Math.abs(room.x0), room.id).toBeLessThan(120);
      expect(Math.abs(room.x1), room.id).toBeLessThan(120);
      expect(Math.abs(room.z0), room.id).toBeLessThan(250);
      expect(Math.abs(room.z1), room.id).toBeLessThan(250);
    }
  });

  it('keeps the main route, armory branch, and gladiator branch traversable', () => {
    const targets = [
      [-66, 59],
      [-64, 84],
      [0, 121],
      [48, 110],
      [0, 162],
      [0, 224],
    ] as const;
    expect(reachableGridTargets(targets)).toEqual(new Set(targets.map((_, index) => index)));
  });

  it('derives measured decor collisions while lava dressing remains walkable', () => {
    const colliders = layoutColliders(INFERNAL_ABYSS_LAYOUT);
    const collidingDecor = decor.filter((item) => item.r !== undefined);
    for (const item of collidingDecor) {
      expect(
        colliders.some(
          (collider) =>
            collider.type === 'circle' &&
            collider.x === item.x &&
            collider.z === item.z &&
            collider.r === item.r,
        ),
      ).toBe(true);
    }
    for (const item of decor.filter(
      (entry) =>
        entry.key === 'lava_pool' || entry.key === 'lava_fissure' || entry.key === 'lava_moat',
    )) {
      expect(item.r).toBeUndefined();
      expect(
        colliders.some(
          (collider) =>
            collider.type === 'circle' && collider.x === item.x && collider.z === item.z,
        ),
      ).toBe(false);
    }
    expect(collidingDecor.map((item) => item.key)).toContain('abyssal_heart_altar');
    expect(collidingDecor.map((item) => item.key)).toContain('infernal_forge_anvil');
  });

  it('registers the infernal_abyss collision key on live instance resolution', () => {
    const dungeon = DUNGEONS.infernal_abyss;
    expect(dungeon.interior).toBe('infernal_abyss');
    const origin = instanceOrigin(dungeon.index, 0);
    const wallPoint = { x: origin.x - 18, z: origin.z - 10 };
    expect(resolvePosition(42, wallPoint.x, wallPoint.z, 0.5)).not.toEqual(wallPoint);

    // The outermost shell is solid on purpose: the exit PORTAL at (0,-14) is
    // the one way out (its 2.0 trigger radius could never cover a walkable
    // opening, which would let players slip past it into the void).
    const sealedShell = { x: origin.x, z: origin.z - 25 };
    expect(resolvePosition(42, sealedShell.x, sealedShell.z, 0.5)).not.toEqual(sealedShell);
  });

  it('keeps every authored spawn and quest object inside unblocked floor space', () => {
    const dungeon = DUNGEONS.infernal_abyss;
    const colliders = layoutColliders(INFERNAL_ABYSS_LAYOUT);
    for (const point of [...dungeon.spawns, ...(dungeon.objects ?? [])]) {
      expect(inAnyRoom(rooms, point.x, point.z), `${point.x},${point.z} is outside`).toBe(true);
      expect(
        colliders.some((collider) => blocks(collider, point.x, point.z, 0.5)),
        `${point.x},${point.z} is blocked`,
      ).toBe(false);
    }
  });

  it('keeps every authored spawn and quest object out of the lava hazards', () => {
    // Lava has no collider, so the floor-space check above cannot catch a mob
    // idling inside a pool (a melee player engaging it would eat 8 percent
    // max hp per second at the pull position).
    const dungeon = DUNGEONS.infernal_abyss;
    for (const point of [...dungeon.spawns, ...(dungeon.objects ?? [])]) {
      expect(
        infernalLavaAt(point.x, point.z),
        `spawn/object at ${point.x},${point.z} is in lava`,
      ).toBe(false);
    }
  });
});
