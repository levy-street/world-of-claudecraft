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
// string builder beside it renders that model with t() plus the shared
// tooltip_line_core builder (which owns the esc), no DOM and no Hud
// state (the elixir_tooltip_view.ts / gather_tool_tooltip.ts pattern), so
// tests/recipe_pattern_tooltip_view.test.ts drives both directly.
//
// The requirement and known lines REUSE the keys their own surfaces already
// own (hudChrome.crafting.skillReqLine from the crafting window and the
// gathering tool card, hudChrome.training.alreadyKnown from the trainer): a
// pattern is a second way to learn the same recipe, so it must not invent a
// second wording for the same sentence.
//
// Three deliberate silences, all the R34 stale-client doctrine (never invent a
// line for content this bundle predates): a teachesRecipeId that resolves to no
// recipe renders NOTHING extra, a recipe whose result item id has no ItemDef
// renders no teaches line rather than a raw snake_case id, and a recipe the
// content table does not mark drop-acquirable renders nothing at all, because
// resolvePatternLearn refuses that pattern SILENTLY: advertising a click the
// sim will not honor is worse than the bare "Common Pattern" tooltip.
//
// One residual gap follows from those silences, stated rather than papered
// over: the requirement line is suppressed at skillReq 0 (it would say nothing),
// but the sim's `profession` arm still refuses a never-practiced character on
// such a pattern, so that ONE combination (skillReq 0 + zero skill in the craft)
// previews no gate while the click refuses. Every skillReq above 0 whose craft
// has a printable name is covered (a craft with no name key renders no
// requirement line at any skillReq, per the guard at the render site), because
// `skillMet` below carries the practiced arm too. No skillReq-0 pattern
// exists in the content table, and this packet authors none; if one is ever
// authored, the fix is to render the requirement line at skillReq 0 as well
// (with wording that does not read as "Requires Alchemy 0").
//
// What the taught thing MAKES or DOES rides below the gate lines, the way a
// classic recipe tooltip reads: each crafted product's own item card (so its
// stats, use effect, and set bonuses are on the pattern itself, not only in
// the crafting window after learning it), then that recipe's materials. The
// card is rendered by the HOST through `productCard` (Hud.itemTooltip with
// compare off, the itemCompareBlock precedent), since the card builder owns
// Hud state; a caller that passes none gets the materials line alone. A
// collection manual teaches several pieces of ONE set, so every card but the
// last of a set is asked to omit its set block (the `omitSet` flag): the
// bonuses read once instead of once per piece, which kept a three-piece
// manual taller than a laptop viewport. A
// formula has no product item, so it states the enchant's effect instead
// (the same stat-line key and proc sentence the enchant picker renders).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../../../sim/content/enchants';
import { recipeById } from '../../../sim/content/recipes';
import { ITEMS } from '../../../sim/data';
import { collectionManualRecipes } from '../../../sim/professions/collection_manual';
import { tierForSkill } from '../../../sim/professions/wheel';
import type { ItemDef } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { formatList, formatNumber, type TranslationKey, t } from '../../i18n';
import { itemNumber, itemStatName } from '../../item_instance_tooltip';
import { tooltipLine } from '../../tooltip_line_core';
import { craftNameKey } from './craft_name_view';
import { enchantNameKey } from './enchant_apply_view';

/** The viewer state the host projects in, satisfied structurally by IWorld's
 *  `craftingIdentity` (CraftingIdentityView) from BOTH worlds. */
export interface RecipePatternViewerInput {
  /** False only on an online client that has not received its first cprof
   *  value yet (craftingIdentity.synced). Both gated lines below answer off
   *  craftSkills/knownRecipes, which are EMPTY defaults until that arrives, so
   *  rendering them unsynced would paint a red "Requires Alchemy 50" at a
   *  master alchemist and claim an already-known recipe is unlearned. */
  synced: boolean;
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

/** One material a taught recipe or formula consumes. */
export interface PatternReagent {
  itemId: string;
  count: number;
}

/** What the tooltip needs to know about the recipe a pattern teaches. */
export interface RecipePatternTooltipModel {
  /** The taught recipe's id (RecipeItemDef.teachesRecipeId, resolved). */
  recipeId: string;
  /** The item that recipe crafts, for the teaches line. */
  resultItemId: string;
  /** Collection manuals teach all of these outputs atomically. */
  resultItemIds?: readonly string[];
  /** Formulas teach an enchant, not a craftable surrogate item. */
  enchantId?: string;
  /** What each taught product costs to make, parallel to the result ids (one
   *  entry per recipe, in teach order; a formula carries its enchant's). */
  reagents: readonly (readonly PatternReagent[])[];
  professionId: string;
  skillReq: number;
  /** True when the viewer's skill in that craft clears the learn gate, meaning
   *  BOTH arms resolvePatternLearn checks: the craft has been practiced at all
   *  (flat skill above 0, its `profession` arm) AND the tier is met.
   *  The tier half is derived from the TIER bands, exactly as
   *  professions/training.ts teachTierMet decides it, never a raw
   *  `skill >= skillReq`: the two agree only while every skillReq is a multiple
   *  of TIER_SKILL_STEP, and the first content recipe gated at, say, 60 would
   *  paint this line red for a crafter the sim is perfectly willing to teach.
   *  The practiced half is what the tier bands alone cannot say: a skillReq of
   *  1 to 24 buckets to tier 0, which an unpracticed crafter at skill 0 also
   *  sits in, so tier alone would paint a plain requirement line for a click
   *  the sim refuses. A pattern is stricter than a trainer here on purpose
   *  (pattern_items.ts arm 3), so the hover must be too. */
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
  if (item.teachesEnchantId) {
    const enchant = Object.hasOwn(ENCHANTS, item.teachesEnchantId)
      ? ENCHANTS[item.teachesEnchantId]
      : undefined;
    if (!enchant || enchant.acquisition !== 'drop' || item.teachesRecipeId !== enchant.id)
      return null;
    const skill = craftSkillOf(viewer.craftSkills, 'enchanting');
    return {
      recipeId: enchant.id,
      resultItemId: '',
      enchantId: enchant.id,
      reagents: [enchant.reagents],
      professionId: 'enchanting',
      skillReq: enchant.skillReq ?? 0,
      skillMet: Number.isFinite(skill) && skill >= (enchant.skillReq ?? 0),
      known: viewer.knownRecipes.includes(enchant.id),
    };
  }
  const recipes = collectionManualRecipes(item, recipeById);
  if (!recipes) return null;
  const recipe = recipes[0];
  // The SAME acquisition predicate resolvePatternLearn refuses on (its
  // `invalid` arm). A pattern naming a recipe no drop may teach is an authoring
  // bug whose click is a silent no-op, so the hover must not describe it.
  if (!recipe.acquisition?.includes('drop')) return null;
  const skill = craftSkillOf(viewer.craftSkills, recipe.professionId);
  return {
    recipeId: recipe.id,
    resultItemId: recipe.resultItemId,
    ...(item.teachesRecipeIds ? { resultItemIds: recipes.map((entry) => entry.resultItemId) } : {}),
    reagents: recipes.map((entry) => entry.reagents),
    professionId: recipe.professionId,
    skillReq: recipe.skillReq,
    // Both of resolvePatternLearn's skill arms, in its order: practiced at all,
    // then the tier band. See the field doc on RecipePatternTooltipModel.
    skillMet: skill > 0 && tierForSkill(skill) >= tierForSkill(recipe.skillReq),
    known: recipes.every((entry) => viewer.knownRecipes.includes(entry.id)),
  };
}

/** Renders one crafted product's item card (the host's item tooltip).
 *  `omitSet` asks the host to leave the card's set block out, because a later
 *  product in the same pattern shows the same set's block. */
export type RecipeProductCard = (product: ItemDef, omitSet: boolean) => string;

/** True when a product AFTER `index` in `ids` belongs to the same item set as
 *  `product`, so that later card carries the shared set block instead. */
function setShownLater(product: ItemDef, ids: readonly string[], index: number): boolean {
  if (!product.set) return false;
  return ids.some(
    (id, at) => at > index && Object.hasOwn(ITEMS, id) && ITEMS[id].set === product.set,
  );
}

/** The materials line for one taught recipe: the crafting window's own
 *  "Requires:" label over a localized list of "{name} x{count}" entries.
 *  Reagents whose item this bundle does not know are skipped (R34), and a
 *  recipe with no printable reagent renders nothing. */
function reagentsLine(reagents: readonly PatternReagent[]): string {
  const entries: string[] = [];
  for (const reagent of reagents) {
    const def = Object.hasOwn(ITEMS, reagent.itemId) ? ITEMS[reagent.itemId] : undefined;
    if (!def) continue;
    entries.push(
      t('hudChrome.pattern.reagent', {
        name: itemDisplayName(def),
        count: formatNumber(reagent.count, { maximumFractionDigits: 0 }),
      }),
    );
  }
  if (!entries.length) return '';
  return tooltipLine(
    'tt-sub',
    t('hudChrome.pattern.reagents', {
      label: t('hudChrome.crafting.reagentsNeeded'),
      list: formatList(entries),
    }),
  );
}

/** What a taught enchant does: its proc sentence when it has one, else one
 *  green "+N Stat" line per stat axis, the enchant picker's own wording. */
function enchantEffectLines(enchantId: string): string {
  const enchant = ENCHANTS[enchantId];
  if (enchant.weaponProc)
    return tooltipLine(
      'tt-green',
      t(`hudChrome.enchantDescription.${enchantId}` as TranslationKey),
    );
  let html = '';
  for (const [stat, value] of Object.entries(enchant.statBonus)) {
    if (!value) continue;
    html += tooltipLine(
      'tt-green',
      t('itemUi.tooltip.stat', { value: itemNumber(value), stat: itemStatName(stat) }),
    );
  }
  return html;
}

/** What the pattern makes or does: a formula's enchant effect, or each
 *  product's card, each followed by the materials that recipe consumes. These
 *  are static content facts, so they render unsynced too. A product that is
 *  itself a pattern never embeds (no card-in-card recursion), and a product
 *  id with no ItemDef embeds nothing, matching the teaches line's silence. */
function patternProductLines(
  model: RecipePatternTooltipModel,
  productCard: RecipeProductCard | undefined,
): string {
  if (model.enchantId)
    return enchantEffectLines(model.enchantId) + reagentsLine(model.reagents[0] ?? []);
  let html = '';
  const ids = model.resultItemIds ?? [model.resultItemId];
  ids.forEach((id, index) => {
    const product = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
    if (!product) return;
    let block = '';
    if (productCard && product.kind !== 'recipe')
      block += productCard(product, setShownLater(product, ids, index));
    block += reagentsLine(model.reagents[index] ?? []);
    if (block) html += `<div class="tt-recipe-product">${block}</div>`;
  });
  return html;
}

/** The tooltip lines for one pattern item, or '' for any other item.
 *  `productCard`, when given, renders each crafted product's item card below
 *  the gate lines (see the header). */
export function recipePatternTooltipLines(
  item: ItemDef,
  viewer: RecipePatternViewerInput,
  productCard?: RecipeProductCard,
): string {
  const model = recipePatternTooltipModel(item, viewer);
  if (!model) return '';
  return patternGateLines(model, viewer) + patternProductLines(model, productCard);
}

/** The teaches line, then (once synced) the requirement and known lines. */
function patternGateLines(
  model: RecipePatternTooltipModel,
  viewer: RecipePatternViewerInput,
): string {
  let html = '';
  // hasOwn-gated like icons.ts itemFallback: ITEMS is a prototype-bearing
  // Record, so a resultItemId of 'constructor' would otherwise resolve a
  // FUNCTION and hand itemDisplayName a non-def.
  if (model.enchantId) {
    html += tooltipLine(
      'tt-desc',
      t('hudChrome.pattern.teachesEnchant', { enchant: t(enchantNameKey(model.enchantId)) }),
    );
  } else {
    for (const id of model.resultItemIds ?? [model.resultItemId]) {
      const result = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
      if (result)
        html += tooltipLine(
          'tt-desc',
          t('hudChrome.pattern.teaches', { item: itemDisplayName(result) }),
        );
    }
  }
  // Everything below answers off the viewer's own progression, which an online
  // client does not have until its first cprof snapshot lands. Stop at the
  // teaches line until then: a possibly-wrong red gate is worse than a short
  // tooltip, and the lines reappear a snapshot later on their own.
  if (!viewer.synced) return html;
  // The same requirement line the crafting window and the gathering tool card
  // render, with the same guard as gather_tool_tooltip.ts: no printable craft
  // name means no line, because falling back to the raw id would print
  // "Requires alchemy 50", a wrong sentence rather than a missing one. A
  // skillReq of 0 states nothing, so it renders nothing either.
  const professionNameKey = craftNameKey(model.professionId);
  if (model.skillReq > 0 && professionNameKey !== undefined) {
    html += tooltipLine(
      model.skillMet ? 'tt-sub' : 'tt-red',
      t('hudChrome.crafting.skillReqLine', {
        craft: t(professionNameKey),
        skill: formatNumber(model.skillReq, { maximumFractionDigits: 0 }),
      }),
    );
  }
  // Red, and only when true. The hover and the click say the IDENTICAL
  // sentence: this key resolves to "You already know that recipe." and so does
  // the sim's own refusal (error.patternKnown in sim_i18n.ts), so a player who
  // reads the warning and clicks anyway gets no second, differently-worded
  // answer. Keep the two in step if either is ever reworded.
  if (model.known) html += tooltipLine('tt-red', t('hudChrome.training.alreadyKnown'));
  return html;
}
