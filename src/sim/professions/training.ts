// Recipe training (Professions 2.0 Phase 9): learning a trainer-taught recipe
// from the resident master at its craft's station. Pure validation only: the
// side effects (charging the fee, acquireRecipe, the trainResult event) live
// with the caller (Sim.trainRecipe), so `resolveTrain` can be exercised
// directly by tests the way crafting.ts's resolve* functions are.
//
// The locked general predicate (state.md, Phase 9): a master teaches a recipe
// when the student's tier IN THAT CRAFT has reached the recipe's own tier
// (`teachTierMet` below; tierForSkill on both sides, NO other condition).
// Training happens only within STATION_RADIUS of a STATIC station of the
// recipe's craft (stations.ts isAtStation); a mobile station NEVER satisfies
// training, unlike crafting's station gate.
//
// Grandfathering: every recipe that existed before Phase 9
// (PRE_TRAINING_RECIPE_IDS) stays known to existing characters via
// `grandfatherKnownRecipes`, a one-time idempotent union run on load and
// recorded by the persisted `recipesGrandfathered` flag (the mailWelcomed
// idiom; see PlayerMeta/CharacterState in sim.ts). Recipes authored after
// Phase 9 MUST carry a non-empty `acquisition` list (see the field doc in
// ./types.ts), so they are never silently known to everyone.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no randomness at all (training draws nothing), no Sim
// import (PlayerMeta arrives type-only, the crafting.ts idiom).

import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import { isRecipeKnown } from './crafting';
import { isAtStation, stationTypeForCraft } from './stations';
import type { ProfessionRecipeRecord } from './types';
import { type CraftSkills, tierForSkill } from './wheel';

// Flat training fee per recipe TIER (tierForSkill(recipe.skillReq)), in
// copper: common (tier 0) is free, uncommon (tier 1) is 25 silver, rare
// (tier 2) is 1 gold. Tiers beyond the table clamp to the last entry; the
// Phase 10/15 tuning passes own extending this table when higher-tier
// trainer-taught content lands.
export const TRAINING_FEE_BY_TIER: readonly number[] = Object.freeze([0, 2500, 10000]);

/** The one-time training fee for `recipe`, in copper: its tier's
 *  TRAINING_FEE_BY_TIER entry, clamped to the last entry for tiers past the
 *  table. A pure gold sink: charged exactly once, on a successful train. */
export function trainingFeeFor(recipe: ProfessionRecipeRecord): number {
  const tier = Math.min(tierForSkill(recipe.skillReq), TRAINING_FEE_BY_TIER.length - 1);
  return TRAINING_FEE_BY_TIER[tier];
}

/** The locked teach-tier predicate (state.md, Phase 9): the student's tier in
 *  the recipe's OWN craft has reached the recipe's tier. Exactly
 *  tierForSkill(craftSkills[recipe.professionId] ?? 0) >=
 *  tierForSkill(recipe.skillReq), and deliberately NO other condition (no
 *  archetype/ceiling/level arm: knowing a recipe and crafting it at tier stay
 *  orthogonal gates, see crafting.ts isRecipeKnown). */
export function teachTierMet(recipe: ProfessionRecipeRecord, craftSkills: CraftSkills): boolean {
  return tierForSkill(craftSkills[recipe.professionId] ?? 0) >= tierForSkill(recipe.skillReq);
}

// Stable deny reasons, not player-facing prose (the client renders localized
// copy off the code plus static recipe content; see the trainResult SimEvent).
export type TrainDenyReason =
  | 'train_already_known'
  | 'train_not_taught_here'
  | 'train_out_of_range'
  | 'train_tier_unmet'
  | 'train_cannot_afford';

export interface TrainResult {
  ok: boolean;
  recipeId: string;
  // Present only when !ok, and absent entirely for a malformed/unknown recipe
  // id (a silent deny: nothing to render a reason against).
  reason?: TrainDenyReason;
  // The fee this training costs (copper): charged by the caller exactly once,
  // only on ok. Carried on denials too (0 for an unknown id) so a UI probe
  // can price a train it cannot yet perform.
  fee: number;
}

/**
 * Pure validation of one train attempt: no side effect ever (the caller
 * charges/grants/emits on ok). The deny ORDER is load-bearing for replay
 * safety (a duplicate command must resolve train_already_known before any
 * other arm can fire, so it never re-charges):
 * 1. unknown recipeId: ok:false with NO reason (silent malformed input);
 * 2. already known (isRecipeKnown, grandfathered recipes included):
 *    train_already_known;
 * 3. recipe not trainer-taught (`acquisition` missing 'trainer'):
 *    train_not_taught_here;
 * 4. not within STATION_RADIUS of a STATIC station of the recipe's craft
 *    (stations.ts isAtStation; a mobile station NEVER satisfies training):
 *    train_out_of_range;
 * 5. teach tier unmet (teachTierMet above): train_tier_unmet;
 * 6. fee unaffordable (meta.copper below trainingFeeFor): train_cannot_afford;
 * 7. otherwise ok, with the fee to charge.
 */
export function resolveTrain(
  meta: PlayerMeta | undefined,
  pos: { x: number; z: number } | undefined,
  recipeId: string,
): TrainResult {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, recipeId, fee: 0 };
  const fee = trainingFeeFor(recipe);
  if (isRecipeKnown(meta, recipe)) {
    return { ok: false, recipeId, reason: 'train_already_known', fee };
  }
  if (!recipe.acquisition?.includes('trainer')) {
    return { ok: false, recipeId, reason: 'train_not_taught_here', fee };
  }
  const stationType = stationTypeForCraft(recipe.professionId);
  if (!stationType || !pos || !isAtStation(pos, stationType)) {
    return { ok: false, recipeId, reason: 'train_out_of_range', fee };
  }
  if (!teachTierMet(recipe, meta ? meta.craftSkills : {})) {
    return { ok: false, recipeId, reason: 'train_tier_unmet', fee };
  }
  if (!meta || meta.copper < fee) {
    return { ok: false, recipeId, reason: 'train_cannot_afford', fee };
  }
  return { ok: true, recipeId, fee };
}

// Every recipe id that existed BEFORE Phase 9 introduced trainer-taught
// acquisition: the 9 COMMON_RECIPES, 6 TOOL_RECIPES, 3 CASTER_HUB_RECIPES,
// and 3 COMBO_RECIPES (content/recipes.ts). Frozen literals on purpose: this
// is a historical record of the pre-training world, and must NOT grow when a
// new recipe is authored (new recipes carry their own acquisition list; see
// the authoring rule in ./types.ts). tests pin the membership.
export const PRE_TRAINING_RECIPE_IDS: readonly string[] = Object.freeze([
  // COMMON_RECIPES
  'recipe_eastbrook_arming_sword',
  'recipe_eastbrook_chain_vest',
  'recipe_eastbrook_wool_trousers',
  'recipe_tanned_leather_jerkin',
  'recipe_tough_jerky',
  'recipe_minor_healing_potion',
  'recipe_eastbrook_ritual_vestments',
  'recipe_eastbrook_druids_hide',
  'recipe_eastbrook_warded_leggings',
  // TOOL_RECIPES
  'recipe_thorium_mining_pick',
  'recipe_arcanite_mining_pick',
  'recipe_ashwood_axe',
  'recipe_elderwood_axe',
  'recipe_goldleaf_sickle',
  'recipe_sunpetal_sickle',
  // CASTER_HUB_RECIPES
  'recipe_wardweave_cowl',
  'recipe_duskhide_wraps',
  'recipe_sootscale_mantle',
  // COMBO_RECIPES (trainer-taught for NEW characters as of Phase 9; existing
  // characters keep them via this grandfather list)
  'recipe_ironbound_warplate_helm',
  'recipe_forgeguard_bulwark_gauntlets',
  'recipe_volatile_flux_elixir',
]);

/**
 * One-time grandfather normalize (the mailWelcomed idiom): when a loaded
 * character's save has not yet been through Phase 9 (`alreadyApplied` false),
 * union every PRE_TRAINING_RECIPE_IDS entry into their known set, so a
 * character who could craft the combo recipes before they became
 * trainer-taught never loses them. Always returns true (the value the caller
 * persists as `recipesGrandfathered`), and idempotent: re-running the union
 * on an already-grandfathered set changes nothing.
 */
export function grandfatherKnownRecipes(
  knownRecipes: Set<string>,
  alreadyApplied: boolean,
): boolean {
  if (!alreadyApplied) {
    for (const id of PRE_TRAINING_RECIPE_IDS) knownRecipes.add(id);
  }
  return true;
}
