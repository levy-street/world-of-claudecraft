// A revealed disguise disappears only for its investigator, and once the
// case is closed the whole post (sergeant, guards, records) leaves for that
// viewer alone. The shared entities stay intact for everyone else; the next
// rotation restores the view.
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_QUEST_ID,
  INVESTIGATION_VARIANTS,
} from './content/world_quest_investigation';
import type { Entity, WorldQuestProgress } from './types';
import { worldQuestPuzzleVariantForCycle } from './world_quest_rotation';

export interface InvestigationVisibilityReader {
  worldQuestCycle?: string;
  worldQuestLog?: ReadonlyMap<string, WorldQuestProgress>;
}

const POST_ENTITY_IDS: ReadonlySet<number> = new Set<number>([
  ...INVESTIGATION_NPC_IDS,
  ...INVESTIGATION_CLUES.map((clue) => clue.entityId),
]);

export function investigationDisguiseHidden(
  entity: Pick<Entity, 'id' | 'kind'>,
  world: InvestigationVisibilityReader,
): boolean {
  if (!world.worldQuestCycle || !POST_ENTITY_IDS.has(entity.id)) return false;
  const progress = world.worldQuestLog?.get(INVESTIGATION_QUEST_ID);
  if (progress?.state === 'completed') return true;
  if (entity.kind !== 'npc') return false;
  if (!INVESTIGATION_NPC_IDS.some((id, index) => index > 0 && id === entity.id)) return false;
  if (progress?.state !== 'active' || progress.investigation?.mobId === undefined) return false;
  const variant = worldQuestPuzzleVariantForCycle(
    world.worldQuestCycle,
    INVESTIGATION_VARIANTS.length,
  );
  return entity.id === INVESTIGATION_NPC_IDS[INVESTIGATION_VARIANTS[variant].culprit + 1];
}
