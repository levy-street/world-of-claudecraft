// The non-player half of the hosts' modular look provider, factored out of
// main.ts so the Studio viewport composes NPCs exactly the way the game does
// (the editor rendered every named NPC as a stock rig because it never
// installed a look provider at all).
import type { Entity } from '../../sim/types';
import type { ModularLook } from './modular';
import { npcLookFor } from './npc_looks';

/**
 * The composed look for a non-player entity: the authored NPC_LOOKS table.
 * Null keeps the fixed legacy rig, the same answer a pre-creator player gets.
 */
export function npcEntityLookFor(e: Entity): ModularLook | null {
  return npcLookFor(e.templateId, e.kind);
}
