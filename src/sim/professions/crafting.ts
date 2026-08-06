// Common-tier crafting resolution (issue #1127). Behind the SimContext seam:
// checks a player has every reagent a recipe requires, consumes them (denying
// and consuming NOTHING if any reagent is short), grants the recipe's declared
// output deterministically (Professions 2.0 retired the output quality
// roll: the only output-side rng is the single masterwork proc draw below, at
// the same draw position the old roll occupied), and grants a flat point of
// craft skill (see wheel.ts: additive-only, free-floor). A proc mints a
// masterwork instance whose bonus stats are baked from the item budget
// (professions/masterwork.ts): add-only, never a downgrade. Input-side rng
// (gathering.ts rollMaterialRarity) is untouched by the deterministic-output model.
//
// Scope: originally the common-tier path only; the module now also resolves
// the higher-tier content that landed on it (content/recipes.ts TOOL_RECIPES
// at skillReq 75/150, COMBO_RECIPES at skillReq 25), the #1132 combo gate,
// the #1129 archetype empowerment ceiling, the #1299 acquisition gate, and
// the #1301 gold sink + output throttle. There is still NO skillReq
// admission gate: any known recipe is attemptable on materials alone, and
// tier only shapes skill-gain scaling, the masterwork proc chance, and (via
// the ceiling) masterwork eligibility.
//
// #1149 (Battlefield Experience) attribution: a crafted output whose DEF
// quality is rare-or-better is stamped with its crafter's name via
// ctx.addItemInstance (the signing threshold reads the static
// def quality, since outputs no longer roll one), same signable-rarity
// threshold and same {signer} shape gathering.ts's harvestCorpse already uses
// for monster materials (#1145). Below that threshold the output stays a
// plain fungible grant. A masterwork proc's copy is always instanced and
// signed, whatever its def quality. This is what gives
// professions/battlefield_xp.ts a `signer` to resolve later, when that
// specific copy is drunk/worn/lands a killing blow.
//
// Specialization material discount (#1134): once a player is specialized in a
// recipe's craft (wheel.ts `isSpecialized`, gated on `PERK_THRESHOLDS`
// content), every reagent's required quantity is discounted via
// `materialCostMultiplier`, floored, with a minimum of 1 (a discount can never
// make a recipe free of an ingredient it needs at least one of). This is
// applied identically to the availability check and the actual consumption,
// so a specialized crafter is never asked for more than they are charged.
//
// #1145 self-gathered crafting bonus: the chosen bonus is a REDUCED REQUIRED
// QUANTITY (rather than an item-level/quality lift): one fewer unit of a
// reagent per craft, for every reagent where the crafter holds at least one
// signed instance stamped with their OWN name (a rare+ monster material they
// harvested themselves; see professions/gathering.ts). Using someone ELSE's
// signed material (signer set but not the crafter's own name) is NOT counted
// here: it behaves exactly like a plain unsigned material, no bonus.
//
// The two discounts COMPOSE: the #1145 flat reduction is applied to the
// listed reagent count first (floored at 1), then the #1134 specialization
// percentage multiplier is applied to that result (floored at 1), so a
// specialized crafter using their own self-signed material gets both
// benefits and neither discount can ever waive a reagent entirely.
//
// The masterwork proc's signed-reagent term (masterwork.ts) is DELIBERATELY
// wider than #1145 (the 2026-07-17 design ruling): it counts a held signed
// instance with ANY player's signature, the crafter's own included, so buying
// a gatherer's signed materials is worth as much to the proc as gathering
// your own. It is also decoupled from the quantity discount: a count-1 signed
// reagent feeds the proc even though the discount can never fire for it. Only
// the quantity discount stays self-only.
//
// Combo-recipe requirement (issue #1132): a recipe may carry a
// `comboRequirement` naming one specific adjacent craft pair and a minimum
// tier both must meet. The character must be attuned to that exact unordered
// pair, and both named crafts must reach the required archetype-gated tier.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged.

import { bagCapacity, countStacked, fitsAll, removeStacked } from '../bags';
import { CRAFT_BATCH_MAX, CRAFT_GOLD_SINK_COPPER_PER_BUDGET } from '../content/professions';
import { recipeById } from '../content/recipes';
import { ITEMS } from '../data';
import { forceDismount } from '../mounts';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, InvSlot, ItemDef, ItemInstancePayload } from '../types';
import { CRAFT_CAST_ID, isConsuming } from '../types';
import { archetypeCeilingFor, craftSkillGainMultiplier } from './archetype';
import { comboEligibility } from './combo_eligibility';
import { isCommissionEligible } from './commission';
import { craftCastDurationSec } from './craft_cast_duration';
import { announceMasterworkZone } from './gather_events';
import { isSignableMaterialRarity, type MaterialRarity } from './gathering';
import {
  type CraftVarianceOutcome,
  JACK_VARIANCE_BETTER_PROC_BONUS,
  rollCraftVariance,
} from './jack_variance';
import {
  MASTERWORK_CHANCE_CAP,
  type MasterworkProc,
  masterworkBonusStats,
  masterworkBumpedQuality,
  masterworkProcChance,
} from './masterwork';
import { countAcrossGrades, materialGradeIds, planGradeRemoval } from './material_grades';
import { materialTierBonusForReagents } from './material_tier';
import { isStationActive } from './mobile_station';
import { craftActionXp } from './profession_xp';
import { isAtStation, stationTypeForCraft } from './stations';
import type { ProfessionReagent, ProfessionRecipeRecord } from './types';
import {
  type CraftSkillState,
  type CraftSkills,
  gainCraftSkill,
  isSpecialized,
  materialCostMultiplier,
  tierCapability,
  tierForSkill,
} from './wheel';

// The BASE craft-skill amount per successful craft, scaled by the
// four-state mastery curve at the gain site below (CRAFT_SKILL_GAIN *
// craftSkillGainMultiplier): full 1, reduced 0.5, minimal 0.25, gray 0. The
// old tier-0 free-floor GAIN rule (skill always accrues on the cheapest
// recipe) is retired; the free-floor COST rule (common-tier crafting never
// costs anything) lives on in recipes.ts/types.ts.
const CRAFT_SKILL_GAIN = 1;

// Re-export for callers that already import from crafting.ts.
export { CRAFT_BATCH_MAX } from '../content/professions';

// Jack of All Trades cross-craft synergy discount (issue #1296, the second
// improviser perk): an ADDITIONAL flat percentage shaved off every reagent's
// required quantity for a Jack-attuned crafter, composing with the #1145
// self-signed reduction and #1134 specialization discount the same way those
// two already compose (requiredReagentCountFor below): one combined floor,
// never fully waiving a reagent (floored at 1). Represents a Jack's breadth
// across every craft lowering material waste, unlike specialization's
// per-craft depth. Magnitude is an open design question (the doc's own Open
// Questions section: "the material-saving bonus" magnitude "is open"); kept
// modest and below PERK_THRESHOLDS' specialization discount
// (content/professions.ts materialDiscountPct, 0.2), since a Jack is
// deliberately broad-and-shallow rather than ever truly specialized.
const JACK_MATERIAL_DISCOUNT_PCT = 0.1;

function isCraftedDisenchantTrackedOutput(def: ItemDef | undefined): boolean {
  return (
    !!def &&
    (def.kind === 'weapon' || def.kind === 'armor') &&
    !!def.quality &&
    def.quality !== 'poor'
  );
}

export interface CraftResult {
  ok: boolean;
  recipeId: string;
  // Present only when ok: the granted item id/count and the OUTPUT DEF quality
  // (outputs are deterministic, so quality is a static fact of the
  // result item's def, normalized onto the MaterialRarity ladder; the rolled
  // quality is retired).
  itemId?: string;
  count?: number;
  quality?: MaterialRarity;
  // Masterwork model: true only when the masterwork effect applied to
  // this craft's output (a proc hit AND the effect gates passed). Absent
  // otherwise, including on every plain deterministic success.
  masterwork?: boolean;
  // #1145: true when at least one consumed reagent had a self-gathered signed
  // instance (signer === the crafting player's own name) counted toward it,
  // reducing that reagent's required quantity by one for this craft.
  selfSignedBonusApplied?: boolean;
  // Commissions (Professions 2.0): true only when the opt-in flag
  // was honored, i.e. the output is an eligible equipment kind and every
  // granted copy was minted armed with bindOnTrade (commission.ts). Absent
  // when the flag was not set AND when it was silently ignored for an
  // ineligible output kind. Sim-internal: this field is NOT projected into
  // CraftResultView (world_api/professions.ts) or the craftResult SimEvent,
  // so no UI may consume it (the honored-vs-ignored pins are its consumer);
  // the player-visible commission fact is the payload's bindOnTrade arm.
  commission?: boolean;
  // Jack of All Trades improviser variance (#1296): present only for a
  // Jack-attuned crafter (jack_variance.ts rollCraftVariance draws an
  // ADDITIONAL rng roll only then, so every non-Jack craft still draws
  // exactly the one masterwork proc roll, unchanged). 'worse' forced this
  // craft's masterwork bump off outright; 'better' improved (never
  // guaranteed) this craft's masterwork odds; 'normal' changed nothing.
  // Sim-internal, the same as `commission` above: NOT projected into
  // CraftResultView or the craftResult SimEvent, since there is no live
  // quest path to become Jack yet (see archetype.ts attuneJackOfAllTrades).
  variance?: CraftVarianceOutcome;
  // Craft Cast System: true when craftItem admitted the attempt and started
  // a CRAFT_CAST_ID cast (no grant yet). Absent on complete resolves and
  // denials. Sim.craftItem skips the craftResult emit while this is set.
  casting?: boolean;
  // Present only when !ok: a stable reason code, not player-facing prose (the
  // caller renders/localizes the denial). `throttled` remains in the union for
  // type stability even though the craft path no longer returns it (Phase 1
  // retired craft from the shared action window).
  reason?:
    | 'unknown_recipe'
    | 'insufficient_materials'
    | 'combo_requirement_unmet'
    | 'recipe_not_learned'
    | 'throttled'
    | 'station_required'
    | 'no_bag_space'
    | 'busy';
}

/** Whether `meta` currently knows `recipe` (issue #1299): a recipe with no
 *  `acquisition` list (or an empty one) is grandfathered, known to everyone
 *  with no learn step; otherwise `meta` must hold it in `knownRecipes`. This
 *  is orthogonal to tier/skill: a player can know a recipe they cannot yet
 *  craft at tier, and vice versa. */
export function isRecipeKnown(
  meta: PlayerMeta | undefined,
  recipe: ProfessionRecipeRecord,
): boolean {
  if (!recipe.acquisition || recipe.acquisition.length === 0) return true;
  return !!meta && meta.knownRecipes.has(recipe.id);
}

export interface AcquireRecipeResult {
  ok: boolean;
  recipeId: string;
  reason?: 'unknown_recipe' | 'already_known' | 'wrong_source';
}

/**
 * Acquire one recipe from one source (issue #1299: trainer purchase, mob
 * drop, or quest reward). Denies (no side effect) if the recipe id is
 * unknown, the player already knows it, or `source` is not one of the
 * recipe's listed `acquisition` sources. On success marks the recipe known;
 * the caller (PlayerMeta.knownRecipes) is a plain Set field on the character
 * save row, so this persists across logout the same way craftSkills does.
 */
export function acquireRecipe(
  ctx: SimContext,
  pid: number,
  recipeId: string,
  source: 'trainer' | 'drop' | 'quest',
): AcquireRecipeResult {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, recipeId, reason: 'unknown_recipe' };
  return acquireRecipeForRecipe(ctx, pid, recipe, source);
}

/** Acquire one already-resolved recipe record from one source. Exported
 *  separately from `acquireRecipe` (mirroring the resolveCraft /
 *  resolveCraftForRecipe split above) so tests can exercise the success and
 *  wrong_source arms against a synthetic gated recipe, independent of the
 *  real acquisition-gated content (since Professions 2.0 the three
 *  COMBO_RECIPES in `content/recipes.ts` are trainer-gated; see
 *  ./training.ts for the training flow that feeds this the 'trainer'
 *  source). */
export function acquireRecipeForRecipe(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
  source: 'trainer' | 'drop' | 'quest',
): AcquireRecipeResult {
  const recipeId = recipe.id;
  const meta = ctx.players.get(pid);
  if (!meta) return { ok: false, recipeId, reason: 'unknown_recipe' };
  if (isRecipeKnown(meta, recipe)) return { ok: false, recipeId, reason: 'already_known' };
  if (!recipe.acquisition?.includes(source)) {
    return { ok: false, recipeId, reason: 'wrong_source' };
  }
  meta.knownRecipes.add(recipeId);
  return { ok: true, recipeId };
}

/** Whether `inventory` holds a slot for `itemId` carrying a signed instance
 *  stamped with `playerName` (a self-gathered signed material). The
 *  host-agnostic form of the #1145 self-signed predicate: no PlayerMeta, so
 *  the crafting window's view core (src/ui/crafting_view.ts) consumes the
 *  SAME check the sim charges by, and the two can never diverge. */
export function holdsSelfSignedInstance(
  inventory: readonly InvSlot[],
  playerName: string,
  itemId: string,
): boolean {
  return inventory.some((s) => s.itemId === itemId && s.instance?.signer === playerName);
}

/** Whether `meta` holds an inventory slot for `itemId` carrying a signed
 *  instance stamped with `meta`'s OWN name (a self-gathered signed material).
 *
 *  Spans the reagent's grades (professions/material_grades.ts). The reason is
 *  that the fine grade REPLACES the plain yield, so past the tier-1 tool a
 *  player's self-gathered copper ore IS fine copper ore, and checking the
 *  declared id alone would quietly stop the #1145 discount firing for exactly
 *  the players who upgraded: using the better tool would cost them a perk.
 *
 *  Note the semantic this inherits and does not change: the discount is
 *  keyed on HOLDING a self-signed copy, not on spending one, and
 *  `planGradeRemoval` drains the base grade first. So a player holding both
 *  grades earns the discount from the fine copy while the craft actually
 *  spends plain ore. That hold-not-spend behavior predates the grades (the
 *  check was always a `some`, and removeItem walks end-backward, so the
 *  signed copy was never guaranteed to be the consumed one); the widening
 *  extends it to a second id rather than introducing it. Pinned in
 *  tests/material_grade_substitution.test.ts so the ruling is on record. */
function hasSelfSignedInstance(meta: PlayerMeta, itemId: string): boolean {
  return materialGradeIds(itemId).some((gradeId) =>
    holdsSelfSignedInstance(meta.inventory, meta.name, gradeId),
  );
}

/** Whether `meta` holds an inventory slot for `itemId` carrying a signed
 *  instance with ANY signer (the crafter's own name included). Feeds the
 *  masterwork proc's signed-reagent term (2026-07-17 ruling); the #1145
 *  quantity discount keeps using the self-only check above.
 *
 *  Spans the reagent's grades for the same reason its sibling does. 26 shipped
 *  masterwork-capable recipes declare a material that has a fine grade
 *  (ironedge_longsword, thoriumscale_cuirass, goldweave_robe and the rest), and
 *  a fine grade carries a signer exactly like its base: resolveHarvest mints
 *  the signed instance on the RESOLVED id (gathering.ts). So a player who
 *  out-tooled the material, holding only signed fine copies, would pay the
 *  reagent line with one and still lose MASTERWORK_SIGNED_CHANCE, which is the
 *  same inversion the sibling exists to prevent. */
function hasSignedInstance(meta: PlayerMeta, itemId: string): boolean {
  const gradeIds = materialGradeIds(itemId);
  return meta.inventory.some((s) => gradeIds.includes(s.itemId) && !!s.instance?.signer);
}

/** The result of resolving one reagent's required quantity: the final count
 *  after both discounts compose, plus whether the #1145 self-signed
 *  reduction specifically (not the composed total) actually lowered it. */
export interface RequiredReagentResult {
  count: number;
  selfSignedBonusApplied: boolean;
}

/**
 * The quantity of one reagent actually required from `pid`, after both
 * discounts compose: `reagent.count` is first reduced by one (floored at 1,
 * never fully waived) if `pid` holds a self-signed instance of that material
 * (#1145), then that result is multiplied by `materialCostMultiplier` for
 * `professionId` (#1134), floored, with a minimum of 1. A non-specialized
 * crafter with no self-signed material always gets back the listed `count`
 * unchanged. `selfSignedBonusApplied` reflects the self-signed step alone, so
 * it stays accurate even when the #1134 specialization discount also lowers
 * the composed count.
 */
export function requiredReagentCount(
  meta: PlayerMeta | undefined,
  reagent: ProfessionReagent,
  craftSkills: CraftSkillState,
  professionId: string,
): RequiredReagentResult {
  return requiredReagentCountFor(
    !!meta && hasSelfSignedInstance(meta, reagent.itemId),
    reagent,
    craftSkills,
    professionId,
    !!meta?.archetype?.isJackOfAllTrades,
  );
}

/**
 * The count math behind `requiredReagentCount`, with the #1145 self-signed
 * fact resolved by the caller (holdsSelfSignedInstance above) instead of read
 * off a PlayerMeta. Host-agnostic and draw-free, exported so the crafting
 * window's view core computes its displayed requirement and Craft gate with
 * the SAME function the sim's availability check and consumption use, the
 * single-surface doctrine the difficulty label already follows.
 *
 * `isJackOfAllTrades` (#1296) composes a THIRD multiplicative discount, the
 * cross-craft synergy material-saving perk, on top of the #1145/#1134 pair
 * in the SAME single floor (never triple-floored, so the three never
 * compound more aggressively than one combined percentage would). Defaults
 * false so every existing caller (crafting_view.ts's UI projection included)
 * is byte-identical until it is threaded a real Jack identity.
 */
export function requiredReagentCountFor(
  hasSelfSigned: boolean,
  reagent: ProfessionReagent,
  craftSkills: CraftSkillState,
  professionId: string,
  isJackOfAllTrades = false,
): RequiredReagentResult {
  const afterSelfSigned = hasSelfSigned ? Math.max(1, reagent.count - 1) : reagent.count;
  const multiplier = materialCostMultiplier(craftSkills, professionId);
  const jackMultiplier = isJackOfAllTrades ? 1 - JACK_MATERIAL_DISCOUNT_PCT : 1;
  return {
    count: Math.max(1, Math.floor(afterSelfSigned * multiplier * jackMultiplier)),
    selfSignedBonusApplied: afterSelfSigned < reagent.count,
  };
}

/** Whether the given player currently holds every reagent a recipe requires,
 *  in the required quantities, after that player's #1145 self-signed
 *  reduction and #1134 specialization discount compose. Read-only: never
 *  mutates inventory. */
export function hasRecipeMaterials(
  ctx: SimContext,
  recipe: ProfessionRecipeRecord,
  pid: number,
): boolean {
  const meta = ctx.players.get(pid);
  const craftSkills = meta ? meta.craftSkills : {};
  return recipe.reagents.every(
    (r) =>
      // Counted across the reagent's grades, in the same order the
      // consumption below spends them, so the gate can never promise units the
      // removal would not find.
      countAcrossGrades(r.itemId, (id) => ctx.countItem(id, pid)) >=
      requiredReagentCount(meta, r, craftSkills, recipe.professionId).count,
  );
}

/** Whether the player satisfies a recipe's dual-craft combo requirement.
 *  Recipes without a combo requirement pass. Combo recipes require the exact
 *  unordered active pair plus the minimum reachable tier in both crafts.
 *  Raw skill alone, a hobby craft, or a different adjacent pair never passes. */
export function meetsComboRequirement(
  skills: CraftSkills,
  recipe: ProfessionRecipeRecord,
  activeArchetype: string | null = null,
  pairedMajor: string | null = null,
  hobbyCraft: string | null = null,
): boolean {
  return comboEligibility(recipe.comboRequirement, skills, {
    activeArchetype,
    pairedMajor,
    hobbyCraft,
  }).ok;
}

/** Pre-consume craft admission gates (station, combo, known, materials, bag
 *  capacity). No gold fee, no consume, no rng, no throttle. Shared by craft
 *  cast start and the complete/resolve success body so the two never diverge.
 *  Returns a denial CraftResult, or null when admitted. */
export function evaluateCraftAdmission(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
  commission = false,
): CraftResult | null {
  const meta = ctx.players.get(pid);
  // Station gate (supersedes #1297's hub gate; the level arm retired
  // with it): a station-bound recipe requires the player to stand at a
  // station of the recipe's type, OR to have their own ACTIVE mobile station
  // (mobile_station.ts) whose craft maps to that type. Checked before every
  // other gate, no side effect on denial, no rng, same shape as the
  // combo-requirement check below.
  if (recipe.stationType) {
    const entity = ctx.entities.get(pid);
    const mobileSatisfies =
      !!meta?.mobileStation &&
      isStationActive(meta.mobileStation, ctx.tickCount) &&
      stationTypeForCraft(meta.mobileStation.craftId) === recipe.stationType;
    if (
      !entity ||
      (!isAtStation(ctx.stationPlacements, entity.pos, recipe.stationType) && !mobileSatisfies)
    ) {
      return { ok: false, recipeId: recipe.id, reason: 'station_required' };
    }
  }
  if (
    recipe.comboRequirement &&
    !meetsComboRequirement(
      meta ? meta.craftSkills : {},
      recipe,
      meta ? meta.archetype.activeArchetype : null,
      meta ? meta.archetype.pairedMajor : null,
      meta ? meta.archetype.hobbyCraft : null,
    )
  ) {
    return { ok: false, recipeId: recipe.id, reason: 'combo_requirement_unmet' };
  }
  if (!isRecipeKnown(meta, recipe)) {
    return { ok: false, recipeId: recipe.id, reason: 'recipe_not_learned' };
  }
  if (!hasRecipeMaterials(ctx, recipe, pid)) {
    return { ok: false, recipeId: recipe.id, reason: 'insufficient_materials' };
  }
  const craftSkills = meta ? meta.craftSkills : {};
  // The output's deterministic facts, hoisted above the #2350 capacity gate
  // so it can model the exact grant arms below. Every one of these is a pure
  // read (content lookups plus archetype state; none reads the inventory and
  // none draws rng).
  const def: ItemDef | undefined = ITEMS[recipe.resultItemId];
  const outputQuality = defOutputQuality(def);
  // #1129/#1148: the archetype empowerment ceiling.
  const ceilingTier = meta
    ? archetypeCeilingFor(
        meta.archetype.activeArchetype,
        meta.archetype.pairedMajor,
        recipe.professionId,
        meta.archetype.hobbyCraft,
      )
    : Infinity;
  const bumped = masterworkBumpedQuality(def?.quality);
  const bonusStats = def
    ? masterworkBonusStats({
        level: recipe.level,
        quality: def.quality,
        slot: def.slot,
        stats: def.stats,
      })
    : null;
  const commissioned = commission && !!meta && isCommissionEligible(def);
  // #2350 capacity gate: the output must fit AFTER the reagents leave, so
  // simulate the consumption on a scratch copy and require EVERY possible
  // grant shape to fit. Denies with no side effect and draws nothing.
  if (meta) {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    for (const reagent of recipe.reagents) {
      const required = requiredReagentCount(meta, reagent, craftSkills, recipe.professionId);
      for (const take of planGradeRemoval(reagent.itemId, required.count, (id) =>
        countStacked(scratch, id),
      )) {
        removeStacked(scratch, take.itemId, take.count);
      }
    }
    const shapes: InvSlot[][] = [];
    if (isSignableMaterialRarity(outputQuality)) {
      const payload: ItemInstancePayload = { signer: meta.name };
      if (commissioned) payload.bindOnTrade = true;
      shapes.push([{ itemId: recipe.resultItemId, count: recipe.resultCount, instance: payload }]);
    } else if (commissioned) {
      shapes.push([
        { itemId: recipe.resultItemId, count: recipe.resultCount, instance: { bindOnTrade: true } },
      ]);
    } else {
      shapes.push([{ itemId: recipe.resultItemId, count: recipe.resultCount }]);
    }
    if (bonusStats !== null && bumped !== null && bumped.tier <= ceilingTier) {
      const payload: ItemInstancePayload = {
        signer: meta.name,
        rolled: { masterwork: true, stats: bonusStats },
      };
      if (commissioned) payload.bindOnTrade = true;
      const adds: InvSlot[] = [{ itemId: recipe.resultItemId, count: 1, instance: payload }];
      if (recipe.resultCount > 1) {
        adds.push(
          commissioned
            ? {
                itemId: recipe.resultItemId,
                count: recipe.resultCount - 1,
                instance: { bindOnTrade: true },
              }
            : { itemId: recipe.resultItemId, count: recipe.resultCount - 1 },
        );
      }
      shapes.push(adds);
    }
    const capacity = bagCapacity(meta.bags);
    if (!shapes.every((adds) => fitsAll(scratch, capacity, adds))) {
      return { ok: false, recipeId: recipe.id, reason: 'no_bag_space' };
    }
  }
  return null;
}

/** Pure resolution of one craft attempt against an already-resolved recipe
 *  record and player entity id (issue #1128 tiered mastery gating; issue
 *  #1132 combo-recipe gating): denies (no side effect at all) if any reagent
 *  is short OR the recipe's `comboRequirement` (if any) is unmet, partial
 *  consumption never happens. On success, consumes every reagent (each
 *  discounted per the crafter's #1145 self-signed reduction composed with
 *  their #1134 specialization discount), draws the single masterwork proc
 *  roll (the one and only output-side rng draw; the old quality
 *  roll is retired and outputs are deterministic), grants the recipe's
 *  declared output (signing a rare-or-better-DEF single-copy output for
 *  #1149 Battlefield Experience attribution; a masterwork proc mints a
 *  signed instance carrying its baked bonus stats), and grants craft skill
 *  scaled by tier mastery: full at or above the player's archetype-gated
 *  tier ceiling (archetype.ts `craftCeiling`, including always-full for the
 *  common tier, regardless of capability), reduced one tier below, zero two
 *  or more tiers below. Exported separately from `resolveCraft` so tests
 *  can exercise the tier curve against a synthetic recipe without needing
 *  higher-tier content in `content/recipes.ts`.
 *
 *  Craft Cast System: the live command path starts a cast via craftItem and
 *  only calls this on cast complete (completeCraftCast). Direct callers
 *  (tests, harnesses) still resolve instantly. The shared action throttle is
 *  no longer consulted here. */
export function resolveCraftForRecipe(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
  commission = false,
): CraftResult {
  const denial = evaluateCraftAdmission(ctx, pid, recipe, commission);
  if (denial) return denial;
  const meta = ctx.players.get(pid);
  const craftSkills = meta ? meta.craftSkills : {};
  const def: ItemDef | undefined = ITEMS[recipe.resultItemId];
  const outputQuality = defOutputQuality(def);
  const craftedRecipeId = isCraftedDisenchantTrackedOutput(def) ? recipe.id : undefined;
  const ceilingTier = meta
    ? archetypeCeilingFor(
        meta.archetype.activeArchetype,
        meta.archetype.pairedMajor,
        recipe.professionId,
        meta.archetype.hobbyCraft,
      )
    : Infinity;
  const bumped = masterworkBumpedQuality(def?.quality);
  const bonusStats = def
    ? masterworkBonusStats({
        level: recipe.level,
        quality: def.quality,
        slot: def.slot,
        stats: def.stats,
      })
    : null;
  const commissioned = commission && !!meta && isCommissionEligible(def);
  // #1301 gold sink: a fee proportional to the recipe's item-level budget,
  // charged on every successful craft, common tier included (the free-floor
  // rule from #1126/#1127 only ever meant free of a HARD gate; a gold fee on
  // a common-tier craft was already implicit once #1301 landed a sink on
  // every craft, TOOL_RECIPES' skillReq 75/150 included). Never blocks a
  // craft the player would otherwise be able to perform: floored at 0 copper
  // rather than denied, so a broke player still crafts, just contributes
  // nothing to the sink that trip. Content-driven via
  // CRAFT_GOLD_SINK_COPPER_PER_BUDGET.
  if (meta) {
    const goldFee = Math.ceil(recipe.itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET);
    meta.copper = Math.max(0, meta.copper - goldFee);
  }
  let selfSignedBonusApplied = false;
  // The masterwork signed-reagent input: a holding check over the recipe's
  // reagents BEFORE consumption (removeItem consumes end-backward, so the
  // signed copy itself may be what gets consumed), any signer counting.
  let signedReagentUsed = false;
  for (const reagent of recipe.reagents) {
    const required = requiredReagentCount(meta, reagent, craftSkills, recipe.professionId);
    if (required.selfSignedBonusApplied) selfSignedBonusApplied = true;
    if (meta && hasSignedInstance(meta, reagent.itemId)) signedReagentUsed = true;
    for (const take of planGradeRemoval(reagent.itemId, required.count, (id) =>
      ctx.countItem(id, pid),
    )) {
      ctx.removeItem(take.itemId, take.count, pid);
    }
  }
  // Jack of All Trades improviser variance roll (#1296): an ADDITIONAL
  // output-side draw, ONLY for a Jack-attuned crafter, positioned
  // immediately before the masterwork proc draw below. Every non-Jack
  // crafter (isJackOfAllTrades false, still the only reachable value: there
  // is no live quest path to become Jack yet) draws nothing extra here, so
  // the one-draw-per-successful-craft contract the masterwork proc draw
  // documents below is unchanged for every existing scenario and test.
  const jackVariance: CraftVarianceOutcome | null = meta?.archetype.isJackOfAllTrades
    ? rollCraftVariance(ctx.rng.next())
    : null;
  // Masterwork proc draw: the single output-side rng draw for every
  // non-Jack crafter, at the exact position the retired quality roll
  // occupied so the world's draw order and the one-draw-per-successful-craft
  // contract are preserved. The draw is UNCONDITIONAL on the success path:
  // it happens even when the effect is gated off below, so the draw count
  // per successful craft is exactly 1 (2 for a Jack, counting the variance
  // roll above) regardless of archetype state or output type. Every denial
  // path above draws nothing, unchanged.
  const procRoll = ctx.rng.next();
  const baseProcChance = masterworkProcChance({
    tiersAboveRecipe:
      tierCapability(craftSkills, recipe.professionId) - tierForSkill(recipe.skillReq),
    signedReagent: signedReagentUsed,
    specialized: isSpecialized(craftSkills, recipe.professionId),
    // Higher-tier materials raise the proc odds. Pure def-level
    // lookup over the recipe's declared reagent list (material_tier.ts), so
    // it draws nothing and cannot move the single procRoll draw above.
    materialTierBonus: materialTierBonusForReagents(recipe.reagents),
  });
  // A 'better' variance roll improves (never guarantees) this craft's
  // masterwork odds, still capped at MASTERWORK_CHANCE_CAP like every other
  // term composing into the chance. 'worse'/'normal' leave the base chance
  // untouched; 'worse' instead forces the masterwork gate off outright below.
  const procChance =
    jackVariance === 'better'
      ? Math.min(MASTERWORK_CHANCE_CAP, baseProcChance + JACK_VARIANCE_BETTER_PROC_BONUS)
      : baseProcChance;
  // Effect gate (gates the EFFECT, never the draw): the def must bake a
  // non-null bonus record, and the bumped quality tier must not exceed the
  // archetype ceiling (the invariant that a dormant or hobby craft's
  // output never exceeds its ceiling tier). A 'worse' Jack variance roll
  // forces this arm off outright, even when procRoll would otherwise have
  // hit. When gated off, the craft still succeeds as a plain deterministic
  // craft.
  const masterwork =
    !!meta &&
    jackVariance !== 'worse' &&
    procRoll < procChance &&
    bonusStats !== null &&
    bumped !== null &&
    bumped.tier <= ceilingTier;
  // Deterministic grant: every successful craft yields recipe.resultItemId.
  // #1149 signing rule preserved on the DEF quality: an output whose def is
  // rare-or-better is a signed instance so it carries an attribution target
  // for Battlefield Experience, EVERY granted copy included (a resultCount >
  // 1 recipe_anglers_feast_platter/recipe_elixir_of_the_serpent-shaped output
  // is just as signable as a resultCount 1 one; the same {signer} payload on
  // every copy stacks byte-equal, so this is one addItemInstance call with
  // count set to the full resultCount, not a loop); anything below stays
  // fungible. A masterwork proc is always minted as ONE signed instance
  // carrying the baked bonus stats; a resultCount > 1 recipe grants the
  // remainder plain, exactly as the plain arm would (the proc bonus is
  // specific to the one procced unit, unlike the DEF-quality signing rule
  // above). NEW crafts never write rolled.quality (retired for new writes;
  // legacy payloads keep loading). A commissioned craft arms every copy (the
  // player opted the CRAFT in, so a multi-copy output mints each remainder
  // copy as its own armed instance; they stack byte-equal), and a
  // commissioned sub-rare output forces the instance path a plain grant
  // would skip. Commission never adds signer: the #1149 signing rule is
  // untouched (the bond composes with the maker's mark, it does not extend
  // it). silent + callerLogs on every grant below: the craftResult event owns
  // BOTH halves of the player feedback for the craft. It fires its own
  // per-family cue (audio.craftSuccess, plus audio.masterwork layered on top
  // for a proc) in src/game/audio.ts, so the generic loot ding would stack on
  // top of it, and it logs the quality-colored, item-linked crafted line
  // carrying the output count, so the hub's "You receive:" line would be a
  // second (and for a resultCount > 1 recipe a third) line for the one craft
  // (#2430). Applying the DEF-quality rule to recipe_anglers_feast_platter and
  // recipe_elixir_of_the_serpent is a deliberate, accepted cost: both are
  // food/elixir, so useItem's battlefieldExperienceTrickle arm (gated on
  // def.kind === 'potion') never reaches them, meaning this signs every copy
  // for zero Battlefield Experience payoff. It still applies, for consistency
  // with the four existing rare single-copy consumables (silvered_carp_supper,
  // marlows_grand_roast, the two sunpetal draughts): the signed instance is
  // non-fungible, so countFungibleItem/removeFungibleItem (src/sim/market.ts)
  // and post_office.ts see zero fungible copies of either output. Since the
  // instanced exchange pipes landed (#1165,
  // src/sim/item_instance_transfer.ts), an unlocked signed copy lists and
  // mails as its own single-copy entry, so signing no longer takes these
  // outputs out of commerce; it only moves them off the fungible paths.
  // Player-to-player trade of the signed instance is unchanged.
  if (meta && masterwork && bonusStats) {
    const payload: ItemInstancePayload = {
      signer: meta.name,
      rolled: { masterwork: true, stats: bonusStats },
    };
    if (commissioned) payload.bindOnTrade = true;
    ctx.addItemInstance(recipe.resultItemId, payload, pid, 1, {
      silent: true,
      callerLogs: true,
      craftedRecipeId,
    });
    if (recipe.resultCount > 1) {
      if (commissioned) {
        for (let i = 1; i < recipe.resultCount; i++) {
          ctx.addItemInstance(recipe.resultItemId, { bindOnTrade: true }, pid, 1, {
            silent: true,
            callerLogs: true,
            craftedRecipeId,
          });
        }
      } else {
        ctx.addItem(recipe.resultItemId, recipe.resultCount - 1, pid, {
          silent: true,
          callerLogs: true,
          craftedRecipeId,
        });
      }
    }
  } else if (meta && isSignableMaterialRarity(outputQuality)) {
    const payload: ItemInstancePayload = { signer: meta.name };
    if (commissioned) payload.bindOnTrade = true;
    ctx.addItemInstance(recipe.resultItemId, payload, pid, recipe.resultCount, {
      silent: true,
      callerLogs: true,
      craftedRecipeId,
    });
  } else if (commissioned) {
    for (let i = 0; i < recipe.resultCount; i++) {
      ctx.addItemInstance(recipe.resultItemId, { bindOnTrade: true }, pid, 1, {
        silent: true,
        callerLogs: true,
        craftedRecipeId,
      });
    }
  } else {
    ctx.addItem(recipe.resultItemId, recipe.resultCount, pid, {
      silent: true,
      callerLogs: true,
      craftedRecipeId,
    });
  }
  if (meta) {
    // The #1129/#1148 gain doctrine (archetype ceiling alone zeroes, ordinary
    // curve off raw capability otherwise) lives in the shared
    // craftSkillGainMultiplier, which the crafting window's difficulty label
    // also consumes so the hint can never diverge from this grant.
    const multiplier = craftSkillGainMultiplier(
      meta.craftSkills,
      meta.archetype.activeArchetype,
      meta.archetype.pairedMajor,
      recipe.professionId,
      meta.archetype.hobbyCraft,
      recipe.skillReq,
    );
    const skillBefore = meta.craftSkills[recipe.professionId] ?? 0;
    gainCraftSkill(meta.craftSkills, recipe.professionId, CRAFT_SKILL_GAIN * multiplier);
    const skillLearned = (meta.craftSkills[recipe.professionId] ?? 0) - skillBefore;
    // Craft Cast System: cast duration paces craft; the shared action
    // throttle is fully retired (Phase 5).
    // Character XP for the craft is LEARNING XP: the level-banded curve
    // (profession_xp.ts) scaled by the skill this craft actually taught (the
    // applied post-clamp delta, 0..CRAFT_SKILL_GAIN). A craft that teaches
    // nothing, gray by tier, above the archetype ceiling, or at the craft's
    // 125 content cap, pays nothing. The character-level green/gray falloff
    // alone cannot bound a level-20 recipe at the level-20 character cap, so
    // the skill journey is the dimension that keeps total craft XP finite
    // (craft skill is additive-only and hard-capped, so every recipe's
    // lifetime XP contribution per character is a closed sum).
    const entity = ctx.entities.get(pid);
    if (entity) {
      const xp = Math.round(
        craftActionXp(recipe.level, entity.level) * (skillLearned / CRAFT_SKILL_GAIN),
      );
      if (xp > 0) ctx.grantXp(xp, meta);
    }
  }
  const result: CraftResult = {
    ok: true,
    recipeId: recipe.id,
    itemId: recipe.resultItemId,
    count: recipe.resultCount,
    quality: outputQuality,
    selfSignedBonusApplied,
  };
  if (masterwork) result.masterwork = true;
  if (commissioned) result.commission = true;
  if (jackVariance !== null) result.variance = jackVariance;
  return result;
}

/** The OUTPUT DEF quality a successful craft reports (CraftResult.quality)
 *  and signs against: the result item def's own static quality, normalized
 *  onto the MaterialRarity ladder ('poor' or absent read as 'common', the
 *  same normalization the budget math applies; no recipe outputs a poor def
 *  today). The rolled output quality is retired, so quality is a
 *  fact of the def, identical for every craft of the same recipe. */
function defOutputQuality(def: ItemDef | undefined): MaterialRarity {
  const quality = def?.quality;
  return quality === undefined || quality === 'poor' ? 'common' : quality;
}

/** Pure resolution of one craft attempt against one recipe id, given an
 *  already-resolved player entity id: denies with `unknown_recipe` if the id
 *  does not resolve, otherwise delegates to `resolveCraftForRecipe`. */
export function resolveCraft(
  ctx: SimContext,
  pid: number,
  recipeId: string,
  commission = false,
): CraftResult {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, recipeId, reason: 'unknown_recipe' };
  return resolveCraftForRecipe(ctx, pid, recipe, commission);
}

/** How many full crafts of `recipe` the player's current bags can pay for,
 *  capped at CRAFT_BATCH_MAX, simulated craft by craft so the conditional
 *  self-signed discount expires mid-batch when its copy is consumed (the
 *  discount is hold-keyed, see hasSelfSignedInstance). Bag space is
 *  re-checked per complete, not here. */
export function maxCraftCountForRecipe(
  ctx: SimContext,
  recipe: ProfessionRecipeRecord,
  pid: number,
): number {
  const meta = ctx.players.get(pid);
  const craftSkills = meta ? meta.craftSkills : {};
  if (recipe.reagents.length === 0) return CRAFT_BATCH_MAX;
  if (!meta) {
    // No meta resolves no inventory to simulate: keep the one-shot division
    // (no self-signed copy can exist without a meta, so it cannot drift).
    let max = CRAFT_BATCH_MAX;
    for (const reagent of recipe.reagents) {
      const required = requiredReagentCount(
        undefined,
        reagent,
        craftSkills,
        recipe.professionId,
      ).count;
      if (required <= 0) continue;
      const have = countAcrossGrades(reagent.itemId, (id) => ctx.countItem(id, pid));
      max = Math.min(max, Math.floor(have / required));
    }
    return Math.max(0, max);
  }
  // Simulate the batch craft by craft on a scratch copy, re-deriving each
  // craft's per-reagent requirement from the SCRATCH state: the #1145
  // self-signed discount is hold-keyed, so it expires the moment the last
  // signed copy is consumed mid-batch. A one-shot division assumed the
  // discount for the whole batch, overestimated for signed crafters, and
  // ended Create All on a spurious insufficient_materials denial. Same
  // removal walk as the real consumption (planGradeRemoval over grades).
  // Pure, draw-free, bounded at CRAFT_BATCH_MAX iterations.
  const scratch = meta.inventory.map((s) => ({ ...s }));
  const isJack = !!meta.archetype?.isJackOfAllTrades;
  let crafts = 0;
  while (crafts < CRAFT_BATCH_MAX) {
    const takes: { itemId: string; count: number }[] = [];
    let payable = true;
    for (const reagent of recipe.reagents) {
      const hasSelfSigned = materialGradeIds(reagent.itemId).some((gradeId) =>
        holdsSelfSignedInstance(scratch, meta.name, gradeId),
      );
      const required = requiredReagentCountFor(
        hasSelfSigned,
        reagent,
        craftSkills,
        recipe.professionId,
        isJack,
      ).count;
      if (required <= 0) continue;
      if (countAcrossGrades(reagent.itemId, (id) => countStacked(scratch, id)) < required) {
        payable = false;
        break;
      }
      for (const take of planGradeRemoval(reagent.itemId, required, (id) =>
        countStacked(scratch, id),
      )) {
        takes.push(take);
      }
    }
    if (!payable) break;
    for (const take of takes) removeStacked(scratch, take.itemId, take.count);
    crafts++;
  }
  return crafts;
}

/** Clamp a requested batch count: default/invalid -> 1, floor, then
 *  min(CRAFT_BATCH_MAX, mats-fit, requested). mats-fit 0 still yields 1 so the
 *  start path can emit the real insufficient_materials denial. */
export function clampCraftBatchCount(requested: number, maxByMats: number): number {
  const n = Number.isFinite(requested) ? Math.floor(requested) : 1;
  if (n < 1) return 1;
  const matCap = Math.max(1, Math.min(CRAFT_BATCH_MAX, Math.max(0, Math.floor(maxByMats))));
  return Math.min(n, matCap, CRAFT_BATCH_MAX);
}

/** Arm CRAFT_CAST_ID session fields and emit castStart. Caller owns admission
 *  and busy gates. batchRemaining/total are the Phase 3 session counters
 *  (including the cast about to run).
 *
 *  Accepted amplification, recorded: castStart is world-scoped (no pid), so
 *  routeEvents fans it to every session in EVENT_RADIUS, and a start-cancel
 *  loop (craft_item + move) can emit at the command-lane ceiling with no GCD,
 *  including at crowded town stations. Same kind as gather/fishing castStart;
 *  bounded by the 30/s per-session command lane; a pacing token was ruled
 *  out to keep cast start knob-free. */
function beginCraftCast(
  ctx: SimContext,
  p: Entity,
  recipe: ProfessionRecipeRecord,
  commission: boolean,
  batchRemaining: number,
  batchTotal: number,
): void {
  // Deliberate cast side effects after every deny arm (gather pattern):
  // stand, dismount, drop an in-flight mount summon, clear a GCD-held queue.
  if (p.sitting) ctx.standUp(p);
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  const duration = craftCastDurationSec(recipe);
  p.castingAbility = CRAFT_CAST_ID;
  p.castTotal = duration;
  p.castRemaining = duration;
  p.castTargetId = null;
  p.channeling = false;
  p.craftCastRecipeId = recipe.id;
  p.craftCastCommission = commission;
  p.craftCastBatchRemaining = batchRemaining;
  p.craftCastBatchTotal = batchTotal;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: CRAFT_CAST_ID,
    time: duration,
  });
}

// Command entry point (behind the SimContext seam): validates one player's
// craft attempt and STARTS a CRAFT_CAST_ID cast (Craft Cast System Phase 1).
// Materials, gold, skill, and masterwork resolve only on completeCraftCast.
// A denial is surfaced solely through the returned CraftResult's `reason`,
// which Sim.craftItem mirrors as a craftResult event; this must not also
// emit a ctx.error toast. A successful cast start returns { ok, casting }
// and emits castStart (no craftResult until complete). Runs on the
// deterministic tick the wire command arrives on, never off-tick.
// `commission` is captured at cast start for the complete path (and every
// remaining item in a Phase 3 batch). `count` is optional (default 1),
// clamped to CRAFT_BATCH_MAX and current mats-fit.
export function craftItem(
  ctx: SimContext,
  recipeId: string,
  commission = false,
  pid?: number,
  count = 1,
): CraftResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, recipeId, reason: 'unknown_recipe' };
  const { meta, e: p } = r;
  // Busy gate: a running cast or consume blocks starting a craft cast
  // (gather harvestNode / startFishing precedent). Deny via craftResult
  // reason so the single-surface doctrine holds.
  if (p.castingAbility || isConsuming(p)) {
    return { ok: false, recipeId, reason: 'busy' };
  }
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, recipeId, reason: 'unknown_recipe' };
  const denial = evaluateCraftAdmission(ctx, meta.entityId, recipe, commission);
  if (denial) return denial;
  const matsMax = maxCraftCountForRecipe(ctx, recipe, meta.entityId);
  const batchTotal = clampCraftBatchCount(count, matsMax);
  beginCraftCast(ctx, p, recipe, commission, batchTotal, batchTotal);
  return { ok: true, recipeId: recipe.id, casting: true };
}

/** Apply post-success craft hooks (deeds, quests) after a completed resolve.
 *  Shared by completeCraftCast so the cast path and any future caller stay
 *  aligned with the pre-cast craftItem side effects. */
function applyCraftSuccessHooks(
  ctx: SimContext,
  meta: PlayerMeta,
  recipeId: string,
  result: CraftResult,
): void {
  if (!result.ok) return;
  ctx.bumpDeedStat(meta, 'craftsPerformed', 1);
  // A station-bound success already proved station presence in the
  // resolve's station gate, so stationType alone identifies one. The
  // persisted stat key stays 'hubCraftsPerformed' for save back-compat: it
  // now means station-bound crafts (the gate was renamed, not the key).
  if (recipeById(recipeId)?.stationType) {
    ctx.bumpDeedStat(meta, 'hubCraftsPerformed', 1);
  }
  // A masterwork proc feeds the Masterwright counter (prog_masterwright).
  // Resolved strictly AFTER the resolve's single output-side proc draw;
  // this bump draws nothing. Deliberately NO retro arm: masterworking is
  // repeatable, so a veteran whose procs predate the counter simply earns
  // it on the next proc.
  if (result.masterwork) {
    ctx.bumpDeedStat(meta, 'masterworksCrafted', 1);
  }
  // Per-craft rare-tier milestone (issue #2055): the first rare-or-better
  // output a player crafts in ONE craft marks that craft's milestone deed
  // (prog_<craftId>_rare). Output quality is a deterministic fact of the
  // recipe's result def (Professions 2.0 retired the output roll), so this
  // is never luck-based. Keyed on the recipe's craft, not the item.
  const recipe = recipeById(recipeId);
  if (result.quality !== undefined && isSignableMaterialRarity(result.quality) && recipe) {
    ctx.markVisited(meta, `craft_rare:${recipe.professionId}`);
  }
  // The dirty mark also covers the craft-skill gain the resolve applied.
  ctx.markDeedsDirty(meta.entityId);
  ctx.onRecipeCraftedForQuests(recipeId, meta);
}

// Completion of a running craft cast, reached through ctx.completeCraftCast
// when updateCasting sees CRAFT_CAST_ID finish. Re-validates via
// resolveCraftForRecipe (station, materials, capacity, ...), then consumes,
// grants, skill, gold sink, and masterwork. On denial after complete, emits
// craftResult with the reason and spends nothing. castStop success already
// fired for the cast finishing; this event is the craft outcome.
// Phase 3: on success, if batch remaining > 1 and start gates still pass,
// immediately starts the next cast (same recipe + captured commission).
// Stops on cancel (cancelCast), mid-complete denial, auto-start denial,
// death, or remaining exhausted. craftResult still fires per item.
export function completeCraftCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const recipeId = p.craftCastRecipeId;
  const commission = p.craftCastCommission;
  const batchRemaining = p.craftCastBatchRemaining;
  const batchTotal = p.craftCastBatchTotal;
  // Clear session fields before resolve so any path leaves them inert
  // (cancelCast also clears them; matching gather's read-and-reset).
  p.craftCastRecipeId = '';
  p.craftCastCommission = false;
  p.craftCastBatchRemaining = 0;
  p.craftCastBatchTotal = 0;
  const recipe = recipeById(recipeId);
  if (!recipe) {
    const result: CraftResult = { ok: false, recipeId, reason: 'unknown_recipe' };
    meta.lastCraftResult = result;
    ctx.emit({
      type: 'craftResult',
      ok: false,
      recipeId,
      reason: 'unknown_recipe',
      pid: meta.entityId,
    });
    return;
  }
  const result = resolveCraftForRecipe(ctx, meta.entityId, recipe, commission);
  applyCraftSuccessHooks(ctx, meta, recipe.id, result);
  meta.lastCraftResult = result;
  ctx.emit({
    type: 'craftResult',
    ok: result.ok,
    recipeId: result.recipeId,
    itemId: result.itemId,
    count: result.count,
    quality: result.quality,
    masterwork: result.masterwork,
    reason: result.reason,
    pid: meta.entityId,
  });
  if (result.masterwork && result.itemId) {
    const proc: MasterworkProc = {
      recipeId: result.recipeId,
      itemId: result.itemId,
      crafter: meta.entityId,
    };
    meta.lastMasterwork = proc;
    ctx.emit({ type: 'masterwork', ...proc, pid: meta.entityId });
    announceMasterworkZone(ctx, meta.entityId, meta.name, proc);
  }
  // Batch auto-continue only after a successful grant. Partial successes
  // stay in the bags; a mid-batch denial stops further starts.
  if (!result.ok) return;
  const left = batchRemaining - 1;
  if (left <= 0) return;
  // Stop rules: death, busy (should not happen post-complete), admission deny.
  // Pure dead read, NOT refusedWhileDead: that helper emits the shared error
  // toast, and a stop rule inside a completion must not print anything.
  if (p.dead) return;
  if (p.castingAbility || isConsuming(p)) return;
  const nextDenial = evaluateCraftAdmission(ctx, meta.entityId, recipe, commission);
  if (nextDenial) {
    meta.lastCraftResult = nextDenial;
    ctx.emit({
      type: 'craftResult',
      ok: false,
      recipeId: nextDenial.recipeId,
      reason: nextDenial.reason,
      pid: meta.entityId,
    });
    return;
  }
  // Same commission for every output in the batch (captured at original start).
  beginCraftCast(ctx, p, recipe, commission, left, batchTotal > 0 ? batchTotal : left);
}
