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

import {
  type ComboEligibilityReason,
  comboEligibility,
} from '../sim/professions/combo_eligibility';
import type { InvSlot, ItemDef } from '../sim/types';

export interface RecipeDefLike {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly { itemId: string; count: number }[];
  skillReq: number;
  // Combo-recipe gate (#1132): present only on a recipe exclusive to one
  // specific adjacent craft pair. See src/sim/professions/types.ts for the
  // authoritative shape and src/sim/professions/crafting.ts for resolution.
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
  };
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
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
    met: boolean | null;
    reason: ComboEligibilityReason | 'syncing' | null;
    unmetCrafts: string[];
  };
  /** True only when every reagent row is satisfied AND (for a combo recipe) the
   *  player's tier capability meets comboRequirement in both named crafts: the
   *  "Craft" action is enabled. */
  craftable: boolean;
}

export interface CraftingView {
  recipes: CraftingRecipeRow[];
}

export interface CraftingIdentityLike {
  synced: boolean;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
}

function countInInventory(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot.itemId === itemId) n += slot.count;
  return n;
}

/**
 * Build the structured crafting view from raw inputs: the recipe content list,
 * the local player's inventory, the item table (for display name/icon/
 * quality), and the local player's flat craft skills (for the combo-recipe
 * gate, #1132; defaults to empty so existing common-tier-only callers, e.g.
 * tests, need not pass it). Read-only: never mutates any of its inputs.
 */
export function buildCraftingView(
  recipes: readonly RecipeDefLike[],
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef>,
  craftSkills: Readonly<Record<string, number>> = {},
  identity: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  },
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
    const combo = recipe.comboRequirement;
    const eligibility = identity.synced
      ? comboEligibility(combo, { ...craftSkills }, identity)
      : null;
    const comboReason: ComboEligibilityReason | 'syncing' | null = identity.synced
      ? (eligibility?.reason ?? null)
      : 'syncing';
    const comboRequirement = combo
      ? {
          ...combo,
          met: eligibility?.ok ?? null,
          reason: comboReason,
          unmetCrafts: eligibility?.unmetCrafts ?? [],
        }
      : undefined;
    return {
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      result: items[recipe.resultItemId],
      resultCount: recipe.resultCount,
      reagents: reagentRows,
      ...(comboRequirement ? { comboRequirement } : {}),
      craftable: reagentRows.every((r) => r.satisfied) && eligibility?.ok !== false,
    };
  });
  return { recipes: rows };
}
