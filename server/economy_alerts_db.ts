// Economy Watch, phase 1: the SQL boundary for `economy_alerts`, the queue of
// conservation findings an operator works through.
//
// A table rather than only a log line or only a metric, because the three
// answer different questions. The metric says "something is wrong right now",
// the log says "here is what it looked like", and only a table can carry the
// thing an incident actually needs: which findings have been looked at. An
// unacknowledged critical alert from four hours ago is the single most
// important row in this system, and it cannot live in a counter.

import { pool } from './db';
import type { EconomyAlert, EconomyAlertSeverity } from './economy_reconcile';

/**
 * The `economy_alerts` DDL, applied by `ensureSchema` under the boot advisory
 * lock like every other domain schema module.
 *
 * This one DOES grow per event and therefore needs a retention story
 * (server/CLAUDE.md). It gets one in `pruneEconomyAlerts` below rather than a
 * keep-forever comment: an alert is a work item, and a resolved work item from
 * last quarter has no readers, while the EVIDENCE behind it lives forever in
 * `gold_ledger` and can always be re-derived.
 */
export const ECONOMY_ALERTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS economy_alerts (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  -- Signed copper the finding is off by. Positive is the duplication
  -- direction: coin the world holds that the ledger cannot explain.
  delta BIGINT NOT NULL,
  detail TEXT NOT NULL,
  -- Set when an operator marks the finding handled. NULL means it is still in
  -- the queue, which is what the admin read API and the alert hook filter on.
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The operator's working view: unacknowledged first, newest first. A partial
-- index because the open queue is the only hot read and it is a tiny fraction
-- of the table once the feature has been live a while.
CREATE INDEX IF NOT EXISTS economy_alerts_open
  ON economy_alerts(realm, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS economy_alerts_character ON economy_alerts(character_id, created_at DESC);
`;

/**
 * Insert a batch of findings. Deliberately DEDUPED against the open queue: a
 * reconciliation pass runs on a schedule over an overlapping rolling window, so
 * the same unresolved violation is found again on every pass. Without the
 * dedupe an operator's queue fills with hundreds of copies of one incident and
 * the real second incident is invisible in the noise.
 *
 * The dedupe key is (kind, character_id, delta) among UNACKNOWLEDGED rows: same
 * finding, same character, same magnitude. Acknowledging a row therefore
 * re-arms it, which is intended, because a finding that recurs AFTER an
 * operator called it handled is new information.
 *
 * Returns the alerts that ACTUALLY landed, not a count, because the operator
 * notification is driven off this list. A ping per finding-per-pass would mean
 * one unresolved violation interrupting a human every fifteen minutes until they
 * muted the channel; a ping per newly-filed row means one incident, one ping.
 */
export async function insertEconomyAlerts(
  realm: string,
  alerts: readonly EconomyAlert[],
): Promise<EconomyAlert[]> {
  const inserted: EconomyAlert[] = [];
  for (const a of alerts) {
    const res = await pool.query(
      `INSERT INTO economy_alerts (realm, kind, severity, character_id, delta, detail)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM economy_alerts
           WHERE realm = $1 AND kind = $2 AND delta = $5
             AND character_id IS NOT DISTINCT FROM $4
             AND acknowledged_at IS NULL
        )`,
      [realm, a.kind, a.severity, a.characterId, a.delta, a.detail],
    );
    if ((res.rowCount ?? 0) > 0) inserted.push(a);
  }
  return inserted;
}

export interface EconomyAlertRow {
  id: number;
  realm: string;
  kind: string;
  severity: EconomyAlertSeverity;
  characterId: number | null;
  delta: number;
  detail: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** The operator queue: open findings, most recent first. */
export async function openEconomyAlerts(realm: string, limit = 100): Promise<EconomyAlertRow[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  const res = await pool.query(
    `SELECT id, realm, kind, severity, character_id, delta, detail, acknowledged_at, created_at
       FROM economy_alerts
      WHERE realm = $1 AND acknowledged_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [realm, capped],
  );
  return res.rows.map(mapAlertRow);
}

// Shared row mapper: pg returns BIGINT as a string to avoid precision loss, so
// every numeric column crosses back through Number() in exactly one place. Both
// readers use it so the two views cannot drift into disagreeing about a row.
function mapAlertRow(r: Record<string, unknown>): EconomyAlertRow {
  return {
    id: Number(r.id),
    realm: String(r.realm),
    kind: String(r.kind),
    severity: String(r.severity) as EconomyAlertSeverity,
    characterId: r.character_id === null ? null : Number(r.character_id),
    delta: Number(r.delta),
    detail: String(r.detail),
    acknowledgedAt: r.acknowledged_at === null ? null : String(r.acknowledged_at),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/**
 * The retention primitive registered with the nightly sweep. Prunes only
 * ACKNOWLEDGED rows past the window: an open finding is never deleted no matter
 * how old, because age is not resolution and a stale unhandled critical is
 * exactly the row an operator most needs to still be there.
 *
 * Batched via a LIMIT subquery per the retention rules in server/CLAUDE.md, and
 * OLDEST FIRST, which is the sweep's forward-progress guarantee: a run capped by
 * the row budget leaves the remainder for the next night rather than deleting an
 * arbitrary slice and re-scanning the same backlog forever.
 *
 * A retention of 0 (or anything non-positive) DISABLES pruning, the same
 * contract every other `*_RETENTION_DAYS` in this codebase follows. Clamping to
 * one day instead would turn the documented "keep them forever" setting into
 * the most aggressive one available.
 */
export async function pruneEconomyAlerts(olderThanDays: number, batch = 500): Promise<number> {
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) return 0;
  // A fractional value clamps to at least one day, never floors to '0 days'.
  const days = Math.max(1, Math.floor(olderThanDays));
  const res = await pool.query(
    `DELETE FROM economy_alerts
      WHERE id IN (
        SELECT id FROM economy_alerts
         WHERE acknowledged_at IS NOT NULL
           AND acknowledged_at < now() - ($1 || ' days')::interval
         ORDER BY acknowledged_at
         LIMIT $2
      )`,
    [String(days), Math.max(1, Math.floor(batch))],
  );
  return res.rowCount ?? 0;
}

/**
 * Mark one finding handled, by the operator who handled it.
 *
 * Idempotent and FIRST-WRITER-WINS: the `acknowledged_at IS NULL` guard means a
 * second acknowledgement of the same row changes nothing and reports false,
 * rather than quietly rewriting who handled it. Two operators working the queue
 * at once is the normal case during an incident, and the record of who looked
 * first is worth more than the record of who clicked last.
 *
 * Acknowledging RE-ARMS the dedupe in `insertEconomyAlerts`, which is the point
 * and also the hazard: the next pass that still finds the violation files it
 * again as a fresh row and notifies again. That is intended (a finding that
 * recurs after an operator called it handled is new information), but it means
 * acknowledging is not a way to silence anything, and an operator who wants the
 * noise to stop has to actually fix the leak.
 */
export async function acknowledgeEconomyAlert(
  realm: string,
  id: number,
  accountId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const res = await pool.query(
    `UPDATE economy_alerts
        SET acknowledged_at = now(), acknowledged_by = $3
      WHERE id = $2 AND realm = $1 AND acknowledged_at IS NULL`,
    [realm, id, accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * One character's findings, newest first, acknowledged ones included.
 *
 * The open queue (`openEconomyAlerts`) answers "what needs working"; this
 * answers "what has this character ever been flagged for", which is the
 * question an investigation actually asks. Acknowledged rows are included for
 * exactly that reason: a character with five handled findings over a month is a
 * pattern, and a view that hid them would show an empty page for the most
 * interesting account on the realm.
 */
export async function economyAlertsForCharacter(
  realm: string,
  characterId: number,
  limit = 50,
): Promise<EconomyAlertRow[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
  const res = await pool.query(
    `SELECT id, realm, kind, severity, character_id, delta, detail, acknowledged_at, created_at
       FROM economy_alerts
      WHERE realm = $1 AND character_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [realm, characterId, capped],
  );
  return res.rows.map(mapAlertRow);
}
