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

/**
 * Record explicit consent + the uploaded sample path, set the player's chosen
 * display name, and (re)arm the grant at pending_sample. Resets any prior
 * clone/error state so a re-recorded sample starts the pipeline fresh.
 */
export async function recordConsentAndSample(
  accountId: number,
  samplePath: string,
  displayName: string,
): Promise<VoiceNpcGrantRow> {
  const res = await pool.query(
    `INSERT INTO voice_npc_grants (account_id, status, npc_display_name, sample_path, consent_at)
     VALUES ($1, 'pending_sample', $2, $3, now())
     ON CONFLICT (account_id) DO UPDATE SET
       status = 'pending_sample',
       npc_display_name = EXCLUDED.npc_display_name,
       sample_path = EXCLUDED.sample_path,
       consent_at = now(),
       eleven_voice_id = NULL,
       lines = '{}'::jsonb,
       error = NULL,
       updated_at = now()
     RETURNING *`,
    [accountId, displayName, samplePath],
  );
  return res.rows[0];
}

/** Confirm payment transitions a sampled grant to pending_clone for the keeper to pick up. */
export async function markPendingClone(accountId: number): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'pending_clone', error = NULL, updated_at = now()
     WHERE account_id = $1`,
    [accountId],
  );
}

export async function markCloning(accountId: number): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'cloning', updated_at = now() WHERE account_id = $1`,
    [accountId],
  );
}

export async function markGenerating(accountId: number, elevenVoiceId: string): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'generating', eleven_voice_id = $2, updated_at = now()
     WHERE account_id = $1`,
    [accountId, elevenVoiceId],
  );
}

export async function markReady(accountId: number, lines: Record<string, string>): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'ready', lines = $2, error = NULL, updated_at = now()
     WHERE account_id = $1`,
    [accountId, JSON.stringify(lines)],
  );
}

export async function markFailed(accountId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE voice_npc_grants SET status = 'failed', error = $2, updated_at = now() WHERE account_id = $1`,
    [accountId, reason.slice(0, 500)],
  );
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
