// Staged spawns for the starter tutorial's scripted reveals.
//
// The tutorial's set pieces (the Warden materializing on her knoll, the first
// wolf bursting out of the brush while the camera pushes in) need an entity to
// appear ON CUE, not at world init. That is what this module is: place one mob or
// one NPC at an exact spot, right now.
//
// Contract, and the reason this is safe to have on the Sim at all:
//   - It draws ZERO rng (exact position, fixed facing, template level), exactly
//     like `spawnWorldBoss` and the practice-dummy arm of the ctor's camp loop, so
//     staging an entity can never perturb the shared draw stream.
//   - It runs in NO tick phase. It is only ever reached from the client host that
//     owns an OFFLINE Sim (src/game/tutorial_scenes.ts, through the hook bag
//     main.ts binds). It is not a wire command and `dispatchMessage` has no case
//     for it, so a network client cannot ask the authoritative server to spawn
//     anything.

import { MOBS, NPCS } from './data';
import { createMob, createNpc } from './entity';
import type { SimContext } from './sim_context';

/** Place a mob at an exact spot. Returns its entity id, or null if unknown. */
export function spawnStagedMob(
  ctx: SimContext,
  templateId: string,
  x: number,
  z: number,
  facing = 0,
): number | null {
  const template = MOBS[templateId];
  if (!template) return null;
  const mob = createMob(ctx.nextId++, template, template.maxLevel, ctx.groundPos(x, z));
  mob.facing = facing;
  mob.prevFacing = facing;
  ctx.addEntity(mob);
  return mob.id;
}

/** Place an NPC at an exact spot. Returns its entity id, or null if unknown. */
export function spawnStagedNpc(
  ctx: SimContext,
  npcId: string,
  x: number,
  z: number,
  facing = 0,
): number | null {
  const def = NPCS[npcId];
  if (!def) return null;
  const npc = createNpc(ctx.nextId++, def, ctx.groundPos(x, z));
  npc.facing = facing;
  npc.prevFacing = facing;
  ctx.addEntity(npc);
  return npc.id;
}
