// The LP staking service: the composable glue between the woc_lp_vault program,
// the #799 flow ledger, and the reward book (lp_staking_db.ts). Like
// arena_wager_service.ts it takes injected dependencies and imports NOTHING
// that touches the DB or env, so every path is unit-tested with fakes;
// lp_staking_boot.ts wires production dependencies and is loaded only by the
// server entrypoint.
//
// The epoch model (see PLAN.md on the branch): once per epoch the runner
//  1. snapshots the on-chain positions,
//  2. syncs the DB mirror and settles unstake forfeits (unvested accruals
//     forfeit pro rata; the forfeit is credited back to the season as an
//     lp_forfeit_recycle inflow AFTER it is durably recorded on the accrual,
//     so a crash can only ever UNDER-credit headroom, never over-emit),
//  3. computes the emission budget (configured rate, capped to a share of the
//     season's current flow-ledger headroom),
//  4. writes the epoch + per-staker accrual rows (pending), then
//  5. reserves the emission through ledger.emit with the synthetic signature
//     lp_epoch:<pool>:<epoch>. The UNIQUE tx_sig makes the reservation
//     idempotent across crashes and sibling realm processes; budget_exceeded
//     voids the epoch (nothing accrues, nothing is owed).
// Accruals vest linearly (lp_staking.ts); payment is the fee-share
// distributor's job (stacked branch), never this module's.
import {
  type Connection,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { FlowLedger } from './flow_ledger';
import {
  epochEmissionBudget,
  forfeitOnUnstake,
  type PositionSnapshot,
  positionWeight,
  splitEpochEmission,
  VE_LP_TIERS,
  veLpTierForRemainingLock,
  vestedAmount,
} from './lp_staking';
import type { LpAccrualRow, LpPositionRow, LpStakingDb } from './lp_staking_db';
import {
  closePositionIx,
  decodePosition,
  extendLockIx,
  openPositionIx,
  POSITION_ACCOUNT_SIZE,
  poolPda,
  positionPda,
  stakeIx,
  unstakeIx,
} from './lp_vault_client';

export const MAX_LOCK_SECONDS = 366 * 24 * 60 * 60; // mirrors the program constant (lib.rs)

export interface LpStakingConfig {
  programId: PublicKey;
  lpMint: PublicKey;
  seasonId: number;
  epochSeconds: number;
  vestSeconds: number;
  /** Base units accrued per epoch across all stakers; 0n = accrual dark. */
  emissionRateBase: bigint;
  /** Max share (bps) of the season's CURRENT headroom one epoch may reserve. */
  headroomCapBps: number;
}

export interface LpChainReader {
  /** All Position accounts of the pool, decoded (getProgramAccounts). */
  positions(): Promise<
    { owner: string; amountBase: bigint; lockedUntil: number; stakedAt: number }[]
  >;
  /** One staker's position, or null if none exists on chain. */
  position(
    owner: PublicKey,
  ): Promise<{ amountBase: bigint; lockedUntil: number; stakedAt: number } | null>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

export interface LpStakingServiceDeps {
  cfg: LpStakingConfig;
  chain: LpChainReader;
  db: LpStakingDb;
  ledger: FlowLedger;
  now: () => number; // ms epoch
}

export interface EpochRunResult {
  ran: boolean;
  reason?: 'not_due' | 'nothing_staked' | 'no_budget' | 'budget_exceeded';
  epochId?: bigint;
  emissionBase?: bigint;
  forfeitedBase?: bigint;
  stakers?: number;
}

export interface LpSummary {
  poolKey: string;
  lpMint: string;
  seasonId: number;
  epochSeconds: number;
  vestSeconds: number;
  headroomBase: string;
  outstandingBase: string;
  totalStakedBase: string;
  stakers: number;
  tiers: { key: string; minRemainingLockSeconds: number; multiplierBps: number }[];
}

export interface LpPositionView {
  owner: string;
  stakedBase: string;
  lockedUntil: number;
  weightBase: string;
  tierKey: string;
  accruedBase: string;
  vestedBase: string;
  claimableBase: string;
  forfeitedBase: string;
  paidBase: string;
}

export class LpStakingService {
  private readonly poolKey: string;

  constructor(private readonly d: LpStakingServiceDeps) {
    this.poolKey = poolPda(d.cfg.programId, d.cfg.lpMint).toBase58();
  }

  pool(): string {
    return this.poolKey;
  }

  // ----- epoch runner -----

  /**
   * Run at most one epoch per epochSeconds window; safe to call every tick.
   * Idempotent across crashes and sibling processes: the epoch row is keyed
   * (pool, epoch_id) and the ledger reservation carries a synthetic UNIQUE sig.
   */
  async runEpochIfDue(): Promise<EpochRunResult> {
    const nowSec = Math.floor(this.d.now() / 1000);
    const epochId = BigInt(Math.floor(nowSec / this.d.cfg.epochSeconds));
    const existing = await this.d.db.epoch(this.poolKey, epochId);
    if (existing) {
      // A previous run crashed between insert and reservation: finish it.
      if (existing.status === 'pending') await this.reserve(epochId, existing.emissionBase);
      return { ran: false, reason: 'not_due', epochId };
    }

    const chainPositions = await this.d.chain.positions();
    const forfeitedBase = await this.syncMirrorAndForfeits(chainPositions, nowSec, epochId);

    const snapshots: PositionSnapshot[] = chainPositions.map((p) => ({
      owner: p.owner,
      amountBase: p.amountBase,
      lockedUntil: p.lockedUntil,
    }));
    const totalWeight = snapshots.reduce((a, p) => a + positionWeight(p, nowSec), 0n);
    const headroomBase = await this.d.ledger.headroom(this.d.cfg.seasonId);
    const budget = epochEmissionBudget({
      rateBase: this.d.cfg.emissionRateBase,
      headroomBase,
      headroomCapBps: this.d.cfg.headroomCapBps,
      totalWeight,
    });
    const shares = splitEpochEmission(budget, snapshots, nowSec);
    const emissionBase = shares.reduce((a, s) => a + s.amountBase, 0n);

    await this.d.db.insertEpochWithAccruals(
      {
        pool: this.poolKey,
        epochId,
        seasonId: this.d.cfg.seasonId,
        snapshotAt: nowSec,
        totalWeight,
        emissionBase,
      },
      shares.map((s) => ({
        pool: this.poolKey,
        epochId,
        owner: s.owner,
        amountBase: s.amountBase,
        accruedAt: nowSec,
      })),
    );
    if (emissionBase === 0n) {
      await this.d.db.setEpochStatus(this.poolKey, epochId, 'void');
      return {
        ran: true,
        reason: totalWeight === 0n ? 'nothing_staked' : 'no_budget',
        epochId,
        emissionBase: 0n,
        forfeitedBase,
        stakers: 0,
      };
    }
    const reserved = await this.reserve(epochId, emissionBase);
    return {
      ran: true,
      reason: reserved ? undefined : 'budget_exceeded',
      epochId,
      emissionBase: reserved ? emissionBase : 0n,
      forfeitedBase,
      stakers: shares.length,
    };
  }

  /** Reserve the epoch's emission through the flow ledger (the buy>sell gate). */
  private async reserve(epochId: bigint, emissionBase: bigint): Promise<boolean> {
    const r = await this.d.ledger.emit({
      seasonId: this.d.cfg.seasonId,
      source: 'lp_emission',
      amountBase: emissionBase,
      txSig: `lp_epoch:${this.poolKey}:${epochId}`,
      recipient: `lp_pool:${this.poolKey}`,
      memo: `LP mining epoch ${epochId}`,
    });
    // 'duplicate' means a prior crashed run already reserved this exact epoch.
    const reserved = r.ok || r.reason === 'duplicate';
    await this.d.db.setEpochStatus(this.poolKey, epochId, reserved ? 'reserved' : 'void');
    return reserved;
  }

  /**
   * Bring the DB mirror up to the chain snapshot. Any position whose amount
   * SHRANK unstaked since the last epoch: forfeit the same fraction of every
   * unvested accrual (durably, capped by the row guard) and only then credit
   * the total back to the season as an lp_forfeit_recycle inflow.
   */
  private async syncMirrorAndForfeits(
    chainPositions: { owner: string; amountBase: bigint; lockedUntil: number; stakedAt: number }[],
    nowSec: number,
    epochId: bigint,
  ): Promise<bigint> {
    const previous = new Map((await this.d.db.positions(this.poolKey)).map((p) => [p.owner, p]));
    const seen = new Set<string>();
    let totalForfeit = 0n;

    for (const cp of chainPositions) {
      seen.add(cp.owner);
      const prev = previous.get(cp.owner);
      if (prev && cp.amountBase < prev.amountBase) {
        totalForfeit += await this.forfeitFor(
          cp.owner,
          prev.amountBase - cp.amountBase,
          prev.amountBase,
          nowSec,
        );
      }
    }
    // A position that vanished from the chain (unstaked fully + closed) is a
    // full exit: forfeit everything unvested, then zero the mirror row.
    const rows: LpPositionRow[] = chainPositions.map((cp) => ({
      pool: this.poolKey,
      owner: cp.owner,
      amountBase: cp.amountBase,
      lockedUntil: cp.lockedUntil,
      stakedAt: cp.stakedAt,
    }));
    for (const [owner, prev] of previous) {
      if (seen.has(owner) || prev.amountBase <= 0n) continue;
      totalForfeit += await this.forfeitFor(owner, prev.amountBase, prev.amountBase, nowSec);
      rows.push({ pool: this.poolKey, owner, amountBase: 0n, lockedUntil: 0, stakedAt: 0 });
    }
    await this.d.db.upsertPositions(rows);

    if (totalForfeit > 0n) {
      const r = await this.d.ledger.creditInflow({
        seasonId: this.d.cfg.seasonId,
        source: 'lp_forfeit_recycle',
        amountBase: totalForfeit,
        txSig: `lp_forfeit:${this.poolKey}:${epochId}`,
        memo: 'unvested LP accruals forfeited on unstake',
      });
      // duplicate = a crashed run already credited this epoch's forfeits;
      // season_closed = the recycle is simply lost to the closed season (safe:
      // headroom is under-credited, the invariant cannot be violated).
      if (!r.ok && r.reason !== 'duplicate' && r.reason !== 'season_closed') {
        throw new Error(`lp forfeit recycle rejected: ${r.reason}`);
      }
    }
    return totalForfeit;
  }

  private async forfeitFor(
    owner: string,
    removedBase: bigint,
    positionBase: bigint,
    nowSec: number,
  ): Promise<bigint> {
    const accruals = await this.d.db.openAccrualsForOwner(this.poolKey, owner);
    let total = 0n;
    for (const a of accruals) {
      const vested = vestedAmount(
        { amountBase: a.amountBase, accruedAtSeconds: a.accruedAt },
        this.d.cfg.vestSeconds,
        nowSec,
      );
      const forfeit = forfeitOnUnstake({
        accrualAmountBase: a.amountBase,
        vestedBase: vested,
        alreadyForfeitedBase: a.forfeitedBase,
        removedBase,
        positionBase,
      });
      if (forfeit <= 0n) continue;
      await this.d.db.addForfeit(a.accrualId, forfeit);
      total += forfeit;
    }
    return total;
  }

  // ----- read models -----

  async summary(): Promise<LpSummary> {
    const [headroom, outstanding, mirror] = await Promise.all([
      this.d.ledger.headroom(this.d.cfg.seasonId),
      this.d.db.outstandingBase(this.poolKey),
      this.d.db.positions(this.poolKey),
    ]);
    const active = mirror.filter((p) => p.amountBase > 0n);
    return {
      poolKey: this.poolKey,
      lpMint: this.d.cfg.lpMint.toBase58(),
      seasonId: this.d.cfg.seasonId,
      epochSeconds: this.d.cfg.epochSeconds,
      vestSeconds: this.d.cfg.vestSeconds,
      headroomBase: headroom.toString(),
      outstandingBase: outstanding.toString(),
      totalStakedBase: active.reduce((a, p) => a + p.amountBase, 0n).toString(),
      stakers: active.length,
      tiers: VE_LP_TIERS.map((t) => ({
        key: t.key,
        minRemainingLockSeconds: t.minRemainingLockSeconds,
        multiplierBps: t.multiplierBps,
      })),
    };
  }

  async positionView(owner: PublicKey): Promise<LpPositionView | null> {
    const chain = await this.d.chain.position(owner);
    const accruals = await this.d.db.openAccrualsForOwner(this.poolKey, owner.toBase58());
    if (!chain && accruals.length === 0) return null;
    const nowSec = Math.floor(this.d.now() / 1000);
    const snapshot: PositionSnapshot = {
      owner: owner.toBase58(),
      amountBase: chain?.amountBase ?? 0n,
      lockedUntil: chain?.lockedUntil ?? 0,
    };
    const remaining = Math.max(0, snapshot.lockedUntil - nowSec);
    const tier = veLpTierForRemainingLock(remaining);
    const totals = accruals.reduce(
      (acc, a) => {
        const vested = vestedAmount(
          { amountBase: a.amountBase, accruedAtSeconds: a.accruedAt },
          this.d.cfg.vestSeconds,
          nowSec,
        );
        const cappedVested =
          vested > a.amountBase - a.forfeitedBase ? a.amountBase - a.forfeitedBase : vested;
        acc.accrued += a.amountBase;
        acc.vested += cappedVested;
        acc.claimable += cappedVested - a.paidBase > 0n ? cappedVested - a.paidBase : 0n;
        acc.forfeited += a.forfeitedBase;
        acc.paid += a.paidBase;
        return acc;
      },
      { accrued: 0n, vested: 0n, claimable: 0n, forfeited: 0n, paid: 0n },
    );
    return {
      owner: owner.toBase58(),
      stakedBase: snapshot.amountBase.toString(),
      lockedUntil: snapshot.lockedUntil,
      weightBase: positionWeight(snapshot, nowSec).toString(),
      tierKey: tier.key,
      accruedBase: totals.accrued.toString(),
      vestedBase: totals.vested.toString(),
      claimableBase: totals.claimable.toString(),
      forfeitedBase: totals.forfeited.toString(),
      paidBase: totals.paid.toString(),
    };
  }

  // ----- unsigned transaction builders (non-custodial: the staker signs) -----

  /** Unsigned stake tx; prepends open_position when the staker has none yet. */
  async buildStakeTx(
    owner: PublicKey,
    amountBase: bigint,
    lockSeconds: number,
  ): Promise<Transaction> {
    if (amountBase <= 0n) throw new Error('stake amount must be positive');
    if (!Number.isInteger(lockSeconds) || lockSeconds < 0 || lockSeconds > MAX_LOCK_SECONDS) {
      throw new Error('lock duration out of range');
    }
    const ids = { programId: this.d.cfg.programId, lpMint: this.d.cfg.lpMint };
    const existing = await this.d.chain.position(owner);
    const ixs = existing
      ? [stakeIx({ ...ids, owner, amountBase, lockSeconds })]
      : [openPositionIx({ ...ids, owner }), stakeIx({ ...ids, owner, amountBase, lockSeconds })];
    return this.unsigned(ixs, owner);
  }

  async buildUnstakeTx(owner: PublicKey, amountBase: bigint): Promise<Transaction> {
    if (amountBase <= 0n) throw new Error('unstake amount must be positive');
    const ids = { programId: this.d.cfg.programId, lpMint: this.d.cfg.lpMint };
    return this.unsigned([unstakeIx({ ...ids, owner, amountBase })], owner);
  }

  async buildExtendLockTx(owner: PublicKey, lockSeconds: number): Promise<Transaction> {
    if (!Number.isInteger(lockSeconds) || lockSeconds <= 0 || lockSeconds > MAX_LOCK_SECONDS) {
      throw new Error('lock duration out of range');
    }
    const ids = { programId: this.d.cfg.programId, lpMint: this.d.cfg.lpMint };
    return this.unsigned([extendLockIx({ ...ids, owner, lockSeconds })], owner);
  }

  async buildClosePositionTx(owner: PublicKey): Promise<Transaction> {
    const ids = { programId: this.d.cfg.programId, lpMint: this.d.cfg.lpMint };
    return this.unsigned([closePositionIx({ ...ids, owner })], owner);
  }

  private async unsigned(ixs: TransactionInstruction[], feePayer: PublicKey): Promise<Transaction> {
    const { blockhash, lastValidBlockHeight } = await this.d.chain.latestBlockhash();
    return new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...ixs);
  }
}

/** The staker's on-chain position PDA (exported for route validation/tests). */
export function positionAddress(
  cfg: Pick<LpStakingConfig, 'programId' | 'lpMint'>,
  owner: PublicKey,
): PublicKey {
  return positionPda(cfg.programId, poolPda(cfg.programId, cfg.lpMint), owner);
}

/** Production LpChainReader over a web3 Connection (used by the boot wiring). */
export function connectionChainReader(
  connection: Connection,
  cfg: Pick<LpStakingConfig, 'programId' | 'lpMint'>,
): LpChainReader {
  const pool = poolPda(cfg.programId, cfg.lpMint);
  return {
    async positions() {
      const accounts = await connection.getProgramAccounts(cfg.programId, {
        filters: [
          { dataSize: POSITION_ACCOUNT_SIZE },
          { memcmp: { offset: 8, bytes: pool.toBase58() } },
        ],
      });
      return accounts.map((a) => {
        const p = decodePosition(a.account.data);
        return {
          owner: p.owner.toBase58(),
          amountBase: p.amount,
          lockedUntil: Number(p.lockedUntil),
          stakedAt: Number(p.stakedAt),
        };
      });
    },
    async position(owner) {
      const info = await connection.getAccountInfo(positionAddress(cfg, owner));
      if (!info) return null;
      const p = decodePosition(info.data);
      return {
        amountBase: p.amount,
        lockedUntil: Number(p.lockedUntil),
        stakedAt: Number(p.stakedAt),
      };
    },
    latestBlockhash: () => connection.getLatestBlockhash(),
  };
}
