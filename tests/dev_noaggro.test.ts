import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// [dev] /dev noaggro lets a designer stand among freshly spawned mobs to verify
// pack placement without scattering them. It gates aggroMob, the single choke
// point every autonomous pull runs through.

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  aggroMob(mob: Entity, target: Entity, social: boolean): boolean;
};

function devSim(): TestSim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
}

function idleHostileMob(sim: TestSim): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, sim.player.level, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

describe('/dev noaggro', () => {
  it('toggles the per-player flag on and off', () => {
    const sim = devSim();
    expect(sim.player.devNoAggro).toBeFalsy();
    sim.chat('/dev noaggro');
    expect(sim.player.devNoAggro).toBe(true);
    sim.chat('/dev noaggro');
    expect(sim.player.devNoAggro).toBe(false);
  });

  it('makes mobs refuse to pull the player while on, and pull again once off', () => {
    const sim = devSim();
    const mob = idleHostileMob(sim);

    sim.chat('/dev noaggro');
    expect(sim.aggroMob(mob, sim.player, false)).toBe(false);
    expect(mob.aiState).toBe('idle');
    expect(mob.aggroTargetId).toBe(null);

    sim.chat('/dev noaggro');
    expect(sim.aggroMob(mob, sim.player, false)).toBe(true);
    expect(mob.aiState).toBe('chase');
    expect(mob.aggroTargetId).toBe(sim.playerId);
  });
});
