import { fireAndFlyMasteryValid } from '../src/sim/fire_and_fly_personal_records';
import { FIRE_AND_FLY_MASTERY_BOARD_ID } from '../src/sim/fire_and_fly_scoreboards';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import type { WorldQuestScoreQueryable, WorldQuestScoreRow } from './world_quest_scores_db';

// Additive boot schema; a rollback leaves the table unused and intact. Keep forever:
// one row per character and Mastery version (the row is the character's whole Mastery,
// replaced in place, never one row per run), so the table is bounded by characters
// times the Mastery versions ever minted. A retired version's rows are read by nothing;
// pruning them is an operator one-off delete, never boot DDL. Character and account
// deletion cascade their rows away. A sibling of fire_and_fly_trial_bests because a
// star sum is not a medal: that table ties its rank to one medal by constraint. The
// star ceiling is checked by the observer, not here, so a later mission's larger sum
// never trips a constraint an older boot created.
export const FIRE_AND_FLY_MASTERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS fire_and_fly_mastery (
  realm TEXT NOT NULL,
  board TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars >= 0),
  points INT NOT NULL CHECK (points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, board, character_id)
);
CREATE INDEX IF NOT EXISTS fire_and_fly_mastery_rank
  ON fire_and_fly_mastery
  (realm, board, stars DESC, points DESC, updated_at ASC, character_id ASC);
CREATE INDEX IF NOT EXISTS fire_and_fly_mastery_character
  ON fire_and_fly_mastery (character_id);
CREATE INDEX IF NOT EXISTS fire_and_fly_mastery_account
  ON fire_and_fly_mastery (account_id);
`;

export interface FireAndFlyMasteryWrite {
  realm: string;
  board: string;
  characterId: number;
  accountId: number;
  stars: number;
  points: number;
}

/**
 * The character's Mastery row, only ever rising: the row-wise comparison ranks more
 * stars first, then more points, so an equal or lower row (a late queued write) is a
 * no-op. Returns true when the row changed.
 */
export async function upsertFireAndFlyMastery(
  db: WorldQuestScoreQueryable,
  row: FireAndFlyMasteryWrite,
): Promise<boolean> {
  if (row.board !== FIRE_AND_FLY_MASTERY_BOARD_ID || !fireAndFlyMasteryValid(row.stars, row.points))
    return false;
  const res = await db.query(
    `INSERT INTO fire_and_fly_mastery (realm, board, character_id, account_id, stars, points)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (realm, board, character_id) DO UPDATE SET
       stars = EXCLUDED.stars, points = EXCLUDED.points, updated_at = now()
     WHERE (EXCLUDED.stars, EXCLUDED.points)
       > (fire_and_fly_mastery.stars, fire_and_fly_mastery.points)`,
    [row.realm, row.board, row.characterId, row.accountId, row.stars, row.points],
  );
  return (res.rowCount ?? 0) > 0;
}

/** The ranked Mastery ladder: most stars, then most points, earlier holder first. */
export async function fireAndFlyMasteryRows(
  db: WorldQuestScoreQueryable,
  realm: string,
  board: string,
  _day: string,
  eligibleAccountSql: string,
): Promise<WorldQuestScoreRow[]> {
  if (board !== FIRE_AND_FLY_MASTERY_BOARD_ID) return [];
  const res = await db.query(
    `SELECT s.character_id, c.name, s.stars, s.points
     FROM fire_and_fly_mastery s JOIN characters c ON c.id = s.character_id
     JOIN accounts a ON a.id = s.account_id
     WHERE s.realm = $1 AND s.board = $2 AND ${eligibleAccountSql}
     ORDER BY s.stars DESC, s.points DESC, s.updated_at ASC, s.character_id ASC
     LIMIT $3`,
    [realm, board, LEADERBOARD_MAX],
  );
  return res.rows.map((r) => ({
    characterId: Number(r.character_id),
    name: String(r.name),
    medal: null,
    metric: Number(r.points),
    stars: Number(r.stars),
  }));
}
