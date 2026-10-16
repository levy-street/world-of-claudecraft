// The non-player half of the hosts' modular look provider, factored out of
// main.ts so the Studio viewport composes NPCs exactly the way the game does
// (the editor rendered every named NPC as a stock rig because it never
// installed a look provider at all).
import type { Entity } from '../../sim/types';
import type { ModularLook } from './modular';

/**
 * The composed look for a non-player entity. Null for every one: an NPC_LOOKS
 * NPC (or escortee) never composes, it wears its authored look on a WOC class
 * body, which createCharacterVisual resolves by templateId (npc_looks.ts
 * npcLookFor), and any other mob keeps its mob visual. The seam stays so a
 * runtime-composed non-player look has one place to land.
 */
export function npcEntityLookFor(_e: Entity): ModularLook | null {
  return null;
}
