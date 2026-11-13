// Rivalmoot's singleton townsfolk on the Quartered Isle, spawned at world init
// under their reserved ids (outside the sequential allocator, so no shipped
// NPC, camp mob or ground object changes id): the Gilded Strongbox's bursar
// before the counting house door. Idempotent; draws no rng.

import { RIVALMOOT_BURSAR_ENTITY_ID, RIVALMOOT_BURSAR_NPC_ID } from './content/quartered_isle';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

/** Spawn the bursar when the world carries her (the built-in world) and list
 *  her as a place to use the bank. */
export function spawnRivalmootBursar(ctx: SimContext, world: WorldContent): void {
  const def = world.npcs[RIVALMOOT_BURSAR_NPC_ID];
  if (!def?.dynamic) return;
  if (ctx.entities.has(RIVALMOOT_BURSAR_ENTITY_ID)) return;
  ctx.addEntity(createNpc(RIVALMOOT_BURSAR_ENTITY_ID, def, ctx.groundPos(def.pos.x, def.pos.z)));
  if (def.banker && !ctx.bankerIds.includes(RIVALMOOT_BURSAR_ENTITY_ID)) {
    ctx.bankerIds.push(RIVALMOOT_BURSAR_ENTITY_ID);
  }
}
