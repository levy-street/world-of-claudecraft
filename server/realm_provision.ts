// Stake-to-provision (#475): verify a finalized on-chain stake lock, then record
// the realm + stake. Reuses the proven finalized-tx verify core (solana_tx) and
// the escrow PDA derivation (realm_escrow). The staked $WOC moves into the
// non-custodial escrow vault, which this confirms; the realm then flips active
// and the stake is recorded in the ledger-quarantined realm_stakes table.

import type { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { getFinalizedTx, ownerCreditedBase, ownerSpentBase, txSucceeded, usesToken2022 } from './solana_tx';
import { realmStakePda, realmVaultAddress } from './realm_escrow';
import { activateRealm, addRealmRole } from './realm_db';
import { insertStake, type RealmStakeRow } from './realm_stake_db';

export type StakeVerdict = { ok: true; amountBase: bigint } | { ok: false; reason: string };

// Verify that `lockSig` is a finalized lock of exactly `expectedAmount` $WOC by
// `stakerWallet` into the escrow vault for `realmId`. Pure verification against
// the chain (no DB writes): mirrors the marketplace verifier (finalized, not
// Token-2022, exact on-chain deltas, payer-bound).
export async function verifyStakeLock(args: {
  lockSig: string;
  realmId: number;
  stakerWallet: string;
  mint: string;
  expectedAmount: bigint;
}): Promise<StakeVerdict> {
  const tx = await getFinalizedTx(args.lockSig);
  if (!tx) return { ok: false, reason: 'tx_not_finalized' };
  if (!txSucceeded(tx)) return { ok: false, reason: 'tx_failed' };
  if (usesToken2022(tx, args.mint)) return { ok: false, reason: 'token_2022' };

  // The vault is owned by the stake PDA, so a credit to the PDA owner is the
  // staked principal landing in the program-owned vault.
  const credited = ownerCreditedBase(tx, realmStakePda(args.realmId).toBase58(), args.mint);
  if (credited !== args.expectedAmount) return { ok: false, reason: 'wrong_vault_amount' };

  // The linked staker wallet must be the one that funded it (payer-bound).
  if (ownerSpentBase(tx, args.stakerWallet, args.mint) < args.expectedAmount) {
    return { ok: false, reason: 'wrong_payer' };
  }

  return { ok: true, amountBase: credited };
}

// Record a verified stake and bring its realm online, atomically: flip the realm
// active, insert the (ledger-quarantined) stake row, and grant the owner role.
// The realm_stakes UNIQUE(lock_tx_sig) is the replay guard, so a re-confirmed
// signature throws 23505 and the transaction rolls back (no double-provision).
export async function recordProvisionedStake(
  pool: Pool,
  s: {
    realmId: number;
    accountId: number;
    stakerWallet: string;
    mint: string;
    amountBase: bigint;
    tier: number;
    lockTxSig: string;
  },
): Promise<RealmStakeRow> {
  const stakePda = realmStakePda(s.realmId);
  const vault = realmVaultAddress(stakePda, new PublicKey(s.mint)).toBase58();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stake = await insertStake(client, {
      realmId: s.realmId,
      accountId: s.accountId,
      ownerWallet: s.stakerWallet,
      pda: stakePda.toBase58(),
      vault,
      mint: s.mint,
      amountBase: s.amountBase,
      tier: s.tier,
      lockTxSig: s.lockTxSig,
    });
    await activateRealm(client, s.realmId);
    await addRealmRole(client, s.realmId, s.accountId, 'owner', s.accountId);
    await client.query('COMMIT');
    return stake;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
