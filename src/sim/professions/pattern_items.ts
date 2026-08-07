// Recipe pattern items: the physical drop that teaches one recipe when used
// from the bags. A pattern is an ordinary tradable item (kind 'recipe',
// src/sim/types.ts RecipeItemDef) naming the ProfessionRecipeRecord it teaches;
// using it spends the copy and marks the recipe known, which is what makes a
// pattern bind on LEARN rather than on pickup: the item is freely tradable and
// market-listable right up until someone consumes it.
//
// Shaped like ./training.ts: a PURE resolver (`resolvePatternLearn`) that
// decides the outcome with no side effect, plus a thin apply function
// (`useRecipePatternItem`) that owns the emits and the consume. The split is
// what lets a Vitest drive every deny arm directly against a synthetic recipe
// without a live Sim, exactly as resolveTrain is driven today.
//
// `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net imports and
// no Sim import (PlayerMeta arrives type-only, the crafting.ts idiom). The whole
// path draws NO rng and reads no clock: learning is a deterministic yes or no.

import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { RecipeItemDef } from '../types';
import { acquireRecipe, isRecipeKnown } from './crafting';
import { teachTierMet } from './training';
import type { ProfessionRecipeRecord } from './types';

/** Why a pattern use was refused, or `ok` when the learn may proceed.
 *  Stable codes, not player-facing prose: the apply function below owns the
 *  English literals, so the resolver stays language-agnostic and testable. */
export type PatternLearnResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'already_known' | 'profession' | 'tier' };

/**
 * Pure validation of one pattern use: no side effect ever (the caller emits,
 * grants, and consumes on ok). The deny ORDER is load-bearing and mirrors
 * resolveTrain's discipline in ./training.ts, so a double click resolves
 * `already_known` before any other arm can fire and never spends a second copy:
 *
 * 1. `invalid`: the recipe id does not resolve, OR the recipe's `acquisition`
 *    list does not include 'drop'. This is a CONTENT-SHAPE guard only, not the
 *    mint authority: acquireRecipeForRecipe in ./crafting.ts is what actually
 *    refuses a wrong-source grant. This pre-check exists solely to decide
 *    SILENT versus EMITTED, because a pattern whose def points at a missing or
 *    non-droppable recipe is an authoring bug, and a player holding one should
 *    see the same nothing a malformed item id produces, not a refusal line
 *    blaming their character.
 * 2. `already_known` (isRecipeKnown, grandfathered recipes included).
 * 3. `profession`: the player has never practiced the recipe's craft at all,
 *    i.e. their flat skill in it is 0 or absent. There is NO profession
 *    membership concept in this codebase (a character carries a flat skill per
 *    craft, professions/wheel.ts CraftSkills, and no roster of "professions
 *    known"), so "you are not that profession" DECOMPOSES to exactly this
 *    zero-skill read. Deliberate: it is the one condition that separates
 *    "wrong craft entirely" from "right craft, not skilled enough" below.
 * 4. `tier`: teachTierMet is unmet. Reused from ./training.ts rather than
 *    restated, so a pattern and a trainer can never disagree about who is
 *    allowed to learn a given recipe.
 * 5. otherwise ok.
 */
export function resolvePatternLearn(
  recipe: ProfessionRecipeRecord | undefined,
  meta: PlayerMeta,
): PatternLearnResult {
  if (!recipe?.acquisition?.includes('drop')) return { ok: false, reason: 'invalid' };
  if (isRecipeKnown(meta, recipe)) return { ok: false, reason: 'already_known' };
  if ((meta.craftSkills[recipe.professionId] ?? 0) <= 0) return { ok: false, reason: 'profession' };
  if (!teachTierMet(recipe, meta.craftSkills)) return { ok: false, reason: 'tier' };
  return { ok: true };
}

/**
 * Use one pattern item: resolve the recipe it teaches, run the pure resolver,
 * then either refuse (never consuming) or learn and spend exactly one copy.
 * Called from the `recipe` kind arm of items.ts useItem, which sits BELOW that
 * function's dead gate, so using a pattern while dead is a silent no-op like
 * every other kind arm there.
 */
export function useRecipePatternItem(ctx: SimContext, def: RecipeItemDef, meta: PlayerMeta): void {
  const recipe = recipeById(def.teachesRecipeId);
  const verdict = resolvePatternLearn(recipe, meta);
  if (!verdict.ok) {
    // Three plain calls, each on ONE physical line: once biome wraps a call it
    // also adds a trailing comma, which the S3 drift-guard's closing-paren
    // anchor on this emit form does not match, and the guard's ternary form
    // cannot span lines at all. Keep each literal short enough to never wrap,
    // or the guard goes blind to it.
    if (verdict.reason === 'already_known') {
      ctx.error(meta.entityId, 'You already know that pattern.');
    } else if (verdict.reason === 'profession') {
      ctx.error(meta.entityId, 'You have not practiced that profession.');
    } else if (verdict.reason === 'tier') {
      ctx.error(meta.entityId, 'Your skill is too low to learn that pattern.');
    }
    // 'invalid' falls through silently, the same contract as useItem's own
    // `if (!def) return;` arm. A refusal NEVER consumes the pattern.
    return;
  }
  const learned = acquireRecipe(ctx, meta.entityId, def.teachesRecipeId, 'drop');
  // Defense in depth, the unlockMechChromaFromItem idiom: the resolver already
  // proved every condition this mint re-checks, so a !ok here means the two
  // disagreed. Return without consuming rather than eating the copy for
  // nothing; a lost pattern is unrecoverable, a silent no-op is not.
  if (!learned.ok) return;
  ctx.removeItem(def.id, 1, meta.entityId);
}
