import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import {
  meleeMissChance,
  MOB_VS_PLAYER_MAX_MISS,
  swingMissChance,
  type Entity,
  type SimEvent,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type TestSim = Sim & {
  readonly cfg: { seed: number };
  readonly grid: { update(e: Entity): void };
  readonly playerGrid: { update(e: Entity): void };
};

function makeSim(playerClass: 'hunter' | 'warrior' = 'hunter', seed = 42): TestSim {
  return new Sim({ seed, playerClass, autoEquip: true }) as unknown as TestSim;
}

function nearestWildMob(sim: Sim, templateId: string, from: Entity = sim.player): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null || e.templateId !== templateId) continue;
    const dx = e.pos.x - from.pos.x;
    const dz = e.pos.z - from.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) throw new Error(`no wild ${templateId}`);
  return best;
}

function teleport(sim: TestSim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.grid.update(e);
  if (e.kind === 'player') sim.playerGrid.update(e);
}

function makeLowLevelThreat(mob: Entity): void {
  mob.level = 1;
  mob.weapon = { min: 3, max: 3, speed: 2 };
  mob.stats.armor = 0;
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  mob.aiState = 'idle';
  mob.aggroTargetId = null;
  mob.wanderTarget = null;
  mob.hostile = true;
}

function syncPetLevel(sim: Sim, owner: Entity): void {
  (sim as unknown as { syncPetLevel(owner: Entity): void }).syncPetLevel(owner);
}

function adoptWolf(sim: TestSim): Entity {
  const pet = nearestWildMob(sim, 'forest_wolf');
  pet.ownerId = sim.player.id;
  pet.hostile = false;
  syncPetLevel(sim, sim.player);
  pet.petMode = 'defensive';
  pet.aggroTargetId = null;
  return pet;
}

function incomingFrom(events: SimEvent[], source: Entity, target: Entity): number {
  let total = 0;
  for (const e of events) {
    if (
      e.type === 'damage' &&
      e.sourceId === source.id &&
      e.targetId === target.id &&
      e.kind === 'hit'
    ) {
      total += e.amount;
    }
  }
  return total;
}

describe('low-level mob threat against high-level player-side targets', () => {
  it('an engaged low-level wild mob still damages a much higher-level player', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(20);
    const player = sim.player;
    const wolf = nearestWildMob(sim, 'forest_wolf');
    makeLowLevelThreat(wolf);
    teleport(sim, player, wolf.pos.x + 2, wolf.pos.z);
    wolf.aiState = 'attack';
    wolf.aggroTargetId = player.id;
    wolf.inCombat = true;
    wolf.threat.set(player.id, 1);

    const hpBefore = player.hp;
    let incoming = 0;
    for (let i = 0; i < 20 * 15 && incoming === 0; i++) {
      incoming += incomingFrom(sim.tick(), wolf, player);
    }

    expect(wolf.aggroTargetId).toBe(player.id);
    expect(incoming).toBeGreaterThan(0);
    expect(player.hp).toBeLessThan(hpBefore);
  });

  it('an idle defensive pet is visible to nearby low-level mobs and takes damage', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(20);
    const pet = adoptWolf(sim);
    const wolf = nearestWildMob(sim, 'forest_wolf', pet);
    makeLowLevelThreat(wolf);
    teleport(sim, sim.player, wolf.pos.x + 10, wolf.pos.z);
    teleport(sim, pet, wolf.pos.x + 3, wolf.pos.z);

    const hpBefore = pet.hp;
    let incoming = 0;
    for (let i = 0; i < 20 * 15 && incoming === 0; i++) {
      incoming += incomingFrom(sim.tick(), wolf, pet);
    }

    expect(wolf.aggroTargetId).toBe(pet.id);
    expect(pet.aggroTargetId).toBe(wolf.id);
    expect(incoming).toBeGreaterThan(0);
    expect(pet.hp).toBeLessThan(hpBefore);
    expect(sim.player.inCombat).toBe(true);
  });

  it('low-level players and pets still keep the full miss penalty against high-level mobs', () => {
    const highMob = {
      kind: 'mob',
      level: 20,
      hostile: true,
      ownerId: null,
    } as Entity;
    const player = {
      kind: 'player',
      level: 1,
      ownerId: null,
    } as Entity;
    const pet = {
      kind: 'mob',
      level: 1,
      hostile: false,
      ownerId: 99,
    } as Entity;

    expect(swingMissChance(player, highMob)).toBe(meleeMissChance(player.level, highMob.level));
    expect(swingMissChance(player, highMob)).toBeGreaterThan(MOB_VS_PLAYER_MAX_MISS);
    expect(swingMissChance(pet, highMob)).toBe(meleeMissChance(pet.level, highMob.level));
    expect(swingMissChance(pet, highMob)).toBeGreaterThan(MOB_VS_PLAYER_MAX_MISS);
  });
});
