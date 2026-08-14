// SQL boundary for the progression analytics event logs (the *_db.ts
// convention: every query for these tables lives here, parameterized, and no
// other module carries raw SQL for them). Two append-only tables:
//
// - level_up_events: one row per player level-up, every level. The deed
//   milestones (character_deeds) only timestamp levels 2/5/10/15/20, so this
//   is the full per-level friction map the UA cohort analysis needs (time in
//   level, where leveling stalls between the milestone deeds).
// - ftue_events: first-time-user-experience events (quest accepted, quest
//   completed, player death) recorded only while the character is inside the
//   FTUE level window, so the table answers "what did a churned level-1
//   player actually touch" without growing per veteran action.
//
// Both are observer-written analytics indexes of sim decisions, never an
// authority: nothing here can grant or deny anything in gameplay terms.
// Inserts are fire-and-forget from the game loop (see progress_events.ts);
// a lost row costs a data point, never gameplay. Retention: both tables grow
// per event, so each registers a bounded prune primitive with the nightly
// sweep (LEVEL_UP_EVENTS_RETENTION_DAYS / FTUE_EVENTS_RETENTION_DAYS in
// server/http/config.ts; UNSET resolves to each key's default there, 365 and
// 90 days respectively, and only an EXPLICIT 0 keeps forever).
//
// Abuse bound: quest rows are first-touch-unique per (character, kind, quest)
// via the partial unique index below plus ON CONFLICT DO NOTHING, so the
// accept/abandon loop a client can drive (the same abuse shape the
// starter-tool mint guard in quest_commands.ts documents) collapses into one
// row. Death rows carry no quest id; their bound is the per-character cap in
// progress_events.ts.

// No './db' import: db.ts applies PROGRESS_EVENTS_SCHEMA at boot, so this
// module takes the pool as a parameter (the unstuck_db shape) to keep the
// import graph acyclic.
import type { Pool } from 'pg';

/** Record FTUE events only while the character is at or below this level.
 *  Bounds table growth to the new-player window the UA analysis reads. */
export const FTUE_MAX_LEVEL = 10;

/** The closed FTUE event vocabulary, enforced by insertFtueEvent below.
 *  Deliberately NOT mirrored as a DB CHECK constraint: CREATE TABLE IF NOT
 *  EXISTS never revises a constraint on a deployed database, so a widened
 *  vocabulary would 23514 on every insert of the new kind, silently, because
 *  the writes are fire-and-forget. The TS guard is the one source of truth. */
export const FTUE_EVENT_KINDS = ['quest_accepted', 'quest_done', 'death'] as const;
export type FtueEventKind = (typeof FTUE_EVENT_KINDS)[number];

// The two nullable FK columns use ON DELETE SET NULL so an account or
// character delete never blocks on the analytics log, and aggregate reads
// keep their rows. Partial indexes keep the RI lookup on delete cheap,
// mirroring unstuck_reports, INCLUDING that comment's caveat: in-transaction
// boot index builds are acceptable only while the table is young and sparse;
// an index added LATER to a grown ftue_events belongs in the post-commit
// CONCURRENTLY arm (server/concurrent_indexes.ts), never boot DDL.
export const PROGRESS_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS level_up_events (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  level INT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS level_up_events_earned
  ON level_up_events(earned_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS level_up_events_level_earned
  ON level_up_events(level, earned_at);
CREATE INDEX IF NOT EXISTS level_up_events_account
  ON level_up_events(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS level_up_events_character
  ON level_up_events(character_id) WHERE character_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ftue_events (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  quest_id TEXT,
  level INT NOT NULL DEFAULT 1,
  zone TEXT,
  killer TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ftue_events_occurred
  ON ftue_events(occurred_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS ftue_events_kind_occurred
  ON ftue_events(kind, occurred_at);
CREATE INDEX IF NOT EXISTS ftue_events_account
  ON ftue_events(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ftue_events_character
  ON ftue_events(character_id) WHERE character_id IS NOT NULL;
-- First-touch uniqueness for quest events: one row per (character, kind,
-- quest), which is both the analytics semantic the FTUE autopsy needs and the
-- bound that collapses a client-driven accept/abandon loop into a no-op
-- (paired with ON CONFLICT DO NOTHING in insertFtueEvent).
CREATE UNIQUE INDEX IF NOT EXISTS ftue_events_first_touch
  ON ftue_events(character_id, kind, quest_id) WHERE quest_id IS NOT NULL;
`;

export interface LevelUpEventRow {
  realm: string;
  characterId: number;
  accountId: number;
  level: number;
}

export interface FtueEventRow {
  realm: string;
  characterId: number;
  accountId: number;
  kind: FtueEventKind;
  questId?: string | null;
  level: number;
  zone?: string | null;
  killer?: string | null;
}

function positiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function boundedLevel(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new TypeError('level must be a safe integer between 1 and 1000');
  }
  return value;
}

function nullableText(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null || value.length === 0) return null;
  return value.slice(0, maxLength);
}

/** Record one level-up. Append-only; no conflict target on purpose (a level
 *  can legitimately repeat across characters, and the observer never
 *  replays). */
export async function insertLevelUpEvent(db: Pool, row: LevelUpEventRow): Promise<void> {
  await db.query(
    `INSERT INTO level_up_events (realm, character_id, account_id, level)
     VALUES ($1, $2, $3, $4)`,
    [
      row.realm,
      positiveId(row.characterId, 'characterId'),
      positiveId(row.accountId, 'accountId'),
      boundedLevel(row.level),
    ],
  );
}

/** Record one FTUE event. The caller (progress_events.ts) owns the
 *  FTUE_MAX_LEVEL gate and the death cap; quest events are first-touch
 *  idempotent here (ON CONFLICT over the partial unique index), so replays
 *  and accept/abandon loops collapse into no-ops. */
export async function insertFtueEvent(db: Pool, row: FtueEventRow): Promise<void> {
  if (!FTUE_EVENT_KINDS.includes(row.kind)) {
    throw new TypeError('kind must be a known FTUE event kind');
  }
  await db.query(
    `INSERT INTO ftue_events (realm, character_id, account_id, kind, quest_id, level, zone, killer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (character_id, kind, quest_id) WHERE quest_id IS NOT NULL DO NOTHING`,
    [
      row.realm,
      positiveId(row.characterId, 'characterId'),
      positiveId(row.accountId, 'accountId'),
      row.kind,
      nullableText(row.questId, 128),
      boundedLevel(row.level),
      nullableText(row.zone, 64),
      nullableText(row.killer, 128),
    ],
  );
}

/**
 * One bounded retention delete per table, the shared-sweep primitive shape
 * (pruneChatLogsBatch contract): 0 or negative days keeps forever, the caller
 * (the daily retention sweep in server/main.ts) owns cadence, budget, and
 * batching. ORDER BY rides the (earned_at/occurred_at ASC, id ASC) indexes
 * above, so the batch never plans a full sort.
 */
export async function pruneLevelUpEventsBatch(
  db: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(
    `DELETE FROM level_up_events
      WHERE id IN (
        SELECT id FROM level_up_events
         WHERE earned_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY earned_at ASC, id ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

export async function pruneFtueEventsBatch(
  db: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(
    `DELETE FROM ftue_events
      WHERE id IN (
        SELECT id FROM ftue_events
         WHERE occurred_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY occurred_at ASC, id ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
