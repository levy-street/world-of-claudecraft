// The canonical honest-material registry shared by the sim and presentation.
// Gathering, salvage, and recipe-pending tables live in type-light leaves, so
// this module can derive eagerly without pulling command modules back through
// bags. The returned view has no runtime mutation surface; its Set is
// closure-private.

import { CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS } from './content/crucible_professions';
import { ENCHANTS } from './content/enchants';
import { HARVEST_COMPONENT_ITEMS, HARVEST_COMPONENT_SPECIMENS } from './content/professions';
import { ALL_RECIPES, ITEMS } from './data';
import { deriveMaterialItemIds } from './material_derivation';
import { NODE_MATERIAL_TABLE } from './professions/gathering_materials';
import { MATERIAL_GRADES } from './professions/material_grades';
import { SALVAGE_MATERIAL_BY_QUALITY } from './professions/salvage_materials';

export const MATERIAL_ITEM_IDS: ReadonlySet<string> = deriveMaterialItemIds({
  nodeMaterialTable: NODE_MATERIAL_TABLE,
  materialGrades: MATERIAL_GRADES,
  harvestComponentItems: HARVEST_COMPONENT_ITEMS,
  harvestComponentSpecimens: HARVEST_COMPONENT_SPECIMENS,
  salvageMaterialByQuality: SALVAGE_MATERIAL_BY_QUALITY,
  recipes: ALL_RECIPES,
  enchants: ENCHANTS,
  recipePendingMaterialItemIds: CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS,
  items: ITEMS,
});

/** Every item id the sim treats as an honest material. */
export function materialItemIds(): ReadonlySet<string> {
  return MATERIAL_ITEM_IDS;
}

/** Set membership on the id, for call sites that hold an id rather than a def. */
export function isMaterialItemId(itemId: string): boolean {
  return MATERIAL_ITEM_IDS.has(itemId);
}
