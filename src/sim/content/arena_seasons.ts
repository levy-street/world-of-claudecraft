// The Arena season roster: data-as-code, one record per planned season. No
// engine logic lives here; the calendar is src/sim/arena_season.ts and the award
// path is server/arena_season_settlement.ts.
//
// One season, one title, awarded to BOTH champions of that season: the
// highest-rated 1v1 duelist and both members of the highest-rated 2v2 pair. That
// is deliberate. The Warmaster line is the Coliseum's single mark of a season
// won; splitting it per bracket would mint two near-identical titles a year and
// dilute the one thing it says.
//
// Titles escalate across the ten seasons and never repeat a word: Season 1 is
// the bare inaugural "Warmaster" and every season after it takes an epithet, two
// of which (Ashen, Drowned) name the Coliseum's own two maps.
//
// APPEND-ONLY, for the same reason DEED_ORDER is: a settled season is persisted
// by NUMBER, so editing an entry retroactively changes what an awarded title
// meant. Extend the table before Season 10 closes; the calendar keeps counting
// past the end of this list, and a season with no record here settles nothing
// (server/arena_season_settlement.ts logs and skips it).

/** One planned season: its number, the Book of Deeds feat it awards, its title. */
export interface ArenaSeasonDef {
  /** 1-based season number; matches `arenaSeasonIndexAt` and the persisted key. */
  index: number;
  /** The `feat_` deed id the champions are granted (its reward carries `title`). */
  deedId: string;
  /** The English display title. Re-localized client-side through deed_i18n.ts. */
  title: string;
}

export const ARENA_SEASONS: readonly ArenaSeasonDef[] = [
  { index: 1, deedId: 'feat_arena_season_1_warmaster', title: 'Warmaster' },
  { index: 2, deedId: 'feat_arena_season_2_glorious', title: 'Glorious Warmaster' },
  { index: 3, deedId: 'feat_arena_season_3_malevolent', title: 'Malevolent Warmaster' },
  { index: 4, deedId: 'feat_arena_season_4_ashen', title: 'Ashen Warmaster' },
  { index: 5, deedId: 'feat_arena_season_5_drowned', title: 'Drowned Warmaster' },
  { index: 6, deedId: 'feat_arena_season_6_merciless', title: 'Merciless Warmaster' },
  { index: 7, deedId: 'feat_arena_season_7_ruinous', title: 'Ruinous Warmaster' },
  { index: 8, deedId: 'feat_arena_season_8_sovereign', title: 'Sovereign Warmaster' },
  { index: 9, deedId: 'feat_arena_season_9_undying', title: 'Undying Warmaster' },
  { index: 10, deedId: 'feat_arena_season_10_immortal', title: 'Immortal Warmaster' },
];

/** How many seasons are authored. The calendar runs past this; content does not. */
export const ARENA_SEASON_COUNT = ARENA_SEASONS.length;

const BY_INDEX = new Map<number, ArenaSeasonDef>(ARENA_SEASONS.map((s) => [s.index, s]));
const BY_DEED_ID = new Map<string, ArenaSeasonDef>(ARENA_SEASONS.map((s) => [s.deedId, s]));

/** The record for a season number, or null past the authored roster. */
export function arenaSeasonDef(index: number): ArenaSeasonDef | null {
  return BY_INDEX.get(index) ?? null;
}

/** The season a season-title deed id belongs to, or null for any other deed. */
export function arenaSeasonForDeedId(deedId: string): ArenaSeasonDef | null {
  return BY_DEED_ID.get(deedId) ?? null;
}

/**
 * Every season-title deed id. The one gate the sim's grant helper checks, so a
 * host that hands the sim an arbitrary deed id cannot mint a non-season title
 * through the season award lane.
 */
export const ARENA_SEASON_DEED_IDS: ReadonlySet<string> = new Set(
  ARENA_SEASONS.map((s) => s.deedId),
);
