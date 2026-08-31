// Load hardening for the daily/weekly gate state (Masterwrought phases 04 and
// 07; the delve and heroic daily fragments joined at Phase 18), extracted
// verbatim from Sim.addPlayer per the monolith ratchet: a
// tampered or corrupt row must degrade to defaults, never throw inside
// addPlayer (the unloadable-character class) and never poison the gate with
// junk entries. A malformed emberWeekAnchor would otherwise stall the weekly
// grant forever: emberWeeksBetween returns 0 for unparseable input, which is
// indistinguishable from same-week. The clamps bound the blob too. That matters
// unevenly across the fields, so state it exactly rather than as one rule:
// wyrmfallDaily, delveDaily, heroicDaily and emberWeekAnchor sit OUTSIDE the
// professions byte ceiling, so
// the load clamp is the only thing bounding them (the knownRecipes doctrine),
// while craftDaily is INSIDE it (it is in both PROFESSIONS_BLOB_FIELDS lists and
// is costed in the growth bound). Real source tokens are short
// (dungeonId:difficulty, 'rift', delve and dungeon ids), real recipe ids are
// short, and every live set is content-bounded near ten, so oversized junk
// simply drops here.
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
  delveDaily?: { date: string; firstClearXp: string[]; markClears: number };
  heroicDaily?: { date: string; marked: string[] };
  emberWeekAnchor?: string;
}

/** The sanitized live shape (PlayerMeta's daily-gate fragments). The optional
 *  members mirror the save's zero-default omission: an absent fragment leaves
 *  the caller's createPlayer default untouched. */
export interface DailyGateLoadResult {
  wyrmfallDaily?: { date: string; sources: Set<string> };
  craftDaily?: { date: string; crafted: Set<string> };
  delveDaily?: { date: string; firstClearXp: Set<string>; markClears: number };
  heroicDaily?: { date: string; marked: Set<string> };
  emberWeekAnchor: string;
}

/** The shared date clamp (the wyrmfallDaily arm's rule): a real window key is
 *  short (10 chars for a day, `reset:<n>` for the heroic window), so an
 *  uncapped or non-string date degrades to '' instead of riding the save
 *  verbatim forever. */
function clampGateDate(date: unknown): string {
  return typeof date === 'string' && date.length <= 64 ? date : '';
}

/** The shared token-set clamp (the wyrmfallDaily arm's rule): type-checked
 *  strings, 64-char cap per token, 32-entry cap. A NON-ITERABLE value is the
 *  arm's whole reason to exist: `new Set(5)` throws, which inlined in
 *  addPlayer made the character unloadable; here it degrades to empty. */
function clampGateTokens(tokens: unknown): Set<string> {
  return new Set(
    Array.isArray(tokens)
      ? tokens.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 32)
      : [],
  );
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
      date: clampGateDate(s.wyrmfallDaily.date),
      sources: clampGateTokens(s.wyrmfallDaily.sources),
    };
  }
  // The delve and heroic daily fragments (masterwrought Phase 18, the third
  // and fourth copies the rule-of-three called for): the SAME type/cap clamps
  // as the wyrmfall arm, keeping the date when the set empties like it does
  // (no live-id filter, so the craftDaily date-reset divergence does not
  // apply), plus delveDaily's numeric markClears floored to a non-negative
  // integer with any non-finite junk reading 0.
  if (s.delveDaily) {
    out.delveDaily = {
      date: clampGateDate(s.delveDaily.date),
      firstClearXp: clampGateTokens(s.delveDaily.firstClearXp),
      markClears: Number.isFinite(s.delveDaily.markClears)
        ? Math.max(0, Math.floor(s.delveDaily.markClears))
        : 0,
    };
  }
  if (s.heroicDaily) {
    out.heroicDaily = {
      date: clampGateDate(s.heroicDaily.date),
      marked: clampGateTokens(s.heroicDaily.marked),
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
