// Persistence for realm stakes (#475): the DB mirror of the on-chain
// realm_stake_escrow PDA. One row per provisioned realm's locked $WOC.
//
// LEDGER QUARANTINE (load-bearing invariant): a stake is collateral, not
// emission headroom. This table holds the stake principal and is NEVER written
// to woc_flow_ledger. The flow-ledger headroom is a blind SUM of inflows, so
// crediting a stake there would make a 1%-of-supply lock spendable as headroom
// AND independently refundable on chain, emitting it twice. The only place the
// principal exists is this table plus the escrow PDA; the only way it leaves is
// the owner-signed on-chain release of exactly the principal. Keep it out of the
// ledger, always.
//
// SQL lives only in *_db.ts (see server/CLAUDE.md). Amounts are bigint base
// units and are read as bigint, never coerced to a JS number (a whale-tier
// stake can exceed Number.MAX_SAFE_INTEGER).

import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export type StakeRowStatus = 'locked' | 'releasing' | 'released';

export const REALM_STAKE_SCHEMA = `
CREATE TABLE IF NOT EXISTS realm_stakes (
  stake_id BIGSERIAL PRIMARY KEY,
  realm_id BIGINT NOT NULL REFERENCES realms(realm_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_wallet TEXT NOT NULL,
  pda TEXT NOT NULL,
  vault TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount_base BIGINT NOT NULL,
  tier SMALLINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'releasing', 'released')),
  -- The finalized lock tx. UNIQUE is the replay guard: a confirm that reuses a
  -- signature already consumed is rejected (23505), so one lock funds one stake.
  lock_tx_sig TEXT NOT NULL UNIQUE,
  release_tx_sig TEXT UNIQUE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS realm_stakes_realm ON realm_stakes(realm_id);
CREATE INDEX IF NOT EXISTS realm_stakes_account ON realm_stakes(account_id);
-- Backs the holder-tier badge's per-wallet escrowed-$WOC sum (stakedBaseForWallet),
-- read for every online player on the holder-tier refresh. Partial to the rows
-- that count (a released stake's tokens are back in the wallet).
CREATE INDEX IF NOT EXISTS realm_stakes_owner_active ON realm_stakes(owner_wallet) WHERE status <> 'released';
`;

export interface RealmStakeRow {
  stakeId: number;
  realmId: number;
  accountId: number;
  ownerWallet: string;
  pda: string;
  vault: string;
  mint: string;
  amountBase: bigint;
  tier: number;
  status: StakeRowStatus;
  lockTxSig: string;
  releaseTxSig: string | null;
  lockedAt: Date;
  releasedAt: Date | null;
}

const COLS = `stake_id, realm_id, account_id, owner_wallet, pda, vault, mint,
  amount_base, tier, status, lock_tx_sig, release_tx_sig, locked_at, released_at`;

function toRow(r: Record<string, unknown>): RealmStakeRow {
  return {
    stakeId: Number(r.stake_id),
    realmId: Number(r.realm_id),
    accountId: Number(r.account_id),
    ownerWallet: String(r.owner_wallet),
    pda: String(r.pda),
    vault: String(r.vault),
    mint: String(r.mint),
    amountBase: BigInt(r.amount_base as string), // never Number(): can exceed 2^53
    tier: Number(r.tier),
    status: String(r.status) as StakeRowStatus,
    lockTxSig: String(r.lock_tx_sig),
    releaseTxSig: r.release_tx_sig == null ? null : String(r.release_tx_sig),
    lockedAt: r.locked_at as Date,
    releasedAt: (r.released_at as Date | null) ?? null,
  };
}

// Record a confirmed stake lock. The UNIQUE(lock_tx_sig) constraint makes this
// the replay guard: a second confirm with the same finalized tx throws 23505,
// which callers translate into a 409. amount_base is passed as a string so the
// full bigint reaches Postgres without precision loss.
export async function insertStake(
  db: Queryable,
  s: {
    realmId: number;
    accountId: number;
    ownerWallet: string;
    pda: string;
    vault: string;
    mint: string;
    amountBase: bigint;
    tier: number;
    lockTxSig: string;
  },
): Promise<RealmStakeRow> {
  const res = await db.query(
    `INSERT INTO realm_stakes
       (realm_id, account_id, owner_wallet, pda, vault, mint, amount_base, tier, status, lock_tx_sig)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'locked', $9)
     RETURNING ${COLS}`,
    [s.realmId, s.accountId, s.ownerWallet, s.pda, s.vault, s.mint, s.amountBase.toString(), s.tier, s.lockTxSig],
  );
  return toRow(res.rows[0]);
}

// The live stake for a realm (the one that is not released), if any.
export async function getActiveStakeByRealm(db: Queryable, realmId: number): Promise<RealmStakeRow | null> {
  const res = await db.query(
    `SELECT ${COLS} FROM realm_stakes WHERE realm_id = $1 AND status <> 'released' ORDER BY locked_at DESC LIMIT 1`,
    [realmId],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

// The wallet's total escrowed $WOC across all its non-released realm stakes, in
// base units. Drives the holder-tier badge: a stake's principal sits in a
// program-owned vault that getTokenAccountsByOwner cannot see, but it is still
// the holder's committed $WOC, so it must count toward the badge (otherwise
// founding a realm would drop the badge the moment the player commits the most
// $WOC). 'released' stakes are excluded: their tokens are back in the wallet and
// the balance RPC sees them again, so counting them would double-count.
export async function stakedBaseForWallet(db: Queryable, ownerWallet: string): Promise<bigint> {
  const res = await db.query(
    `SELECT COALESCE(SUM(amount_base), 0)::text AS total
       FROM realm_stakes WHERE owner_wallet = $1 AND status <> 'released'`,
    [ownerWallet],
  );
  return BigInt(res.rows[0].total as string);
}

// Lookup by the lock signature, used to detect a replayed confirm before insert.
export async function getStakeByLockTx(db: Queryable, lockTxSig: string): Promise<RealmStakeRow | null> {
  const res = await db.query(`SELECT ${COLS} FROM realm_stakes WHERE lock_tx_sig = $1`, [lockTxSig]);
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

// Mark a stake as releasing (the owner has begun decommissioning on chain).
export async function setStakeReleasing(db: Queryable, stakeId: number): Promise<RealmStakeRow | null> {
  const res = await db.query(
    `UPDATE realm_stakes SET status = 'releasing' WHERE stake_id = $1 AND status = 'locked' RETURNING ${COLS}`,
    [stakeId],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

// Mark a stake released once the owner's on-chain release is confirmed.
export async function setStakeReleased(
  db: Queryable,
  stakeId: number,
  releaseTxSig: string,
): Promise<RealmStakeRow | null> {
  const res = await db.query(
    `UPDATE realm_stakes
        SET status = 'released', release_tx_sig = $2, released_at = now()
      WHERE stake_id = $1 AND status <> 'released'
      RETURNING ${COLS}`,
    [stakeId, releaseTxSig],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}
