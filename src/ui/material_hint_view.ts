// Purpose hints for the enchanting materials (a data-driven tooltip line).
// The eight arcane/resonant materials are kind 'junk' with no def-level use,
// so their tooltips said nothing about what they are for or where they come
// from: a player holding Resonant Timber had no in-game way to learn it is an
// enchanting reagent, let alone which gear yields it. One line per material,
// keyed by ITEM ID in the table below so the hint is DATA the painter reads,
// never a branch inside the tooltip builder.
//
// Deliberately scoped to these eight ids ONLY. Every other item keeps its
// existing tooltip byte-for-byte; this is not a general item-description
// mechanism (the def-driven lines above it already cover use/quest/set text).
// The source wordings track the sim's own routing rules:
// DISENCHANT_MATERIAL_BY_QUALITY (src/sim/professions/enchanting.ts) for the
// three arcane tiers, and ARMOR_SECONDARY_BY_TYPE / TIMBER_WEAPON_TYPES
// (src/sim/professions/disenchant_reagents.ts) for the five resonants.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { esc } from './esc';
import { type TranslationKey, t } from './i18n';

/** Item id -> its purpose-hint key. The ONLY items that carry a hint. */
export const MATERIAL_HINT_KEYS: Readonly<Record<string, TranslationKey>> = {
  arcane_dust: 'hudChrome.materialHint.arcaneDust',
  arcane_essence: 'hudChrome.materialHint.arcaneEssence',
  arcane_shard: 'hudChrome.materialHint.arcaneShard',
  resonant_thread: 'hudChrome.materialHint.resonantThread',
  resonant_hide: 'hudChrome.materialHint.resonantHide',
  resonant_links: 'hudChrome.materialHint.resonantLinks',
  resonant_steel: 'hudChrome.materialHint.resonantSteel',
  resonant_timber: 'hudChrome.materialHint.resonantTimber',
};

/** The hint key for one item id, or undefined for every other item. */
export function materialHintKey(itemId: string): TranslationKey | undefined {
  return MATERIAL_HINT_KEYS[itemId];
}

/** The hint as a tooltip line, or '' for an item with no hint. Rendered in the
 *  muted description style the other def-driven use lines share. */
export function materialHintLine(itemId: string): string {
  const key = materialHintKey(itemId);
  return key ? `<div class="tt-desc">${esc(t(key))}</div>` : '';
}
