// SQL boundary for the Arena season domain (the *_db.ts convention: every
// season query lives here, parameterized, and no other module carries raw SQL
// for these tables).
//
// Four tables, each with a different growth story:
// - `arena_season_entrants` and `arena_season_partners` are the two that grow
//   with play. Entrants records that a character fought a ranked bout in a
//   season and bracket, which is what makes a champion a champion OF THAT SEASON
//   rather than whoever happens to sit on top of a carried-over ladder.
//   Partners records that a specific DUO fought together, which is what makes
//   "the pair with the highest Elo" answerable at all: 2v2 Elo is stored per
//   CHARACTER, so without this row there is no such thing as a pair. Both are
//   bounded per season and pruned by the nightly retention sweep.
// - `arena_season_titles` is the award ledger: at most three rows per season per
//   realm (one 1v1 champion, two pair members). It is the source of truth the
//   join handler replays into the sim, so it is never pruned.
// - `arena_season_settlements` is the exactly-once marker: one row per settled
//   season per realm, written in the SAME transaction as that season's awards.
//   Its presence, not a clock, is what makes settlement idempotent across
//   restarts, redeploys, and multiple realm processes.
//
// Ratings are read out of each character's `state` JSONB, exactly like
// `topArenaRatings` in db.ts: seasons add no column to `characters` and no
// migration, and a character who never fought is excluded by its own record.

import type { PlayerClass } from '../src/sim/types';
import {
  DB_HEAVY_STATEMENT_TIMEOUT_MS,
  ELIGIBLE_ACCOUNT_SQL,
  pool,
  runWithStatementTimeout,
} from './db';

// How many candidate rows a settlement read pulls before the deterministic pick
// happens in JS. Generous next to any realistic ranked population, and it keeps
// the tie-break rules in one testable pure function instead of split across SQL.
export const ARENA_SEASON_CANDIDATE_LIMIT = 200;

/** The 2v2 rating expression, mirroring db.ts topArenaRatings for the bracket. */
const RATING_2V2 = (alias: string) => `COALESCE((${alias}.state->>'arena2v2Rating')::int, 1500)`;
/** The 1v1 rating expression, including the pre-split legacy key fallback. */
const RATING_1V1 = (alias: string) =>
  `COALESCE((${alias}.state->>'arena1v1Rating')::int, (${alias}.state->>'arenaRating')::int, 1500)`;
const WINS_1V1 = (alias: string) =>
  `COALESCE((${alias}.state->>'arena1v1Wins')::int, (${alias}.state->>'arenaWins')::int, 0)`;
const LOSSES_1V1 = (alias: string) =>
  `COALESCE((${alias}.state->>'arena1v1Losses')::int, (${alias}.state->>'arenaLosses')::int, 0)`;

export const ARENA_SEASON_SCHEMA = `
-- Who actually competed, per season and bracket. A champion must appear here,
-- so a character who topped the ladder in an earlier season and then stopped
-- playing cannot keep winning seasons they never entered.
CREATE TABLE IF NOT EXISTS arena_season_entrants (
  realm TEXT NOT NULL,
  season INT NOT NULL,
  bracket TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  bouts INT NOT NULL DEFAULT 0,
  last_bout_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, season, bracket, character_id)
);
-- The retention sweep deletes oldest-season-first; the settlement read seeks by
-- (realm, season, bracket), which the primary key already serves.
CREATE INDEX IF NOT EXISTS arena_season_entrants_season
  ON arena_season_entrants(season);

-- Ranked 2v2 duos that fought together in a season. The pair is stored in
-- canonical order (character_a < character_b, enforced by the writer and by the
-- CHECK below) so one duo is exactly one row however the teams were built.
CREATE TABLE IF NOT EXISTS arena_season_partners (
  realm TEXT NOT NULL,
  season INT NOT NULL,
  character_a INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_b INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  bouts INT NOT NULL DEFAULT 0,
  last_bout_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, season, character_a, character_b),
  CONSTRAINT arena_season_partners_ordered CHECK (character_a < character_b)
);
-- The retention sweep deletes oldest-season-first; the settlement read seeks by
-- (realm, season), which the primary key already serves.
CREATE INDEX IF NOT EXISTS arena_season_partners_season
  ON arena_season_partners(season);

-- The award ledger. Replayed into the sim at every join, so the per-character
-- seek is the hot read and gets its own index.
CREATE TABLE IF NOT EXISTS arena_season_titles (
  realm TEXT NOT NULL,
  season INT NOT NULL,
  bracket TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deed_id TEXT NOT NULL,
  rating INT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, season, bracket, character_id)
);
CREATE INDEX IF NOT EXISTS arena_season_titles_character
  ON arena_season_titles(character_id);

-- Exactly-once marker. Written in the same transaction as the season's awards,
-- so a settled season can never be re-scored by a later boot or a peer process.
CREATE TABLE IF NOT EXISTS arena_season_settlements (
  realm TEXT NOT NULL,
  season INT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  champions INT NOT NULL DEFAULT 0,
  PRIMARY KEY (realm, season)
);
`;

/** One 1v1 ladder candidate at season close. */
export interface ArenaSeasonSoloCandidate {
  characterId: number;
  accountId: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
  /** Ranked 1v1 bouts fought IN the season (the entrants tally, a tie-break). */
  bouts: number;
}

/** One member of a 2v2 duo candidate. */
export interface ArenaSeasonPairMember {
  characterId: number;
  accountId: number;
  name: string;
  cls: PlayerClass;
  rating: number;
}

/** One duo that fought together in the season, with both members' close ratings. */
export interface ArenaSeasonPairCandidate {
  a: ArenaSeasonPairMember;
  b: ArenaSeasonPairMember;
  bouts: number;
}

/** One awarded row, as the settlement writes it and the public read returns it. */
export interface ArenaSeasonTitleRow {
  season: number;
  bracket: string;
  characterId: number;
  accountId: number;
  deedId: string;
  rating: number;
  name?: string;
  cls?: PlayerClass;
}

/**
 * Record that a character fought a ranked bout in `season`/`bracket`. Called
 * once per participant per bout by the game observer. A duplicate simply bumps
 * `bouts`, which is a tie-break input, never a ranking one.
 */
export async function recordArenaSeasonEntrant(row: {
  realm: string;
  season: number;
  bracket: string;
  characterId: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO arena_season_entrants (realm, season, bracket, character_id, bouts)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (realm, season, bracket, character_id)
     DO UPDATE SET bouts = arena_season_entrants.bouts + 1, last_bout_at = now()`,
    [row.realm, row.season, row.bracket, row.characterId],
  );
}

/**
 * Record that a duo completed a ranked 2v2 bout together in `season`. Called
 * once per team per bout by the game observer, beside the two entrant rows. The
 * pair is normalized to (low, high) here so the caller never has to think about
 * ordering; a self-pair (which the sim cannot produce) is dropped rather than
 * violating the ordering CHECK.
 */
export async function recordArenaSeasonPair(row: {
  realm: string;
  season: number;
  characterIdA: number;
  characterIdB: number;
}): Promise<void> {
  const low = Math.min(row.characterIdA, row.characterIdB);
  const high = Math.max(row.characterIdA, row.characterIdB);
  if (low === high) return;
  await pool.query(
    `INSERT INTO arena_season_partners (realm, season, character_a, character_b, bouts)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (realm, season, character_a, character_b)
     DO UPDATE SET bouts = arena_season_partners.bouts + 1, last_bout_at = now()`,
    [row.realm, row.season, low, high],
  );
}

/** Seasons already settled on this realm, so the driver can skip them cheaply. */
export async function settledArenaSeasons(realm: string): Promise<Set<number>> {
  const res = await pool.query('SELECT season FROM arena_season_settlements WHERE realm = $1', [
    realm,
  ]);
  return new Set(res.rows.map((r) => Number(r.season)));
}

/**
 * Everyone who fought a ranked 1v1 bout in `season`, with their rating as it
 * stands now. The entrants join is the seasonal gate: an idle former champion
 * carries their rating but not their entry, so they cannot win a season they sat
 * out.
 */
export async function arenaSeasonSoloCandidates(
  realm: string,
  season: number,
  limit = ARENA_SEASON_CANDIDATE_LIMIT,
): Promise<ArenaSeasonSoloCandidate[]> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT c.id, c.account_id, c.name, c.class, e.bouts,
              ${RATING_1V1('c')} AS rating,
              ${WINS_1V1('c')} AS wins,
              ${LOSSES_1V1('c')} AS losses
         FROM arena_season_entrants e
         JOIN characters c ON c.id = e.character_id
        WHERE e.realm = $1
          AND e.season = $2
          AND e.bracket = '1v1'
          AND c.state IS NOT NULL
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = c.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
        ORDER BY rating DESC, wins DESC, c.name ASC
        LIMIT $3`,
      [realm, season, Math.max(1, Math.min(ARENA_SEASON_CANDIDATE_LIMIT, limit))],
    ),
  );
  return res.rows.map((r) => ({
    characterId: Number(r.id),
    accountId: Number(r.account_id),
    name: String(r.name),
    cls: r.class as PlayerClass,
    rating: Number(r.rating),
    wins: Number(r.wins),
    losses: Number(r.losses),
    bouts: Number(r.bouts),
  }));
}

/**
 * The duos that fought a ranked 2v2 bout together in `season`, each with both
 * members' 2v2 rating as it stands now. Ordered by combined rating so a LIMIT
 * keeps the strongest candidates; the actual winner is picked deterministically
 * in JS (pickArenaSeasonChampions) so the tie-break rules stay unit-testable.
 */
export async function arenaSeasonPairCandidates(
  realm: string,
  season: number,
  limit = ARENA_SEASON_CANDIDATE_LIMIT,
): Promise<ArenaSeasonPairCandidate[]> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT p.bouts,
              ca.id AS a_id, ca.account_id AS a_account, ca.name AS a_name,
              ca.class AS a_class, ${RATING_2V2('ca')} AS a_rating,
              cb.id AS b_id, cb.account_id AS b_account, cb.name AS b_name,
              cb.class AS b_class, ${RATING_2V2('cb')} AS b_rating
         FROM arena_season_partners p
         JOIN characters ca ON ca.id = p.character_a
         JOIN characters cb ON cb.id = p.character_b
        WHERE p.realm = $1
          AND p.season = $2
          AND ca.state IS NOT NULL
          AND cb.state IS NOT NULL
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = ca.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = cb.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
        ORDER BY (${RATING_2V2('ca')} + ${RATING_2V2('cb')}) DESC, p.bouts DESC
        LIMIT $3`,
      [realm, season, Math.max(1, Math.min(ARENA_SEASON_CANDIDATE_LIMIT, limit))],
    ),
  );
  return res.rows.map((r) => ({
    a: {
      characterId: Number(r.a_id),
      accountId: Number(r.a_account),
      name: String(r.a_name),
      cls: r.a_class as PlayerClass,
      rating: Number(r.a_rating),
    },
    b: {
      characterId: Number(r.b_id),
      accountId: Number(r.b_account),
      name: String(r.b_name),
      cls: r.b_class as PlayerClass,
      rating: Number(r.b_rating),
    },
    bouts: Number(r.bouts),
  }));
}

/**
 * Commit one season's result: every award row plus the settlement marker, in a
 * single transaction. The marker's primary key is the exactly-once guarantee, so
 * this is safe to call concurrently from several realm processes: the loser of
 * the race rolls back and returns false, having written nothing.
 *
 * A season with no champions at all (an empty ladder) still writes its marker.
 * That is deliberate: an unsettled season would otherwise be re-read forever,
 * and a season nobody contested has no champion to find later either.
 */
export async function commitArenaSeasonSettlement(
  realm: string,
  season: number,
  awards: readonly ArenaSeasonTitleRow[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const marker = await client.query(
      `INSERT INTO arena_season_settlements (realm, season, champions)
       VALUES ($1, $2, $3)
       ON CONFLICT (realm, season) DO NOTHING
       RETURNING season`,
      [realm, season, awards.length],
    );
    if (marker.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    for (const a of awards) {
      await client.query(
        `INSERT INTO arena_season_titles
           (realm, season, bracket, character_id, account_id, deed_id, rating)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (realm, season, bracket, character_id) DO NOTHING`,
        [realm, season, a.bracket, a.characterId, a.accountId, a.deedId, a.rating],
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Every season-title deed id this character has been awarded, on any realm. The
 * join handler passes the result into `Sim.addPlayer`, which grants them through
 * the roster-gated helper. Realm-agnostic on purpose: a title is the character's
 * for good, and a character never moves realms anyway.
 */
export async function arenaSeasonTitleDeedsForCharacter(characterId: number): Promise<string[]> {
  const res = await pool.query(
    'SELECT deed_id FROM arena_season_titles WHERE character_id = $1 ORDER BY season ASC',
    [characterId],
  );
  return res.rows.map((r) => String(r.deed_id));
}

/** The settled champions of this realm, most recent season first (public read). */
export async function arenaSeasonChampions(
  realm: string,
  seasons = 4,
): Promise<ArenaSeasonTitleRow[]> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT t.season, t.bracket, t.character_id, t.account_id, t.deed_id, t.rating,
              c.name, c.class
         FROM arena_season_titles t
         JOIN characters c ON c.id = t.character_id
        WHERE t.realm = $1
          AND t.season > (SELECT COALESCE(MAX(season), 0) - $2 FROM arena_season_settlements
                           WHERE realm = $1)
        ORDER BY t.season DESC, t.bracket ASC, t.rating DESC, c.name ASC`,
      [realm, Math.max(1, Math.min(20, seasons))],
    ),
  );
  return res.rows.map((r) => ({
    season: Number(r.season),
    bracket: String(r.bracket),
    characterId: Number(r.character_id),
    accountId: Number(r.account_id),
    deedId: String(r.deed_id),
    rating: Number(r.rating),
    name: String(r.name),
    cls: r.class as PlayerClass,
  }));
}

/**
 * Retention: drop entrant / partnership rows for seasons that can no longer be
 * settled. Oldest-season-first and LIMIT-bounded, the shape every retention
 * table uses, so a large backlog drains across nightly runs instead of one giant
 * delete. The award ledger and the settlement markers are never pruned (both are
 * tiny and both are load-bearing forever).
 *
 * `keepFromSeason` is exclusive-below: rows for seasons strictly older are
 * eligible. A value at or below 1 prunes nothing, so a misconfiguration fails
 * closed rather than deleting the live season's participation.
 */
export async function pruneArenaSeasonEntrantsBatch(
  keepFromSeason: number,
  limit: number,
): Promise<number> {
  return pruneSeasonScopedBatch('arena_season_entrants', keepFromSeason, limit);
}

/** The partner-table twin of `pruneArenaSeasonEntrantsBatch`. */
export async function pruneArenaSeasonPartnersBatch(
  keepFromSeason: number,
  limit: number,
): Promise<number> {
  return pruneSeasonScopedBatch('arena_season_partners', keepFromSeason, limit);
}

// The table name is a module-private literal from the two callers above, never
// caller input, so it can be interpolated where a bind is not allowed.
async function pruneSeasonScopedBatch(
  table: 'arena_season_entrants' | 'arena_season_partners',
  keepFromSeason: number,
  limit: number,
): Promise<number> {
  if (!Number.isFinite(keepFromSeason) || keepFromSeason <= 1) return 0;
  const res = await pool.query(
    `DELETE FROM ${table}
      WHERE ctid IN (SELECT ctid FROM ${table}
                      WHERE season < $1
                      ORDER BY season ASC
                      LIMIT $2)`,
    [Math.floor(keepFromSeason), Math.max(1, limit)],
  );
  return res.rowCount ?? 0;
}
