import {
  ARCHETYPE_PAIR_TARGETS,
  type ArchetypeState,
  attuneArchetypePair,
  canAttuneArchetypePair,
  canSwitchHobby,
  hobbyCandidatesForPair,
  requiredAmendsProgress,
  switchHobby,
} from '../professions/archetype';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { QuestDef, QuestProgress } from '../types';

export function professionQuestSelectionTargets(quest: QuestDef, state: ArchetypeState): string[] {
  const effect = quest.completionEffect;
  if (!effect) return [];
  if (effect.type === 'attunePair') {
    return ARCHETYPE_PAIR_TARGETS.filter((target) =>
      canAttuneArchetypePair(state, target, effect.mode),
    );
  }
  if (!state.activeArchetype || !state.pairedMajor) return [];
  return hobbyCandidatesForPair(state.activeArchetype, state.pairedMajor).filter(
    (target) => target !== state.hobbyCraft,
  );
}

export function validateProfessionQuestSelection(
  quest: QuestDef,
  meta: PlayerMeta,
  selection: string | undefined,
): boolean {
  const effect = quest.completionEffect;
  if (!effect) return selection === undefined;
  if (!selection) return false;
  if (effect.type === 'attunePair') {
    return canAttuneArchetypePair(meta.archetype, selection, effect.mode);
  }
  return canSwitchHobby(meta.archetype, selection);
}

export function resolvedQuestObjectiveCounts(quest: QuestDef, meta: PlayerMeta): number[] {
  const counts = quest.objectives.map((objective) => objective.count);
  if (quest.resolvedObjectiveCounts === 'archetypeAmends' && counts.length > 0) {
    counts[0] = requiredAmendsProgress(meta.archetype.switchCount);
  }
  return counts;
}

/** Revalidate immediately before mutation, then apply the selected transition.
 * This is called only from the authoritative turn-in transaction. */
export function applyProfessionQuestEffect(
  ctx: SimContext,
  quest: QuestDef,
  progress: QuestProgress,
  meta: PlayerMeta,
): boolean {
  const effect = quest.completionEffect;
  if (!effect) return true;
  if (!validateProfessionQuestSelection(quest, meta, progress.selection)) return false;
  if (effect.type === 'attunePair') {
    return attuneArchetypePair(ctx, meta.entityId, progress.selection as string, effect.mode);
  }
  return switchHobby(ctx, meta.entityId, progress.selection as string);
}
