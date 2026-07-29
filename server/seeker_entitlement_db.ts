import { pool } from './db';
import { MAX_SEEKER_TOKEN_MINTS } from './seeker_entitlement_limits';

export const SEEKER_ENTITLEMENT_SCHEMA = `
-- Keep forever. A claimed SGT mint must never become reusable after a wallet
-- unlink, token transfer, account deactivation, hard delete, or binary rollback.
CREATE TABLE IF NOT EXISTS seeker_entitlement_claims (
  mint TEXT PRIMARY KEY,
  account_id INT NULL REFERENCES accounts(id) ON DELETE SET NULL,
  claimant_wallet TEXT NOT NULL,
  proof_version TEXT NOT NULL,
  verification_slot BIGINT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);
`;

export interface SeekerEntitlementCandidate {
  mint: string;
  verificationSlot: number | null;
}

export interface AvailableSeekerEntitlementClaim {
  candidates: readonly SeekerEntitlementCandidate[];
  accountId: number;
  claimantWallet: string;
  proofVersion: string;
}

export type SeekerEntitlementClaimResult =
  | { status: 'claimed' | 'existing_same'; mint: string }
  | { status: 'conflict'; mint: null };

interface QueryResultLike {
  rows: Record<string, unknown>[];
}

interface QueryPool {
  query(sql: string, params?: readonly unknown[]): Promise<QueryResultLike>;
}

function validCandidates(candidates: readonly SeekerEntitlementCandidate[]): boolean {
  if (candidates.length === 0 || candidates.length > MAX_SEEKER_TOKEN_MINTS) return false;
  let previous = '';
  for (const candidate of candidates) {
    const slot = candidate.verificationSlot;
    if (
      !candidate.mint ||
      candidate.mint !== candidate.mint.trim() ||
      candidate.mint <= previous ||
      (slot !== null && (!Number.isSafeInteger(slot) || slot < 0))
    ) {
      return false;
    }
    previous = candidate.mint;
  }
  return true;
}

/**
 * Claim the first available verified SGT candidate across every realm process.
 * Chain verification and deterministic sorting finish before this bounded DB call.
 */
export async function claimAvailableSeekerEntitlement(
  claim: AvailableSeekerEntitlementClaim,
  db: QueryPool = pool,
): Promise<SeekerEntitlementClaimResult> {
  if (!validCandidates(claim.candidates)) return { status: 'conflict', mint: null };
  const mints = claim.candidates.map((candidate) => candidate.mint);
  const slots = claim.candidates.map((candidate) => candidate.verificationSlot);
  const inserted = await db.query(
    `INSERT INTO seeker_entitlement_claims
       (mint, account_id, claimant_wallet, proof_version, verification_slot)
     SELECT candidate.mint, $3, $4, $5, candidate.verification_slot
       FROM unnest($1::text[], $2::bigint[]) WITH ORDINALITY
         AS candidate(mint, verification_slot, ordinality)
      ORDER BY candidate.ordinality
     ON CONFLICT DO NOTHING
     RETURNING mint`,
    [mints, slots, claim.accountId, claim.claimantWallet, claim.proofVersion],
  );
  const insertedMint = inserted.rows[0]?.mint;
  if (typeof insertedMint === 'string') return { status: 'claimed', mint: insertedMint };

  const existing = await db.query(
    `SELECT mint
       FROM seeker_entitlement_claims
      WHERE account_id = $1
      LIMIT 1`,
    [claim.accountId],
  );
  const existingMint = existing.rows[0]?.mint;
  if (typeof existingMint === 'string' && mints.includes(existingMint)) {
    return { status: 'existing_same', mint: existingMint };
  }
  return { status: 'conflict', mint: null };
}

export async function hasSeekerEntitlement(
  accountId: number,
  db: Pick<QueryPool, 'query'> = pool,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM seeker_entitlement_claims
      WHERE account_id = $1
      LIMIT 1`,
    [accountId],
  );
  return result.rows.length > 0;
}

export async function seekerEntitlementForAccount(
  accountId: number,
  db: Pick<QueryPool, 'query'> = pool,
): Promise<{ mint: string; claimantWallet: string } | null> {
  const result = await db.query(
    `SELECT mint, claimant_wallet
       FROM seeker_entitlement_claims
      WHERE account_id = $1
      LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  return row && typeof row.mint === 'string' && typeof row.claimant_wallet === 'string'
    ? { mint: row.mint, claimantWallet: row.claimant_wallet }
    : null;
}
