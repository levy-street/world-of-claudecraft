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
// Scope: COMMON TIER ONLY (skillReq 0 on every recipe in content/recipes.ts).
// Higher-tier gating, the wheel, and archetype-exclusive combos are later
// issues; this module resolves exactly the common-tier path end to end.
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

import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type MaterialRarity, rollMaterialRarity } from './gathering';
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
  reason?: 'unknown_recipe' | 'insufficient_materials' | 'combo_requirement_unmet';
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
 *  `comboRequirement` at all, otherwise true only when the player's tier
 *  capability (wheel.ts tierCapability) in BOTH named crafts is at or above
 *  `minTier`. Deliberately does not fall back to any other craft: a high
 *  skill in a craft outside the required pair never satisfies this check. */
export function meetsComboRequirement(
  skills: CraftSkills,
  recipe: ProfessionRecipeRecord,
): boolean {
  const combo = recipe.comboRequirement;
  if (!combo) return true;
  return (
    tierCapability(skills, combo.craftA) >= combo.minTier &&
    tierCapability(skills, combo.craftB) >= combo.minTier
  );
}

/** Pure resolution of one craft attempt against an already-resolved recipe
 *  record and player entity id (issue #1128 tiered mastery gating; issue
 *  #1132 combo-recipe gating): denies (no side effect at all) if any reagent
 *  is short OR the recipe's `comboRequirement` (if any) is unmet, partial
 *  consumption never happens. On success, consumes every reagent (each
 *  discounted per the crafter's #1145 self-signed reduction composed with
 *  their #1134 specialization discount), rolls the output's quality off the
 *  player's current skill in the recipe's craft, grants the output item, and
 *  grants craft skill scaled by tier mastery: full at or above the player's
 *  tier capability (including always-full for the common tier, regardless of
 *  capability), reduced one tier below, zero two or more tiers below.
 *  Exported separately from `resolveCraft` so tests can exercise the tier
 *  curve against a synthetic recipe without needing higher-tier content in
 *  `content/recipes.ts`. */
export function resolveCraftForRecipe(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
): CraftResult {
  const meta = ctx.players.get(pid);
  if (recipe.comboRequirement && !meetsComboRequirement(meta ? meta.craftSkills : {}, recipe)) {
    return { ok: false, recipeId: recipe.id, reason: 'combo_requirement_unmet' };
  }
  if (!hasRecipeMaterials(ctx, recipe, pid)) {
    return { ok: false, recipeId: recipe.id, reason: 'insufficient_materials' };
  }
  const craftSkills = meta ? meta.craftSkills : {};
  let selfSignedBonusApplied = false;
  for (const reagent of recipe.reagents) {
    const required = requiredReagentCount(meta, reagent, craftSkills, recipe.professionId);
    if (required.selfSignedBonusApplied) selfSignedBonusApplied = true;
    ctx.removeItem(reagent.itemId, required.count, pid);
  }
  const skill = meta ? (meta.craftSkills[recipe.professionId] ?? 0) : 0;
  const quality = rollMaterialRarity(skill, ctx.rng);
  ctx.addItem(recipe.resultItemId, recipe.resultCount, pid);
  if (meta) {
    const capabilityTier = tierCapability(meta.craftSkills, recipe.professionId);
    const recipeTier = tierForSkill(recipe.skillReq);
    const multiplier = tierProgressMultiplier(capabilityTier, recipeTier);
    gainCraftSkill(meta.craftSkills, recipe.professionId, CRAFT_SKILL_GAIN * multiplier);
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
  return resolveCraft(ctx, r.meta.entityId, recipeId);
}
