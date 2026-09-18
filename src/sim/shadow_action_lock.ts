import { SHADOW_QUEST_ID } from './content/world_quest_shadow';
import type { Entity, WorldQuestProgress } from './types';
export const SHADOW_CLOAK_AURA_ID = 'world_quest_shadow_cloak';
export function shadowActionsLocked(log: ReadonlyMap<string, WorldQuestProgress>): boolean {
  return log.get(SHADOW_QUEST_ID)?.shadow?.phase === 'cloaked';
}
export function hasShadowCloak(entity: Pick<Entity, 'auras'>): boolean {
  return entity.auras.some((aura) => aura.id === SHADOW_CLOAK_AURA_ID);
}
