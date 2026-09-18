import { GLIDER_QUEST_ID } from './content/world_quest_glider';
import type { WorldQuestProgress } from './types';

/** An airborne run owns actions even when replaying an already rewarded quest. */
export function gliderActionsLocked(
  log: ReadonlyMap<string, WorldQuestProgress> | undefined,
): boolean {
  const phase = log?.get(GLIDER_QUEST_ID)?.glider?.phase;
  return phase === 'countdown' || phase === 'flying';
}
