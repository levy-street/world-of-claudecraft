// SQL boundary for the Reliquary population-rarity aggregate (the *_db.ts
// convention: the query lives here, parameterized, and no other module
// carries raw SQL for it). Unlike deeds rarity there is NO relic observer
// table: relic ownership lives inside the characters.state JSONB blob
// (deedStats.itemsDiscovered for item relics, reliquary.marks for kill-proof
// marks, reliquary.illuminatedPages for page illumination), so the numerators
// unnest those arrays in place. The read is an observer: nothing here can
// grant, deny, or mutate reliquary state.
//
// Cost posture, decided with the deeds walk in view: this scan does NOT get
// its own cadence. main.ts runs it inside the SAME single-flight refresh and
// TTL cache as deedRarityCounts, so the characters walk happens at most once
// per DEEDS_RARITY_TTL_MS no matter which UI asks. The blob extraction makes
// this the heavier half of that refresh (it detoasts every eligible
// character's state, which the deeds COUNT arms never do); the measured
// figures live in the phase record and the module's own bounded allowance
// below (RELIQUARY_RARITY_STATEMENT_TIMEOUT_MS) is what caps them.

import {
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_MARK_IDS,
  RELIQUARY_PAGE_ORDER,
} from '../src/sim/content/reliquary';
import { ELIGIBLE_ACCOUNT_SQL, runWithStatementTimeout } from './db';
import { DEED_RARITY_MIN_LEVEL } from './deeds_db';

/** Dedicated per-statement allowance for this cosmetic read, DELIBERATELY far
 *  below DB_HEAVY_STATEMENT_TIMEOUT_MS (the GUILD_BANK_LOG_TIMEOUT_MS
 *  lowering precedent): statement_timeout is per STATEMENT, so a transaction
 *  of three blob scans under the 60 s heavy allowance could hold one pooled
 *  client for three minutes. The heaviest arm measured 2.1 s at 42k eligible
 *  characters, so 10 s is generous headroom while capping the whole refresh
 *  hold near 30 s worst case. */
export const RELIQUARY_RARITY_STATEMENT_TIMEOUT_MS = 10_000;

/** The population aggregate the public endpoint serves: how many eligible
 *  characters have found each catalogued relic id (item relics by first
 *  discovery, mark relics by the kill-proof ledger; zero-found ids absent)
 *  and how many have illuminated each page (zero-illumination pages absent).
 *  GLOBAL (cross-realm) by design, the deeds rarity precedent: at current
 *  population, per-realm percentages would be noise. THREE relic kinds are
 *  deliberately not counted: weapon skins (account-scoped), titles
 *  (deed-scoped), and mounts (possession-based; a mount cell's id is the
 *  mount key, not the reins item id, so nothing in the blob arrays matches
 *  it). All three stay absent from `found` and the client renders no line
 *  for them, the same shape as zero-found; a mounts page can still show a
 *  header illumination line while its cells never show one. */
export interface ReliquaryRarityAggregate {
  totalEligible: number;
  found: Record<string, number>;
  illuminated: Record<string, number>;
}

/** A blob array read that tolerates a malformed or absent path: strict
 *  jsonpath with silent-on-error answers [] for a missing path, a scalar, or
 *  an object, and passes a real array through element for element (all four
 *  shapes verified on a live Postgres 16). The serializer only ever writes
 *  string arrays here, so this guards restore drift and hand-edited rows,
 *  not a live shape. jsonb_path_query_array references c.state ONCE, where
 *  the earlier jsonb_typeof CASE named its path twice and paid the blob
 *  detoast twice per arm (Postgres detoasts per expression REFERENCE, the
 *  measured 2x buffer cost the db review caught). The jsonpath is
 *  interpolated into SQL, so it MUST be a compile-time literal from this
 *  module, never a caller-supplied or wire-derived string. */
function blobArraySql(jsonPath: string): string {
  return `jsonb_path_query_array(c.state, 'strict ${jsonPath}[*]', '{}', true)`;
}

/**
 * `eligibleFromSameRefresh` skips the denominator statement: the main.ts
 * refresh runs deedRarityCounts first, whose denominator is byte-identical
 * to this one (same predicate constants), so re-counting it in the same
 * refresh would walk `characters JOIN accounts` twice for the same number.
 * A standalone call (a test, a probe) omits it and pays for its own count.
 */
export async function reliquaryRarityCounts(
  eligibleFromSameRefresh?: number,
): Promise<ReliquaryRarityAggregate> {
  // Catalog filters ride text[] binds (never interpolated) so the unnest
  // GROUP BY only aggregates catalogued ids: itemsDiscovered holds every item
  // a character ever discovered, and filtering in SQL keeps the grouped row
  // set bounded by the catalog rather than the item table.
  const itemIds = [...RELIQUARY_ITEM_TO_PAGES.keys()];
  const markIds = [...RELIQUARY_MARK_IDS];
  const pageIds = [...RELIQUARY_PAGE_ORDER];
  // All arms run in ONE transaction under the module's own bounded allowance
  // (see RELIQUARY_RARITY_STATEMENT_TIMEOUT_MS). READ COMMITTED still applies
  // (no single snapshot across arms), and with the same-refresh denominator
  // handoff the denominator comes from an EARLIER transaction than the
  // numerators, so a character created mid-refresh can count in a numerator
  // but not the denominator; the client-side fraction clamp absorbs the
  // over-1 direction, exactly as the deeds fraction gate does.
  //
  // Every arm embeds the SAME eligibility predicate deedRarityCounts pins on
  // both its axes (the DEED_RARITY_MIN_LEVEL floor plus state IS NOT NULL,
  // and ELIGIBLE_ACCOUNT_SQL VERBATIM through an `accounts a` join), so a
  // banned, suspended, or sub-floor character leaves every numerator and the
  // denominator together and no count can read past the population it is
  // measured against.
  return runWithStatementTimeout(RELIQUARY_RARITY_STATEMENT_TIMEOUT_MS, async (query) => {
    const foundItems = await query(
      `SELECT x.id, COUNT(*)::int AS found
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       CROSS JOIN LATERAL jsonb_array_elements_text(
         ${blobArraySql('$.deedStats.itemsDiscovered')}
       ) AS x(id)
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}
        AND x.id = ANY($2::text[])
      GROUP BY x.id`,
      [DEED_RARITY_MIN_LEVEL, itemIds],
    );
    const foundMarks = await query(
      `SELECT x.id, COUNT(*)::int AS found
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       CROSS JOIN LATERAL jsonb_array_elements_text(
         ${blobArraySql('$.reliquary.marks')}
       ) AS x(id)
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}
        AND x.id = ANY($2::text[])
      GROUP BY x.id`,
      [DEED_RARITY_MIN_LEVEL, markIds],
    );
    const illuminatedPages = await query(
      `SELECT x.id, COUNT(*)::int AS illuminated
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       CROSS JOIN LATERAL jsonb_array_elements_text(
         ${blobArraySql('$.reliquary.illuminatedPages')}
       ) AS x(id)
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}
        AND x.id = ANY($2::text[])
      GROUP BY x.id`,
      [DEED_RARITY_MIN_LEVEL, pageIds],
    );
    let totalEligible: number;
    if (eligibleFromSameRefresh !== undefined) {
      totalEligible = eligibleFromSameRefresh;
    } else {
      const eligible = await query(
        `SELECT COUNT(*)::int AS eligible
         FROM characters c
         JOIN accounts a ON a.id = c.account_id
        WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}`,
        [DEED_RARITY_MIN_LEVEL],
      );
      totalEligible = eligible.rows[0]?.eligible ?? 0;
    }
    const found: Record<string, number> = {};
    for (const row of foundItems.rows) found[row.id] = row.found;
    for (const row of foundMarks.rows) found[row.id] = row.found;
    const illuminated: Record<string, number> = {};
    for (const row of illuminatedPages.rows) illuminated[row.id] = row.illuminated;
    return { totalEligible, found, illuminated };
  });
}
