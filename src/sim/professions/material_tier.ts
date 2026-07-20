// Material-tier masterwork feed (Professions 2.0 Phase 10): the def-level
// material tier a recipe's reagents carry, and the additive masterwork proc
// chance that tier feeds into masterworkProcChance's materialTierBonus input
// (the hook Phase 2 reserved). Pure leaf module, same contract as
// masterwork.ts: no Sim/SimContext import, no content-table import, no rng,
// explicit arguments only, so a Vitest imports it directly.
//
// Tier grouping, derived from the gathered material families
// (gathering.ts NODE_MATERIAL_TABLE's zone progression) aligned with the
// vendor price bands the premium reagents ship at:
// - tier 0 (absent from the table, contributes exactly 0): the baseline
//   mob-drop reagents (bone_fragments, linen_scrap, spider_leg) and the
//   eastbrook_vale starter yields (copper_ore, ironbark_log,
//   silverleaf_herb), plus every non-material item a recipe consumes
//   (crafted tool inputs and the like). Zero here is load-bearing: it keeps
//   every pre-Phase-10 pinned scenario and the parity goldens byte-identical
//   (both golden recipes consume only tier-0 reagents).
// - tier 1: the mid band: the mirefen_marsh yields (iron_ore, ashwood_log,
//   goldleaf_herb) plus thorium_ore, which rides the same 15/60-copper
//   vendor band and the same skillReq-75 recipe rung as ashwood/goldleaf
//   even though its node row sits in thornpeak_heights.
// - tier 2: the premium 40/160-copper band: the remaining thornpeak_heights
//   yields (elderwood_log, sunpetal_herb) plus arcanite_bar, the refined
//   vendor reagent in that band (not a node yield, so keyed here directly).
//
// Keying is by ITEM DEF, never by consumed-instance payload: the crafting.ts
// call site resolves reagents by itemId and ctx.removeItem consumes
// end-backward without reporting WHICH instance went, so a rolled-rarity
// instance feed would need a consumption-order change (out of Phase 10's
// scope; the def-level table is the implemented model).
import type { ProfessionReagent } from './types';

// Pinned per-material tier table (tests/professions_masterwork.test.ts pins
// every row literally). An id absent here is tier 0.
export const MATERIAL_TIER_BY_ITEM: Readonly<Record<string, number>> = Object.freeze({
  iron_ore: 1,
  ashwood_log: 1,
  goldleaf_herb: 1,
  thorium_ore: 1,
  elderwood_log: 2,
  sunpetal_herb: 2,
  arcanite_bar: 2,
});

// Additive proc chance per material tier, on the same scale as the
// masterwork.ts tuning constants (matches MASTERWORK_PER_TIER_ABOVE_CHANCE):
// a tier-1 reagent feeds 0.01, a tier-2 reagent 0.02, capped downstream by
// MASTERWORK_CHANCE_CAP like every other summand.
export const MASTERWORK_MATERIAL_TIER_CHANCE = 0.01;

/** The material tier of one item id: the pinned table row, or 0 for any id
 *  not in it (mob drops, starter yields, crafted tool inputs, unknown ids). */
export function materialTierForItem(itemId: string): number {
  return MATERIAL_TIER_BY_ITEM[itemId] ?? 0;
}

/** The materialTierBonus one craft feeds masterworkProcChance: the MAX
 *  material tier across the recipe's reagent list (never the sum, so a
 *  multi-reagent premium recipe stays on the same scale as the other
 *  masterwork bonuses) times MASTERWORK_MATERIAL_TIER_CHANCE. A tier-0-only
 *  list (every pre-Phase-10 common recipe) resolves to exactly 0. */
export function materialTierBonusForReagents(
  reagents: readonly Pick<ProfessionReagent, 'itemId'>[],
): number {
  let maxTier = 0;
  for (const reagent of reagents) {
    maxTier = Math.max(maxTier, materialTierForItem(reagent.itemId));
  }
  return MASTERWORK_MATERIAL_TIER_CHANCE * maxTier;
}
