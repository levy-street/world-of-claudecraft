// Profession affinity for honest materials: which craft(s) on the ring
// consume an item as a reagent. Derived from the live recipe and enchant
// tables the same way material_taxonomy.ts derives material membership, so
// authoring a new recipe self-registers its reagents here with no hand list.
//
// Fine grades also inherit the base grade's consumers: a fine ore stands in
// for its ordinary version wherever a recipe requires the base
// (material_grades.ts materialGradeIds, downward substitution). Direct fine-
// only consumers (tool recipes) stay on the fine id alone.
//
// Presentation order follows CRAFT_RING so multi-craft lines read in a stable,
// intentional order rather than first-seen recipe order.
//
// HARD RULE: no file under src/sim may import this module (same cycle hazard
// as material_taxonomy.ts; enforced beside it by the shared importer scan in
// tests/material_taxonomy.test.ts, and first-evaluation safety is proven by
// tests/material_profession_affinity_bootstrap.test.ts). UI and tests are
// the only consumers. Recipes are imported from content/recipes directly,
// NOT via data.ts, so this leaf keeps the whole data.ts closure out of its
// import graph and the hazard stays as small as the content tables it reads.

import { ENCHANTS } from './content/enchants';
import { CRAFT_RING } from './content/professions';
import { ALL_RECIPES } from './content/recipes';
import { baseMaterialFor } from './professions/material_grades';

/** Direct item id -> craft ids that list it as a reagent (recipes + enchants). */
function deriveDirectCraftConsumers(): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  const add = (itemId: string, craftId: string): void => {
    let set = map.get(itemId);
    if (!set) {
      set = new Set();
      map.set(itemId, set);
    }
    set.add(craftId);
  };
  for (const recipe of ALL_RECIPES) {
    for (const reagent of recipe.reagents) {
      add(reagent.itemId, recipe.professionId);
    }
  }
  for (const enchant of Object.values(ENCHANTS)) {
    for (const reagent of enchant.reagents) {
      add(reagent.itemId, 'enchanting');
    }
  }
  return map;
}

const DIRECT_CONSUMERS: ReadonlyMap<string, ReadonlySet<string>> = deriveDirectCraftConsumers();

const CRAFT_RING_ORDER: readonly string[] = CRAFT_RING.map((craft) => craft.id);

// The content tables never change after module evaluation, so the ring-ordered
// result per item id is memoized on first ask (tooltips re-ask on every hover).
// Misses memoize too, which is fine while callers pass catalog item ids (the
// tooltip does); a future caller feeding unbounded arbitrary ids would need a
// cap here first.
const CRAFTS_BY_ITEM = new Map<string, readonly string[]>();

/**
 * Craft ids that consume `itemId` as a reagent, in CRAFT_RING order.
 * Fine grades include the base grade's consumers (downward substitution).
 * Empty when nothing on the craft ring or enchant table consumes the id.
 */
export function craftIdsForMaterialItem(itemId: string): readonly string[] {
  const memo = CRAFTS_BY_ITEM.get(itemId);
  if (memo !== undefined) return memo;
  const crafts = new Set<string>();
  const direct = DIRECT_CONSUMERS.get(itemId);
  if (direct) {
    for (const craftId of direct) crafts.add(craftId);
  }
  // Fine grade stands in for its base wherever a recipe lists the base.
  const baseItemId = baseMaterialFor(itemId);
  if (baseItemId !== undefined) {
    const baseCrafts = DIRECT_CONSUMERS.get(baseItemId);
    if (baseCrafts) {
      for (const craftId of baseCrafts) crafts.add(craftId);
    }
  }
  const result: readonly string[] =
    crafts.size === 0 ? [] : CRAFT_RING_ORDER.filter((craftId) => crafts.has(craftId));
  CRAFTS_BY_ITEM.set(itemId, result);
  return result;
}
