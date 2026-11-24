// Rivalmoot's singleton townsfolk on the Quartered Isle, spawned at world init
// under their reserved ids (outside the sequential allocator, so no shipped
// NPC, camp mob or ground object changes id): the Gilded Strongbox's bursar
// before the counting house door, and the townsfolk of content/quartered_isle_story.ts
// (the Keeper of the Moot Rolls, the innkeeper, the outfitter and Captain Thessaly).
// Idempotent; draws no rng.

import { RIVALMOOT_BURSAR_ENTITY_ID, RIVALMOOT_BURSAR_NPC_ID } from './content/quartered_isle';
import { RIVALMOOT_TOWNSFOLK_ENTITY_IDS } from './content/quartered_isle_story';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

/** Spawn the bursar when the world carries her (the built-in world) and list
 *  her as a place to use the bank, then the rest of Rivalmoot's townsfolk. */
export function spawnRivalmootBursar(ctx: SimContext, world: WorldContent): void {
  const def = world.npcs[RIVALMOOT_BURSAR_NPC_ID];
  if (def?.dynamic && !ctx.entities.has(RIVALMOOT_BURSAR_ENTITY_ID)) {
    ctx.addEntity(createNpc(RIVALMOOT_BURSAR_ENTITY_ID, def, ctx.groundPos(def.pos.x, def.pos.z)));
    if (def.banker && !ctx.bankerIds.includes(RIVALMOOT_BURSAR_ENTITY_ID)) {
      ctx.bankerIds.push(RIVALMOOT_BURSAR_ENTITY_ID);
    }
  }
  spawnRivalmootTownsfolk(ctx, world);
}

/** The townsfolk, each under its reserved id, when the world carries them. */
export function spawnRivalmootTownsfolk(ctx: SimContext, world: WorldContent): void {
  for (const [npcId, entityId] of Object.entries(RIVALMOOT_TOWNSFOLK_ENTITY_IDS)) {
    const def = world.npcs[npcId];
    if (!def?.dynamic || ctx.entities.has(entityId)) continue;
    ctx.addEntity(createNpc(entityId, def, ctx.groundPos(def.pos.x, def.pos.z)));
  }
}
