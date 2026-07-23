import { describe, expect, it } from 'vitest';
import { findNearbyAllies } from '../src/sim/mob/nearby_allies';
import { SpatialGrid } from '../src/sim/spatial';
import type { Entity } from '../src/sim/types';

function mob(id: number, x: number, z: number, opts: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    dead: false,
    ownerId: null,
    hostile: true,
    hp: 100,
    maxHp: 100,
    pos: { x, y: 0, z },
    ...opts,
  } as Entity;
}

describe('findNearbyAllies', () => {
  it('finds same-faction mobs within radius via the grid, matching a brute-force scan', () => {
    const grid = new SpatialGrid();
    const caster = mob(1, 0, 0);
    const near = mob(2, 10, 0);
    const far = mob(3, 500, 0);
    const enemy = mob(4, 5, 0, { hostile: false });
    const player = mob(5, 5, 0, { kind: 'player' });
    const pet = mob(6, 5, 0, { ownerId: 99 });
    const corpse = mob(7, 5, 0, { dead: true });
    for (const e of [caster, near, far, enemy, player, pet, corpse]) grid.insert(e);

    const found = findNearbyAllies(grid, caster, 40);
    expect(found.map((e) => e.id)).toEqual([1, 2]);

    const all = [caster, near, far, enemy, player, pet, corpse];
    const bruteForce = all
      .filter(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.hostile === caster.hostile &&
          e.ownerId == null &&
          Math.hypot(e.pos.x - caster.pos.x, e.pos.z - caster.pos.z) <= 40,
      )
      .map((e) => e.id)
      .sort((x, y) => x - y);
    expect(found.map((e) => e.id)).toEqual(bruteForce);
  });

  it('returns matches in ascending entity-id order regardless of grid insertion or bucket order, so per-ally rng draws and max-hp tie-breaks stay stable', () => {
    const grid = new SpatialGrid();
    // Insert out of id order, and spread across distinct grid cells (cellSize
    // 32), so bucket-iteration order alone would not happen to match id order.
    const c = mob(5, 0, 0);
    const b = mob(3, -40, 0);
    const a = mob(9, 40, 0);
    for (const e of [a, b, c]) grid.insert(e);

    const found = findNearbyAllies(grid, c, 100);
    expect(found.map((e) => e.id)).toEqual([3, 5, 9]);
  });

  it('applies the caller predicate on top of the faction/radius filter', () => {
    const grid = new SpatialGrid();
    const caster = mob(1, 0, 0, { hp: 100, maxHp: 100 });
    const wounded = mob(2, 5, 0, { hp: 30, maxHp: 100 });
    const healthy = mob(3, 5, 0, { hp: 100, maxHp: 100 });
    for (const e of [caster, wounded, healthy]) grid.insert(e);

    const found = findNearbyAllies(grid, caster, 40, (ally) => ally.hp < ally.maxHp);
    expect(found.map((e) => e.id)).toEqual([2]);
  });

  it('lets the predicate exclude the caster itself (channelHeal protectee pick)', () => {
    const grid = new SpatialGrid();
    const caster = mob(1, 0, 0, { maxHp: 500 });
    const boss = mob(2, 5, 0, { maxHp: 9000 });
    const add = mob(3, 5, 0, { maxHp: 200 });
    for (const e of [caster, boss, add]) grid.insert(e);

    const candidates = findNearbyAllies(grid, caster, 40, (ally) => ally.id !== caster.id);
    const protectee = candidates.reduce<Entity | null>(
      (best, ally) => (!best || ally.maxHp > best.maxHp ? ally : best),
      null,
    );
    expect(protectee?.id).toBe(2);
  });

  it('excludes allies outside the radius, and includes one exactly on the boundary', () => {
    const grid = new SpatialGrid();
    const caster = mob(1, 0, 0);
    const justInside = mob(2, 39, 0);
    const onBoundary = mob(4, 40, 0);
    const justOutside = mob(3, 41, 0);
    for (const e of [caster, justInside, onBoundary, justOutside]) grid.insert(e);

    const found = findNearbyAllies(grid, caster, 40);
    expect(found.map((e) => e.id)).toEqual([1, 2, 4]);
  });
});
