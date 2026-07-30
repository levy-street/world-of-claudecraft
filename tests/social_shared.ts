// Shared fixtures for tests/social.test.ts and tests/social_classes.test.ts.
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Party/duel/trade/instance tests only ever talk between hand-added players
// (dungeon instances spawn their own mobs from DUNGEONS data at claim time),
// so none of the hundreds of ambient overworld mobs/NPCs/objects matter, and
// several timelines tick 30s-plus of world time. Keep every terrain-relevant
// field identical to BUILTIN_WORLD while stripping only constructor-spawned
// entity content. Tests that DO need real camp mobs (a live forest wolf) use
// makeFullWorld() instead.
export const SOCIAL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

export function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: SOCIAL_TEST_WORLD });
}

export function makeFullWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

export function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

export function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = mustEntity(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

export function face(sim: Sim, pid: number, targetId: number) {
  const e = mustEntity(sim, pid);
  const t = mustEntity(sim, targetId);
  e.facing = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
}

export function nearestMob(
  sim: Sim,
  templateId: string,
  from: { x: number; z: number } = { x: 0, z: 0 },
): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error(`missing mob ${templateId}`);
  return best;
}
