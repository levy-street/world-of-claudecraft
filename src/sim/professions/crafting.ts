// Common-tier crafting resolution (issue #1127). Behind the SimContext seam:
// checks a player has every reagent a recipe requires, consumes them (denying
// and consuming NOTHING if any reagent is short), rolls the output's quality
// via the shared material-rarity ladder (rollMaterialRarity, keyed on the
// player's craft skill for this recipe's craft rather than gathering
// proficiency: same ladder, different "power" input, exactly the reuse the
// gathering.ts comment on that function invites), grants the resulting item,
// and grants a flat point of craft skill (see wheel.ts: additive-only,
// free-floor).
//
// Scope: originally the common-tier path only; the module now also resolves
// the higher-tier content that landed on it (content/recipes.ts TOOL_RECIPES
// at skillReq 75/150, COMBO_RECIPES at skillReq 25), the #1132 combo gate,
// the #1129 archetype empowerment ceiling, the #1299 acquisition gate, and
// the #1301 gold sink + output throttle. There is still NO skillReq
// admission gate: any known recipe is attemptable on materials alone, and
// tier only shapes skill-gain scaling and (via the ceiling) output quality.
//
// #1149 (Battlefield Experience) attribution: a crafted output that rolls
// rare-or-better is stamped with its crafter's name via ctx.addItemInstance,
// same signable-rarity threshold and same {signer} shape gathering.ts's
// harvestCorpse already uses for monster materials (#1145). Below that
// threshold the output stays a plain fungible grant, unchanged from before
// this issue. This is what gives professions/battlefield_xp.ts a `signer` to
// resolve later, when that specific copy is drunk/worn/lands a killing blow.
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
// Combo-recipe requirement (issue #1132): a recipe may carry a
// `comboRequirement` naming one specific adjacent craft pair and a minimum
// tier both must meet. `meetsComboRequirement` checks the player's tier
// capability in BOTH named crafts (via wheel.ts tierCapability), independent
// of the recipe's `professionId`. Only the two named crafts ever count: a
// player's skill in any other craft, however high, never substitutes for
// either half of the pair.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged.

import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  CRAFT_THROTTLE_MAX_PER_WINDOW,
  CRAFT_THROTTLE_WINDOW_SECONDS,
} from '../content/professions';
import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { archetypeCeilingFor, craftCeiling } from './archetype';
import { canUseCraftingHubStation } from './crafting_hub';
import {
  clampMaterialRarity,
  isSignableMaterialRarity,
  type MaterialRarity,
  rollMaterialRarity,
} from './gathering';
import { craftActionXp } from './profession_xp';
import type { ProfessionReagent, ProfessionRecipeRecord } from './types';
import {
  type CraftSkillState,
  type CraftSkills,
  gainCraftSkill,
  materialCostMultiplier,
  tierCapability,
  tierForSkill,
  tierProgressMultiplier,
} from './wheel';

// One flat craft-skill point per successful common-tier craft (the free-floor
// rule: common-tier crafting itself never costs anything, but skill still
// accrues so later tiers have something to build a gate against).
const CRAFT_SKILL_GAIN = 1;

export interface CraftResult {
  ok: boolean;
  recipeId: string;
  // Present only when ok: the granted item id/count and the rolled quality.
  itemId?: string;
  count?: number;
  quality?: MaterialRarity;
  // #1145: true when at least one consumed reagent had a self-gathered signed
  // instance (signer === the crafting player's own name) counted toward it,
  // reducing that reagent's required quantity by one for this craft.
  selfSignedBonusApplied?: boolean;
  // Present only when !ok: a stable reason code, not player-facing prose (the
  // caller renders/localizes the denial).
  reason?:
    | 'unknown_recipe'
    | 'insufficient_materials'
    | 'combo_requirement_unmet'
    | 'recipe_not_learned'
    | 'throttled'
    | 'not_at_hub';
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
 *  wrong_source arms against a synthetic gated recipe without needing an
 *  acquisition-gated entry in `content/recipes.ts` (none exists yet). */
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

/** Whether `meta`'s rolling craft-output window (issue #1301) still has room
 *  for one more successful craft, advancing/resetting the window against
 *  `now` (sim time, deterministic) as a side effect exactly like a real
 *  rolling window would. A maxed specialist is capped at
 *  `CRAFT_THROTTLE_MAX_PER_WINDOW` successful crafts per
 *  `CRAFT_THROTTLE_WINDOW_SECONDS`, regardless of skill or material supply. */
function withinCraftThrottle(meta: PlayerMeta, now: number): boolean {
  if (now - meta.craftThrottle.windowStart >= CRAFT_THROTTLE_WINDOW_SECONDS) {
    meta.craftThrottle.windowStart = now;
    meta.craftThrottle.count = 0;
  }
  return meta.craftThrottle.count < CRAFT_THROTTLE_MAX_PER_WINDOW;
}

/** Whether `meta` holds an inventory slot for `itemId` carrying a signed
 *  instance stamped with `meta`'s OWN name (a self-gathered signed material). */
function hasSelfSignedInstance(meta: PlayerMeta, itemId: string): boolean {
  return meta.inventory.some((s) => s.itemId === itemId && s.instance?.signer === meta.name);
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
  const afterSelfSigned =
    meta && hasSelfSignedInstance(meta, reagent.itemId)
      ? Math.max(1, reagent.count - 1)
      : reagent.count;
  const multiplier = materialCostMultiplier(craftSkills, professionId);
  return {
    count: Math.max(1, Math.floor(afterSelfSigned * multiplier)),
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
      ctx.countItem(r.itemId, pid) >=
      requiredReagentCount(meta, r, craftSkills, recipe.professionId).count,
  );
}

/** Whether the given player's craft skills satisfy a recipe's dual-craft
 *  combo requirement (issue #1132): true if the recipe carries no
 *  `comboRequirement` at all, otherwise true only when the player's
 *  archetype-gated tier ceiling (archetype.ts `craftCeiling`, which composes
 *  wheel.ts `tierCapability` with the #1129 empowerment ceiling) in BOTH
 *  named crafts is at or above `minTier`. Deliberately does not fall back to
 *  any other craft: a high skill in a craft outside the required pair never
 *  satisfies this check. `activeArchetype`/`pairedMajor` default to `null`
 *  (the uncapped-to-rare pre-archetype state) so existing raw-skills callers
 *  keep working unchanged. Every `COMBO_RECIPES` pair in content/recipes.ts
 *  is ring-adjacent (content/professions.ts `adjacentCrafts`), i.e. exactly
 *  the shape of a player's two majors, so a specialist attuned to that pair
 *  qualifies (both sides unlimited via `pairedMajor`); the stubbed default
 *  pair (archetype.ts `defaultPairedMajor`) prefers a craft's content-combo
 *  partner precisely so attuning either side of a combo never strands it. */
export function meetsComboRequirement(
  skills: CraftSkills,
  recipe: ProfessionRecipeRecord,
  activeArchetype: string | null = null,
  pairedMajor: string | null = null,
): boolean {
  const combo = recipe.comboRequirement;
  if (!combo) return true;
  return (
    craftCeiling(skills, activeArchetype, pairedMajor, combo.craftA) >= combo.minTier &&
    craftCeiling(skills, activeArchetype, pairedMajor, combo.craftB) >= combo.minTier
  );
}

/** Pure resolution of one craft attempt against an already-resolved recipe
 *  record and player entity id (issue #1128 tiered mastery gating; issue
 *  #1132 combo-recipe gating): denies (no side effect at all) if any reagent
 *  is short OR the recipe's `comboRequirement` (if any) is unmet, partial
 *  consumption never happens. On success, consumes every reagent (each
 *  discounted per the crafter's #1145 self-signed reduction composed with
 *  their #1134 specialization discount), rolls the output's quality off the
 *  player's current skill in the recipe's craft, grants the output item
 *  (signing a rare-or-better single-copy output for #1149 Battlefield
 *  Experience attribution), and grants craft skill scaled by tier mastery:
 *  full at or above the player's archetype-gated tier ceiling (archetype.ts
 *  `craftCeiling`, including always-full for the common tier, regardless of
 *  capability), reduced one tier below, zero two or more tiers below.
 *  Exported separately from `resolveCraft` so tests
 *  can exercise the tier curve against a synthetic recipe without needing
 *  higher-tier content in `content/recipes.ts`. */
export function resolveCraftForRecipe(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
): CraftResult {
  const meta = ctx.players.get(pid);
  // #1297: a station-bound recipe (TOOL_RECIPES today) requires the player to
  // be physically present at the level-20 crafting hub. Checked before every
  // other gate, no side effect on denial, same shape as the combo-requirement
  // check below.
  if (recipe.requiresHubStation) {
    const entity = ctx.entities.get(pid);
    if (!entity || !canUseCraftingHubStation(entity.pos, entity.level)) {
      return { ok: false, recipeId: recipe.id, reason: 'not_at_hub' };
    }
  }
  if (
    recipe.comboRequirement &&
    !meetsComboRequirement(
      meta ? meta.craftSkills : {},
      recipe,
      meta ? meta.archetype.activeArchetype : null,
      meta ? meta.archetype.pairedMajor : null,
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
  // #1301 output throttle: a flat cap on successful crafts per rolling
  // window, checked (never side-effected on denial beyond the window's own
  // natural rollover) before any reagent is consumed.
  if (meta && !withinCraftThrottle(meta, ctx.time)) {
    return { ok: false, recipeId: recipe.id, reason: 'throttled' };
  }
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
  const craftSkills = meta ? meta.craftSkills : {};
  let selfSignedBonusApplied = false;
  for (const reagent of recipe.reagents) {
    const required = requiredReagentCount(meta, reagent, craftSkills, recipe.professionId);
    if (required.selfSignedBonusApplied) selfSignedBonusApplied = true;
    ctx.removeItem(reagent.itemId, required.count, pid);
  }
  const skill = meta ? (meta.craftSkills[recipe.professionId] ?? 0) : 0;
  const rawQuality = rollMaterialRarity(skill, ctx.rng);
  // #1129/#1148 review: output quality must respect the empowerment ceiling
  // too, not just skill-gain (a dormant or hobby craft can still roll high off
  // raw skill; the actual granted quality is clamped to what that craft is
  // empowered to produce).
  const ceilingTier = meta
    ? archetypeCeilingFor(
        meta.archetype.activeArchetype,
        meta.archetype.pairedMajor,
        recipe.professionId,
      )
    : Infinity;
  const quality = clampMaterialRarity(rawQuality, ceilingTier);
  // #1149: sign a single rare-or-better copy so it carries an attribution
  // target for Battlefield Experience; anything below that stays fungible,
  // and a resultCount > 1 output is never itself signable (only single-copy
  // grants are, matching every recipe in content/recipes.ts today).
  if (meta && recipe.resultCount === 1 && isSignableMaterialRarity(quality)) {
    ctx.addItemInstance(recipe.resultItemId, { signer: meta.name, rolled: { quality } }, pid);
  } else {
    ctx.addItem(recipe.resultItemId, recipe.resultCount, pid);
  }
  if (meta) {
    // #1129/#1148 review: a recipe whose tier is ABOVE this craft's ARCHETYPE
    // ceiling (ceilingTier, the same archetypeCeilingFor value the quality
    // clamp reads above) must grant zero progress, full stop, never the
    // ordinary diminishing-returns treatment: that is what makes a dormant or
    // hobby craft's climb actually stop at its cap. The guard deliberately
    // compares against the archetype ceiling ALONE, never craftCeiling's
    // min-with-raw-capability: there is NO skillReq admission gate on
    // crafting (content/recipes.ts documents that resolveCraft does not read
    // skillReq), so a recipe tier above the player's RAW capability is the
    // ordinary, doc-confirmed climb ("full at or above capability: this is
    // how capability advances in the first place", wheel.ts) and must keep
    // granting full progress exactly as base did. Below or at the ceiling,
    // the ordinary curve (full at/above raw capability, reduced one tier
    // under, zero two-plus under) applies unchanged off raw capability.
    const recipeTier = tierForSkill(recipe.skillReq);
    const multiplier =
      recipeTier > ceilingTier
        ? 0
        : tierProgressMultiplier(tierCapability(meta.craftSkills, recipe.professionId), recipeTier);
    gainCraftSkill(meta.craftSkills, recipe.professionId, CRAFT_SKILL_GAIN * multiplier);
    meta.craftThrottle.count += 1;
    // Character XP for the craft (profession_xp.ts), tier-scaled and
    // level-gated the same way gathering/kill XP are: a max-level player
    // spamming a trivial (gray) recipe gets zero.
    const entity = ctx.entities.get(pid);
    if (entity) ctx.grantXp(craftActionXp(recipe.level, entity.level), meta);
  }
  return {
    ok: true,
    recipeId: recipe.id,
    itemId: recipe.resultItemId,
    count: recipe.resultCount,
    quality,
    selfSignedBonusApplied,
  };
}

/** Pure resolution of one craft attempt against one recipe id, given an
 *  already-resolved player entity id: denies with `unknown_recipe` if the id
 *  does not resolve, otherwise delegates to `resolveCraftForRecipe`. */
export function resolveCraft(ctx: SimContext, pid: number, recipeId: string): CraftResult {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, recipeId, reason: 'unknown_recipe' };
  return resolveCraftForRecipe(ctx, pid, recipe);
}

// Command entry point (behind the SimContext seam): resolves one player's
// craft attempt, resolving the caller's own player entity the same way every
// other immediate-interaction command does (ctx.resolve). A denial is
// surfaced solely through the returned CraftResult's `reason`, which the
// caller mirrors as a `craftResult` event and renders via the localized
// hudChrome.crafting.* catalog keys; this must not also emit a ctx.error
// toast, or a denied craft prints twice and the second copy is unlocalized.
// Runs on the deterministic tick the wire command arrives on, never off-tick.
export function craftItem(ctx: SimContext, recipeId: string, pid?: number): CraftResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, recipeId, reason: 'unknown_recipe' };
  const result = resolveCraft(ctx, r.meta.entityId, recipeId);
  if (result.ok) {
    ctx.bumpDeedStat(r.meta, 'craftsPerformed', 1);
    // A station-bound success already proved hub position and level in the
    // resolve's hub gate, so the recipe flag alone identifies a hub craft.
    if (recipeById(recipeId)?.requiresHubStation) {
      ctx.bumpDeedStat(r.meta, 'hubCraftsPerformed', 1);
    }
    // The dirty mark also covers the craft-skill gain the resolve applied.
    ctx.markDeedsDirty(r.meta.entityId);
  }
  return result;
}
