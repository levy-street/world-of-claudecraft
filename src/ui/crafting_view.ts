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

import { craftSkillGainMultiplier } from '../sim/professions/archetype';
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
  // Station-bound recipe (#1297): craftable only at the level-20 crafting hub.
  requiresHubStation?: boolean;
  // Combo-recipe gate (#1132): present only on a recipe exclusive to one
  // specific adjacent craft pair. See src/sim/professions/types.ts for the
  // authoritative shape and src/sim/professions/crafting.ts for resolution.
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
  };
}

/** The skill-GAIN outlook for crafting a recipe, mirroring the sim's
 *  tier-progress multiplier at the gainCraftSkill call site in
 *  src/sim/professions/crafting.ts: 'full' (multiplier 1), 'reduced' (0.5,
 *  one tier under capability), 'none' (0: two-plus tiers under capability,
 *  or the recipe tier is above the archetype ceiling). Purely informational,
 *  never an admission gate: there is no skillReq gate on crafting. */
export type CraftDifficulty = 'full' | 'reduced' | 'none';

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
  /** The recipe's flat skill requirement, surfaced for the skill-req line. */
  skillReq: number;
  /** Skill-gain outlook (see CraftDifficulty). Actionable info: identical on
   *  every graphics preset, and the painter must never carry it color-only. */
  difficulty: CraftDifficulty;
  /** Hub-station gate (#1297): null when the recipe has no requiresHubStation;
   *  otherwise whether the player currently stands in station range. */
  station: { required: boolean; inRange: boolean } | null;
  /** True only when every reagent row is satisfied AND (for a combo recipe) the
   *  player's tier capability meets comboRequirement in both named crafts AND
   *  (for a station-bound recipe) the player is in station range: the "Craft"
   *  action is enabled. The server re-validates every gate on craft. */
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
 * tests, need not pass it), and whether the player currently stands in range
 * of the crafting-hub station (for #1297 station-bound recipes; defaults to
 * true so station-free callers need not pass it). Read-only: never mutates
 * any of its inputs.
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
  stationInRange = true,
): CraftingView {
  // One mutable copy for the sim-side pure functions (their CraftSkills
  // parameter is mutable-typed); they never write it, this is typing only.
  const skills = { ...craftSkills };
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
    const eligibility = identity.synced ? comboEligibility(combo, skills, identity) : null;
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
    // Skill-gain difficulty: the SAME shared craftSkillGainMultiplier the
    // sim's gainCraftSkill site consumes (archetype.ts), so the label can
    // never diverge from the authoritative grant. Computed the same while
    // identity is still syncing (empty pre-cprof skills, null archetype):
    // presentation-neutral, and never a craftable gate either way.
    const multiplier = craftSkillGainMultiplier(
      skills,
      identity.activeArchetype,
      identity.pairedMajor,
      recipe.professionId,
      identity.hobbyCraft,
      recipe.skillReq,
    );
    const difficulty: CraftDifficulty =
      multiplier === 0 ? 'none' : multiplier === 1 ? 'full' : 'reduced';
    const station = recipe.requiresHubStation ? { required: true, inRange: stationInRange } : null;
    return {
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      result: items[recipe.resultItemId],
      resultCount: recipe.resultCount,
      reagents: reagentRows,
      ...(comboRequirement ? { comboRequirement } : {}),
      skillReq: recipe.skillReq,
      difficulty,
      station,
      craftable:
        reagentRows.every((r) => r.satisfied) &&
        eligibility?.ok !== false &&
        (station === null || station.inRange),
    };
  });
  return { recipes: rows };
}
