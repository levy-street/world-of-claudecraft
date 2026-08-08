// Which rung of the FARMING ladder a zone's garden beds sit on.
//
// FARMING'S OWN COLUMN, NOT THE SHIPPED ZONE PROGRESSION. The numbers below
// are authored by the D2 hub design (one patch per farming hub, four hubs,
// tiers 1 to 4), and they are the farming ladder and nothing else. The
// shipped zone-progression column that fishing_zones.ts and
// professions/material_grades.ts share is a different column that happens to
// agree on the first three zones; agreement on three rows is not identity,
// and reading one where the other is meant is the mistake this header exists
// to prevent.
//
// WHERE THE TWO DELIBERATELY DIVERGE: evergarden. The shipped ladder still
// holds it at tier 1 with the rest of the v0.32.0 expansion, under the named
// progression inversion recorded at fishing_zones.ts:52-59 (its content ships
// a hub-outskirt starter kit and waits on the zone-4 design pass). Farming
// locks it at tier 4 because the Evergarden parterre IS the showcase garden:
// the eight-bed site is the top of the farming climb by design, not by
// inheritance from a column authored for a different axis.
//
// THEREFORE THE FISHING TEST'S TRICK CANNOT BE COPIED. tests/fishing_zones.test.ts
// derives its expected column from GATHER_NODES, the same way
// tests/material_grades.test.ts does, so re-tiering a zone's ground and
// leaving its water behind reds. Farming has no such backstop available: its
// column intentionally disagrees with the ground at evergarden, so deriving
// it from GATHER_NODES would either fail on the row the design chose or force
// the design to follow the ground. tests/farming_zones.test.ts pins each row
// to a LITERAL instead, which is the only honest way to guard a column whose
// authority is a design decision rather than a derivation.
//
// ONE LADDER, NO SIDE KNOBS. Every farming knob later phases add derives from
// this tier rather than carrying a per-zone number of its own; crop gating in
// the growth phase is the first runtime consumer of the reader below. The
// one-ladder arm in tests/farm_patch_placement.test.ts pins
// FARM_PATCHES[].tier to this reader, so a second farming tier column cannot
// appear anywhere without reddening.
//
// Pure leaf module: no SimContext, no content-table import, no rng, explicit
// arguments only, so a Vitest imports it directly (same contract as tools.ts,
// material_grades.ts and fishing_zones.ts).

/** The farming tier a zone with no row of its own sits on. Tier 1 is the
 *  ladder's own floor, the rung the starting zone's beds are authored for, so
 *  an unlisted zone can never gate content behind a tier its patches do not
 *  have. Reaching this value at runtime means a zone grew a patch without
 *  growing a row, which the every-zone-covered arm in
 *  tests/farming_zones.test.ts reds on. */
export const DEFAULT_FARMING_ZONE_TIER = 1;

/**
 * The farming tier each farming hub sits on, keyed by zone id. A side table
 * rather than a field on the zone record or a column on FARM_PATCHES: a zone
 * record is world geometry that src/render and the editor both read, and the
 * patch table is content the persistence allowlist is keyed on, while this is
 * one profession's ladder. It is the shape FISHING_ZONE_ROD_TIERS and
 * MATERIAL_GRADES already use for the same reason.
 *
 * An explicit row per farming zone, never a fallback to the default: the
 * coverage arm reads Object.hasOwn, so a fifth hub cannot ride the floor and
 * read as "someone decided" when nobody looked.
 */
const FARMING_ZONE_TIER_ROWS: Record<string, number> = {
  eastbrook_vale: 1,
  mirefen_marsh: 2,
  thornpeak_heights: 3,
  // Tier 4 while the shipped progression column still says 1: the divergence
  // named in this file's header, and the reason this column is its own table.
  evergarden: 4,
};

export const FARMING_ZONE_TIERS: Readonly<Record<string, number>> = Object.freeze({
  ...FARMING_ZONE_TIER_ROWS,
});

/** The farming tier this zone's beds sit on, or the floor for a zone with no
 *  row. Object.hasOwn, not a bare index: `zoneId` reaches this from authored
 *  content and from persisted plot rows, and a prototype name like
 *  'constructor' must fall to the floor rather than hand back a function. */
export function farmingZoneTierFor(zoneId: string): number {
  return Object.hasOwn(FARMING_ZONE_TIERS, zoneId)
    ? FARMING_ZONE_TIERS[zoneId]
    : DEFAULT_FARMING_ZONE_TIER;
}
