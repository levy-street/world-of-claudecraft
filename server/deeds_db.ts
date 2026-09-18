// SQL boundary for the deeds domain (the *_db.ts convention: every deeds
// query lives here, parameterized, and no other module carries raw SQL for
// these tables). Backing storage is the character_deeds table plus the
// accounts.deed_broadcasts opt-out column; see the DDL blocks in db.ts SCHEMA.
// The table is an observer-written index of the sim's decisions: inserts are
// idempotent (ON CONFLICT DO NOTHING over UNIQUE (character_id, deed_id)) so
// retro re-emits and crash-replays collapse into no-ops, and nothing here can
// grant, deny, or mutate a deed in gameplay terms.

import {
  DB_HEAVY_STATEMENT_TIMEOUT_MS,
  ELIGIBLE_ACCOUNT_SQL,
  pool,
  runWithStatementTimeout,
} from './db';

/** One earned-deed record. realm is passed explicitly on every insert (the
 *  table carries no DEFAULT; the interpolated-default pattern is
 *  last-boot-wins across realm processes). */
export interface CharacterDeedRow {
  realm: string;
  characterId: number;
  accountId: number;
  deedId: string;
}

/** Record one earned deed. Idempotent: a replay of the same (character, deed)
 *  pair is a no-op, which is what makes the fire-and-forget observer safe. */
export async function insertCharacterDeed(row: CharacterDeedRow): Promise<void> {
  await pool.query(
    `INSERT INTO character_deeds (realm, character_id, account_id, deed_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (character_id, deed_id) DO NOTHING`,
    [row.realm, row.characterId, row.accountId, row.deedId],
  );
}

/** Backfill a character's whole earned-deed set into the index in ONE
 *  statement, same columns and explicit-realm handling as insertCharacterDeed.
 *  The login reconcile replays deedsEarned (the authoritative state blob) so a
 *  row a transient per-unlock insert failure lost, and which the sim never
 *  re-emits, is re-created; ON CONFLICT DO NOTHING collapses the rows that
 *  already landed into no-ops, so the common case (nothing drifted) touches no
 *  data. Empty set is a caller-side no-op (it never reaches SQL). deedIds is a
 *  fixed-length text[] bind, never interpolated. */
export async function insertCharacterDeeds(
  who: { realm: string; characterId: number; accountId: number },
  deedIds: readonly string[],
): Promise<void> {
  if (deedIds.length === 0) return;
  await pool.query(
    `INSERT INTO character_deeds (realm, character_id, account_id, deed_id)
     SELECT $1, $2, $3, unnest($4::text[])
     ON CONFLICT (character_id, deed_id) DO NOTHING`,
    [who.realm, who.characterId, who.accountId, [...deedIds]],
  );
}

/** The rarity aggregate the public endpoint serves: how many characters have
 *  earned each deed (zero-earn deeds absent) over the eligible population.
 *  GLOBAL (cross-realm) by design: at current population, per-realm
 *  percentages would be noise. */
export interface DeedRarityAggregate {
  totalEligible: number;
  earned: Record<string, number>;
}

/** Level 5 is the eligibility floor for the rarity denominator: below it a
 *  character is a fresh roll (or a bot probe) that would dilute every
 *  percentage; state IS NOT NULL skips rows that never finished creation. */
export const DEED_RARITY_MIN_LEVEL = 5;

export async function deedRarityCounts(): Promise<DeedRarityAggregate> {
  // Two full-table aggregate scans over character_deeds / characters, so run both
  // in ONE raised-timeout transaction: a large table can legitimately exceed the
  // default statement timeout. The shared transaction raises the allowance once
  // and reuses one client; it does NOT give the two scans a single snapshot
  // (READ COMMITTED, see the runWithStatementTimeout header), so an earn
  // committing between them can skew a percentage by one refresh cycle. The
  // shared eligibility predicate below is what keeps the pair mutually
  // consistent; the read is TTL-cached and cosmetic, so one-cycle skew is fine.
  //
  // Numerator and denominator share ONE eligibility predicate on TWO axes so
  // they stay mutually consistent: (1) the level floor plus state IS NOT NULL,
  // because counting every earner while the denominator holds only level-floor
  // characters would let a sub-floor earn push earned[deedId] past
  // totalEligible (a >100 percent rarity); and (2) ELIGIBLE_ACCOUNT_SQL,
  // embedded VERBATIM through an `accounts a` join in BOTH arms exactly as
  // every public board read does (db.ts), so a banned or suspended account
  // leaves the numerator and the denominator together and can never inflate a
  // deed's percentage past the eligible population it is measured against.
  return runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, async (query) => {
    const counts = await query(
      `SELECT cd.deed_id, COUNT(*)::int AS earned
       FROM character_deeds cd
       JOIN characters c ON c.id = cd.character_id
       JOIN accounts a ON a.id = cd.account_id
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}
      GROUP BY cd.deed_id`,
      [DEED_RARITY_MIN_LEVEL],
    );
    const eligible = await query(
      `SELECT COUNT(*)::int AS eligible
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}`,
      [DEED_RARITY_MIN_LEVEL],
    );
    const earned: Record<string, number> = {};
    for (const row of counts.rows) earned[row.deed_id] = row.earned;
    return { totalEligible: eligible.rows[0]?.eligible ?? 0, earned };
  });
}

/** One row of the sheet's recent-deeds strip (earnedAt as an ISO string). */
export interface RecentDeedRow {
  deedId: string;
  earnedAt: string;
}

/** The most recent earned deeds for one character, newest first (id breaks
 *  same-timestamp ties so a retro burst lists in insert order). */
export async function recentDeedsForCharacter(
  characterId: number,
  limit: number,
): Promise<RecentDeedRow[]> {
  const res = await pool.query(
    `SELECT deed_id, earned_at FROM character_deeds
     WHERE character_id = $1
     ORDER BY earned_at DESC, id DESC
     LIMIT $2`,
    [characterId, limit],
  );
  return res.rows.map((row) => ({
    deedId: row.deed_id,
    earnedAt: row.earned_at instanceof Date ? row.earned_at.toISOString() : String(row.earned_at),
  }));
}

// In-flight collapse for the earned-deeds roll-up: the Steam and Epic mirrors
// each call this read independently (D21 keeps the observers independent), and
// on the login reconcile both fire within the same continuation, so without
// the collapse one join issues the identical SELECT twice. Concurrent callers
// share one promise; the entry is dropped on settle, so nothing is ever served
// stale and a rejection is never memoized.
const earnedDeedIdsInFlight = new Map<number, Promise<string[]>>();

/** Every deed id the account has earned on any character, deduped. Feeds the
 *  storefront reconcile pushes (server/steam/mirror.ts, server/epic/mirror.ts):
 *  the server store is canonical and each storefront mirrors a subset, so this
 *  read is the whole sync. Concurrent identical reads collapse to one query. */
export function earnedDeedIdsForAccount(accountId: number): Promise<string[]> {
  const inFlight = earnedDeedIdsInFlight.get(accountId);
  if (inFlight !== undefined) return inFlight;
  const read = pool
    .query('SELECT DISTINCT deed_id FROM character_deeds WHERE account_id = $1', [accountId])
    .then((res) => res.rows.map((row: { deed_id: unknown }) => String(row.deed_id)))
    .finally(() => {
      earnedDeedIdsInFlight.delete(accountId);
    });
  earnedDeedIdsInFlight.set(accountId, read);
  return read;
}

/** The broadcast opt-out flag. A missing account row reads as TRUE (the column
 *  is NOT NULL DEFAULT TRUE, so a row that EXISTS can never read null). Both
 *  gated callers publish on a true read: Game.fanOutDeedUnlock (the guild and
 *  follower marquee plus the Discord feed card) and the masterwork arm of the
 *  event loop (a Discord card only), so the fail-open is no longer a no-op the
 *  way it was before the feed existed. It stays acceptable because the arm is
 *  practically unreachable: every caller holds a live session, whose account
 *  row exists by construction. server/deeds.ts reads the same flag for the
 *  settings toggle. */
export async function getDeedBroadcasts(accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT deed_broadcasts FROM accounts WHERE id = $1', [accountId]);
  return res.rows[0]?.deed_broadcasts ?? true;
}

export async function setDeedBroadcasts(accountId: number, enabled: boolean): Promise<void> {
  await pool.query('UPDATE accounts SET deed_broadcasts = $2 WHERE id = $1', [accountId, enabled]);
}

// The character_deeds DDL, the deeds domain's own *_SCHEMA (moved whole out of
// the core SCHEMA string at the monolith ratchet). FK-references characters(id)
// and accounts(id), so ensureSchema (server/db.ts) applies it after SCHEMA, in
// the same advisory-locked boot transaction, unconditionally (idempotent).
export const DEEDS_SCHEMA = `
-- Earned-deed records: one row per (character, deed), written fire-and-forget
-- off the game loop by server/deeds_records.ts, an OBSERVER of the sim's
-- deedUnlocked events. The characters.state blob stays the gameplay source of
-- truth; this table only indexes it for rarity aggregates, account roll-ups,
-- and sheet reads, and no server path grants or revokes a deed. realm carries
-- no DEFAULT deliberately: the interpolated-default pattern is last-boot-wins
-- across realm processes, so every insert passes realm explicitly. account_id
-- is a snapshot of the owner at unlock time (a future character-transfer
-- feature must update or re-derive it). earned_at is the server clock (the
-- sim's utcDay stamp lives in the state blob and is not duplicated here).
-- UNIQUE (character_id, deed_id) is the idempotence backbone: retro re-emits
-- and crash-replays collapse into no-ops.
CREATE TABLE IF NOT EXISTS character_deeds (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deed_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, deed_id)
);
-- character_deeds_deed (a lone index on deed_id) was retired: no query seeks
-- by deed_id. insertCharacterDeed's ON CONFLICT rides the UNIQUE (character_id,
-- deed_id) index, deedRarityCounts groups by deed_id but cannot seek on it,
-- and the board and account reads use their own indexes below, so the index
-- was pure write amplification. The statement below removes it idempotently to
-- converge databases that booted the earlier schema; a no-op where it never
-- existed.
DROP INDEX IF EXISTS character_deeds_deed;
-- Per-account roll-up reads: earnedDeedIdsForAccount (server/deeds_db.ts,
-- the Steam reconcile-on-link push) filters on account_id through this
-- index. The Renown board's deedsBoardRanked read stays a full-table hash
-- aggregation (cached in main.ts) and does not use it.
CREATE INDEX IF NOT EXISTS character_deeds_account ON character_deeds(account_id);
CREATE INDEX IF NOT EXISTS character_deeds_character_earned
  ON character_deeds(character_id, earned_at DESC);
`;
