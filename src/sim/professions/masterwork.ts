// Masterwork proc model (Professions 2.0 Phase 2). The output quality roll is
// retired from the craft path: every successful craft yields its recipe's
// declared output deterministically, and the ONLY output-side randomness is a
// single masterwork proc draw (crafting.ts keeps that draw at the exact
// position the old roll occupied, one draw per successful craft). A proc mints
// a masterwork instance whose bonus stats are BAKED from the item budget at
// craft time; it is add-only, never a downgrade of the declared output.
//
// This is a pure leaf module: no Sim/SimContext import, no content-table
// import, explicit arguments only, so a Vitest imports it directly. Its only
// dependencies are the pure budget primitives (../item_budget) and shared type
// modules. No rng in here either: the caller draws (exactly once) and passes
// nothing but plain values in.

import { normalizePrimaryStats, PRIMARY_STATS, primaryStatBudget } from '../item_budget';
import type { CoreStats, ItemDef, ItemSlot } from '../types';

// Locked Phase 2 tuning, amended 2026-07-17: base chance at recipe-tier
// parity, plus a small bump per tier of craft skill above the recipe's tier,
// plus flat bonuses for a signed reagent (ANY player's signature, the
// crafter's own included; the amendment widened this from self-signed-only so
// buying a gatherer's signed materials is worth as much to the proc as
// gathering your own) and for reaching the specialization threshold, hard
// capped. Fractions of 1 (0.03 = 3 percent).
export const MASTERWORK_BASE_CHANCE = 0.03;
export const MASTERWORK_PER_TIER_ABOVE_CHANCE = 0.01;
export const MASTERWORK_SIGNED_CHANCE = 0.02;
export const MASTERWORK_SPECIALIZATION_CHANCE = 0.03;
export const MASTERWORK_CHANCE_CAP = 0.15;

export interface MasterworkChanceInput {
  // The crafter's tier capability in the recipe's craft minus the recipe's own
  // tier (wheel.ts tierCapability / tierForSkill). Clamped below at 0 here, so
  // crafting ABOVE one's tier never subtracts from the base chance.
  tiersAboveRecipe: number;
  // At least one consumed reagent is a signed instance, ANY player's
  // signature (crafting.ts's holding check over the recipe's reagents).
  // Deliberately DECOUPLED from the #1145 self-signed quantity discount,
  // which stays self-only: a count-1 signed reagent qualifies here even
  // though the discount can never fire for it.
  signedReagent: boolean;
  // The crafter has reached the specialization threshold in the recipe's craft
  // (wheel.ts isSpecialized, content-driven, never hardcoded).
  specialized: boolean;
  // Phase 10 material-tier hook: reserved additive chance input for
  // material-tier quality feeding the proc. Always 0 until Phase 10 wires a
  // real value; it participates in the sum today so wiring it later is purely
  // a call-site change.
  materialTierBonus?: number;
}

/** The masterwork proc chance for one successful craft, in [0, MASTERWORK_CHANCE_CAP].
 *  Pure sum of the locked tuning constants above, capped. */
export function masterworkProcChance(input: MasterworkChanceInput): number {
  const tiersAbove = Math.max(0, input.tiersAboveRecipe);
  const chance =
    MASTERWORK_BASE_CHANCE +
    MASTERWORK_PER_TIER_ABOVE_CHANCE * tiersAbove +
    (input.signedReagent ? MASTERWORK_SIGNED_CHANCE : 0) +
    (input.specialized ? MASTERWORK_SPECIALIZATION_CHANCE : 0) +
    (input.materialTierBonus ?? 0);
  return Math.min(MASTERWORK_CHANCE_CAP, chance);
}

// The quality ladder a masterwork bumps along, index-aligned with the tier
// scale the archetype empowerment ceiling uses (archetype.ts: common=0,
// uncommon=1, rare=2, epic=3, legendary=4).
// 'poor' is deliberately off the ladder: a junk-grade def never masterworks.
export const MASTERWORK_QUALITY_LADDER = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;
export type MasterworkQuality = (typeof MASTERWORK_QUALITY_LADDER)[number];

export interface MasterworkBump {
  quality: MasterworkQuality;
  // The bumped quality's ladder index; crafting.ts compares this against the
  // archetype ceiling tier so a dormant/hobby craft's output can never exceed
  // its empowerment ceiling through the masterwork path.
  tier: number;
}

/** One quality tier above `quality` on the ladder, or null when no bump exists:
 *  a legendary def does not bump (already the top rung) and 'poor' is off the
 *  ladder entirely. An absent quality reads as 'common', the same
 *  normalization primaryStatBudget applies. */
export function masterworkBumpedQuality(quality: ItemDef['quality']): MasterworkBump | null {
  const base = quality ?? 'common';
  const idx = (MASTERWORK_QUALITY_LADDER as readonly string[]).indexOf(base);
  if (idx < 0) return null; // 'poor': never masterworks
  const bumpedIdx = idx + 1;
  if (bumpedIdx >= MASTERWORK_QUALITY_LADDER.length) return null; // legendary does not bump
  return { quality: MASTERWORK_QUALITY_LADDER[bumpedIdx], tier: bumpedIdx };
}

export interface MasterworkStatsInput {
  // The output item's source level (for a crafted output, the recipe's own
  // `level`: the level item_level.ts registers a recipe's result at).
  level: number;
  quality: ItemDef['quality'];
  slot: ItemSlot | undefined;
  stats: Partial<CoreStats> | undefined;
}

/**
 * Bake one masterwork copy's bonus-stat record from the item budget: the
 * primary-stat budget DELTA between the def's own quality and one quality tier
 * above it (same level, same slot), redistributed across the def's existing
 * primary-stat profile (largest-remainder, deterministic). Returns null when
 * no masterwork is possible for this def: no bump exists (legendary/poor), no
 * slot, no primary-stat profile (armor alone is not a primary-stat identity to
 * scale), or a zero/negative budget delta.
 *
 * The record is the TIER DELTA, additive on top of the def's own stats:
 * recalcPlayerStats (entity.ts) adds an equipped instance's rolled.stats on
 * top of the def's stats, so baking the delta (never the full bumped budget)
 * keeps the equipped total at exactly the bumped tier's budget. Capping the
 * bump at one tier (and never past legendary) also keeps a masterwork below
 * the raid-loot band, whose budgets ride the higher raid item level.
 */
export function masterworkBonusStats(input: MasterworkStatsInput): Partial<CoreStats> | null {
  const { level, quality, slot, stats } = input;
  if (!slot || !stats) return null;
  const bumped = masterworkBumpedQuality(quality);
  if (!bumped) return null;
  // Primary stats only: normalizePrimaryStats passes `armor` through verbatim,
  // which is correct for a full-stat rebuild but would DOUBLE armor here (the
  // def already grants its own), so the profile is filtered down first.
  const primaryProfile: Partial<CoreStats> = {};
  for (const stat of PRIMARY_STATS) {
    const value = stats[stat] ?? 0;
    if (value > 0) primaryProfile[stat] = value;
  }
  if (Object.keys(primaryProfile).length === 0) return null;
  const bonusBudget =
    primaryStatBudget(level, bumped.quality, slot) - primaryStatBudget(level, quality, slot);
  if (bonusBudget <= 0) return null;
  return normalizePrimaryStats(primaryProfile, bonusBudget);
}

/** The per-player masterwork read surface (sim.ts PlayerMeta.lastMasterwork /
 *  IWorldProfessions lastMasterwork): ids only, text-free. `crafter` is the
 *  crafting player's entity id. */
export interface MasterworkProc {
  recipeId: string;
  itemId: string;
  crafter: number;
}
