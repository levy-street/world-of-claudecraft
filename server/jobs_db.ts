// Postgres-backed JobsDb for player job contracts. The schema is appended to the
// main ensureSchema() run in db.ts (like SOCIAL_SCHEMA). job_id is drawn from a
// GLOBAL sequence (shared across realm processes) because it also seeds the
// on-chain escrow PDA, which is realm-agnostic — two realms must never collide.
import { pool } from './db';
import { REALM } from './realm';
import type { JobsDb, JobRecord, JobLifecycle } from './job_contracts';
import type { JobMilestone, JobProgress } from './job_milestone';

const REALM_SQL = REALM.replace(/'/g, "''");

export const JOBS_SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS job_contract_id_seq;
CREATE TABLE IF NOT EXISTS job_contracts (
  job_id BIGINT PRIMARY KEY,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL}',
  payer_account_id INT NOT NULL,
  payer_character_id INT NOT NULL,
  payer_character_name TEXT NOT NULL,
  payer_wallet TEXT NOT NULL,
  helper_account_id INT NOT NULL,
  helper_character_id INT NOT NULL,
  helper_character_name TEXT NOT NULL,
  helper_wallet TEXT NOT NULL,
  currency TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount_base BIGINT NOT NULL,
  milestone JSONB NOT NULL,
  progress JSONB NOT NULL,
  status TEXT NOT NULL,
  deadline_sec BIGINT NOT NULL,
  job_pda TEXT NOT NULL,
  vault TEXT NOT NULL,
  deposit_sig TEXT,
  settle_sig TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_contracts_realm_status ON job_contracts (realm, status);
CREATE INDEX IF NOT EXISTS job_contracts_payer ON job_contracts (payer_character_id);
CREATE INDEX IF NOT EXISTS job_contracts_helper ON job_contracts (helper_character_id);
`;

function rowToRecord(r: any): JobRecord {
  return {
    jobId: BigInt(r.job_id),
    realm: r.realm,
    payer: { accountId: r.payer_account_id, characterId: r.payer_character_id, name: r.payer_character_name, wallet: r.payer_wallet },
    helper: { accountId: r.helper_account_id, characterId: r.helper_character_id, name: r.helper_character_name, wallet: r.helper_wallet },
    currency: r.currency,
    mint: r.mint,
    amountBase: BigInt(r.amount_base),
    milestone: r.milestone as JobMilestone, // node-postgres parses jsonb to objects
    progress: r.progress as JobProgress,
    status: r.status as JobLifecycle,
    deadlineSec: Number(r.deadline_sec),
    jobPda: r.job_pda,
    vault: r.vault,
    depositSig: r.deposit_sig ?? null,
    settleSig: r.settle_sig ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export const jobsDb: JobsDb = {
  async nextJobId(): Promise<bigint> {
    const res = await pool.query("SELECT nextval('job_contract_id_seq') AS id");
    return BigInt(res.rows[0].id);
  },

  async insertJob(j: JobRecord): Promise<void> {
    await pool.query(
      `INSERT INTO job_contracts (
         job_id, realm, payer_account_id, payer_character_id, payer_character_name, payer_wallet,
         helper_account_id, helper_character_id, helper_character_name, helper_wallet,
         currency, mint, amount_base, milestone, progress, status, deadline_sec, job_pda, vault, deposit_sig, settle_sig
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        String(j.jobId), j.realm, j.payer.accountId, j.payer.characterId, j.payer.name, j.payer.wallet,
        j.helper.accountId, j.helper.characterId, j.helper.name, j.helper.wallet,
        j.currency, j.mint, String(j.amountBase), JSON.stringify(j.milestone), JSON.stringify(j.progress),
        j.status, j.deadlineSec, j.jobPda, j.vault, j.depositSig, j.settleSig,
      ],
    );
  },

  async getJob(jobId: bigint): Promise<JobRecord | null> {
    const res = await pool.query('SELECT * FROM job_contracts WHERE job_id = $1', [String(jobId)]);
    return res.rows[0] ? rowToRecord(res.rows[0]) : null;
  },

  async updateJob(jobId, patch): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.status !== undefined) { sets.push(`status = $${i++}`); vals.push(patch.status); }
    if (patch.progress !== undefined) { sets.push(`progress = $${i++}`); vals.push(JSON.stringify(patch.progress)); }
    if (patch.depositSig !== undefined) { sets.push(`deposit_sig = $${i++}`); vals.push(patch.depositSig); }
    if (patch.settleSig !== undefined) { sets.push(`settle_sig = $${i++}`); vals.push(patch.settleSig); }
    vals.push(String(jobId));
    await pool.query(`UPDATE job_contracts SET ${sets.join(', ')} WHERE job_id = $${i}`, vals);
  },

  async listActiveJobs(realm: string): Promise<JobRecord[]> {
    const res = await pool.query(
      "SELECT * FROM job_contracts WHERE realm = $1 AND status IN ('open', 'active') ORDER BY created_at",
      [realm],
    );
    return res.rows.map(rowToRecord);
  },

  async listPendingJobs(realm: string): Promise<JobRecord[]> {
    const res = await pool.query(
      "SELECT * FROM job_contracts WHERE realm = $1 AND status = 'pending_deposit' ORDER BY created_at",
      [realm],
    );
    return res.rows.map(rowToRecord);
  },

  async listJobsForCharacter(characterId: number, limit = 25): Promise<JobRecord[]> {
    const res = await pool.query(
      `SELECT * FROM job_contracts
        WHERE realm = $1 AND (payer_character_id = $2 OR helper_character_id = $2)
        ORDER BY created_at DESC LIMIT $3`,
      [REALM, characterId, Math.min(100, Math.max(1, limit))],
    );
    return res.rows.map(rowToRecord);
  },
};
