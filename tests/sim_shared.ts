// Shared fixtures/helpers for the sim test shards (sim.test.ts and
// sim_quests_economy.test.ts). Extracted verbatim when the original single
// file was split to keep per-file runtime bounded.
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, type WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { placePlayerInOpenField } from './helpers/open_field';

export function makeSim(cls: 'warrior' | 'mage' | 'rogue' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

export const PICKUP_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: BUILTIN_WORLD.groundObjects.filter((object) => object.itemId === 'supply_crate'),
};
export const RL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf').slice(0, 1),
  npcs: {},
  groundObjects: [],
};

export function makePickupSim() {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    world: PICKUP_TEST_WORLD,
  });
}

export function makeRlSim(cls: 'warrior' | 'rogue', seed: number) {
  return new Sim({ seed, playerClass: cls, autoEquip: true, world: RL_TEST_WORLD });
}

// Subsystem worlds for the remaining suites (same pattern as PICKUP/RL above):
// each keeps only the ambient content its describe block actually reaches for,
// which makes sim.tick() and Sim construction far cheaper.
export const EMPTY_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
export const WOLF_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};
export const COMBAT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) =>
    ['forest_wolf', 'mudfin_murloc', 'gorrak', 'gravecaller_summoner'].includes(camp.mobId),
  ),
  npcs: {},
  groundObjects: [],
};
export const VENDOR_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf').slice(0, 1),
  groundObjects: [],
};

export function makeScopedSim(
  world: WorldContent,
  cls: 'warrior' | 'mage' | 'rogue' = 'warrior',
  seed = 42,
) {
  return new Sim({ seed, playerClass: cls, autoEquip: true, world });
}

export function nearestMob(sim: Sim, templateId?: string) {
  const p = sim.player;
  let best: any = null,
    bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (templateId && e.templateId !== templateId) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function teleportTo(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.onGround = true;
  p.fallStartY = p.pos.y;
}

export function facePlayerAt(sim: Sim, target: any) {
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
}

export function despawnMobs(sim: Sim) {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.pos.x += 10000;
    e.pos.z += 10000;
    e.prevPos = { ...e.pos };
    e.spawnPos = { ...e.pos };
    e.leashAnchor = { ...e.pos };
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
    e.aggroTargetId = null;
    e.targetId = null;
    e.threat.clear();
    e.auras = [];
    e.castingAbility = null;
  }
}

export function forwardDistance(sim: Sim, ticks = 60): number {
  // Speed comparisons run on empty ground: the starting town is furnished
  // (see src/sim/town_props.ts), so a run from spawn would measure a
  // collision with a workbench rather than a movement multiplier.
  placePlayerInOpenField(sim);
  const start = { ...sim.player.pos };
  sim.moveInput.forward = true;
  for (let i = 0; i < ticks; i++) sim.tick();
  sim.moveInput.forward = false;
  return dist2d(start, sim.player.pos);
}
