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
import { announceAttunement } from '../professions/attunement_events';
import { baselineActivePairTierMail } from '../professions/tier_mail';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { QuestDef, QuestProgress } from '../types';

export function professionQuestSelectionTargets(quest: QuestDef, state: ArchetypeState): string[] {
  const effect = quest.completionEffect;
  if (!effect) return [];
  if (effect.type === 'attunePair') {
    // A per-pair attune quest (Phase 14) pins one pairId, so its target list is
    // that single pair intersected with the mode-legal candidates (empty, hence
    // the quest is unavailable at that master, unless that exact pair is legal
    // for the mode right now); a quest with no pairId offers every legal pair.
    return ARCHETYPE_PAIR_TARGETS.filter(
      (target) =>
        (!effect.pairId || target === effect.pairId) &&
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
    // A per-pair quest accepts and turns in ONLY its pinned pair (Phase 14),
    // over and above the shared mode-legality gate.
    if (effect.pairId && selection !== effect.pairId) return false;
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
    const target = progress.selection as string;
    if (!attuneArchetypePair(ctx, meta.entityId, target, effect.mode)) return false;
    // Baseline the newly-active majors at their current tier BEFORE the next mail
    // sweep, so the tier-crossing mail's first letter is only for a tier crossed
    // after this attunement (not the tier already held at attunement time).
    baselineActivePairTierMail(meta);
    // Celebrate: a personal event plus the soft zone broadcast (both new and
    // return modes: returning to a held pair is a celebration too).
    announceAttunement(ctx, meta.entityId, target);
    return true;
  }
  return switchHobby(ctx, meta.entityId, progress.selection as string);
}
