// Persisted account suspicion flags: the flag store behind the admin
// dashboard's Flagged workflow. Rows are minted by the emitters wired in
// server/suspicion_flags.ts (bot-detector confirmations, registration bursts;
// the economy-watch detectors land on the same seam later) and worked by
// admins through the new / under_review / cleared / actioned workflow. SQL
// only; the state machine and the emitter logic live in suspicion_flags.ts.

import { pool, runWithStatementTimeout } from './db';
import {
  allowedSuspicionFlagTransition,
  SUSPICION_FLAG_ACTIVE_STATUSES,
  type SuspicionFlagSeverity,
  type SuspicionFlagSource,
  type SuspicionFlagStatus,
} from './suspicion_flag_workflow';

// Both tables are audit history and are deliberately KEPT FOREVER (no
// retention registration): a cleared or actioned flag must remain visible on
// the account's history, and the events table is the workflow's audit trail.
// Growth is bounded by the emitters' dedupe (one ACTIVE flag per
// account/source/kind; re-detections bump the existing row) and by flag-count
// per account staying small in practice.
export const SUSPICION_FLAGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_suspicion_flags (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  related_account_ids INT[],
  status TEXT NOT NULL DEFAULT 'new',
  copper_at_flag BIGINT,
  occurrences INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The emitter dedupe target: at most one ACTIVE flag per account/source/kind,
-- so re-detections bump occurrences instead of stacking rows, while cleared
-- and actioned flags stay behind as history.
CREATE UNIQUE INDEX IF NOT EXISTS suspicion_flags_active_dedupe
  ON account_suspicion_flags (account_id, source, kind)
  WHERE status IN ('new', 'under_review');
CREATE INDEX IF NOT EXISTS suspicion_flags_status_seen
  ON account_suspicion_flags (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS suspicion_flags_account
  ON account_suspicion_flags (account_id);

CREATE TABLE IF NOT EXISTS account_suspicion_flag_events (
  id BIGSERIAL PRIMARY KEY,
  flag_id BIGINT NOT NULL REFERENCES account_suspicion_flags(id) ON DELETE CASCADE,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suspicion_flag_events_flag
  ON account_suspicion_flag_events (flag_id, id);
`;

export const SUSPICION_FLAG_NOTE_MAX = 2000;
// Sized for the detector's full evidence summary (the automated report text it
// mirrors), not a one-line label. The detector caps its summary at the same
// length on its side; a larger summary would be truncated here.
export const SUSPICION_FLAG_DETAILS_MAX = 2000;

// Flag writes are single-row, index-served statements whose intended cost is
// milliseconds; on the pool default a blocked write (an admin holding the row
// lock) would pin a pooled client for the full 15 s, at the head of the
// emitters' serialized queue. Same reasoning as GUILD_BANK_LOG_TIMEOUT_MS.
export const SUSPICION_FLAG_WRITE_TIMEOUT_MS = 2_000;

// Postgres unique_violation: the partial dedupe index is the real arbiter of
// "one active flag per account/source/kind" when two writers race.
const UNIQUE_VIOLATION = '23505';
export const SUSPICION_FLAG_RELATED_MAX = 50;

export interface SuspicionFlagUpsertInput {
  accountId: number;
  source: SuspicionFlagSource;
  kind: string;
  severity: SuspicionFlagSeverity;
  details: string;
  relatedAccountIds?: readonly number[];
}

/**
 * Mint or refresh a flag. A conflicting ACTIVE flag (same account/source/kind)
 * bumps occurrences and last_seen, keeps the higher severity, and refreshes
 * details; copper_at_flag is captured from the materialised wealth row on
 * first insert only, so "gold trend since flagging" always measures from the
 * moment the account was first flagged.
 */
export async function upsertSuspicionFlag(input: SuspicionFlagUpsertInput): Promise<void> {
  const related = (input.relatedAccountIds ?? [])
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== input.accountId)
    .slice(0, SUSPICION_FLAG_RELATED_MAX);
  await runWithStatementTimeout(SUSPICION_FLAG_WRITE_TIMEOUT_MS, (query) =>
    query(
      `INSERT INTO account_suspicion_flags
       (account_id, source, kind, severity, details, related_account_ids, copper_at_flag)
     VALUES ($1, $2, $3, $4, $5, $6,
             (SELECT total_copper FROM account_wealth WHERE account_id = $1))
     ON CONFLICT (account_id, source, kind) WHERE status IN ('new', 'under_review')
     DO UPDATE SET
       occurrences = account_suspicion_flags.occurrences + 1,
       last_seen_at = now(),
       updated_at = now(),
       details = EXCLUDED.details,
       related_account_ids = COALESCE(EXCLUDED.related_account_ids,
                                      account_suspicion_flags.related_account_ids),
       severity = CASE
         WHEN account_suspicion_flags.severity = 'high' OR EXCLUDED.severity = 'high' THEN 'high'
         WHEN account_suspicion_flags.severity = 'medium' OR EXCLUDED.severity = 'medium'
           THEN 'medium'
         ELSE 'low'
       END`,
      [
        input.accountId,
        input.source,
        input.kind,
        input.severity,
        input.details.slice(0, SUSPICION_FLAG_DETAILS_MAX),
        related.length > 0 ? related : null,
      ],
    ),
  );
}

export interface SuspicionFlagDetailsInput {
  accountId: number;
  source: SuspicionFlagSource;
  kind: string;
  details: string;
}

/**
 * Replace the details of the account's ACTIVE flag (same account/source/kind)
 * without counting an occurrence: the case an emitter already recorded grew
 * new evidence. No active flag (an admin cleared or actioned it) means nothing
 * is written; only a fresh record can bring the account back. Resolves to
 * whether an active flag was there to refresh.
 */
export async function refreshSuspicionFlagDetails(
  input: SuspicionFlagDetailsInput,
): Promise<boolean> {
  const res = await runWithStatementTimeout(SUSPICION_FLAG_WRITE_TIMEOUT_MS, (query) =>
    query(
      `UPDATE account_suspicion_flags
       SET details = $4, last_seen_at = now(), updated_at = now()
       WHERE account_id = $1 AND source = $2 AND kind = $3
         AND status IN ('new', 'under_review')`,
      [
        input.accountId,
        input.source,
        input.kind,
        input.details.slice(0, SUSPICION_FLAG_DETAILS_MAX),
      ],
    ),
  );
  return (res.rowCount ?? 0) > 0;
}

export interface RelatedAccountRef {
  accountId: number;
  username: string | null;
}

export interface SuspicionFlagRow {
  id: number;
  accountId: number;
  username: string;
  bannedAt: string | null;
  suspendedUntil: string | null;
  source: SuspicionFlagSource;
  kind: string;
  severity: SuspicionFlagSeverity;
  details: string;
  relatedAccounts: RelatedAccountRef[];
  status: SuspicionFlagStatus;
  copperAtFlag: number | null;
  copperNow: number | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

const FLAG_ROW_SQL = `
  SELECT f.id, f.account_id, a.username, a.banned_at, a.suspended_until,
         f.source, f.kind, f.severity, f.details, f.related_account_ids,
         f.status, f.copper_at_flag, f.occurrences,
         f.first_seen_at, f.last_seen_at, f.updated_at,
         w.total_copper AS copper_now,
         (SELECT json_agg(json_build_object('accountId', r.rid, 'username', ra.username))
          FROM unnest(f.related_account_ids) AS r(rid)
          LEFT JOIN accounts ra ON ra.id = r.rid) AS related
  FROM account_suspicion_flags f
  JOIN accounts a ON a.id = f.account_id
  LEFT JOIN account_wealth w ON w.account_id = f.account_id`;

interface FlagRowRaw {
  id: unknown;
  account_id: unknown;
  username: string;
  banned_at: string | null;
  suspended_until: string | null;
  source: string;
  kind: string;
  severity: string;
  details: string;
  status: string;
  copper_at_flag: unknown;
  copper_now: unknown;
  occurrences: unknown;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  related: { accountId: number; username: string | null }[] | null;
}

function mapFlagRow(row: FlagRowRaw): SuspicionFlagRow {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    username: row.username,
    bannedAt: row.banned_at,
    suspendedUntil: row.suspended_until,
    source: row.source as SuspicionFlagSource,
    kind: row.kind,
    severity: row.severity as SuspicionFlagSeverity,
    details: row.details,
    relatedAccounts: (row.related ?? []).map((r) => ({
      accountId: Number(r.accountId),
      username: r.username ?? null,
    })),
    status: row.status as SuspicionFlagStatus,
    copperAtFlag: row.copper_at_flag === null ? null : Number(row.copper_at_flag),
    copperNow: row.copper_now === null ? null : Number(row.copper_now),
    occurrences: Number(row.occurrences),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  };
}

// The cached Flagged-view dataset is bounded; older resolved history past the
// cap stays reachable through the per-account read on the detail view.
export const SUSPICION_FLAG_LIST_MAX = 500;

export interface SuspicionFlagDataset {
  rows: SuspicionFlagRow[];
  countsByStatus: Record<SuspicionFlagStatus, number>;
  truncated: boolean;
}

/** The Flagged view's dataset: newest-activity-first flags (bounded, with the
 *  per-status totals computed SQL-side so the cap never hides a count). Read
 *  through the cache in suspicion_flags.ts, never per-request. */
export async function listSuspicionFlagDataset(): Promise<SuspicionFlagDataset> {
  const [rows, counts] = await Promise.all([
    pool.query(
      `${FLAG_ROW_SQL}
       ORDER BY (f.status IN ('new', 'under_review')) DESC, f.last_seen_at DESC, f.id DESC
       LIMIT $1`,
      [SUSPICION_FLAG_LIST_MAX + 1],
    ),
    pool.query(`SELECT status, count(*)::int AS n FROM account_suspicion_flags GROUP BY status`),
  ]);
  const countsByStatus: Record<SuspicionFlagStatus, number> = {
    new: 0,
    under_review: 0,
    cleared: 0,
    actioned: 0,
  };
  for (const row of counts.rows) {
    if (row.status in countsByStatus) {
      countsByStatus[row.status as SuspicionFlagStatus] = Number(row.n);
    }
  }
  const truncated = rows.rows.length > SUSPICION_FLAG_LIST_MAX;
  return {
    rows: rows.rows.slice(0, SUSPICION_FLAG_LIST_MAX).map((row) => mapFlagRow(row as FlagRowRaw)),
    countsByStatus,
    truncated,
  };
}

export interface SuspicionFlagEventRow {
  id: number;
  flagId: number;
  adminAccountId: number | null;
  adminUsername: string | null;
  fromStatus: SuspicionFlagStatus | null;
  toStatus: SuspicionFlagStatus | null;
  note: string;
  createdAt: string;
}

function mapEventRow(row: {
  id: unknown;
  flag_id: unknown;
  admin_account_id: unknown;
  admin_username: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string;
  created_at: string;
}): SuspicionFlagEventRow {
  return {
    id: Number(row.id),
    flagId: Number(row.flag_id),
    adminAccountId: row.admin_account_id === null ? null : Number(row.admin_account_id),
    adminUsername: row.admin_username ?? null,
    fromStatus: (row.from_status as SuspicionFlagStatus | null) ?? null,
    toStatus: (row.to_status as SuspicionFlagStatus | null) ?? null,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** One account's full flag history (active AND resolved; flags never silently
 *  disappear), each with its complete workflow audit trail. */
export async function suspicionFlagsForAccount(
  accountId: number,
): Promise<{ flags: SuspicionFlagRow[]; events: SuspicionFlagEventRow[] }> {
  const flags = await pool.query(
    `${FLAG_ROW_SQL} WHERE f.account_id = $1 ORDER BY f.last_seen_at DESC, f.id DESC`,
    [accountId],
  );
  const rows = flags.rows.map((row) => mapFlagRow(row as FlagRowRaw));
  if (rows.length === 0) return { flags: [], events: [] };
  const events = await pool.query(
    `SELECT e.id, e.flag_id, e.admin_account_id, a.username AS admin_username,
            e.from_status, e.to_status, e.note, e.created_at
     FROM account_suspicion_flag_events e
     LEFT JOIN accounts a ON a.id = e.admin_account_id
     WHERE e.flag_id = ANY($1::bigint[])
     ORDER BY e.id`,
    [rows.map((r) => r.id)],
  );
  return { flags: rows, events: events.rows.map((row) => mapEventRow(row)) };
}

export type SuspicionFlagTransitionResult =
  | { ok: true; flag: SuspicionFlagRow }
  | { ok: false; error: 'not_found' | 'invalid_transition' | 'active_flag_exists' };

/**
 * Move one flag through the workflow, recording the audit event atomically
 * with the status write (row-locked so two admins racing the same flag
 * serialize). The allowed-transition table lives in suspicion_flag_workflow.ts.
 * Reopening is refused with active_flag_exists when the account already has
 * another ACTIVE flag of the same source/kind, and the refusal names that
 * cause (an open sibling) rather than the transition. Two layers: the sibling
 * read under FOR UPDATE is the fast path (it also serializes behind a move in
 * progress on the sibling), and the partial unique index is the arbiter for
 * the race it cannot see (a sibling inserted or reopened by a transaction
 * that has not committed yet): its unique_violation on the UPDATE maps to the
 * same refusal instead of escaping as a 500. No deadlock shape: the index
 * allows one active row per key, so two transactions can never each hold the
 * row the other wants.
 */
export async function transitionSuspicionFlag(input: {
  flagId: number;
  adminAccountId: number;
  to: SuspicionFlagStatus;
  note: string;
}): Promise<SuspicionFlagTransitionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT account_id, source, kind, status FROM account_suspicion_flags WHERE id = $1 FOR UPDATE`,
      [input.flagId],
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'not_found' };
    }
    const from = current.rows[0].status as SuspicionFlagStatus;
    if (!allowedSuspicionFlagTransition(from, input.to)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'invalid_transition' };
    }
    const active = SUSPICION_FLAG_ACTIVE_STATUSES as readonly string[];
    // Only a reopen (terminal to active) can collide: an active row moving to
    // another active status IS the one active row the index allows. The status
    // list is a literal so the partial index serves this read on a generic plan.
    if (active.includes(input.to) && !active.includes(from)) {
      const sibling = await client.query(
        `SELECT id FROM account_suspicion_flags
         WHERE account_id = $1 AND source = $2 AND kind = $3 AND id <> $4
           AND status IN ('new', 'under_review')
         LIMIT 1
         FOR UPDATE`,
        [current.rows[0].account_id, current.rows[0].source, current.rows[0].kind, input.flagId],
      );
      if (sibling.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'active_flag_exists' };
      }
    }
    try {
      await client.query(
        `UPDATE account_suspicion_flags SET status = $2, updated_at = now() WHERE id = $1`,
        [input.flagId, input.to],
      );
    } catch (err) {
      if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
      await client.query('ROLLBACK');
      return { ok: false, error: 'active_flag_exists' };
    }
    await client.query(
      `INSERT INTO account_suspicion_flag_events
         (flag_id, admin_account_id, from_status, to_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.flagId,
        input.adminAccountId,
        from,
        input.to,
        input.note.slice(0, SUSPICION_FLAG_NOTE_MAX),
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    // Every exit path (commit, refused move, thrown error) returns the client;
    // a leaked client here would drain the pool one refused transition at a time.
    client.release();
  }
  const row = await pool.query(`${FLAG_ROW_SQL} WHERE f.id = $1`, [input.flagId]);
  return { ok: true, flag: mapFlagRow(row.rows[0] as FlagRowRaw) };
}

/** Append a note-only audit event (no status change). False when the flag id
 *  does not exist. */
export async function addSuspicionFlagNote(input: {
  flagId: number;
  adminAccountId: number;
  note: string;
}): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO account_suspicion_flag_events (flag_id, admin_account_id, note)
     SELECT $1, $2, $3
     WHERE EXISTS (SELECT 1 FROM account_suspicion_flags WHERE id = $1)
     RETURNING id`,
    [input.flagId, input.adminAccountId, input.note.slice(0, SUSPICION_FLAG_NOTE_MAX)],
  );
  return res.rows.length > 0;
}

/** Active-flag counts for a page of account rows (the accounts-list flag
 *  indicator). Returns only accounts that have at least one active flag. */
export async function activeSuspicionFlagCounts(
  accountIds: readonly number[],
): Promise<Map<number, number>> {
  if (accountIds.length === 0) return new Map();
  const res = await pool.query(
    `SELECT account_id, count(*)::int AS n
     FROM account_suspicion_flags
     WHERE account_id = ANY($1::int[]) AND status = ANY($2::text[])
     GROUP BY account_id`,
    [accountIds, [...SUSPICION_FLAG_ACTIVE_STATUSES]],
  );
  return new Map(res.rows.map((row) => [Number(row.account_id), Number(row.n)]));
}
