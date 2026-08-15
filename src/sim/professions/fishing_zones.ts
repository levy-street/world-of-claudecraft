// Which rod a zone's water demands (D9: fishing difficulty is skill versus
// spot, never reaction time).
//
// Before this, the catch table was keyed on zone alone. Nothing stopped a
// level-1 character with the 20-copper starter pole from working Thornpeak
// water, and the only thing a better rod bought was a shorter bite delay and a
// wider reel window, so the top rung of the ladder opened nothing. This module
// is the missing axis: each zone names the rod tier its water takes, and the
// same number says which catch band that rod unlocks, so one figure per zone
// drives both the cast gate and the empty-hook schedule.
//
// TWO NUMBERS, ONE LADDER. `rodTier` is the tier a cast requires
// (professions/tools.ts canGatherTier, the same comparator every node gate
// uses). `requiredBand` is rodTier - 1, because the shipped band gate already
// says catch band b takes tool tier b + 1 (professions/fishing.ts). They are
// not independent knobs: deriving the band from the tier is what keeps the
// water a rod may legally work and the water it can actually fish from
// drifting apart.
//
// The column is the ZONE PROGRESSION tier, the same ladder the fine-material
// axis is built on (professions/material_grades.ts gatherTier: eastbrook 1,
// mirefen 2, thornpeak 3), and `tests/fishing_zones.test.ts` derives it from
// GATHER_NODES the way tests/material_grades.test.ts derives its own column, so
// re-tiering a zone's ground and leaving its water behind fails loudly.
//
// Pure leaf module: no SimContext, no content-table import, no rng, explicit
// arguments only, so a Vitest imports it directly (same contract as tools.ts
// and material_grades.ts).

/** The rod tier a zone with no row of its own demands. Tier 1 is the
 *  bare-hands floor (professions/tools.ts BARE_HANDS_TOOL_TIER), so an
 *  unlisted zone is always castable, matching the catch table's own fallback
 *  to the eastbrook_vale rows for a zone without its own table. */
export const DEFAULT_FISHING_ROD_TIER = 1;

/**
 * The rod tier each zone's water takes, keyed by zone id. Deliberately a side
 * table rather than a field on the zone record or a column on
 * FISHING_TABLES_BY_BAND: a zone record is world geometry and content that
 * `src/render` and the editor both read, and the catch tables are pinned as an
 * image by the deed zone-key guard, while this is one profession's gate. It is
 * the shape MATERIAL_GRADES already uses for the same reason.
 */
const FISHING_ZONE_ROD_TIER_ROWS: Record<string, number> = {
  eastbrook_vale: 1,
  mirefen_marsh: 2,
  thornpeak_heights: 3,
  // The v0.32.0 expansion zones: tier 1, matching their hub-outskirt gather
  // nodes (gather_nodes.ts authors every expansion node at tier 1, so the
  // water asks no more than the ground does). Explicit rows rather than the
  // DEFAULT_FISHING_ROD_TIER floor so the every-zone-covered pin in
  // tests/fishing_zones.test.ts keeps meaning "someone decided", not "nobody
  // looked". The phase 13 content pass KEPT them tier 1 deliberately (the
  // R37 starter kit), and under R19 that is a NAMED PROGRESSION INVERSION:
  // their water teaches only to 100, so a level-17 expansion zone is a
  // strictly worse fishing climb than the level-6 marsh until the zone-4
  // design pass re-tiers each zone with its full kit
  // (docs/design/professions-tuning-packet-review.md, R37; surfaced in the
  // phase 13 record).
  veiled_hollow: 1,
  drakelands: 1,
  frostveil: 1,
  amberfall: 1,
  willowfen: 1,
  nightbloom: 1,
  wraithwood: 1,
  palmreach: 1,
  evergarden: 1,
  galecrest: 1,
  farshore_isle: 1,
};

export const FISHING_ZONE_ROD_TIERS: Readonly<Record<string, number>> = Object.freeze({
  ...FISHING_ZONE_ROD_TIER_ROWS,
});

/** The rod tier a cast in this zone requires, or the tier-1 floor for a zone
 *  with no row. Object.hasOwn, not a bare index: `zoneId` can be a map-doc
 *  authored string (the same door resolveVendorRowGate hardens against), and
 *  a prototype name like 'constructor' must fall to the floor rather than
 *  hand back a function. */
export function rodTierRequiredForZone(zoneId: string): number {
  return Object.hasOwn(FISHING_ZONE_ROD_TIERS, zoneId)
    ? FISHING_ZONE_ROD_TIERS[zoneId]
    : DEFAULT_FISHING_ROD_TIER;
}

// WHY THE BAND SIDE OF THIS LADDER IS NOT EXPORTED. A zone's required BAND is
// rodTier - 1, and how far a given band falls short of it is what the nine
// catch-table cells are authored against (content/items.ts). None of that has
// a runtime consumer: the engine reads the table it is handed and never asks
// how the numbers in it were chosen. Exporting the arithmetic anyway would put
// production code in src/sim/ whose only caller is a test, so the schedule
// lives beside the cells it checks, in tests/fishing_zones.test.ts.
