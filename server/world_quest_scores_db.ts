// SQL boundary for the world-quest scoreboards (the *_db.ts convention: every
// query for the table lives here, parameterized, and no other module carries
// raw SQL for it). One row per (realm, board, character): the character's BEST
// finished attempt on that ladder, so the table is bounded by characters times
// boards and never grows per attempt. A worse attempt is a no-op at the
// database (the ON CONFLICT ... WHERE guard below), which is what lets the
// game loop fire the write without reading first.
//
// Observer-written: the sim decides the medal and the number, the server only
// mirrors them (nothing here can grant or deny anything in gameplay terms).
// Retention: rows also age out on updated_at through the nightly sweep
// (WORLD_QUEST_SCORES_RETENTION_DAYS in server/http/config.ts; an EXPLICIT 0
// keeps forever), so a ladder never shows a character last seen years ago.
// No './db' import: db.ts applies the schema at boot, so this module takes the
// pool as a parameter (the progress_events_db shape) to keep the graph acyclic.
import type { Pool, QueryResult } from 'pg';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import type { WorldQuestMedal } from '../src/sim/world_quest_scoreboards';
import { GLIDER_SCORES_SCHEMA } from './glider_scores_db';

// Both FKs cascade (a deleted character or account takes its rows along; a
// ladder never shows a ghost), and each carries its own index so the RI probe
// on a delete never scans the table. The board index serves the ranked read
// as one ordered range scan per (realm, board) with the full ORDER BY (the
// trailing character_id is the deterministic tie-break), and the updated_at
// index serves the prune. In-transaction boot index builds are acceptable
// only while the table is young and sparse; an index added LATER to a grown
// world_quest_scores belongs in the post-commit CONCURRENTLY arm
// (server/concurrent_indexes.ts), never boot DDL.
export const WORLD_QUEST_SCORES_SCHEMA = `
CREATE TABLE IF NOT EXISTS world_quest_scores (
  realm TEXT NOT NULL,
  board TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  medal TEXT,
  metric DOUBLE PRECISION NOT NULL,
  sort_key DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, board, character_id)
);
CREATE INDEX IF NOT EXISTS world_quest_scores_board
  ON world_quest_scores (realm, board, sort_key DESC, updated_at ASC, character_id ASC);
CREATE INDEX IF NOT EXISTS world_quest_scores_character ON world_quest_scores (character_id);
CREATE INDEX IF NOT EXISTS world_quest_scores_account ON world_quest_scores (account_id);
CREATE INDEX IF NOT EXISTS world_quest_scores_updated ON world_quest_scores (updated_at);
${GLIDER_SCORES_SCHEMA}
`;

export interface WorldQuestScoreWrite {
  realm: string;
  board: string;
  characterId: number;
  accountId: number;
  medal: WorldQuestMedal | null;
  metric: number;
  sortKey: number;
}

/** The query surface both a Pool and a runWithStatementTimeout query satisfy. */
export interface WorldQuestScoreQueryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export interface WorldQuestScoreRow {
  characterId: number;
  name: string;
  medal: WorldQuestMedal | null;
  metric: number;
}

/** Insert or improve the character's row; returns true when the row changed
 *  (a first attempt or a better one), false when the standing best held. */
export async function upsertWorldQuestScore(
  db: WorldQuestScoreQueryable,
  row: WorldQuestScoreWrite,
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO world_quest_scores
       (realm, board, character_id, account_id, medal, metric, sort_key, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (realm, board, character_id) DO UPDATE
       SET medal = EXCLUDED.medal,
           metric = EXCLUDED.metric,
           sort_key = EXCLUDED.sort_key,
           account_id = EXCLUDED.account_id,
           updated_at = now()
       WHERE EXCLUDED.sort_key > world_quest_scores.sort_key`,
    [row.realm, row.board, row.characterId, row.accountId, row.medal, row.metric, row.sortKey],
  );
  return (res.rowCount ?? 0) > 0;
}

/** The full ranked ladder for one board (the one query a cache refresh runs):
 *  best first, earlier holder first on a tie, capped at the exposed depth.
 *  `eligibleAccountSql` is db.ts ELIGIBLE_ACCOUNT_SQL over alias `a`, so
 *  banned and suspended accounts drop off every board the moment moderation
 *  lands (the daily-rewards ladder contract). */
export async function worldQuestScoreboardRows(
  db: WorldQuestScoreQueryable,
  realm: string,
  board: string,
  eligibleAccountSql: string,
): Promise<WorldQuestScoreRow[]> {
  const res = await db.query(
    `SELECT s.character_id, c.name, s.medal, s.metric
       FROM world_quest_scores s
       JOIN characters c ON c.id = s.character_id
       JOIN accounts a ON a.id = s.account_id
      WHERE s.realm = $1 AND s.board = $2 AND ${eligibleAccountSql}
      ORDER BY s.sort_key DESC, s.updated_at ASC, s.character_id ASC
      LIMIT $3`,
    [realm, board, LEADERBOARD_MAX],
  );
  return res.rows.map((r) => ({
    characterId: Number(r.character_id),
    name: String(r.name),
    medal: (r.medal ?? null) as WorldQuestMedal | null,
    metric: Number(r.metric),
  }));
}

/** Bounded prune primitive for the nightly retention sweep (the
 *  pruneChatLogsBatch contract): 0 or negative days keeps forever; the caller
 *  owns cadence, budget, and batching. The inner pick rides the updated_at
 *  index and the outer delete probes by ctid (a Tid Scan), so a batch never
 *  rescans the table the way a composite-key IN (...) subplan would. */
export async function pruneWorldQuestScoresBatch(
  db: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(
    `DELETE FROM world_quest_scores
      WHERE ctid IN (
        SELECT ctid FROM world_quest_scores
         WHERE updated_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY updated_at ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
