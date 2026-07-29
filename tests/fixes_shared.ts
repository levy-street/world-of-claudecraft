// Shared fixtures/helpers for the fixes test shards (fixes.test.ts and
// fixes_loot_npcs.test.ts). Extracted verbatim when the original single file
// was split to keep per-file runtime bounded.
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { generateDecorations, groundHeight } from '../src/sim/world';

export const SEED = 20061;

export const RITUAL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: BUILTIN_WORLD.groundObjects.filter(
    (object) => object.itemId === 'crypt_ritual_circle',
  ),
};

let decorationCache: ReturnType<typeof generateDecorations> | null = null;

export function decorations() {
  if (!decorationCache) decorationCache = generateDecorations(SEED);
  return decorationCache;
}

export function makeSim(cls: 'warrior' | 'mage' | 'hunter' = 'warrior') {
  return new Sim({ seed: SEED, playerClass: cls });
}

export function makeRitualSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior', world: RITUAL_TEST_WORLD });
}

// The loot suite builds every corpse it needs via createMob and never touches
// ambient camps, npcs, or ground objects, so run it on a bare subsystem world
// (pattern from tests/fiesta.test.ts): the two 61s roll-timeout tests tick
// 1220 times each and dominate that shard's runtime on the full world.
export const LOOT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

export function makeLootSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior', world: LOOT_TEST_WORLD });
}

export function teleportTo(sim: Sim, x: number, z: number, pid?: number) {
  const p = sim.entities.get(pid ?? sim.playerId)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

export function placeEntity(sim: Sim, e: Entity, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.spawnPos = { ...e.pos };
}

export function faceTarget(actor: Entity, target: Entity) {
  actor.facing = Math.atan2(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z);
}

export function formRaid(sim: Sim) {
  while ((sim.partyOf(sim.playerId)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(pid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid();
}
