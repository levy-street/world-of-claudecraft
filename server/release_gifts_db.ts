import type { Client } from 'pg';

export const RELEASE_GIFTS_OPERATION = 'v0.45.0-release-gifts';
export const REDESIGN_GRANT_SCHEMA =
  'ALTER TABLE characters ADD COLUMN IF NOT EXISTS appearance_reroll_granted BOOLEAN NOT NULL DEFAULT FALSE';

export interface ReleaseGiftsOptions {
  realm: string;
  createdBefore: string;
  lockoutKeys: readonly string[];
  maxCharacters: number;
  maxStateBytes: number;
  apply: boolean;
  writersStopped: boolean;
}

export interface ReleaseGiftsReport {
  characters: number;
  stateBytes: number;
  redesigns: number;
  lockoutCharacters: number;
  malformed: number;
  updated: number;
  applied: boolean;
}

// No player blobs leave PostgreSQL. Only known dungeon/raid keys are removed.
const CENSUS = `SELECT count(*)::int AS characters,
  COALESCE(sum(octet_length(state::text)), 0)::text AS "stateBytes",
  count(*) FILTER (WHERE NOT appearance_reroll_granted)::int AS redesigns,
  count(*) FILTER (WHERE state->'raidLockouts' ?| $3::text[])::int AS "lockoutCharacters",
  count(*) FILTER (WHERE
    (state IS NOT NULL AND jsonb_typeof(state) <> 'object') OR
    (state ? 'raidLockouts' AND jsonb_typeof(state->'raidLockouts') NOT IN ('object', 'null'))
  )::int AS malformed
  FROM characters WHERE realm = $1 AND created_at < $2::timestamptz`;

/** Offline operation only. Row locks protect the cohort, not admission: the
 * operator MUST stop target-realm writers and exclude admissions until the
 * grant-aware binary starts. A lease census is an additional refusal, not proof
 * that an empty realm is stopped. The marker is retained forever to prevent replay. */
export async function runReleaseGifts(
  client: Client,
  options: ReleaseGiftsOptions,
): Promise<ReleaseGiftsReport> {
  if (
    !options.realm.trim() ||
    options.realm.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.createdBefore) ||
    !Number.isFinite(Date.parse(options.createdBefore)) ||
    !Number.isSafeInteger(options.maxCharacters) ||
    options.maxCharacters <= 0 ||
    !Number.isSafeInteger(options.maxStateBytes) ||
    options.maxStateBytes <= 0 ||
    options.lockoutKeys.length === 0 ||
    options.lockoutKeys.some((key) => !/^[a-z0-9_]+(?::heroic)?$/.test(key))
  ) {
    throw new Error(
      'Explicit realm, cohort cutoff, dungeon keys and positive workload limits required',
    );
  }
  if (options.apply && !options.writersStopped) throw new Error('Stop target-realm writers first');
  const marker = `${RELEASE_GIFTS_OPERATION}:${options.realm}`;
  const params = [options.realm, options.createdBefore, [...options.lockoutKeys]];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '45s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    const lock = await client.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
      [marker],
    );
    if (!lock.rows[0].acquired) throw new Error('Release gifts operation already running');
    const done = await client.query('SELECT 1 FROM world_state WHERE key = $1', [marker]);
    if (done.rowCount) throw new Error('Release gifts already applied; replay refused');
    const census = async (): Promise<ReleaseGiftsReport> => {
      const result = await client.query(CENSUS, params);
      const row = result.rows[0];
      const report = { ...row, stateBytes: Number(row.stateBytes), updated: 0, applied: false };
      if (report.characters > options.maxCharacters || report.stateBytes > options.maxStateBytes)
        throw new Error('Release gifts workload exceeds approved limits');
      if (report.malformed) throw new Error('Malformed character state; no changes applied');
      return report;
    };
    let report = await census();
    if (options.apply) {
      // Lock the existing cohort without returning IDs or blobs to the operator.
      await client.query(
        `SELECT count(*) FROM (
        SELECT id FROM characters WHERE realm = $1 AND created_at < $2::timestamptz
        ORDER BY id FOR UPDATE) AS locked`,
        params.slice(0, 2),
      );
      const leases = await client.query(
        'SELECT 1 FROM character_leases WHERE realm = $1 AND expires_at > now() LIMIT 1',
        [options.realm],
      );
      if (leases.rowCount) throw new Error('Target realm has active leases; aborting');
      report = await census();
      const changed = await client.query(
        `UPDATE characters
        SET appearance_reroll_granted = TRUE,
            appearance_reroll_used = TRUE,
            state = CASE WHEN state->'raidLockouts' ?| $3::text[]
              THEN jsonb_set(state, '{raidLockouts}', (state->'raidLockouts') - $3::text[])
              ELSE state END,
            updated_at = now()
        WHERE realm = $1 AND created_at < $2::timestamptz
          AND (NOT appearance_reroll_granted OR NOT appearance_reroll_used OR state->'raidLockouts' ?| $3::text[])`,
        params,
      );
      report.updated = changed.rowCount ?? 0;
      report.applied = true;
      await client.query('INSERT INTO world_state (key, data) VALUES ($1, $2::jsonb)', [
        marker,
        JSON.stringify({
          ...report,
          createdBefore: options.createdBefore,
          lockoutKeys: options.lockoutKeys,
        }),
      ]);
    }
    await client.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
