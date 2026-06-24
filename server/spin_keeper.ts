// The spin-settlement keeper: turns pending spin claims into on-chain SOL
// payouts. It is pure orchestration over already-tested pieces (the payoutIx
// encoder + EngagementService.settleSpin/failSpin) with the actual sign+send
// injected, so the batch logic (which spins to pay, what to do on success vs a
// send failure, how to handle a zero-prize spin) is unit-testable without a
// cluster. The production wiring builds `send` from a Connection + the keeper
// Keypair (server/buyback.ts is the reference for keeper signing) and runs
// settlePendingSpins on a setInterval, gated on spinSettleReady(cfg).
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { payoutIx } from './woc_spin_vault_client';
import type { EngagementService } from './engagement_service';
import type { EngagementDb } from './engagement_db';

export interface KeeperDeps {
  programId: PublicKey;
  settler: PublicKey;
  /** Resolve an account's registered payout wallet (base58), or null if unlinked. */
  walletForAccount: (accountId: number) => Promise<string | null>;
  /** Sign + send the payout instruction on-chain, returning the signature. */
  send: (ix: TransactionInstruction) => Promise<string>;
  /** Max spins to settle per pass (default 25). */
  batchLimit?: number;
}

export interface SettleSummary {
  settled: number;
  failed: number;
  skipped: number;
}

/**
 * Settle one batch of pending spins. For each:
 *  - a zero-prize spin (the common no-win outcome) needs no on-chain tx and is
 *    settled with a sentinel signature;
 *  - a winning spin for a linked account is paid via payoutIx, then settled with
 *    the on-chain signature, or marked failed if the send throws (so the batch
 *    continues and the spin can be retried);
 *  - a winning spin for an unlinked account is left pending (skipped) until the
 *    player links a wallet.
 * Idempotent at the spin level (settleSpin is), and the on-chain receipt PDA is
 * the ultimate double-pay guard.
 */
export async function settlePendingSpins(svc: EngagementService, db: EngagementDb, deps: KeeperDeps): Promise<SettleSummary> {
  const pending = await db.listPendingSpins(deps.batchLimit ?? 25);
  const summary: SettleSummary = { settled: 0, failed: 0, skipped: 0 };

  for (const spin of pending) {
    if (spin.lamports <= 0n) {
      await svc.settleSpin(spin.id, 'no-payout');
      summary.settled++;
      continue;
    }
    const wallet = await deps.walletForAccount(spin.accountId);
    if (!wallet) {
      summary.skipped++;
      continue;
    }
    const ix = payoutIx({
      programId: deps.programId,
      settler: deps.settler,
      winner: new PublicKey(wallet),
      day: BigInt(spin.utcDay),
      accountId: BigInt(spin.accountId),
      amount: spin.lamports,
    });
    let sig: string;
    // A failed send (expired blockhash, RPC error, on-chain revert) must not abort
    // the whole batch: mark this spin failed for retry and keep going.
    try {
      sig = await deps.send(ix);
    } catch {
      await svc.failSpin(spin.id);
      summary.failed++;
      continue;
    }
    await svc.settleSpin(spin.id, sig);
    summary.settled++;
  }
  return summary;
}
