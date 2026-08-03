// Recipe training (Professions 2.0): learning a trainer-taught recipe
// from the resident master at its craft's station. Pure validation only: the
// side effects (charging the fee, acquireRecipe, the trainResult event) live
// with the caller (Sim.trainRecipe), so `resolveTrain` can be exercised
// directly by tests the way crafting.ts's resolve* functions are.
//
// The locked general predicate: a master teaches a recipe
// when the student's tier IN THAT CRAFT has reached the recipe's own tier
// (`teachTierMet` below; tierForSkill on both sides, NO other condition).
// Training happens only within STATION_RADIUS of a STATIC station of the
// recipe's craft (stations.ts isAtStation); a mobile station NEVER satisfies
// training, unlike crafting's station gate.
//
// Grandfathering: every recipe that existed before trainer-taught acquisition
// (PRE_TRAINING_RECIPE_IDS) stays known to existing characters via
// `grandfatherKnownRecipes`, a one-time idempotent union run on load and
// recorded by the persisted `recipesGrandfathered` flag (the mailWelcomed
// idiom; see PlayerMeta/CharacterState in sim.ts). Recipes authored since
// trainer-taught acquisition MUST carry a non-empty `acquisition` list (see
// the field doc in
// ./types.ts), so they are never silently known to everyone.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no randomness at all (training draws nothing), no Sim
// import (PlayerMeta arrives type-only, the crafting.ts idiom).

import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import type { StationDef, StationType } from '../types';
import { isRecipeKnown } from './crafting';
import { isAtStation, stationTypeForCraft } from './stations';
import type { ProfessionRecipeRecord } from './types';
import { type CraftSkills, tierForSkill } from './wheel';

// Flat training fee per recipe TIER (tierForSkill(recipe.skillReq)), in
// copper: common (tier 0) is free, uncommon (tier 1) is 25 silver, rare
// (tier 2) is 1 gold, then a 4x geometric step per tier: tier 3 is 4 gold,
// tier 4 is 16 gold. Tiers beyond the table still
// clamp to the last entry.
//
// The top two rungs are LIVE now, and they were not when this table was
// written. The two crafted fishing rods (content/recipes.ts ROD_RECIPES) are
// the first trainer-taught recipes to reach them: skillReq 75 lands on recipe
// tier 3 and pays 4 gold, and skillReq 125 lands on recipe tier 5, which is
// past the end of this table and so clamps to its last entry, 16 gold. Everything else taught by a
// trainer still sits at 0, 25 silver or 1 gold, and the six crafted LAND tools
// escape the table entirely because they predate training and carry no
// acquisition list, so they are known rather than learned. The derived rod
// fees (4 gold and 16 gold) are SETTLED (ruling R8 in
// docs/design/professions-tuning-packet-review.md): the curve stays
// exception-free, so moving a fee means moving this curve or the recipe's
// skillReq, never a special case.
export const TRAINING_FEE_BY_TIER: readonly number[] = Object.freeze([
  0, 2500, 10000, 40000, 160000,
]);

/** The one-time training fee for `recipe`, in copper: its tier's
 *  TRAINING_FEE_BY_TIER entry, clamped to the last entry for tiers past the
 *  table. A pure gold sink: charged exactly once, on a successful train. */
export function trainingFeeFor(recipe: ProfessionRecipeRecord): number {
  const tier = Math.min(tierForSkill(recipe.skillReq), TRAINING_FEE_BY_TIER.length - 1);
  return TRAINING_FEE_BY_TIER[tier];
}

/** The locked teach-tier predicate: the student's tier in
 *  the recipe's OWN craft has reached the recipe's tier. Exactly
 *  tierForSkill(craftSkills[recipe.professionId] ?? 0) >=
 *  tierForSkill(recipe.skillReq), and deliberately NO other condition (no
 *  archetype/ceiling/level arm: knowing a recipe and crafting it at tier stay
 *  orthogonal gates, see crafting.ts isRecipeKnown). */
export function teachTierMet(recipe: ProfessionRecipeRecord, craftSkills: CraftSkills): boolean {
  return tierForSkill(craftSkills[recipe.professionId] ?? 0) >= tierForSkill(recipe.skillReq);
}

/**
 * The station where a trainer-taught recipe is learned: the recipe's OWN
 * station binding when it has one, else the station serving its home craft.
 * One definition, three readers (resolveTrain's range arm, the trainer
 * window's teach list in src/ui/hud/vendor/train_view.ts, and the crafting
 * window's where-to-learn hint in src/ui/crafting_view.ts), so what the UI
 * lists and what the sim teaches can never name different masters.
 *
 * The fallback order matters for the crafts with no physical station
 * (enchanting/jewelcrafting/inscription, stations.ts stationTypeForCraft):
 * their recipes are teachable exactly when they carry an explicit
 * `stationType` (the tool-effect charms bind to the toolworks: the charms
 * are Enchanter work SOLD as tool upgrades, so the tool master teaches
 * them). For every recipe of a stationed craft the two arms agree today
 * (each such recipe's stationType, when present, IS its craft's station),
 * so this is a widening, not a change, for shipped content.
 */
export function trainingStationTypeFor(recipe: ProfessionRecipeRecord): StationType | undefined {
  return recipe.stationType ?? stationTypeForCraft(recipe.professionId);
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
  stations: readonly StationDef[],
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
  const stationType = trainingStationTypeFor(recipe);
  if (!stationType || !pos || !isAtStation(stations, pos, stationType)) {
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

// Every recipe id that existed BEFORE trainer-taught acquisition was
// introduced: the 9 COMMON_RECIPES, 6 TOOL_RECIPES, 3 CASTER_HUB_RECIPES,
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
  // COMBO_RECIPES (trainer-taught for NEW characters; existing
  // characters keep them via this grandfather list)
  'recipe_ironbound_warplate_helm',
  'recipe_forgeguard_bulwark_gauntlets',
  'recipe_volatile_flux_elixir',
]);

/**
 * One-time grandfather normalize (the mailWelcomed idiom): when a loaded
 * character's save has not yet been grandfathered (`alreadyApplied` false),
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

// The known-recipes load bound (phase 16). The grandfathered model DEPENDS on
// ids the current catalog no longer names surviving a load (a retired recipe
// keeps working forever), so a catalog allowlist here would be wrong; the
// bound is SHAPE only. No shipped recipe id approaches this length (the
// longest today is under 40 characters), so anything longer is a hand-edited
// or corrupted row riding every future save at full length, and non-strings
// have no legal writer at all.
export const MAX_KNOWN_RECIPE_ID_LENGTH = 64;

/**
 * The COUNT half of the same bound. The catalog ships well under a hundred
 * recipes, and the grandfather contract only ever adds PRE_TRAINING_RECIPE_IDS
 * on top, so a stored array anywhere near this size is corruption; without a
 * cap, one row of ten thousand well-shaped ids rides every autosave forever.
 * The bound is on the PERSISTED array, not on the live Set: the grandfather
 * union runs after this filter and may legitimately push a capped set a few
 * entries past it, which the next save then re-caps.
 */
export const MAX_KNOWN_RECIPE_IDS = 512;

/**
 * Load-side shape filter for a persisted knownRecipes value: strings within
 * the id-length bound survive byte-faithfully and IN ORDER (retired ids
 * included, the grandfather contract), everything else drops, and at most
 * MAX_KNOWN_RECIPE_IDS survive.
 *
 * TOTAL on `unknown`, which is the contract and not a convenience: this runs
 * inside Sim.addPlayer, so a stored value that is not an array (a JSON string
 * is the shape a hand-edit or a bad admin write produces) used to throw
 * `filter is not a function` there and lock that character out of the game
 * permanently, on every host, with no way back in. A corrupt value loads as
 * NO known recipes instead. A character not yet grandfathered still gets the
 * pre-training set unioned in on that same load; one already past the cut
 * loses what the corrupt row held, which was unreadable either way. Pure.
 */
export function sanitizeKnownRecipeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length > MAX_KNOWN_RECIPE_ID_LENGTH) continue;
    out.push(id);
    if (out.length === MAX_KNOWN_RECIPE_IDS) break;
  }
  return out;
}
