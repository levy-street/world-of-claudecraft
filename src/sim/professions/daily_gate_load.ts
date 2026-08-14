// Load hardening for the Masterwrought daily/weekly gate state (phases 04 and
// 07), extracted verbatim from Sim.addPlayer per the monolith ratchet: a
// tampered or corrupt row must degrade to defaults, never throw inside
// addPlayer (the unloadable-character class) and never poison the gate with
// junk entries. A malformed emberWeekAnchor would otherwise stall the weekly
// grant forever: emberWeeksBetween returns 0 for unparseable input, which is
// indistinguishable from same-week. The clamps bound the blob too (these
// fields are outside the professions byte ceiling, so the load clamp is what
// bounds them, the knownRecipes doctrine): real source tokens are short
// (dungeonId:difficulty, 'rift'), real recipe ids are short, and both live
// sets are content-bounded near ten, so oversized junk simply drops here.
//
// A pure leaf (src/sim/CLAUDE.md): no SimContext, no rng, no clock; a Vitest
// imports it directly. Sim.addPlayer is the one runtime caller.

import { ALL_RECIPES } from '../content/recipes';
import { emberWeekAnchorOf } from './masterwrought_materials';

/** Live oncePerDay recipe ids, derived once from static content: the
 *  craftDaily load clamp filters saved stamps to this set (the node_persist
 *  anti-tamper doctrine). Module-level because content is immutable, so a
 *  per-load rebuild would be a constant wearing a per-load costume. */
const ONCE_PER_DAY_RECIPE_IDS: ReadonlySet<string> = new Set(
  ALL_RECIPES.filter((r) => r.oncePerDay).map((r) => r.id),
);

/** The saved shape (CharacterState's daily-gate fragments). Declared
 *  structurally here rather than importing CharacterState, so the leaf never
 *  imports sim.ts; the fields are treated as untrusted regardless. */
export interface DailyGateSaveFragments {
  wyrmfallDaily?: { date: string; sources: string[] };
  craftDaily?: { date: string; crafted: string[] };
  emberWeekAnchor?: string;
}

/** The sanitized live shape (PlayerMeta's daily-gate fragments). The optional
 *  members mirror the save's zero-default omission: an absent fragment leaves
 *  the caller's createPlayer default untouched. */
export interface DailyGateLoadResult {
  wyrmfallDaily?: { date: string; sources: Set<string> };
  craftDaily?: { date: string; crafted: Set<string> };
  emberWeekAnchor: string;
}

export function sanitizeDailyGateLoad(s: DailyGateSaveFragments): DailyGateLoadResult {
  const out: DailyGateLoadResult = {
    // Normalized through the anchor parser, not stored verbatim: any
    // unparseable or off-anchor value (corrupt row, tampered save, a future
    // date-format change) degrades to a state the weekly grant recovers
    // from, instead of stalling it forever (unparseable reads as same-week).
    emberWeekAnchor: emberWeekAnchorOf(
      typeof s.emberWeekAnchor === 'string' ? s.emberWeekAnchor : '',
    ),
  };
  if (s.wyrmfallDaily) {
    out.wyrmfallDaily = {
      // The date carries the same 64-char cap as the tokens: a real value
      // is always 10 chars, and an uncapped corrupt date would re-save
      // verbatim forever (the omission arm keeps any non-empty date).
      date:
        typeof s.wyrmfallDaily.date === 'string' && s.wyrmfallDaily.date.length <= 64
          ? s.wyrmfallDaily.date
          : '',
      sources: new Set(
        Array.isArray(s.wyrmfallDaily.sources)
          ? s.wyrmfallDaily.sources
              .filter((x) => typeof x === 'string' && x.length <= 64)
              .slice(0, 32)
          : [],
      ),
    };
  }
  // The oncePerDay craft stamp (Masterwrought phase 07): the exact clamps
  // the wyrmfallDaily arm above applies (64-char cap on the date and on
  // every token, 32-entry cap, type-checked), for the same reason: a
  // tampered or corrupt row degrades here instead of throwing in
  // addPlayer or riding back out through the save verbatim. Real recipe
  // ids are short and the oncePerDay set is content-bounded near ten.
  // One deliberate divergence from the sibling: this arm resets the
  // date when the stamp set empties (below); wyrmfallDaily keeps its
  // date, so its {date, sources: []} shape can still re-serialize (its
  // sources carry no live-id filter, so the corner needs a tampered
  // row there rather than a retired recipe).
  if (s.craftDaily) {
    // Tokens are additionally filtered to LIVE oncePerDay recipe ids
    // (the node_persist anti-tamper doctrine: load-side, so a tampered
    // or orphaned stamp, or one whose recipe lost the flag, drops here
    // instead of riding the save verbatim). A date whose stamps ALL
    // filtered away resets with them: an empty set gates nothing, and a
    // kept date would re-serialize {date, crafted: []} forever, breaking
    // the zero-default omission's byte-identity claim in Sim.
    const craftedStamps = new Set(
      Array.isArray(s.craftDaily.crafted)
        ? s.craftDaily.crafted
            .filter(
              (x) => typeof x === 'string' && x.length <= 64 && ONCE_PER_DAY_RECIPE_IDS.has(x),
            )
            .slice(0, 32)
        : [],
    );
    out.craftDaily = {
      date:
        craftedStamps.size > 0 &&
        typeof s.craftDaily.date === 'string' &&
        s.craftDaily.date.length <= 64
          ? s.craftDaily.date
          : '',
      crafted: craftedStamps,
    };
  }
  return out;
}
