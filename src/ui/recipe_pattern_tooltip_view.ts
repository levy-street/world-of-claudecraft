// Recipe PATTERN item tooltip lines (kind 'recipe'): what the pattern teaches,
// the craft skill it wants, and whether this character already knows it. A
// pattern carries no def-level `use` payload and no stats, so without these
// lines its tooltip says only "Common Pattern": a player holding one has no
// in-game way to learn what using it grants or why the sim refused the use.
//
// Split the way quest_item_tooltip_view.ts is: the HOST projects the viewer's
// crafting identity in (knownRecipes + craftSkills off IWorld's
// craftingIdentity, identical offline and online), the core resolves the taught
// recipe against static content and answers a small typed model, and the
// string builder beside it renders that model with t() + esc, no DOM and no Hud
// state (the elixir_tooltip_view.ts / gather_tool_tooltip.ts pattern), so
// tests/recipe_pattern_tooltip_view.test.ts drives both directly.
//
// The requirement and known lines REUSE the keys their own surfaces already
// own (hudChrome.crafting.skillReqLine from the crafting window and the
// gathering tool card, hudChrome.training.alreadyKnown from the trainer): a
// pattern is a second way to learn the same recipe, so it must not invent a
// second wording for the same sentence.
//
// Two deliberate silences, both the R34 stale-client doctrine (never invent a
// line for content this bundle predates): a teachesRecipeId that resolves to no
// recipe renders NOTHING extra, and a recipe whose result item id has no
// ItemDef renders no teaches line rather than a raw snake_case id.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { recipeById } from '../sim/content/recipes';
import { ITEMS } from '../sim/data';
import type { ItemDef } from '../sim/types';
import { craftNameKey } from './craft_name_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** The viewer state the host projects in, satisfied structurally by IWorld's
 *  `craftingIdentity` (CraftingIdentityView) from BOTH worlds. */
export interface RecipePatternViewerInput {
  /** Recipe ids this character has learned (craftingIdentity.knownRecipes).
   *  Grandfathered recipes (no acquisition list) are known to everyone WITHOUT
   *  appearing here, so `known` below answers this list only; no pattern item
   *  teaches a grandfathered recipe, since there would be nothing to teach. */
  knownRecipes: readonly string[];
  /** Flat per-craft skill values (craftingIdentity.craftSkills), keyed by craft
   *  id. Every ring craft is always present (professions/wheel.ts), so a
   *  missing key means an unknown craft, not an unpracticed one. */
  craftSkills: Readonly<Record<string, number>>;
}

/** What the tooltip needs to know about the recipe a pattern teaches. */
export interface RecipePatternTooltipModel {
  /** The taught recipe's id (RecipeItemDef.teachesRecipeId, resolved). */
  recipeId: string;
  /** The item that recipe crafts, for the teaches line. */
  resultItemId: string;
  professionId: string;
  skillReq: number;
  /** True when the viewer's skill in that craft meets the requirement. */
  skillMet: boolean;
  /** True when the viewer already knows the recipe (the use would refuse). */
  known: boolean;
}

/** hasOwn-safe read of the projected skill record: it arrives as a plain object
 *  off a wire mirror, so a bare bracket read of a prototype key
 *  ('constructor') would resolve a function instead of a number. */
function craftSkillOf(craftSkills: Readonly<Record<string, number>>, craftId: string): number {
  return Object.hasOwn(craftSkills, craftId) ? craftSkills[craftId] : 0;
}

/** Build the pattern tooltip model, or null for every non-pattern kind and for
 *  a teachesRecipeId this bundle cannot resolve. */
export function recipePatternTooltipModel(
  item: ItemDef,
  viewer: RecipePatternViewerInput,
): RecipePatternTooltipModel | null {
  if (item.kind !== 'recipe') return null;
  const recipe = recipeById(item.teachesRecipeId);
  if (!recipe) return null;
  return {
    recipeId: recipe.id,
    resultItemId: recipe.resultItemId,
    professionId: recipe.professionId,
    skillReq: recipe.skillReq,
    skillMet: craftSkillOf(viewer.craftSkills, recipe.professionId) >= recipe.skillReq,
    known: viewer.knownRecipes.includes(recipe.id),
  };
}

function line(cls: 'tt-sub' | 'tt-desc' | 'tt-red', text: string): string {
  return `<div class="${cls}">${esc(text)}</div>`;
}

/** The tooltip lines for one pattern item, or '' for any other item. */
export function recipePatternTooltipLines(item: ItemDef, viewer: RecipePatternViewerInput): string {
  const model = recipePatternTooltipModel(item, viewer);
  if (!model) return '';
  let html = '';
  const result = ITEMS[model.resultItemId];
  if (result) {
    html += line('tt-desc', t('hudChrome.pattern.teaches', { item: itemDisplayName(result) }));
  }
  // The same requirement line the crafting window and the gathering tool card
  // render, with the same guard as gather_tool_tooltip.ts: no printable craft
  // name means no line, because falling back to the raw id would print
  // "Requires alchemy 50", a wrong sentence rather than a missing one. A
  // skillReq of 0 states nothing, so it renders nothing either.
  const professionNameKey = craftNameKey(model.professionId);
  if (model.skillReq > 0 && professionNameKey !== undefined) {
    html += line(
      model.skillMet ? 'tt-sub' : 'tt-red',
      t('hudChrome.crafting.skillReqLine', {
        craft: t(professionNameKey),
        skill: formatNumber(model.skillReq, { maximumFractionDigits: 0 }),
      }),
    );
  }
  // Red, and only when true: the trainer's own wording for the refusal this
  // copy would raise, so the hover states it before the click does.
  if (model.known) html += line('tt-red', t('hudChrome.training.alreadyKnown'));
  return html;
}
