// SQL for the voice_npc_grants table (DDL lives in db.ts's SCHEMA). Mirrors the
// chat_filter.ts/chat_filter_db.ts and wallet_link.ts/wallet.ts split: this
// file is the IO shell, voice_npc_keeper.ts and voice_npc.ts stay SQL-free and
// talk to the functions here. One row per account; status walks the lifecycle
// pending_sample -> pending_clone -> cloning -> generating -> ready -> failed.
import { pool } from './db';

export type VoiceNpcStatus =
  | 'pending_sample'
  | 'pending_clone'
  | 'cloning'
  | 'generating'
  | 'ready'
  | 'failed';

export interface VoiceNpcGrantRow {
  id: number;
  account_id: number;
  status: VoiceNpcStatus;
  npc_display_name: string;
  sample_path: string | null;
  eleven_voice_id: string | null;
  lines: Record<string, string>;
  consent_at: string | null;
  applied_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch the caller's grant, creating an empty pending_sample row if absent. */
export async function createOrGetGrant(accountId: number): Promise<VoiceNpcGrantRow> {
  const existing = await grantForAccount(accountId);
  if (existing) return existing;
  const res = await pool.query(
    `INSERT INTO voice_npc_grants (account_id) VALUES ($1)
     ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
     RETURNING *`,
    [accountId],
  );
  return res.rows[0];
}

export async function grantForAccount(accountId: number): Promise<VoiceNpcGrantRow | null> {
  const res = await pool.query('SELECT * FROM voice_npc_grants WHERE account_id = $1', [accountId]);
  return res.rows[0] ?? null;
}

/**
 * Atomically claim a 'ready', not-yet-applied grant for the in-world spawn:
 * sets applied_at in the same statement it reads it, so a racing duplicate
 * join (or restart) can never spawn the NPC twice. Returns null if there is
 * nothing to apply.
 */
export async function claimReadyGrantForApply(accountId: number): Promise<VoiceNpcGrantRow | null> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET applied_at = now()
     WHERE account_id = $1 AND status = 'ready' AND applied_at IS NULL
     RETURNING *`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

/** Statuses a grant may be re-armed to pending_sample from: never mid-pipeline. */
const REARMABLE_STATUSES: VoiceNpcStatus[] = ['pending_sample', 'ready', 'failed'];

/**
 * Record explicit consent + the uploaded sample path, set the player's chosen
 * display name, and (re)arm the grant at pending_sample. Resets any prior
 * clone/error state so a re-recorded sample starts the pipeline fresh.
 *
 * Atomic compare-and-set, same idiom as `claimReadyGrantForApply`: the
 * conditional UPDATE only lands while the existing row is NOT mid-pipeline
 * ('pending_clone' | 'cloning' | 'generating'). If the row exists and is
 * mid-pipeline, this returns null instead of clobbering the in-flight grant;
 * the caller (the sample-upload HTTP route) turns that into a 409. The
 * INSERT ON CONFLICT DO NOTHING handles the first-time (no row yet) case in
 * the same statement, no separate SELECT-then-UPDATE.
 */
export async function recordConsentAndSample(
  accountId: number,
  samplePath: string,
  displayName: string,
): Promise<VoiceNpcGrantRow | null> {
  await pool.query(
    `INSERT INTO voice_npc_grants (account_id, status, npc_display_name, sample_path, consent_at)
     VALUES ($1, 'pending_sample', $2, $3, now())
     ON CONFLICT (account_id) DO NOTHING`,
    [accountId, displayName, samplePath],
  );
  const res = await pool.query(
    `UPDATE voice_npc_grants SET
       status = 'pending_sample',
       npc_display_name = $2,
       sample_path = $3,
       consent_at = now(),
       eleven_voice_id = NULL,
       lines = '{}'::jsonb,
       error = NULL,
       updated_at = now()
     WHERE account_id = $1 AND status = ANY($4)
     RETURNING *`,
    [accountId, displayName, samplePath, REARMABLE_STATUSES],
  );
  return res.rows[0] ?? null;
}

/** Confirm payment transitions a sampled grant to pending_clone for the keeper to pick up. */
export async function markPendingClone(accountId: number): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'pending_clone', error = NULL, updated_at = now()
     WHERE account_id = $1`,
    [accountId],
  );
}

/**
 * Each state-machine transition below is itself an atomic compare-and-set: the
 * WHERE clause only matches while the row is still in the expected prior
 * status, so a concurrent re-upload (which resets the row to 'pending_sample')
 * makes a stale keeper write affect 0 rows instead of clobbering fresh state.
 * Returns whether the row was actually updated so the keeper can no-op
 * gracefully on a miss.
 */
export async function markCloning(accountId: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET status = 'cloning', updated_at = now()
     WHERE account_id = $1 AND status = 'pending_clone'`,
    [accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markGenerating(accountId: number, elevenVoiceId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET status = 'generating', eleven_voice_id = $2, updated_at = now()
     WHERE account_id = $1 AND status = 'cloning'`,
    [accountId, elevenVoiceId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markReady(
  accountId: number,
  lines: Record<string, string>,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET status = 'ready', lines = $2, error = NULL, updated_at = now()
     WHERE account_id = $1 AND status = 'generating'`,
    [accountId, JSON.stringify(lines)],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Persist one synthesized line's URL incrementally (merges into the existing
 * `lines` JSONB rather than replacing it), so a crash mid-generation doesn't
 * lose already-synthesized lines: `generateOne` calls this after EACH
 * successful line synthesis instead of batching every line into one
 * `markReady` write at the end. Guarded the same way as the other
 * transitions: only lands while the row is still 'generating'.
 */
export async function appendGeneratedLine(
  accountId: number,
  lineKey: string,
  url: string,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET lines = lines || jsonb_build_object($2::text, $3::text), updated_at = now()
     WHERE account_id = $1 AND status = 'generating'`,
    [accountId, lineKey, url],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Mark a grant failed. Unlike the forward transitions above this is allowed
 * from any mid-pipeline status ('pending_clone' | 'cloning' | 'generating'):
 * it is the error/crash-recovery exit, not a forward step, and must still be
 * able to land even if the exact prior status raced. It still refuses to
 * clobber a grant a concurrent re-upload already reset to 'pending_sample'.
 */
export async function markFailed(accountId: number, reason: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE voice_npc_grants SET status = 'failed', error = $2, updated_at = now()
     WHERE account_id = $1 AND status IN ('pending_clone', 'cloning', 'generating')`,
    [accountId, reason.slice(0, 500)],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Grants the cloning keeper should pick up next cycle. */
export async function pendingCloneGrants(): Promise<VoiceNpcGrantRow[]> {
  const res = await pool.query(
    `SELECT * FROM voice_npc_grants WHERE status = 'pending_clone' ORDER BY updated_at ASC LIMIT 20`,
  );
  return res.rows;
}

/** Grants the line-synthesis keeper should pick up next cycle (clone done, lines pending). */
export async function pendingGenerateGrants(): Promise<VoiceNpcGrantRow[]> {
  const res = await pool.query(
    `SELECT * FROM voice_npc_grants WHERE status = 'generating' ORDER BY updated_at ASC LIMIT 20`,
  );
  return res.rows;
}

/** Also pick up 'cloning' rows stuck mid-cycle (crash recovery): see voice_npc_keeper.ts recover(). */
export async function cloningGrants(): Promise<VoiceNpcGrantRow[]> {
  const res = await pool.query(
    `SELECT * FROM voice_npc_grants WHERE status = 'cloning' ORDER BY updated_at ASC LIMIT 20`,
  );
  return res.rows;
}
