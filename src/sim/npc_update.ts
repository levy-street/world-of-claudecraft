import { cleanseFriendlyNpcAuras } from './combat/auras';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** Friendly NPC upkeep and scripted walks, including after an encounter ends. */
export function updateNpc(ctx: SimContext, npc: Entity): void {
  cleanseFriendlyNpcAuras(ctx, npc);
  if (npc.wanderTarget && ctx.moveToward(npc, npc.wanderTarget, npc.moveSpeed)) {
    npc.wanderTarget = null;
  }
}
