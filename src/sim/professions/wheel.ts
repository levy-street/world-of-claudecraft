// Flat per-craft skill tracking (issue #1126). A player has one independent skill
// value for each of the ten crafts on the ring (see content/professions.ts). This is
// a flat model on purpose: no conserved-mass economy yet, so gains are purely
// additive and never draw down another craft's value. The wheel/mass-conservation
// mechanic (a later issue) will extend this file rather than replace it.
//
// Free-floor rule: crafting at the common tier never costs anything, regardless of
// whether conserved mass exists yet. Since this module has no cost/spend path at
// all (skill only ever goes up), that rule holds trivially: there is nothing here
// that could charge a common-tier craft.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic so it runs offline, on the
// server, and in the headless RL env unchanged.

import {
  CRAFT_RING,
  craftById,
  PERK_THRESHOLDS,
  type PerkThresholdDef,
} from '../content/professions';
import type { SimContext } from '../sim_context';

/** Per-craft skill values, keyed by CraftDef.id. Every craft is always present. */
export type CraftSkills = Record<string, number>;

/** A fresh all-zero skill record covering every craft on the ring. */
export function emptyCraftSkills(): CraftSkills {
  const skills: CraftSkills = {};
  for (const craft of CRAFT_RING) skills[craft.id] = 0;
  return skills;
}

/** Backfill a persisted/partial record so every ring craft has an entry, without
 *  disturbing any value already present (additive back-compat: an older save with
 *  fewer or zero craft keys loads cleanly at 0 for the missing ones). */
export function normalizeCraftSkills(
  saved: Record<string, number> | undefined | null,
): CraftSkills {
  const skills = emptyCraftSkills();
  if (!saved) return skills;
  for (const craft of CRAFT_RING) {
    const value = saved[craft.id];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) skills[craft.id] = value;
  }
  return skills;
}

/** Additive-only skill gain for exactly one craft. Never touches any other craft's
 *  value (each of the ten crafts is an independent counter). A non-positive amount
 *  is a no-op; skill never goes negative. */
export function gainCraftSkill(skills: CraftSkills, craftId: string, amount: number): void {
  if (!(craftId in skills) || !(amount > 0)) return;
  skills[craftId] += amount;
}

/** Read surface: a copy of a player's ten craft skill values, keyed by craft id.
 *  Backs the IWorld `craftSkills` read (progression_xp facet). */
export function craftSkillsFor(ctx: SimContext, pid: number): CraftSkills {
  const meta = ctx.players.get(pid);
  return meta ? { ...meta.craftSkills } : emptyCraftSkills();
}

// Tiered mastery gating (issue #1128), layered onto the flat skill state above.
//
// A player's "tier capability" in a craft is derived from their current flat
// skill value in that craft via a simple, fixed bucket: every TIER_SKILL_STEP
// points of skill unlocks one more tier. Tier 0 ("common") is the free floor:
// skill 0-24 has common-tier capability, 25-49 tier-1 capability, 50-74 tier-2,
// and so on. Recipes bucket their skillReq the same way, so a recipe's tier
// and a player's capability tier are directly comparable.
//
// Skill-progress rule on a successful craft:
// - common tier (recipe tier 0): always the full amount, regardless of the
//   player's capability (the free floor from #1126/#1127 holds unconditionally).
// - recipe tier at or above the player's capability: full amount (this is how
//   capability advances in the first place).
// - recipe exactly one tier below capability: reduced amount (diminishing
//   returns for crafting something already mastered).
// - recipe two or more tiers below capability: zero (no progress at all).
export const TIER_SKILL_STEP = 25;

/** Bucket a flat skill value into a tier index. Skill 0-24 -> tier 0 (common),
 *  25-49 -> tier 1, 50-74 -> tier 2, etc. Never negative. */
export function tierForSkill(skill: number): number {
  if (!(skill > 0)) return 0;
  return Math.floor(skill / TIER_SKILL_STEP);
}

/** A player's current tier capability in one craft, derived from their flat
 *  skill value in that craft (0 if the craft or player is unknown). */
export function tierCapability(skills: CraftSkills, craftId: string): number {
  return tierForSkill(skills[craftId] ?? 0);
}

// Multiplier applied to a one-tier-below craft's skill-progress amount.
const REDUCED_TIER_MULTIPLIER = 0.5;

/** The skill-progress multiplier for crafting a recipe of `recipeTier` given a
 *  player's `capabilityTier` in that craft. Common tier (recipeTier 0) is
 *  always 1 (the free floor), independent of capability. Otherwise: full (1)
 *  at or above capability, reduced (0.5) one tier below, zero two or more
 *  tiers below. */
export function tierProgressMultiplier(capabilityTier: number, recipeTier: number): number {
  if (recipeTier <= 0) return 1;
  const tiersBelow = capabilityTier - recipeTier;
  if (tiersBelow <= 0) return 1;
  if (tiersBelow === 1) return REDUCED_TIER_MULTIPLIER;
  return 0;
}

// Specialization-perk eligibility reads over the ten-craft wheel (#1134).
// These are pure leaf reads over the live `CraftSkills` record above (P5,
// #1128 landed on this base): the eligibility gate every perk in #1134
// reads is the material-cost discount (crafting.ts), the additional
// recharge discount (tools.ts), and the mobile crafting station
// (mobile_station.ts).

/** Alias kept for #1134 call sites; identical to the live `CraftSkills` record. */
export type CraftSkillState = CraftSkills;

/** The player's skill in `craftId`, defaulting to 0 when untracked. */
export function skillInCraft(skills: CraftSkillState, craftId: string): number {
  return skills[craftId] ?? 0;
}

function thresholdFor(craftId: string): PerkThresholdDef {
  // Throws on an unknown craft id, same as craftById/adjacentCrafts above:
  // every craft on CRAFT_RING has a PERK_THRESHOLDS entry (see content).
  craftById(craftId);
  const threshold = PERK_THRESHOLDS[craftId];
  if (!threshold) {
    throw new Error(`no perk threshold registered for craft id: ${craftId}`);
  }
  return threshold;
}

/**
 * True only when the player's skill in `craftId` has reached that craft's
 * specialization threshold (read from content, never hardcoded here). This
 * is the single eligibility gate every perk in this issue reads: the
 * material-cost discount (crafting.ts), the additional recharge discount
 * (tools.ts), and the mobile crafting station (mobile_station.ts).
 */
export function isSpecialized(skills: CraftSkillState, craftId: string): boolean {
  return skillInCraft(skills, craftId) >= thresholdFor(craftId).specializedSkillThreshold;
}

/**
 * The multiplier to apply to a recipe's material quantities when crafted in
 * `craftId`: 1 (no discount) when not specialized, or
 * `1 - materialDiscountPct` once specialized. Never negative or zero-clamped
 * here; `crafting.ts` owns rounding and the floor-at-1 rule when it applies
 * this to an actual integer quantity.
 */
export function materialCostMultiplier(skills: CraftSkillState, craftId: string): number {
  if (!isSpecialized(skills, craftId)) return 1;
  return 1 - thresholdFor(craftId).materialDiscountPct;
}

/**
 * The ADDITIONAL multiplier (#1134) an original crafter's recharge discount
 * composes with when that crafter is also specialized in `craftId`: 1 (no
 * additional discount) when not specialized, or `1 - rechargeDiscountPct`
 * once specialized. `tools.ts` multiplies this into its existing
 * original-crafter discount rather than replacing it: the tick-cost half
 * always drops strictly, but the material half is an integer ceil, so with
 * today's placeholder constants a small base material cost can floor at the
 * same integer as the plain original-crafter discount (see the recharge test
 * for the material-cost bound actually asserted).
 */
export function rechargeDiscountMultiplier(skills: CraftSkillState, craftId: string): number {
  if (!isSpecialized(skills, craftId)) return 1;
  return 1 - thresholdFor(craftId).rechargeDiscountPct;
}
