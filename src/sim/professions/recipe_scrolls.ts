// Recipe scrolls: the drop-taught learn path (raid professions,
// docs/prd/ignivar-raid-professions.md). A scroll item carries
// `use: { type: 'teachRecipe', recipeId }` and, on use, teaches the named
// recipe to THIS character through the 'drop' acquisition source. The learn
// floor is the SAME tier rule master training applies (training.ts
// teachTierMet), so the trainer and scroll paths cannot drift.
//
// Every deny leaves the scroll UNCONSUMED: a misclick or an unqualified
// winner never wastes the drop, and because scrolls are tradeable an
// unqualified holder sells it on to someone who can learn it instead. Only a
// successful teach consumes.
//
// Feedback is the text-free personal recipeScrollResult event (the
// trainResult convention): the client derives the recipe name and tier
// threshold from recipeId plus static content, so the event carries NO
// display text, and the malformed/unknown-id arm emits ok:false with NO
// reason (the silent-deny probe arm).
//
// Host-agnostic sim logic behind the SimContext seam: no Sim import, no
// DOM, no rng draws in any arm.

import { ENCHANTS, type EnchantDef } from '../content/enchants';
import { recipeById } from '../content/recipes';
// Type-only import (the crafting.ts idiom): PlayerMeta is a shape, never the
// Sim class, so this module stays host-agnostic.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { acquireRecipeForRecipe, isRecipeKnown } from './crafting';
import { isEnchantKnown } from './enchanting';
import { teachTierMet } from './training';
import type { ProfessionRecipeRecord } from './types';
import { tierForSkill } from './wheel';

export type RecipeScrollDenyReason =
  | 'scroll_already_known'
  | 'scroll_tier_unmet'
  | 'scroll_wrong_source';

/** The pure teach decision for one scroll use: null means the teach may
 *  proceed. Deny order is known first (matching acquireRecipeForRecipe),
 *  then the tier floor (the player-actionable arm), then the source check
 *  (a scroll for a recipe that does not list 'drop' is an authoring error;
 *  content guards pin it out of shipped scrolls). */
export function resolveScrollTeach(
  meta: PlayerMeta,
  recipe: ProfessionRecipeRecord,
): RecipeScrollDenyReason | null {
  if (isRecipeKnown(meta, recipe)) return 'scroll_already_known';
  if (!teachTierMet(recipe, meta.craftSkills)) return 'scroll_tier_unmet';
  if (!recipe.acquisition?.includes('drop')) return 'scroll_wrong_source';
  return null;
}

/** The scroll-use command body for an already-resolved recipe record.
 *  Exported separately from `useRecipeScroll` (the acquireRecipe /
 *  acquireRecipeForRecipe split) so tests exercise every arm against
 *  synthetic gated recipes, independent of shipped content. `consume`
 *  removes exactly one scroll copy and is called on the success arm only. */
export function useRecipeScrollForRecipe(
  ctx: SimContext,
  meta: PlayerMeta,
  recipe: ProfessionRecipeRecord,
  consume: () => void,
): void {
  const denied = resolveScrollTeach(meta, recipe);
  if (denied) {
    ctx.emit({
      type: 'recipeScrollResult',
      ok: false,
      recipeId: recipe.id,
      reason: denied,
      pid: meta.entityId,
    });
    return;
  }
  // Belt and braces: acquireRecipeForRecipe re-checks known and source. A
  // deny here means resolveScrollTeach and the acquire path disagree, which
  // a test pins against; map it rather than teach-and-consume on a lie.
  const acquired = acquireRecipeForRecipe(ctx, meta.entityId, recipe, 'drop');
  if (!acquired.ok) {
    ctx.emit({
      type: 'recipeScrollResult',
      ok: false,
      recipeId: recipe.id,
      reason: acquired.reason === 'already_known' ? 'scroll_already_known' : 'scroll_wrong_source',
      pid: meta.entityId,
    });
    return;
  }
  consume();
  ctx.emit({ type: 'recipeScrollResult', ok: true, recipeId: recipe.id, pid: meta.entityId });
}

/** The pure teach decision for an ENCHANT FORMULA scroll: the recipe rule
 *  transposed onto the enchant table. The floor mirrors teachTierMet
 *  directly (the learner's enchanting tier must reach the formula's
 *  skillReq tier); it is inlined rather than shared because teachTierMet's
 *  signature is a full recipe record and a formula is not one. */
export function resolveFormulaTeach(
  meta: PlayerMeta,
  enchant: EnchantDef,
): RecipeScrollDenyReason | null {
  if (isEnchantKnown(meta, enchant)) return 'scroll_already_known';
  if (tierForSkill(meta.craftSkills.enchanting ?? 0) < tierForSkill(enchant.skillReq ?? 0)) {
    return 'scroll_tier_unmet';
  }
  if (!enchant.acquisition?.includes('drop')) return 'scroll_wrong_source';
  return null;
}

/** The scroll-use command body for an already-resolved enchant formula: the
 *  ForRecipe arm's mirror. On success the formula id lands in the SAME
 *  knownRecipes set recipe ids use (both are content-table ids; the
 *  load-side sanitizer passes either), which is what isEnchantKnown reads
 *  at apply time. */
export function useRecipeScrollForFormula(
  ctx: SimContext,
  meta: PlayerMeta,
  enchant: EnchantDef,
  consume: () => void,
): void {
  const denied = resolveFormulaTeach(meta, enchant);
  if (denied) {
    ctx.emit({
      type: 'recipeScrollResult',
      ok: false,
      recipeId: enchant.id,
      reason: denied,
      pid: meta.entityId,
    });
    return;
  }
  meta.knownRecipes.add(enchant.id);
  consume();
  ctx.emit({ type: 'recipeScrollResult', ok: true, recipeId: enchant.id, pid: meta.entityId });
}

/** Whether a quest carrying `recipeId` as its recipeReward may turn in for
 *  `meta`: the SAME tier floor the scroll path applies, so the quest chain
 *  can never bypass the learn gate (the hammer chain's 125 floor is the
 *  point). Already-known ids and ids neither table resolves return true:
 *  the turn-in completes and the teach arm below simply no-ops (a repeat
 *  turn-in must never wedge on knowledge, and a dangling id is an authoring
 *  bug for the content guards, not a player-facing wall). */
export function canTeachQuestRecipeReward(meta: PlayerMeta, recipeId: string): boolean {
  const recipe = recipeById(recipeId);
  if (recipe) {
    if (isRecipeKnown(meta, recipe)) return true;
    return teachTierMet(recipe, meta.craftSkills);
  }
  const enchant = ENCHANTS[recipeId];
  if (enchant) {
    if (isEnchantKnown(meta, enchant)) return true;
    return tierForSkill(meta.craftSkills.enchanting ?? 0) >= tierForSkill(enchant.skillReq ?? 0);
  }
  return true;
}

/** The quest turn-in teach arm (the 'quest' acquisition source): teaches the
 *  id through the same tables the scroll path resolves, emitting the learned
 *  line on success and NOTHING otherwise (already known and dangling ids are
 *  silent no-ops; the floor was checked by canTeachQuestRecipeReward before
 *  the turn-in committed). */
export function teachQuestRecipeReward(ctx: SimContext, meta: PlayerMeta, recipeId: string): void {
  const recipe = recipeById(recipeId);
  if (recipe) {
    if (acquireRecipeForRecipe(ctx, meta.entityId, recipe, 'quest').ok) {
      ctx.emit({ type: 'recipeScrollResult', ok: true, recipeId, pid: meta.entityId });
    }
    return;
  }
  const enchant = ENCHANTS[recipeId];
  if (!enchant?.acquisition?.includes('quest')) return;
  if (isEnchantKnown(meta, enchant)) return;
  meta.knownRecipes.add(recipeId);
  ctx.emit({ type: 'recipeScrollResult', ok: true, recipeId, pid: meta.entityId });
}

/** The items.ts use-arm entry: resolves the id against the recipe table
 *  first, then the enchant table (a teachRecipe scroll may carry either),
 *  and delegates. An id neither table resolves emits the silent-deny arm
 *  (ok:false, no reason) and never consumes, exactly like resolveTrain's
 *  malformed-id arm. */
export function useRecipeScroll(
  ctx: SimContext,
  meta: PlayerMeta,
  recipeId: string,
  consume: () => void,
): void {
  const recipe = recipeById(recipeId);
  if (recipe) {
    useRecipeScrollForRecipe(ctx, meta, recipe, consume);
    return;
  }
  const enchant = ENCHANTS[recipeId];
  if (enchant) {
    useRecipeScrollForFormula(ctx, meta, enchant, consume);
    return;
  }
  ctx.emit({ type: 'recipeScrollResult', ok: false, recipeId, pid: meta.entityId });
}
