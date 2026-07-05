// The LP fee-share DISTRIBUTOR: pays the vested, unpaid part of the branch-1
// accrual book to stakers' wallets from the LP season's woc_escrow
// distribution vault, keeper-style (durable intent before broadcast, confirm
// by polled signature, recover in-flight rows first).
//
// Accounting discipline: there is NO ledger emit here. The emission was
// reserved (budget-gated, idempotent) when the epoch accrued; paying it out
// through emit again would double-count. Two independent ceilings still bound
// every payment: the accrual book (paid_base is guard-capped per accrual, and
// only vested amounts are ever allocated) and the on-chain payout instruction
// (authority-only, never more than the funded vault balance).
//
// Vesting math note: an in-flight allocation can never be invalidated by a
// racing unstake forfeit, because forfeits only ever claw back the UNVESTED
// remainder and vesting is monotone in time; the confirmLpPayout row guard is
// defense in depth, not a correctness dependency.

import {
  type Connection,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { vestedAmount } from './lp_staking';
import type { LpAccrualRow, LpPayoutAllocation, LpStakingDb } from './lp_staking_db';
import {
  createAtaIdempotentIx,
  distributionPda,
  openDistributionIx,
  payoutIx,
  vaultAta,
} from './woc_escrow_client';

export interface LpDistributorPolicy {
  /** Dust floor: skip claimants below this (base units). */
  minPayoutBase: bigint;
  /** Max recipients paid per cycle (bounds RPC work per tick). */
  maxPerCycle: number;
  /** A broadcasting payout older than this whose sig will not confirm is dead
   *  (well past blockhash validity) and is marked failed for a fresh retry. */
  staleMs: number;
}

export const DEFAULT_LP_DISTRIBUTOR_POLICY: LpDistributorPolicy = {
  minPayoutBase: 1_000_000n,
  maxPerCycle: 50,
  staleMs: 10 * 60 * 1000,
};

export interface LpDistributorChain {
  /** The LP season distribution account exists on chain. */
  distributionExists(): Promise<boolean>;
  /** Sign open_distribution with the authority (first-run bootstrap). */
  signOpenDistribution(): Promise<{ signature: string; send(): Promise<void> }>;
  /** Current distribution-vault balance in base units. */
  vaultBalanceBase(): Promise<bigint>;
  /** Sign [create recipient ATA idempotent, payout(season, amount)]. */
  signPayout(
    recipient: PublicKey,
    amountBase: bigint,
  ): Promise<{ signature: string; send(): Promise<void> }>;
  confirm(signature: string): Promise<'confirmed' | 'failed' | 'unknown'>;
}

export interface LpDistributorDeps {
  poolKey: string;
  vestSeconds: number;
  chain: LpDistributorChain;
  db: Pick<
    LpStakingDb,
    | 'ownersWithOpenAccruals'
    | 'openAccrualsForOwner'
    | 'insertLpPayout'
    | 'broadcastingLpPayouts'
    | 'confirmLpPayout'
    | 'markLpPayoutFailed'
  >;
  policy: LpDistributorPolicy;
  now: () => number;
  newPayoutId: () => string;
  toPublicKey: (base58: string) => PublicKey;
}

export interface ClaimPlan {
  owner: string;
  amountBase: bigint;
  allocations: LpPayoutAllocation[];
}

/**
 * The claimable plan for one owner's accruals at `nowSec`: vested minus paid,
 * allocated oldest-accrual-first, optionally clamped to `capBase` (the
 * remaining vault balance). Pure.
 */
export function planClaim(
  owner: string,
  accruals: LpAccrualRow[],
  vestSeconds: number,
  nowSec: number,
  capBase: bigint,
): ClaimPlan {
  const allocations: LpPayoutAllocation[] = [];
  let total = 0n;
  for (const a of accruals) {
    if (total >= capBase) break;
    const vested = vestedAmount(
      { amountBase: a.amountBase, accruedAtSeconds: a.accruedAt },
      vestSeconds,
      nowSec,
    );
    const ceiling = a.amountBase - a.forfeitedBase;
    const capped = vested > ceiling ? ceiling : vested;
    let claimable = capped - a.paidBase;
    if (claimable <= 0n) continue;
    if (total + claimable > capBase) claimable = capBase - total;
    allocations.push({ accrualId: a.accrualId, amountBase: claimable });
    total += claimable;
  }
  return { owner, amountBase: total, allocations };
}

export interface LpDistributeResult {
  recovered: number;
  paid: number;
  paidBase: bigint;
  skipped: number;
}

export class LpDistributor {
  constructor(private readonly d: LpDistributorDeps) {}

  /**
   * One distribution cycle: recover in-flight payouts first (never two
   * payments against the same claim), bootstrap the on-chain distribution if
   * absent, then pay up to maxPerCycle claimants whose vested claim clears the
   * dust floor, each clamped to the remaining vault balance.
   */
  async runCycle(): Promise<LpDistributeResult> {
    const recovered = await this.recover();
    if (!(await this.d.chain.distributionExists())) {
      const open = await this.d.chain.signOpenDistribution();
      await open.send();
      const conf = await this.d.chain.confirm(open.signature);
      if (conf !== 'confirmed') return { recovered, paid: 0, paidBase: 0n, skipped: 0 };
    }

    const inFlightOwners = new Set(
      (await this.d.db.broadcastingLpPayouts(this.d.poolKey)).map((p) => p.owner),
    );
    const nowSec = Math.floor(this.d.now() / 1000);
    let vaultRemaining = await this.d.chain.vaultBalanceBase();
    let paid = 0;
    let paidBase = 0n;
    let skipped = 0;

    for (const owner of await this.d.db.ownersWithOpenAccruals(this.d.poolKey)) {
      if (paid >= this.d.policy.maxPerCycle) break;
      if (vaultRemaining <= 0n) break;
      if (inFlightOwners.has(owner)) {
        skipped += 1;
        continue;
      }
      const accruals = await this.d.db.openAccrualsForOwner(this.d.poolKey, owner);
      const plan = planClaim(owner, accruals, this.d.vestSeconds, nowSec, vaultRemaining);
      if (plan.amountBase < this.d.policy.minPayoutBase) {
        skipped += 1;
        continue;
      }
      const ok = await this.payClaim(plan);
      if (ok) {
        paid += 1;
        paidBase += plan.amountBase;
        vaultRemaining -= plan.amountBase;
      }
    }
    return { recovered, paid, paidBase, skipped };
  }

  private async payClaim(plan: ClaimPlan): Promise<boolean> {
    const tx = await this.d.chain.signPayout(this.d.toPublicKey(plan.owner), plan.amountBase);
    const payoutId = this.d.newPayoutId();
    // Durable intent BEFORE broadcast: a crash after this recovers by tx_sig.
    const fresh = await this.d.db.insertLpPayout({
      payoutId,
      pool: this.d.poolKey,
      owner: plan.owner,
      amountBase: plan.amountBase,
      txSig: tx.signature,
      allocations: plan.allocations,
    });
    if (!fresh) return false; // this signed payout is already tracked; recovery owns it
    await tx.send();
    const conf = await this.d.chain.confirm(tx.signature);
    if (conf === 'confirmed') {
      await this.d.db.confirmLpPayout(payoutId);
      return true;
    }
    if (conf === 'failed') {
      await this.d.db.markLpPayoutFailed(payoutId, 'payout tx reverted');
    }
    return false; // unknown: left broadcasting for the next cycle's recovery
  }

  /** Resolve in-flight payouts by their recorded signature, never by re-paying. */
  private async recover(): Promise<number> {
    const rows = await this.d.db.broadcastingLpPayouts(this.d.poolKey);
    let resolved = 0;
    for (const row of rows) {
      const conf = await this.d.chain.confirm(row.txSig);
      if (conf === 'confirmed') {
        await this.d.db.confirmLpPayout(row.payoutId);
        resolved += 1;
      } else if (conf === 'failed') {
        await this.d.db.markLpPayoutFailed(row.payoutId, 'payout tx reverted');
        resolved += 1;
      } else if (this.d.now() - new Date(row.createdAt).getTime() > this.d.policy.staleMs) {
        // Past any blockhash validity window and still unconfirmed: the tx is
        // dead and can never land, so the claim safely retries with a fresh tx.
        await this.d.db.markLpPayoutFailed(row.payoutId, 'payout tx expired unconfirmed');
        resolved += 1;
      }
    }
    return resolved;
  }
}

/** Build the production chain seam over a Connection + the authority keypair. */
export function distributionChain(cfg: {
  connection: Connection;
  programId: PublicKey;
  mint: PublicKey;
  seasonId: bigint;
  authority: Keypair;
  confirm: (sig: string) => Promise<'confirmed' | 'failed' | 'unknown'>;
}): LpDistributorChain {
  const distribution = distributionPda(cfg.programId, cfg.seasonId);
  const vault = vaultAta(distribution, cfg.mint);
  const signed = async (
    ixs: TransactionInstruction[],
  ): Promise<{ signature: string; send(): Promise<void> }> => {
    const { blockhash, lastValidBlockHeight } = await cfg.connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: cfg.authority.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(...ixs);
    tx.sign(cfg.authority);
    return {
      signature: bs58.encode(tx.signature!),
      send: async () => {
        await cfg.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 5,
        });
      },
    };
  };
  return {
    distributionExists: async () => (await cfg.connection.getAccountInfo(distribution)) !== null,
    signOpenDistribution: () =>
      signed([
        openDistributionIx({
          programId: cfg.programId,
          mint: cfg.mint,
          seasonId: cfg.seasonId,
          authority: cfg.authority.publicKey,
        }),
      ]),
    vaultBalanceBase: async () => {
      const info = await cfg.connection.getParsedAccountInfo(vault);
      const data = info.value?.data;
      if (!data || !('parsed' in data)) return 0n;
      return BigInt(data.parsed.info.tokenAmount.amount);
    },
    signPayout: (recipient, amountBase) =>
      signed([
        createAtaIdempotentIx({ payer: cfg.authority.publicKey, owner: recipient, mint: cfg.mint }),
        payoutIx({
          programId: cfg.programId,
          mint: cfg.mint,
          seasonId: cfg.seasonId,
          authority: cfg.authority.publicKey,
          recipient,
          amountBase,
        }),
      ]),
    confirm: cfg.confirm,
  };
}
