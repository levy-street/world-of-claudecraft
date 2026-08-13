// SQL for the class power tuner (the admin Balance > Class Power panel): one
// current tuning document per realm plus an append-only before/after audit
// trail of who moved which sliders and why.
//
// Shaped after server/antibot_config_db.ts, the other operator-tunable
// per-realm JSONB config: same one-row-per-realm document, same atomic
// save-plus-history transaction, same unchanged-is-a-no-op rule. Validation
// lives in the sim (`sanitizeClassTuningDocument`); this file is the only place
// this feature's SQL runs (server/CLAUDE.md: SQL lives only in db.ts and *_db.ts).

import { isEmptyClassTuningDocument, sanitizeClassTuningDocument } from '../src/sim/tuning';
import { pool } from './db';
import { REALM } from './realm';

export const CLASS_TUNING_SCHEMA = `
CREATE TABLE IF NOT EXISTS class_tuning_config (
  realm TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS class_tuning_changes (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS class_tuning_changes_realm
  ON class_tuning_changes(realm, created_at DESC, id DESC);
`;

export interface StoredClassTuning {
  data: unknown;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface ClassTuningSaveResult {
  changed: boolean;
  updatedAt: string | null;
}

export interface ClassTuningHistoryEntry {
  id: number;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  note: string;
  createdAt: string;
  adminAccountId: number | null;
  adminUsername: string | null;
}

/** The realm's saved tuning document ({} when the realm has never been tuned). */
export async function loadClassTuning(): Promise<StoredClassTuning> {
  const res = await pool.query(
    `SELECT data, updated_at, updated_by FROM class_tuning_config WHERE realm = $1`,
    [REALM],
  );
  const row = res.rows[0];
  return {
    data: row?.data ?? {},
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy:
      row?.updated_by === null || row?.updated_by === undefined ? null : Number(row.updated_by),
  };
}

/**
 * Replace the realm's tuning document and append its audit row atomically.
 * An unchanged document is a no-op: it neither refreshes updated_at nor writes
 * history, so the trail records real balance decisions rather than every time
 * somebody opened the page and pressed save.
 */
export async function saveClassTuningChange(
  data: Record<string, unknown>,
  updatedBy: number,
  note: string,
): Promise<ClassTuningSaveResult> {
  const encoded = JSON.stringify(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize saves per realm BEFORE the row exists: FOR UPDATE matches zero
    // rows on a realm's FIRST save, so two concurrent first saves would both
    // read "no row" and append two `{} -> X` audit rows. Transaction-scoped, so
    // COMMIT and ROLLBACK both release it.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      'class_tuning_config',
      REALM,
    ]);
    const current = await client.query(
      `SELECT data, updated_at, data = $2::jsonb AS unchanged
       FROM class_tuning_config
       WHERE realm = $1
       FOR UPDATE`,
      [REALM, encoded],
    );
    const row = current.rows[0];
    if (row && row.unchanged === true) {
      await client.query('COMMIT');
      return {
        changed: false,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    }
    // A first save of an EMPTY document is also a no-op: there is nothing to
    // record, and writing the row would claim the realm had been tuned.
    //
    // "Empty" is asked of the WHOLE document, through the sim's own predicate,
    // never of one scope: a weapons-only first save is a real change, and an
    // ability-shaped check would discard it while the dashboard still reported
    // it as saved and pending a restart.
    if (!row && isEmptyClassTuningDocument(sanitizeClassTuningDocument(data))) {
      await client.query('COMMIT');
      return { changed: false, updatedAt: null };
    }

    const beforeData = documentObject(row?.data);
    const saved = await client.query(
      `INSERT INTO class_tuning_config (realm, data, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT (realm) DO UPDATE
         SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [REALM, encoded, updatedBy],
    );
    await client.query(
      `INSERT INTO class_tuning_changes (
         realm, admin_account_id, before_data, after_data, note
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [REALM, updatedBy, JSON.stringify(beforeData), encoded, note],
    );
    await client.query('COMMIT');
    return { changed: true, updatedAt: new Date(saved.rows[0].updated_at).toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The page the dashboard reads per request; also the default LIMIT below. */
export const CLASS_TUNING_HISTORY_PAGE = 50;

/**
 * The newest history rows, keyset-paged: pass the smallest `id` of the page in
 * hand as `beforeId` to read the next-older page. `id` is BIGSERIAL, so it
 * orders with the insert sequence and never needs an OFFSET walk.
 */
export async function listClassTuningHistory(
  limit = CLASS_TUNING_HISTORY_PAGE,
  beforeId?: number,
): Promise<ClassTuningHistoryEntry[]> {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 50;
  const before =
    typeof beforeId === 'number' && Number.isFinite(beforeId) && beforeId > 0
      ? Math.trunc(beforeId)
      : null;
  const res = await pool.query(
    `SELECT
       h.id,
       h.before_data,
       h.after_data,
       h.note,
       h.created_at,
       h.admin_account_id,
       a.username AS admin_username
     FROM class_tuning_changes h
     LEFT JOIN accounts a ON a.id = h.admin_account_id
     WHERE h.realm = $1${before === null ? '' : ' AND h.id < $3'}
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $2`,
    before === null ? [REALM, boundedLimit] : [REALM, boundedLimit, before],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    beforeData: documentObject(row.before_data),
    afterData: documentObject(row.after_data),
    note: typeof row.note === 'string' ? row.note : '',
    createdAt: new Date(row.created_at).toISOString(),
    adminAccountId: row.admin_account_id === null ? null : Number(row.admin_account_id),
    adminUsername: typeof row.admin_username === 'string' ? row.admin_username : null,
  }));
}

function documentObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
