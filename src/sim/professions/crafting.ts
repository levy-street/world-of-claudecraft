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
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged.

import { recipeById } from '../content/recipes';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type MaterialRarity, rollMaterialRarity } from './gathering';
import type { ProfessionReagent, ProfessionRecipeRecord } from './types';
import { gainCraftSkill, tierCapability, tierForSkill, tierProgressMultiplier } from './wheel';

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
  reason?: 'unknown_recipe' | 'insufficient_materials';
}

// #1145 self-gathered crafting bonus: the chosen bonus is a REDUCED REQUIRED
// QUANTITY (rather than an item-level/quality lift): one fewer unit of a
// reagent per craft, for every reagent where the crafter holds at least one
// signed instance stamped with their OWN name (a rare+ monster material they
// harvested themselves; see professions/gathering.ts). Reasoning: this module
// already resolves the materials check as a per-reagent "do I have count N"
// predicate (hasRecipeMaterials below), so lowering that per-reagent N by one
// composes directly with the existing check-then-consume flow with no new
// side channel; an item-level/quality lift would instead have to reach into
// the SAME rollMaterialRarity call gathering.ts's own comment already flags as
// informational-only for now (this common-tier crafting.ts caller does not
// re-roll per-reagent quality). Using someone ELSE's signed material (signer
// set but not the crafter's own name) is NOT counted here: it behaves exactly
// like a plain unsigned material, no bonus.

/** Whether `meta` holds an inventory slot for `itemId` carrying a signed
 *  instance stamped with `meta`'s OWN name (a self-gathered signed material). */
function hasSelfSignedInstance(meta: PlayerMeta, itemId: string): boolean {
  return meta.inventory.some((s) => s.itemId === itemId && s.instance?.signer === meta.name);
}

/** The quantity of `reagent.itemId` this craft actually requires from `pid`:
 *  `reagent.count`, minus one (floored at 1, never fully waived, so a
 *  signed instance is always consumed rather than retained forever) if
 *  `pid` holds a self-signed instance of that material (#1145 bonus). */
function requiredCountFor(meta: PlayerMeta | undefined, reagent: ProfessionReagent): number {
  if (meta && hasSelfSignedInstance(meta, reagent.itemId)) return Math.max(1, reagent.count - 1);
  return reagent.count;
}

/** Whether the given player currently holds every reagent a recipe requires,
 *  in the required quantities (after the #1145 self-signed bonus reduction,
 *  if any). Read-only: never mutates inventory. */
export function hasRecipeMaterials(
  ctx: SimContext,
  recipe: ProfessionRecipeRecord,
  pid: number,
): boolean {
  const meta = ctx.players.get(pid);
  return recipe.reagents.every((r) => ctx.countItem(r.itemId, pid) >= requiredCountFor(meta, r));
}

/** Pure resolution of one craft attempt against an already-resolved recipe
 *  record and player entity id (issue #1128 tiered mastery gating): denies
 *  (no side effect at all) if any reagent is short, partial consumption never
 *  happens. On success, consumes every reagent (at its #1145-adjusted required
 *  quantity), rolls the output's quality off the player's current skill in the
 *  recipe's craft, grants the output item, and grants craft skill scaled by
 *  tier mastery: full at or above the player's tier capability (including
 *  always-full for the common tier, regardless of capability), reduced one
 *  tier below, zero two or more tiers below. Exported separately from
 *  `resolveCraft` so tests can exercise the tier curve against a synthetic
 *  recipe without needing higher-tier content in `content/recipes.ts`. */
export function resolveCraftForRecipe(
  ctx: SimContext,
  pid: number,
  recipe: ProfessionRecipeRecord,
): CraftResult {
  if (!hasRecipeMaterials(ctx, recipe, pid)) {
    return { ok: false, recipeId: recipe.id, reason: 'insufficient_materials' };
  }
  const meta = ctx.players.get(pid);
  let selfSignedBonusApplied = false;
  for (const reagent of recipe.reagents) {
    const required = requiredCountFor(meta, reagent);
    if (required < reagent.count) selfSignedBonusApplied = true;
    if (required > 0) ctx.removeItem(reagent.itemId, required, pid);
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
