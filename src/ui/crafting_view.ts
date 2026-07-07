// Pure, host-agnostic view model for the crafting window (issue #1127).
//
// This is the pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md Conventions; reference unit_portrait.ts / vendor_view.ts). It owns
// the one thing the crafting window decides that is worth testing without a
// DOM: for each known recipe, whether the local player currently holds every
// required reagent (so the "Craft" button can be enabled/disabled), and the
// display quantities for each reagent line. The DOM/i18n side lives in a
// thin painter; rendering is driven entirely off the structure returned here.
//
// DOM-free and i18n-free so tests/crafting_view.test.ts can drive it directly.

import type { InvSlot, ItemDef } from '../sim/types';

export interface RecipeDefLike {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly { itemId: string; count: number }[];
  skillReq: number;
}

export interface CraftingReagentRow {
  itemId: string;
  item?: ItemDef;
  required: number;
  have: number;
  /** True when the player holds at least `required` of this reagent. */
  satisfied: boolean;
}

export interface CraftingRecipeRow {
  recipeId: string;
  professionId: string;
  resultItemId: string;
  result?: ItemDef;
  resultCount: number;
  reagents: CraftingReagentRow[];
  /** True only when every reagent row is satisfied: the "Craft" action is enabled. */
  craftable: boolean;
}

export interface CraftingView {
  recipes: CraftingRecipeRow[];
}

function countInInventory(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot.itemId === itemId) n += slot.count;
  return n;
}

/**
 * Build the structured crafting view from raw inputs: the recipe content list,
 * the local player's inventory, and the item table (for display name/icon/
 * quality). Read-only: never mutates any of its inputs.
 */
export function buildCraftingView(
  recipes: readonly RecipeDefLike[],
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef>,
): CraftingView {
  const rows: CraftingRecipeRow[] = recipes.map((recipe) => {
    const reagentRows: CraftingReagentRow[] = recipe.reagents.map((reagent) => {
      const have = countInInventory(inventory, reagent.itemId);
      return {
        itemId: reagent.itemId,
        item: items[reagent.itemId],
        required: reagent.count,
        have,
        satisfied: have >= reagent.count,
      };
    });
    return {
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      result: items[recipe.resultItemId],
      resultCount: recipe.resultCount,
      reagents: reagentRows,
      craftable: reagentRows.every((r) => r.satisfied),
    };
  });
  return { recipes: rows };
}
