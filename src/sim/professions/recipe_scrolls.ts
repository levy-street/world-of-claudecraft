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

import { recipeById } from '../content/recipes';
// Type-only import (the crafting.ts idiom): PlayerMeta is a shape, never the
// Sim class, so this module stays host-agnostic.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { acquireRecipeForRecipe, isRecipeKnown } from './crafting';
import { teachTierMet } from './training';
import type { ProfessionRecipeRecord } from './types';

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

/** The items.ts use-arm entry: resolves the recipe id and delegates. An
 *  unknown id emits the silent-deny arm (ok:false, no reason) and never
 *  consumes, exactly like resolveTrain's malformed-id arm. */
export function useRecipeScroll(
  ctx: SimContext,
  meta: PlayerMeta,
  recipeId: string,
  consume: () => void,
): void {
  const recipe = recipeById(recipeId);
  if (!recipe) {
    ctx.emit({ type: 'recipeScrollResult', ok: false, recipeId, pid: meta.entityId });
    return;
  }
  useRecipeScrollForRecipe(ctx, meta, recipe, consume);
}
