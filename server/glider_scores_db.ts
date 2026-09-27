import { gliderScoreboardId, gliderScoreboardInfo } from '../src/sim/glider_scoreboards';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import type {
  WorldQuestScoreQueryable,
  WorldQuestScoreRow,
  WorldQuestScoreWrite,
} from './world_quest_scores_db';

// Additive boot schema. Rollback leaves this unused table intact. Keep forever:
// at most two rows per character and versioned course, never one row per attempt
// or calendar day. Character/account deletion cascades remove their records.
export const GLIDER_SCORES_SCHEMA = `
CREATE TABLE IF NOT EXISTS glider_course_bests (
  realm TEXT NOT NULL,
  board TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reset_day TEXT NOT NULL,
  medal TEXT,
  metric DOUBLE PRECISION NOT NULL CHECK (metric > 0 AND metric < 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, board, character_id)
);
CREATE INDEX IF NOT EXISTS glider_course_bests_rank
  ON glider_course_bests (realm, board, reset_day, metric ASC, updated_at ASC, character_id ASC);
CREATE INDEX IF NOT EXISTS glider_course_bests_character ON glider_course_bests (character_id);
CREATE INDEX IF NOT EXISTS glider_course_bests_account ON glider_course_bests (account_id);
`;

/** Atomically maintain both periods; late queued days cannot replace a newer day. */
export async function upsertGliderScore(
  db: WorldQuestScoreQueryable,
  row: WorldQuestScoreWrite & { resetDay: string },
): Promise<boolean> {
  const info = gliderScoreboardInfo(row.board);
  if (
    !info ||
    info.period !== 'lifetime' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.resetDay) ||
    !Number.isFinite(row.metric) ||
    row.metric <= 0 ||
    row.metric >= 1000
  )
    return false;
  const res = await db.query(
    `INSERT INTO glider_course_bests
      (realm, board, character_id, account_id, reset_day, medal, metric)
     VALUES ($1,$2,$4,$5,$6,$7,$8), ($1,$3,$4,$5,'',$7,$8)
     ON CONFLICT (realm, board, character_id) DO UPDATE SET
       reset_day = EXCLUDED.reset_day, medal = EXCLUDED.medal,
       metric = EXCLUDED.metric, updated_at = now()
     WHERE EXCLUDED.reset_day > glider_course_bests.reset_day
        OR (EXCLUDED.reset_day = glider_course_bests.reset_day
            AND EXCLUDED.metric < glider_course_bests.metric)`,
    [
      row.realm,
      gliderScoreboardId(info.courseId, 'daily'),
      row.board,
      row.characterId,
      row.accountId,
      row.resetDay,
      row.medal,
      row.metric,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function gliderScoreRows(
  db: WorldQuestScoreQueryable,
  realm: string,
  board: string,
  day: string,
  eligibleAccountSql: string,
): Promise<WorldQuestScoreRow[]> {
  const info = gliderScoreboardInfo(board);
  if (!info) return [];
  const res = await db.query(
    `SELECT s.character_id, c.name, s.medal, s.metric
     FROM glider_course_bests s JOIN characters c ON c.id = s.character_id
     JOIN accounts a ON a.id = s.account_id
     WHERE s.realm = $1 AND s.board = $2 AND s.reset_day = $3 AND ${eligibleAccountSql}
     ORDER BY s.metric ASC, s.updated_at ASC, s.character_id ASC LIMIT $4`,
    [realm, board, info.period === 'daily' ? day : '', LEADERBOARD_MAX],
  );
  return res.rows.map((r) => ({
    characterId: Number(r.character_id),
    name: String(r.name),
    medal: r.medal ?? null,
    metric: Number(r.metric),
  }));
}
