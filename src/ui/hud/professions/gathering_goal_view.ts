// Pure, host-agnostic view model for the gathering goal panel (Intentional
// Gathering PR4): a persistent compact readout of "what am I collecting for
// right now", built from the frozen GatheringGoalView DTO
// (src/sim/professions/gathering_goal_types.ts) plus the item table and the
// gathering-source reverse lookup (gathering_supply.ts). DOM/i18n-free so
// tests/gathering_goal_view.test.ts can drive it directly; the thin painter
// (gathering_goal_painter.ts) resolves display names/labels and paints from
// this model.
//
// This module decides NO tracking and applies NO harvest preference: it only
// projects the sim's own read-only GatheringGoalView into a render-ready
// shape. Selecting a goal, changing quantity, and setting a harvest
// preference are all explicit actions the painter forwards through callbacks
// the parent composition supplies.

import type { GatheringProfessionId } from '../../../sim/content/professions';
import { ALL_RECIPES } from '../../../sim/content/recipes';
import type {
  GatheringGoalIdentity,
  GatheringGoalMaterial,
  GatheringGoalUnavailableReason,
  GatheringGoalView,
} from '../../../sim/professions/gathering_goal_types';
import {
  CORPSE_HARVEST_FAMILY,
  gatheringSupplyHintsForItem,
} from '../../../sim/professions/gathering_supply';
import type { HarvestPreference } from '../../../sim/professions/harvest_preference';
import type { ItemDef } from '../../../sim/types';
import { knownItemDef } from '../../known_item';

export type GatheringGoalSourceFamilyId = GatheringProfessionId | typeof CORPSE_HARVEST_FAMILY;

export interface GatheringGoalMaterialRow {
  readonly itemId: string;
  readonly item?: ItemDef;
  readonly required: number;
  readonly carried: number;
  readonly stored: number;
  readonly reachable: number;
  readonly missing: number;
  readonly inaccessible: number;
  /** `reachable >= required`: this row alone contributes nothing to the
   *  panel being blocked. Never implies the overall goal is deliverable
   *  (gold, a station, and bag space are separate concerns this row knows
   *  nothing about). */
  readonly satisfied: boolean;
  /** The gathering family the reverse lookup credits this material to, or
   *  null when no gathering family supplies it (a vendor-only or crafted
   *  intermediate reagent). Exact family membership, never inferred from the
   *  item's name. */
  readonly sourceFamilyId: GatheringGoalSourceFamilyId | null;
  /** Set ONLY when sourceFamilyId is the corpse family and the reverse
   *  lookup names a real material id a harvest preference could target
   *  (never a specimen id, never a tag): the row's "Set as harvest
   *  preference" shortcut target. Null for every node/fish/farm row and for
   *  a corpse hint with no resolvable preference target. */
  readonly corpsePreferenceItemId: string | null;
  /** True exactly when `corpsePreferenceItemId` is non-null AND matches the
   *  viewer's AUTHORITATIVE `harvestPreference` (the real union read the
   *  caller passes in, never guessed from this row's own shortcut target):
   *  the row is already the active preference, so the painter renders a
   *  disabled "current" state instead of a redundant Set action. Always
   *  false when `corpsePreferenceItemId` is null (no shortcut on this row at
   *  all). */
  readonly isCurrentHarvestPreference: boolean;
}

export interface GatheringGoalRecipeResult {
  readonly resultItemId: string;
  readonly resultCount: number;
}

/** Injected recipe lookup so this module never hardcodes a second copy of
 *  "which recipe produces what": both a craft goal and a commission goal
 *  carry a recipeId, and the commission order's own recipe is the SAME
 *  recipe table row a craft goal names. Defaults to reading ALL_RECIPES
 *  directly (the content table every other pure profession view already
 *  imports, e.g. crafting_view.ts), so ordinary callers pass nothing. */
export function recipeResultFor(recipeId: string): GatheringGoalRecipeResult | undefined {
  const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return undefined;
  return { resultItemId: recipe.resultItemId, resultCount: recipe.resultCount };
}

export interface GatheringGoalPanelModel {
  readonly goal: GatheringGoalIdentity | null;
  readonly status: GatheringGoalView['status'];
  readonly reason: GatheringGoalUnavailableReason | null;
  readonly resultItemId: string | null;
  readonly result?: ItemDef;
  /** The number of CRAFTS the goal tracks: the recipe goal's own requested
   *  count, or exactly 1 for a commission (a commission is always one craft
   *  of the authoritative order recipe). Null when the goal's recipe does
   *  not resolve (an unknown/retired recipe id: the 'unknown_recipe' reason
   *  already covers this on the status side). */
  readonly craftCount: number | null;
  /** The TOTAL OUTPUT the panel should display beside the result:
   *  `craftCount * recipe.resultCount`, so a recipe that produces a stack
   *  (resultCount > 1) reports the real item total rather than the craft
   *  count alone. Null under the same condition as craftCount. */
  readonly displayCount: number | null;
  readonly materials: readonly GatheringGoalMaterialRow[];
  readonly payableCrafts: number;
  readonly storageRestricted: boolean;
}

function materialRow(
  material: GatheringGoalMaterial,
  items: Readonly<Record<string, ItemDef>>,
  harvestPreference: HarvestPreference | null,
): GatheringGoalMaterialRow {
  const hints = gatheringSupplyHintsForItem(material.itemId);
  const corpseHint = hints.find((h) => h.familyId === CORPSE_HARVEST_FAMILY);
  const hint = corpseHint ?? hints[0];
  const corpsePreferenceItemId =
    hint?.familyId === CORPSE_HARVEST_FAMILY ? hint.corpsePreferenceItemId : null;
  return {
    itemId: material.itemId,
    item: knownItemDef(items, material.itemId),
    required: material.required,
    carried: material.carried,
    stored: material.stored,
    reachable: material.reachable,
    missing: material.missing,
    inaccessible: material.inaccessible,
    satisfied: material.reachable >= material.required,
    sourceFamilyId: hint?.familyId ?? null,
    corpsePreferenceItemId,
    isCurrentHarvestPreference:
      corpsePreferenceItemId !== null &&
      harvestPreference !== null &&
      harvestPreference.kind === 'material' &&
      harvestPreference.itemId === corpsePreferenceItemId,
  };
}

/** The inert shape for "nothing tracked at all": `IWorld.gatheringGoal` is
 *  `GatheringGoalView | null` (the outer null covers "no goal exists yet",
 *  distinct from the inner `view.goal === null` the sim's own DTO already
 *  states), so this module is the one place that folds the two into the
 *  same render-ready model rather than every caller re-deriving a fallback. */
const NO_GOAL_VIEW: GatheringGoalView = Object.freeze({
  goal: null,
  status: 'collecting',
  reason: null,
  materials: [],
  payableCrafts: 0,
  storageRestricted: false,
});

/**
 * Build the panel model from the sim's GatheringGoalView (or null: no goal
 * has ever been tracked), the item table (for display name/icon/quality
 * resolution), an optional recipe lookup (defaults to the live content
 * table), and the viewer's AUTHORITATIVE harvest preference (defaults to
 * null: callers that never pass one get every row's
 * isCurrentHarvestPreference as false, never a guess). Read-only over every
 * input.
 */
export function buildGatheringGoalPanelModel(
  view: GatheringGoalView | null,
  items: Readonly<Record<string, ItemDef>>,
  resolveRecipe: (recipeId: string) => GatheringGoalRecipeResult | undefined = recipeResultFor,
  harvestPreference: HarvestPreference | null = null,
): GatheringGoalPanelModel {
  const resolved = view ?? NO_GOAL_VIEW;
  const recipe = resolved.goal ? resolveRecipe(resolved.goal.recipeId) : undefined;
  const resultItemId = recipe?.resultItemId ?? null;
  // Commission is always exactly ONE craft of the authoritative order
  // recipe; a recipe goal tracks its own requested craft count.
  const craftCount =
    recipe === undefined ? null : resolved.goal?.kind === 'recipe' ? resolved.goal.count : 1;
  const displayCount =
    craftCount === null || recipe === undefined ? null : craftCount * recipe.resultCount;
  return {
    goal: resolved.goal,
    status: resolved.status,
    reason: resolved.reason,
    resultItemId,
    result: resultItemId !== null ? knownItemDef(items, resultItemId) : undefined,
    craftCount,
    displayCount,
    materials: resolved.materials.map((material) =>
      materialRow(material, items, harvestPreference),
    ),
    payableCrafts: resolved.payableCrafts,
    storageRestricted: resolved.storageRestricted,
  };
}
