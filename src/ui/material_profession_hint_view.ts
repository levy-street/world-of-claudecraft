// Profession-affinity purpose line for honest materials.
//
// Classic MMO pattern (WoW Crafting Reagent + trade-good tooltips, RuneScape
// category/examine): never call a useful reagent "Junk", and name the craft(s)
// that consume it when an item can serve more than one role. Kind stays
// 'junk' internally for Sell Junk / taxonomy; the kind line already reads
// "Material" via item_kind_label.ts. This module adds the second line:
// "Used by Leatherworking, Weaponcrafting, and Armorcrafting."
//
// Data half is content-derived (sim/material_profession_affinity.ts). Specific
// purpose hints win when they already answer "what is this for" more clearly
// than a craft list: raw cooking catches (cooking_catch_hint_view) and the
// enchanting-only materials that already say "Enchanting reagent" in
// material_hint_view. Multi-craft cooking reagents (e.g. a catch also used by
// Engineering) still get this line so secondary crafts are not hidden.
//
// TEXT only, no markup: the host paints via createTooltipLine
// (tooltip_line.ts) with the tt-material-use modifier, per the
// cooking_catch_hint_view precedent, so this feature does not grow the
// legacy HTML-string tooltip path.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { craftIdsForMaterialItem } from '../sim/material_profession_affinity';
import { MATERIAL_ITEM_IDS } from '../sim/material_taxonomy';
import { cookingCatchHintKey } from './cooking_catch_hint_view';
import { craftNameKey } from './craft_name_view';
import { formatList, t } from './i18n';
import { materialHintKey } from './material_hint_view';

/**
 * Whether this material already has a more specific purpose sentence that
 * fully answers "what profession is this for", so the generic Used-by line
 * would only repeat it.
 */
function hasSupersedingPurposeHint(itemId: string, craftIds: readonly string[]): boolean {
  // Raw cooking catch: "Cooking ingredient. Must be cooked before eating."
  // covers the single-craft cooking case. Multi-craft catches still need
  // Used-by so Engineering (etc.) is not invisible beside the cooking line.
  if (cookingCatchHintKey(itemId) !== undefined) {
    return craftIds.length === 1 && craftIds[0] === 'cooking';
  }
  // The arcane/resonant materials open with "Enchanting reagent. ...", which
  // already names the one craft. MATERIAL_HINT_KEYS also holds the nine fine
  // grades sharing the fineGrade key, but that sentence names NO craft, so a
  // fine grade never supersedes: even a hypothetical enchanting-only fine
  // grade still needs its Used-by line. The key literal below is type-safe,
  // not stringly: TranslationKey is the generated catalog union, so a renamed
  // fineGrade key turns this comparison into a tsc no-overlap error.
  const hintKey = materialHintKey(itemId);
  if (hintKey !== undefined && hintKey !== 'hudChrome.materialHint.fineGrade') {
    return craftIds.length === 1 && craftIds[0] === 'enchanting';
  }
  return false;
}

/**
 * Localized "Used by {crafts}." text for an honest material, or '' when the
 * item is not a material, has no craft consumers, or a more specific purpose
 * hint already covers it alone.
 */
export function materialProfessionHintText(itemId: string): string {
  if (!MATERIAL_ITEM_IDS.has(itemId)) return '';
  const craftIds = craftIdsForMaterialItem(itemId);
  if (craftIds.length === 0) return '';
  if (hasSupersedingPurposeHint(itemId, craftIds)) return '';
  const names: string[] = [];
  for (const craftId of craftIds) {
    // Structurally dead skip: the affinity returns only ring ids and the
    // craft_name_view pin covers every ring id. Never render a raw id.
    const key = craftNameKey(craftId);
    if (key !== undefined) names.push(t(key));
  }
  if (names.length === 0) return '';
  return t('hudChrome.materialHint.usedBy', { crafts: formatList(names) });
}
