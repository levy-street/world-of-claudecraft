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
import { formatList, type TranslationKey, t } from './i18n';
import { materialHintKey } from './material_hint_view';

/**
 * The material-hint keys whose lead sentence NAMES a craft ("Enchanting
 * reagent. ..."), so the sentence can fully answer "what profession is this
 * for" on its own while that craft is the sole consumer. An EXPLICIT
 * allowlist, not an exclusion: the craft-free leads (fineGrade's grade
 * sentence, and the craft-neutral "Crafting reagent." that arcaneDust and
 * arcaneEssence adopted with the jewelcrafting base catalog) must never
 * supersede the Used-by line, even for a hypothetical single-craft consumer
 * set, or the tooltip would name no craft at all. Rewording a hint's lead
 * changes membership HERE in the same change; an unlisted key defaults to
 * never-supersedes, the safe side. Key literals are type-safe against the
 * generated TranslationKey union, so a renamed key is a tsc error. Exported
 * for the contract pin: the test derives the craft-naming set from the
 * resolved English leads and holds it equal to this list in BOTH directions,
 * so a reworded lead cannot silently desynchronize membership.
 */
export const CRAFT_NAMING_HINT_KEYS: ReadonlySet<TranslationKey> = new Set<TranslationKey>([
  'hudChrome.materialHint.arcaneShard',
  'hudChrome.materialHint.resonantThread',
  'hudChrome.materialHint.resonantHide',
  'hudChrome.materialHint.resonantLinks',
  'hudChrome.materialHint.resonantSteel',
  'hudChrome.materialHint.resonantTimber',
]);

/**
 * Whether this material already has a more specific purpose sentence that
 * fully answers "what profession is this for", so the generic Used-by line
 * would only repeat it. Exported for the decisiveness pin (the latent
 * single-craft cases never occur in live content while dust and essence feed
 * two crafts, so only a direct call can hold them).
 */
export function hasSupersedingPurposeHint(itemId: string, craftIds: readonly string[]): boolean {
  // Raw cooking catch: "Cooking ingredient. Must be cooked before eating."
  // covers the single-craft cooking case. Multi-craft catches still need
  // Used-by so Engineering (etc.) is not invisible beside the cooking line.
  if (cookingCatchHintKey(itemId) !== undefined) {
    return craftIds.length === 1 && craftIds[0] === 'cooking';
  }
  // A material hint supersedes only when its lead sentence names the craft
  // AND that craft is the sole consumer (CRAFT_NAMING_HINT_KEYS above). Once
  // a second craft consumes one, the lead covers half the answer and the
  // Used-by line has to render so the other craft is not hidden.
  const hintKey = materialHintKey(itemId);
  if (hintKey !== undefined && CRAFT_NAMING_HINT_KEYS.has(hintKey)) {
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
