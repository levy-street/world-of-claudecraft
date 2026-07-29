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
import { applyPairTransitionHobbyMemory, recordQuestedHobby } from '../professions/hobby_memory';
import { applyPairTransitionTierMail } from '../professions/tier_mail';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { QuestDef, QuestProgress } from '../types';

export function professionQuestSelectionTargets(quest: QuestDef, state: ArchetypeState): string[] {
  const effect = quest.completionEffect;
  if (!effect) return [];
  if (effect.type === 'attunePair') {
    // A per-pair attune quest pins one pairId, so its target list is
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
    // A per-pair quest accepts and turns in ONLY its pinned pair,
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
    // The transition just re-derived the pair's DEFAULT hobby. If this
    // character once quested a hobby for the pair they are moving into, that
    // explicit choice wins instead: a make-amends return restores the identity
    // they chose, rather than silently discarding it (professions/hobby_memory.ts).
    // A 'new' attunement is a guaranteed miss (the pair was never held, so
    // nothing was ever recorded for it) and keeps the skill-derived default.
    applyPairTransitionHobbyMemory(meta);
    // The shared pair-transition rule (prune stale acknowledgements, then
    // baseline the new majors), BEFORE the next mail sweep: the prune is what
    // makes a later RETURN re-baseline instead of mailing a retroactive
    // letter for tiers crossed while the pair was dormant, and the baseline
    // keeps the first letter for a tier crossed after this attunement only.
    // A craft the old and new pair share is pruned by neither (still a
    // major) and baselined already.
    applyPairTransitionTierMail(meta);
    // Celebrate: a personal event plus the soft zone broadcast (both new and
    // return modes: returning to a held pair is a celebration too).
    announceAttunement(ctx, meta.entityId, target);
    return true;
  }
  if (!switchHobby(ctx, meta.entityId, progress.selection as string)) return false;
  // Remember the choice against the CURRENT pair, after the write, so a later
  // return to this pair restores it instead of re-deriving the skill default.
  // Only this quested path records: a default the engine derived is never an
  // explicit choice.
  recordQuestedHobby(meta);
  return true;
}

/** Whether a quest's completion effect rewrites profession IDENTITY (the active
 *  pair of majors, or the explicit hobby). The `completionEffect` union
 *  (types.ts) is exactly `attunePair | switchHobby` and BOTH are identity
 *  transitions, so "carries a completion effect" and "is an identity
 *  transition" are the same predicate today; the shipped vocabulary is pinned
 *  in tests/profession_attunement_quests.test.ts so a future third effect type
 *  has to come back here and decide rather than silently joining the gate. */
export function isIdentityTransitionQuest(quest: QuestDef | undefined): boolean {
  return quest?.completionEffect !== undefined;
}
