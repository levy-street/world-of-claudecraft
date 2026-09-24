import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { WorldQuestInvestigationState } from './types';

function boundedMask(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** Owner-only session evidence. Copy known fields and reject malformed state atomically. */
export function decodeInvestigationState(
  value: unknown,
  questId: string,
): WorldQuestInvestigationState | undefined {
  if (
    !Object.hasOwn(WORLD_QUESTS_BY_ID, questId) ||
    WORLD_QUESTS_BY_ID[questId].objective.type !== 'investigation' ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return undefined;
  const state = value as Partial<WorldQuestInvestigationState>;
  if (
    !boundedMask(state.heard, 15) ||
    !boundedMask(state.clues, 3) ||
    !boundedMask(state.cleared, 15) ||
    (state.mobId !== undefined &&
      (typeof state.mobId !== 'number' || !Number.isSafeInteger(state.mobId) || state.mobId <= 0))
  )
    return undefined;
  return {
    heard: state.heard,
    clues: state.clues,
    cleared: state.cleared,
    ...(state.mobId === undefined ? {} : { mobId: state.mobId }),
  };
}
