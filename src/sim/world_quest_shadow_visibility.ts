// The courier guards exist only for a cloaked infiltrator.
//
// The guard NPCs are shared world entities (the patrols run for everyone), but
// a viewer sees them only while wearing the Duskweave Cloak: to a passer-by, or
// to a player who has not borrowed the cloak yet, the glade is empty and Scout
// Valerie stands alone. Same shape as the investigation disguise rule: a pure
// per-viewer predicate consumed by the renderer gate and every interaction scan,
// never a change to the shared entity.

import { SHADOW_GUARDS, SHADOW_NPC_ID, SHADOW_QUEST_ID } from './content/world_quest_shadow';
import type { Entity, WorldQuestProgress } from './types';

const GUARD_ENTITY_IDS: ReadonlySet<number> = new Set(SHADOW_GUARDS.map((row) => row.entityId));

export interface ShadowVisibilityReader {
  worldQuestLog?: ReadonlyMap<string, WorldQuestProgress>;
}

export function isShadowGuardEntity(entity: Pick<Entity, 'id' | 'kind'>): boolean {
  return entity.kind === 'npc' && GUARD_ENTITY_IDS.has(entity.id);
}

/** True when this viewer must not see (or target) the guard, or the scout
 *  once the viewer has finished the dispatch run (the glade empties for them). */
export function shadowGuardHidden(
  entity: Pick<Entity, 'id' | 'kind'>,
  world: ShadowVisibilityReader,
): boolean {
  const progress = world.worldQuestLog?.get(SHADOW_QUEST_ID);
  if (entity.kind === 'npc' && entity.id === SHADOW_NPC_ID) return progress?.state === 'completed';
  if (!isShadowGuardEntity(entity)) return false;
  return progress?.state !== 'active' || progress.shadow?.phase !== 'cloaked';
}
