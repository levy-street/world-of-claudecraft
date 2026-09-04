// Pure helpers for world-quest salvage layouts. The authored debris exists in
// every host, but a viewer sees and can credit only the layout selected for the
// current calendar-week slot. Progress uses the existing stable position-key
// ledger, so recovered pieces remain gone after leaving the area or reconnecting.

import {
  FARSHORE_SALVAGE_ENTITY_ID_START,
  FARSHORE_SALVAGE_OBJECT_ITEM_ID,
} from './content/world_quests';
import { hasInteractObjectCredit, interactObjectCreditKey } from './quests/interact_object_credit';
import type { Entity, WorldQuestDef, WorldQuestProgress } from './types';
import { activeWorldQuestsForCycle, worldQuestPuzzleVariantForCycle } from './world_quest_rotation';

export const FARSHORE_SALVAGE_VISUAL_COUNT = 6;

function layoutVariant(
  quest: WorldQuestDef,
  progress: WorldQuestProgress | undefined,
  cycle: string,
): number {
  if (quest.objective.type !== 'salvage' || quest.objective.layouts.length === 0) return 0;
  const fallback = worldQuestPuzzleVariantForCycle(cycle, quest.objective.layouts.length);
  const raw = Number.isSafeInteger(progress?.puzzleVariant)
    ? (progress?.puzzleVariant as number)
    : fallback;
  return (
    ((raw % quest.objective.layouts.length) + quest.objective.layouts.length) %
    quest.objective.layouts.length
  );
}

export function worldQuestSalvageLayout(
  quest: WorldQuestDef,
  progress: WorldQuestProgress | undefined,
  cycle: string,
): readonly number[] {
  if (quest.objective.type !== 'salvage') return [];
  return quest.objective.layouts[layoutVariant(quest, progress, cycle)] ?? [];
}

export function isWorldQuestSalvageObject(entity: Entity, quest: WorldQuestDef): boolean {
  return (
    entity.kind === 'object' &&
    quest.objective.type === 'salvage' &&
    entity.objectItemId === quest.objective.objectItemId &&
    quest.objective.layouts.some((layout) => layout.includes(entity.id))
  );
}

export function isWorldQuestSalvageObjectInCurrentLayout(
  entity: Entity,
  quest: WorldQuestDef,
  progress: WorldQuestProgress | undefined,
  cycle: string,
): boolean {
  return (
    isWorldQuestSalvageObject(entity, quest) &&
    worldQuestSalvageLayout(quest, progress, cycle).includes(entity.id)
  );
}

/** Viewer-specific hide rule for the authored salvage props. */
export function isWorldQuestSalvageObjectHidden(
  entity: Entity,
  quest: WorldQuestDef,
  cycle: string,
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>,
): boolean {
  if (!isWorldQuestSalvageObject(entity, quest)) return false;
  const progress = worldQuestLog.get(quest.id);
  if (
    progress?.state !== 'active' &&
    !activeWorldQuestsForCycle(cycle).some((candidate) => candidate.id === quest.id)
  ) {
    return true;
  }
  if (progress?.state === 'completed') return true;
  if (!isWorldQuestSalvageObjectInCurrentLayout(entity, quest, progress, cycle)) return true;
  return progress
    ? hasInteractObjectCredit(progress, interactObjectCreditKey(0, entity.pos))
    : false;
}

/** Stable visual slot for the six bespoke GLBs; null means ordinary flotsam. */
export function worldQuestSalvageVisualIndex(entityId: number): number | null {
  const offset = entityId - FARSHORE_SALVAGE_ENTITY_ID_START;
  if (offset < 0 || offset >= 24 || !Number.isInteger(offset)) return null;
  return offset % FARSHORE_SALVAGE_VISUAL_COUNT;
}

export function isFarshoreSalvageEntity(entity: Entity): boolean {
  return (
    entity.kind === 'object' &&
    entity.objectItemId === FARSHORE_SALVAGE_OBJECT_ITEM_ID &&
    worldQuestSalvageVisualIndex(entity.id) !== null
  );
}
