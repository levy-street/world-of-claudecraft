// Crucible of the Last Spring: the shared raid reagent, eleven crafted
// collections and their manuals, and the Last Flame's Zeal formula.
// Collection gear and recipe data live in crucible_collections.ts.

import type { ItemDef } from '../types';
import { CRUCIBLE_COLLECTION_ITEMS, CRUCIBLE_COLLECTION_PATTERNS } from './crucible_collections';

// Materials staged before their consuming recipes ship. Remove an id from
// this list once a live recipe names it, since reagent derivation then owns
// its classification.
export const CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS: readonly string[] = [];

export const CRUCIBLE_PROFESSION_ITEMS: Record<string, ItemDef> = {
  ...CRUCIBLE_COLLECTION_ITEMS,
  ...CRUCIBLE_COLLECTION_PATTERNS,
  formula_lastflame_zeal: {
    id: 'formula_lastflame_zeal',
    name: "Formula: Last Flame's Zeal",
    kind: 'recipe',
    teachesRecipeId: 'enchant_weapon_lastflame_zeal',
    teachesEnchantId: 'enchant_weapon_lastflame_zeal',
    quality: 'epic',
    sellValue: 0,
    noVendorSell: true,
  },
  // Guaranteed off both raid bosses. Each collection piece and Zeal
  // application consumes three; each quartermaster manual costs one.
  // Ordinary tradable material; live recipe reagents own its classification.
  // Inputs retain more vendor value than the crafted output.
  lastflame_core: {
    id: 'lastflame_core',
    name: 'Core of the Last Flame',
    kind: 'junk',
    quality: 'epic',
    sellValue: 5000,
  },
};
