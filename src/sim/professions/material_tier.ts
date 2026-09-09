// Material-tier masterwork feed (Professions 2.0): the def-level
// material tier a recipe's reagents carry, and the additive masterwork proc
// chance that tier feeds into masterworkProcChance's materialTierBonus input
// (the reserved hook on that input). Pure leaf module, same contract as
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
//   every tier-0-only pinned scenario and the parity goldens byte-identical
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
// instance feed would need a consumption-order change (out of this module's
// scope; the def-level table is the implemented model).
import { fineMaterialFor } from './material_grades';
import type { ProfessionReagent } from './types';

// The base rows. An id absent here is tier 0.
//
// The ten Masterwrought intermediates (Phase 08, paying the Phase 07 ledger
// obligation) sit on tier 2 by the arcanite_bar precedent: a refined reagent
// keyed here directly rather than through a node family. They are one rung
// past arcanite (skill-75 crafted, each consuming a Quickening Catalyst plus
// tier-1/2 mats), but tier 2 is deliberately the ceiling: a new tier would
// change the masterwork bonus scale, and masterwork.ts constants are locked
// by ruling. Two consumer surfaces exist: the apex rows (the intended one,
// every bill maxes at tier 2 via its intermediate) AND the nine phase 07
// intermediate recipes themselves, whose Quickening Catalyst reagent now
// carries tier 2, raising their masterworkProcChance INPUT (seven of nine
// move: 0.01 to 0.02 for billet/plating/setting/chassis, 0 to 0.02 for
// cording/stock/reagent; bolt and vellum already sat at 2 via sunpetal).
// That input change is EFFECT-DEAD by a separate mechanism: every
// intermediate output is slotless junk, so masterworkBonusStats returns
// null and the crafting.ts effect gate never fires (pinned in
// tests/professions_masterwork.test.ts). The proc draw is unconditional
// either way, so no rng draw order moves anywhere. wyrmfall_core stays
// DELIBERATELY untiered: the raid chase material's premium is availability,
// not refinement, and every apex bill already maxes at tier 2 through its
// intermediate; revisit only if a future apex row ever lists the core
// without an intermediate beside it.
const BASE_MATERIAL_TIERS: Readonly<Record<string, number>> = Object.freeze({
  iron_ore: 1,
  ashwood_log: 1,
  goldleaf_herb: 1,
  thorium_ore: 1,
  elderwood_log: 2,
  sunpetal_herb: 2,
  arcanite_bar: 2,
  duskforged_billet: 2,
  forgefold_plating: 2,
  wyrmhide_cording: 2,
  sunspun_bolt: 2,
  prismglass_setting: 2,
  precision_chassis: 2,
  quickening_catalyst: 2,
  seasoned_stock: 2,
  lucent_reagent: 2,
  sablewax_vellum: 2,
});

// Pinned per-material tier table (tests/professions_masterwork.test.ts pins
// every row literally). An id absent here is tier 0.
//
// A fine grade (professions/material_grades.ts) INHERITS its base's band, and
// is derived from it here rather than hand-listed so the two can never drift.
// Inheritance is the deliberate choice: this band is a price proxy for the
// masterwork proc, and a fine grade is the same material worked with a better
// tool, not a rung further up the recipe ladder. It also keeps every
// re-specced tool recipe's masterworkProcChance byte-identical across the D8
// swap, so that change moves reagent ids and nothing else. The eastbrook
// grades inherit ABSENCE the same way, keeping the load-bearing zero above
// intact for them.
export const MATERIAL_TIER_BY_ITEM: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(BASE_MATERIAL_TIERS).flatMap(([itemId, tier]) => {
      const fineItemId = fineMaterialFor(itemId);
      return fineItemId ? [[itemId, tier] as const, [fineItemId, tier] as const] : [[itemId, tier]];
    }),
  ),
);

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
 *  list (every baseline common recipe) resolves to exactly 0. */
export function materialTierBonusForReagents(
  reagents: readonly Pick<ProfessionReagent, 'itemId'>[],
): number {
  let maxTier = 0;
  for (const reagent of reagents) {
    maxTier = Math.max(maxTier, materialTierForItem(reagent.itemId));
  }
  return MASTERWORK_MATERIAL_TIER_CHANCE * maxTier;
}
