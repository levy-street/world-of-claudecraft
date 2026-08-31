import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// MobTemplate.idleStationary keeps a hand-placed pack (the downed forge mechs)
// motionless in formation until something pulls it, without disabling combat
// movement. It skips ONLY the idle wander, drawn after the proximity aggro scan.

type TestSim = Sim & { addEntity(entity: Entity): void; nextId: number };

function testSim(): TestSim {
  return new Sim({
    seed: 7,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
}

function addIdleMob(sim: TestSim, templateId: string): Entity {
  // Far from the player so the proximity aggro scan never fires; the idle AI
  // still ticks every tick (idleMobTickRadius defaults to 0).
  const pos = { x: sim.player.pos.x + 60, y: sim.player.pos.y, z: sim.player.pos.z + 60 };
  const mob = createMob(sim.nextId++, MOBS[templateId], 20, pos);
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.spawnPos = { ...mob.pos };
  sim.addEntity(mob);
  return mob;
}

describe('idleStationary', () => {
  it('holds a derelict mech on its spawn while idle', () => {
    const sim = testSim();
    const mob = addIdleMob(sim, 'derelict_mech');
    const spawn = { x: mob.pos.x, z: mob.pos.z };

    for (let i = 0; i < 200; i++) sim.tick();
    expect(mob.pos.x).toBe(spawn.x);
    expect(mob.pos.z).toBe(spawn.z);
    expect(mob.aiState).toBe('idle');
  });

  it('still wakes on proximity (dormancy, not a skipped tick)', () => {
    const sim = testSim();
    // Spawn it right next to the player: the idle AI runs every tick, so it must
    // still aggro. This proves the hold above is deliberate dormancy.
    const pos = { x: sim.player.pos.x, y: sim.player.pos.y, z: sim.player.pos.z + 3 };
    const mob = createMob(sim.nextId++, MOBS.derelict_mech, 20, pos);
    mob.hostile = true;
    mob.aiState = 'idle';
    mob.spawnPos = { ...mob.pos };
    sim.addEntity(mob);
    for (let i = 0; i < 5; i++) sim.tick();
    // It woke and engaged (chase, or attack once in melee range): dormancy, not
    // a dead tick.
    expect(mob.aiState).not.toBe('idle');
    expect(mob.inCombat).toBe(true);
    expect(mob.aggroTargetId).toBe(sim.playerId);
  });

  it('a normal mob without the flag does wander off its spawn', () => {
    const sim = testSim();
    const mob = addIdleMob(sim, 'forest_wolf');
    const spawn = { x: mob.pos.x, z: mob.pos.z };
    let moved = false;
    for (let i = 0; i < 1200 && !moved; i++) {
      sim.tick();
      if (mob.pos.x !== spawn.x || mob.pos.z !== spawn.z) moved = true;
    }
    expect(moved).toBe(true);
  });
});
