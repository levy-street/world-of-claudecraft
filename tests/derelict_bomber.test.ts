import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The derelict forge mech (MobTemplate.meleeBomb): crawls to its target facing
// it first (no sideways glide), arms a standup windup on reaching melee, then
// detonates an AoE blast and dies.

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  aggroMob(mob: Entity, target: Entity, social: boolean): boolean;
};

function testSim(): TestSim {
  return new Sim({
    seed: 5,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
}

function addMech(sim: TestSim, x: number, z: number): Entity {
  const mech = createMob(sim.nextId++, MOBS.derelict_mech, 20, {
    x: sim.player.pos.x + x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + z,
  });
  mech.hostile = true;
  mech.aiState = 'idle';
  mech.spawnPos = { ...mech.pos };
  sim.addEntity(mech);
  return mech;
}

describe('derelict mech suicide bomber', () => {
  it('arms on reaching melee, then detonates an AoE blast and dies', () => {
    const sim = testSim();
    const mech = addMech(sim, 0, 3); // already inside melee range (5)
    sim.aggroMob(mech, sim.player, false);
    const hpBefore = sim.player.hp;

    sim.tick(); // reaches melee -> arms
    expect(mech.bombWindup ?? 0).toBeGreaterThan(0);
    expect(mech.aiState).toBe('attack');
    expect(sim.player.hp).toBe(hpBefore); // no damage yet, just arming

    for (let i = 0; i < 65; i++) sim.tick(); // fuse (~2.8s) elapses
    expect(mech.dead).toBe(true); // the blast is its own death
    expect(sim.player.hp).toBeLessThan(hpBefore); // caught in the blast
  });

  it('does not detonate while still out of melee range', () => {
    const sim = testSim();
    const mech = addMech(sim, 0, 20); // far away
    sim.aggroMob(mech, sim.player, false);
    for (let i = 0; i < 10; i++) sim.tick();
    // Still approaching, not yet armed or dead.
    expect(mech.dead).toBe(false);
  });

  it('turns to face the target before it translates (no sideways glide)', () => {
    const sim = testSim();
    const mech = addMech(sim, 0, 15); // 15yd away, must chase
    mech.facing = 0; // facing +z, AWAY from the player (who is at -z from the mech)
    sim.aggroMob(mech, sim.player, false);
    const start = { x: mech.pos.x, z: mech.pos.z };

    sim.tick();
    // First tick it rotates in place toward the player, it does not slide.
    expect(mech.pos.x).toBe(start.x);
    expect(mech.pos.z).toBe(start.z);
    expect(mech.facing).not.toBe(0);

    // Once aligned it does close the distance.
    let moved = false;
    for (let i = 0; i < 60 && !moved; i++) {
      sim.tick();
      if (mech.pos.z !== start.z) moved = true;
    }
    expect(moved).toBe(true);
  });
});
