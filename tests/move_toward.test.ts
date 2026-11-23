// src/sim/mob/move_toward.ts: the mob/pet/feared-player one-tick step, moved
// whole out of Sim.moveToward (ctx.moveToward still binds the coordinator's
// thin delegate). Pins the delegate wiring and the arms a move must keep:
// arrival, a speed-bounded step on open ground, the release's zero-step floor
// snap on the built-in world, and the authored-map immobile hold that keeps a
// body something else owns where its owner put it.

import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, PLAYER_START, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { MOVE_SLIDE_FAN, moveTowardImpl } from '../src/sim/mob/move_toward';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => {
  setActiveWorldContent(null);
});

function builtinSim(): Sim {
  setActiveWorldContent(null);
  return new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
}

function mobAt(sim: Sim, id: number, x: number, z: number): Entity {
  return createMob(id, MOBS.training_dummy, 5, sim.groundPos(x, z));
}

describe('moveTowardImpl', () => {
  it('keeps the straight heading first in the slide fan', () => {
    expect(MOVE_SLIDE_FAN[0]).toBe(0);
  });

  it('reports arrival inside 0.3 yd without moving', () => {
    const sim = builtinSim();
    const e = mobAt(sim, 900_001, PLAYER_START.x, PLAYER_START.z);
    const before = { ...e.pos };
    const dest = { x: e.pos.x + 0.2, y: e.pos.y, z: e.pos.z };
    expect(moveTowardImpl(sim.ctx, e, dest, 7)).toBe(true);
    expect(e.pos).toEqual(before);
  });

  it('steps at most speed * DT across open ground and arrives in time', () => {
    const sim = builtinSim();
    const e = mobAt(sim, 900_002, PLAYER_START.x, PLAYER_START.z);
    const dest = sim.groundPos(PLAYER_START.x + 4, PLAYER_START.z);
    const d0 = dist2d(e.pos, dest);
    expect(moveTowardImpl(sim.ctx, e, dest, 7)).toBe(false);
    const d1 = dist2d(e.pos, dest);
    expect(d0 - d1).toBeGreaterThan(0);
    expect(d0 - d1).toBeLessThanOrEqual(7 * DT + 1e-9);
    let arrived = false;
    for (let i = 0; i < 40 && !arrived; i++) arrived = moveTowardImpl(sim.ctx, e, dest, 7);
    expect(arrived).toBe(true);
  });

  it('is what ctx.moveToward runs (same step, bit for bit)', () => {
    const sim = builtinSim();
    const a = mobAt(sim, 900_003, PLAYER_START.x, PLAYER_START.z);
    const b = mobAt(sim, 900_004, PLAYER_START.x, PLAYER_START.z);
    const dest = sim.groundPos(PLAYER_START.x + 6, PLAYER_START.z + 3);
    for (let i = 0; i < 10; i++) {
      expect(sim.ctx.moveToward(a, dest, 6)).toBe(moveTowardImpl(sim.ctx, b, dest, 6));
      expect(a.pos).toEqual(b.pos);
      expect(a.facing).toBe(b.facing);
    }
  });

  it('keeps the release zero-step floor snap on the built-in world', () => {
    const sim = builtinSim();
    const e = mobAt(sim, 900_005, PLAYER_START.x, PLAYER_START.z);
    const floor = e.pos.y;
    e.pos.y = floor + 30;
    const dest = sim.groundPos(PLAYER_START.x + 5, PLAYER_START.z);
    expect(moveTowardImpl(sim.ctx, e, dest, 0)).toBe(false);
    expect(e.pos.y).toBeCloseTo(floor, 6);
  });

  it('holds an immobile body where it is on an authored map, turning only', () => {
    // A map document over the shipped world: an authored map.
    const world = { ...BUILTIN_WORLD, placements: [] };
    setActiveWorldContent(world);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true, world });
    const e = mobAt(sim, 900_006, 0, 0);
    e.pos = { x: e.pos.x, y: e.pos.y + 30, z: e.pos.z };
    const before = { ...e.pos };
    const dest = { x: e.pos.x + 5, y: e.pos.y, z: e.pos.z + 5 };
    expect(moveTowardImpl(sim.ctx, e, dest, 0)).toBe(false);
    expect(e.pos).toEqual(before);
    expect(e.facing).toBeCloseTo(Math.atan2(5, 5), 6);
  });
});
