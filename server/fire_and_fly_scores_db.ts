import { fireAndFlyScoreValid } from '../src/sim/fire_and_fly_personal_records';
import {
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
} from '../src/sim/fire_and_fly_scoreboards';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import { WORLD_QUEST_MEDAL_RANK } from '../src/sim/world_quest_scoreboards';
import type {
  WorldQuestScoreQueryable,
  WorldQuestScoreRow,
  WorldQuestScoreWrite,
} from './world_quest_scores_db';

// Additive boot schema; a rollback leaves the table unused and intact. Keep forever:
// at most two rows per character and versioned trial (the daily row is replaced by a
// newer day, never one row per run or per day) and one per versioned mission, so the
// table is bounded by characters times scenarios times score versions ever minted. A
// retired version's rows are read by nothing; pruning them is an operator one-off delete,
// never boot DDL. Character and account deletion cascade their rows away. Ranked by
// medal, then points: a separate table because the glider's ranks lowest time first.
export const FIRE_AND_FLY_SCORES_SCHEMA = `
CREATE TABLE IF NOT EXISTS fire_and_fly_trial_bests (
  realm TEXT NOT NULL,
  board TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reset_day TEXT NOT NULL,
  medal TEXT NOT NULL CHECK (medal IN ('gold', 'silver', 'bronze')),
  medal_rank SMALLINT NOT NULL,
  points INT NOT NULL CHECK (points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, board, character_id),
  CHECK (medal_rank = CASE medal WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'bronze' THEN 1 END)
);
CREATE INDEX IF NOT EXISTS fire_and_fly_trial_bests_rank
  ON fire_and_fly_trial_bests
  (realm, board, reset_day, medal_rank DESC, points DESC, updated_at ASC, character_id ASC);
CREATE INDEX IF NOT EXISTS fire_and_fly_trial_bests_character
  ON fire_and_fly_trial_bests (character_id);
CREATE INDEX IF NOT EXISTS fire_and_fly_trial_bests_account
  ON fire_and_fly_trial_bests (account_id);
`;

const UPSERT_BETTER = `ON CONFLICT (realm, board, character_id) DO UPDATE SET
       reset_day = EXCLUDED.reset_day, medal = EXCLUDED.medal,
       medal_rank = EXCLUDED.medal_rank, points = EXCLUDED.points, updated_at = now()
     WHERE EXCLUDED.reset_day > fire_and_fly_trial_bests.reset_day
        OR (EXCLUDED.reset_day = fire_and_fly_trial_bests.reset_day
            AND (EXCLUDED.medal_rank, EXCLUDED.points)
              > (fire_and_fly_trial_bests.medal_rank, fire_and_fly_trial_bests.points))`;

/**
 * One run onto both of its trial's rows, or a mission's one lifetime row; a late
 * queued day never replaces a newer one.
 */
export async function upsertFireAndFlyScore(
  db: WorldQuestScoreQueryable,
  row: WorldQuestScoreWrite & { resetDay: string },
): Promise<boolean> {
  const info = fireAndFlyScoreboardInfo(row.board);
  const daily = info && fireAndFlyScoreboardId(info.scenarioId, 'daily');
  if (
    info?.period !== 'lifetime' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.resetDay) ||
    !row.medal ||
    !fireAndFlyScoreValid(row.medal, row.metric)
  )
    return false;
  const rank = WORLD_QUEST_MEDAL_RANK[row.medal];
  const res = daily
    ? await db.query(
        `INSERT INTO fire_and_fly_trial_bests
      (realm, board, character_id, account_id, reset_day, medal, medal_rank, points)
     VALUES ($1,$2,$4,$5,$6,$7,$8,$9), ($1,$3,$4,$5,'',$7,$8,$9)
     ${UPSERT_BETTER}`,
        [
          row.realm,
          daily,
          row.board,
          row.characterId,
          row.accountId,
          row.resetDay,
          row.medal,
          rank,
          row.metric,
        ],
      )
    : await db.query(
        `INSERT INTO fire_and_fly_trial_bests
      (realm, board, character_id, account_id, reset_day, medal, medal_rank, points)
     VALUES ($1,$2,$3,$4,'',$5,$6,$7)
     ${UPSERT_BETTER}`,
        [row.realm, row.board, row.characterId, row.accountId, row.medal, rank, row.metric],
      );
  return (res.rowCount ?? 0) > 0;
}

/** The ranked ladder of one trial board: best medal, then most points, earlier holder first. */
export async function fireAndFlyScoreRows(
  db: WorldQuestScoreQueryable,
  realm: string,
  board: string,
  day: string,
  eligibleAccountSql: string,
): Promise<WorldQuestScoreRow[]> {
  const info = fireAndFlyScoreboardInfo(board);
  if (!info) return [];
  const res = await db.query(
    `SELECT s.character_id, c.name, s.medal, s.points
     FROM fire_and_fly_trial_bests s JOIN characters c ON c.id = s.character_id
     JOIN accounts a ON a.id = s.account_id
     WHERE s.realm = $1 AND s.board = $2 AND s.reset_day = $3 AND ${eligibleAccountSql}
     ORDER BY s.medal_rank DESC, s.points DESC, s.updated_at ASC, s.character_id ASC
     LIMIT $4`,
    [realm, board, info.period === 'daily' ? day : '', LEADERBOARD_MAX],
  );
  return res.rows.map((r) => ({
    characterId: Number(r.character_id),
    name: String(r.name),
    medal: r.medal,
    metric: Number(r.points),
  }));
}
