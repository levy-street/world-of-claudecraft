// SQL boundary for the deeds domain (the *_db.ts convention: every deeds
// query lives here, parameterized, and no other module carries raw SQL for
// these tables). Backing storage is the character_deeds table plus the
// accounts.deed_broadcasts opt-out column; see the DDL blocks in db.ts SCHEMA.
// The table is an observer-written index of the sim's decisions: inserts are
// idempotent (ON CONFLICT DO NOTHING over UNIQUE (character_id, deed_id)) so
// retro re-emits and crash-replays collapse into no-ops, and nothing here can
// grant, deny, or mutate a deed in gameplay terms.

import { ELIGIBLE_ACCOUNT_SQL, pool } from './db';

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
  // Numerator and denominator share ONE eligibility predicate on TWO axes so
  // they stay mutually consistent: (1) the level floor plus state IS NOT NULL,
  // because counting every earner while the denominator holds only level-floor
  // characters would let a sub-floor earn push earned[deedId] past
  // totalEligible (a >100 percent rarity); and (2) ELIGIBLE_ACCOUNT_SQL,
  // embedded VERBATIM through an `accounts a` join in BOTH arms exactly as
  // every public board read does (db.ts), so a banned or suspended account
  // leaves the numerator and the denominator together and can never inflate a
  // deed's percentage past the eligible population it is measured against.
  const counts = await pool.query(
    `SELECT cd.deed_id, COUNT(*)::int AS earned
       FROM character_deeds cd
       JOIN characters c ON c.id = cd.character_id
       JOIN accounts a ON a.id = cd.account_id
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}
      GROUP BY cd.deed_id`,
    [DEED_RARITY_MIN_LEVEL],
  );
  const eligible = await pool.query(
    `SELECT COUNT(*)::int AS eligible
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
      WHERE c.level >= $1 AND c.state IS NOT NULL AND ${ELIGIBLE_ACCOUNT_SQL}`,
    [DEED_RARITY_MIN_LEVEL],
  );
  const earned: Record<string, number> = {};
  for (const row of counts.rows) earned[row.deed_id] = row.earned;
  return { totalEligible: eligible.rows[0]?.eligible ?? 0, earned };
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

/** Every deed id the account has earned on any character, deduped. Feeds the
 *  Steam reconcile-on-link push (server/steam/mirror.ts): the server store is
 *  canonical and Steam mirrors a subset, so this read is the whole sync. */
export async function earnedDeedIdsForAccount(accountId: number): Promise<string[]> {
  const res = await pool.query(
    'SELECT DISTINCT deed_id FROM character_deeds WHERE account_id = $1',
    [accountId],
  );
  return res.rows.map((row) => String(row.deed_id));
}

/** The broadcast opt-out flag. Missing account reads as TRUE (the column
 *  default): the caller's audience resolution degrades to a no-op anyway. */
export async function getDeedBroadcasts(accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT deed_broadcasts FROM accounts WHERE id = $1', [accountId]);
  return res.rows[0]?.deed_broadcasts ?? true;
}

export async function setDeedBroadcasts(accountId: number, enabled: boolean): Promise<void> {
  await pool.query('UPDATE accounts SET deed_broadcasts = $2 WHERE id = $1', [accountId, enabled]);
}
