// LpStakingService epoch runner over in-memory fakes: reservation through the
// flow ledger (the buy>sell invariant), idempotency across crashes and
// duplicate runs, forfeit-then-recycle ordering, and the adversarial case of a
// concurrent arena payout spending the same headroom.
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  emissionDecision,
  type FlowEntryInput,
  FlowLedger,
  type FlowLedgerDb,
} from '../server/flow_ledger';
import type { LpAccrualRow, LpEpochRow, LpPositionRow, LpStakingDb } from '../server/lp_staking_db';
import { type LpChainReader, LpStakingService } from '../server/lp_staking_service';

// The same in-memory FlowLedgerDb the devnet tests use: headroom is a fold over
// entries, outflows serialize through emissionDecision exactly like Postgres.
class MemFlowDb implements FlowLedgerDb {
  entries: { dir: 'in' | 'out'; amount: bigint; txSig: string | null; source: string }[] = [];
  open = true;
  async ensureSeason() {}
  async seasonHeadroom() {
    return this.entries.reduce((h, e) => (e.dir === 'in' ? h + e.amount : h - e.amount), 0n);
  }
  async seasonIsOpen() {
    return this.open;
  }
  async recordInflow(i: FlowEntryInput) {
    if (i.txSig && this.entries.some((e) => e.txSig === i.txSig))
      return { ok: false as const, reason: 'duplicate' as const };
    this.entries.push({
      dir: 'in',
      amount: i.amountBase,
      txSig: i.txSig ?? null,
      source: i.source,
    });
    return { ok: true as const };
  }
  async recordOutflowWithinBudget(i: FlowEntryInput) {
    if (i.txSig && this.entries.some((e) => e.txSig === i.txSig)) {
      return {
        ok: false as const,
        reason: 'duplicate' as const,
        headroomBase: await this.seasonHeadroom(),
      };
    }
    const headroomBase = await this.seasonHeadroom();
    const d = emissionDecision(headroomBase, i.amountBase);
    if (!d.allow) return { ok: false as const, reason: d.reason, headroomBase };
    this.entries.push({
      dir: 'out',
      amount: i.amountBase,
      txSig: i.txSig ?? null,
      source: i.source,
    });
    return { ok: true as const, headroomBase: await this.seasonHeadroom() };
  }
}

class MemLpDb implements LpStakingDb {
  rows = new Map<string, LpPositionRow>();
  epochs = new Map<string, LpEpochRow>();
  accruals: LpAccrualRow[] = [];
  private nextId = 1;
  async positions(poolKey: string) {
    return [...this.rows.values()].filter((r) => r.pool === poolKey);
  }
  async upsertPositions(rows: LpPositionRow[]) {
    for (const r of rows) this.rows.set(`${r.pool}:${r.owner}`, { ...r });
  }
  async epoch(poolKey: string, epochId: bigint) {
    return this.epochs.get(`${poolKey}:${epochId}`) ?? null;
  }
  async insertEpochWithAccruals(
    epoch: Omit<LpEpochRow, 'status'>,
    accruals: Omit<LpAccrualRow, 'accrualId' | 'forfeitedBase' | 'paidBase'>[],
  ) {
    const key = `${epoch.pool}:${epoch.epochId}`;
    if (this.epochs.has(key)) throw new Error('duplicate epoch');
    this.epochs.set(key, { ...epoch, status: 'pending' });
    for (const a of accruals) {
      this.accruals.push({ ...a, accrualId: this.nextId++, forfeitedBase: 0n, paidBase: 0n });
    }
  }
  async setEpochStatus(poolKey: string, epochId: bigint, status: 'reserved' | 'void') {
    const e = this.epochs.get(`${poolKey}:${epochId}`);
    if (e) e.status = status;
  }
  async openAccrualsForOwner(poolKey: string, owner: string) {
    return this.accruals.filter(
      (a) =>
        a.pool === poolKey &&
        a.owner === owner &&
        this.epochs.get(`${a.pool}:${a.epochId}`)?.status === 'reserved' &&
        a.amountBase - a.forfeitedBase - a.paidBase > 0n,
    );
  }
  async addForfeit(accrualId: number, forfeitBase: bigint) {
    const a = this.accruals.find((x) => x.accrualId === accrualId);
    if (a && a.forfeitedBase + a.paidBase + forfeitBase <= a.amountBase)
      a.forfeitedBase += forfeitBase;
  }
  async outstandingBase(poolKey: string) {
    return this.accruals
      .filter(
        (a) =>
          a.pool === poolKey && this.epochs.get(`${a.pool}:${a.epochId}`)?.status === 'reserved',
      )
      .reduce((s, a) => s + (a.amountBase - a.forfeitedBase - a.paidBase), 0n);
  }
}

type ChainPos = { owner: string; amountBase: bigint; lockedUntil: number; stakedAt: number };

function chainOf(positions: () => ChainPos[]): LpChainReader {
  return {
    positions: async () => positions(),
    position: async (owner: PublicKey) => {
      const p = positions().find((x) => x.owner === owner.toBase58());
      return p
        ? { amountBase: p.amountBase, lockedUntil: p.lockedUntil, stakedAt: p.stakedAt }
        : null;
    },
    latestBlockhash: async () => ({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1,
    }),
  };
}

const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const HOUR = 3600;

function setup(over: { rate?: bigint; capBps?: number; vest?: number } = {}) {
  const flow = new MemFlowDb();
  const ledger = new FlowLedger(flow);
  const db = new MemLpDb();
  let chain: ChainPos[] = [];
  let nowMs = 1_750_000_000_000;
  const svc = new LpStakingService({
    cfg: {
      programId: new PublicKey('9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6'),
      lpMint: Keypair.generate().publicKey,
      seasonId: 7,
      epochSeconds: HOUR,
      vestSeconds: over.vest ?? 10 * HOUR,
      emissionRateBase: over.rate ?? 1_000n,
      headroomCapBps: over.capBps ?? 5_000,
    },
    chain: chainOf(() => chain),
    db,
    ledger,
    now: () => nowMs,
  });
  return {
    svc,
    flow,
    ledger,
    db,
    setChain: (c: ChainPos[]) => {
      chain = c;
    },
    advance: (seconds: number) => {
      nowMs += seconds * 1000;
    },
    nowSec: () => Math.floor(nowMs / 1000),
    fund: (amount: bigint, sig: string) =>
      ledger.creditInflow({
        seasonId: 7,
        source: 'marketplace_buyback',
        amountBase: amount,
        txSig: sig,
      }),
  };
}

describe('epoch reservation', () => {
  it('reserves the emission through the ledger and books pro-rata accruals', async () => {
    const t = setup();
    await t.fund(10_000n, 'buy1');
    t.setChain([
      { owner: A, amountBase: 300n, lockedUntil: 0, stakedAt: 1 },
      { owner: B, amountBase: 100n, lockedUntil: t.nowSec() + 360 * 86_400, stakedAt: 1 }, // 5x
    ]);
    const r = await t.svc.runEpochIfDue();
    expect(r.ran).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.emissionBase).toBe(1_000n); // weights 300 + 500, shares 375 + 625
    expect(await t.ledger.headroom(7)).toBe(9_000n);
    const a = await t.db.openAccrualsForOwner(t.svc.pool(), A);
    const b = await t.db.openAccrualsForOwner(t.svc.pool(), B);
    expect(a[0].amountBase).toBe(375n);
    expect(b[0].amountBase).toBe(625n);
  });

  it('emissions never exceed inflows, even with an absurd configured rate', async () => {
    const t = setup({ rate: 2n ** 80n, capBps: 10_000 });
    await t.fund(500n, 'buy1');
    t.setChain([{ owner: A, amountBase: 1n, lockedUntil: 0, stakedAt: 1 }]);
    const r = await t.svc.runEpochIfDue();
    expect(r.emissionBase).toBe(500n);
    expect(await t.ledger.headroom(7)).toBe(0n);
    // and the next epoch, with zero headroom, emits nothing at all
    t.advance(HOUR);
    const r2 = await t.svc.runEpochIfDue();
    expect(r2.reason).toBe('no_budget');
    expect(r2.emissionBase).toBe(0n);
  });

  it('one epoch per window: the second run in the same hour is a no-op', async () => {
    const t = setup();
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    const r1 = await t.svc.runEpochIfDue();
    const r2 = await t.svc.runEpochIfDue();
    expect(r1.ran).toBe(true);
    expect(r2.ran).toBe(false);
    expect(t.flow.entries.filter((e) => e.dir === 'out')).toHaveLength(1);
  });

  it('crash recovery: a pending epoch whose reservation already landed is not double-emitted', async () => {
    const t = setup();
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    await t.svc.runEpochIfDue();
    // simulate a crash after ledger.emit but before the status flip
    const epochId = BigInt(Math.floor(t.nowSec() / HOUR));
    await t.db.setEpochStatus(t.svc.pool(), epochId, 'void');
    const e = await t.db.epoch(t.svc.pool(), epochId);
    if (e) e.status = 'pending';
    await t.svc.runEpochIfDue(); // resumes: ledger says duplicate, status flips to reserved
    expect((await t.db.epoch(t.svc.pool(), epochId))?.status).toBe('reserved');
    expect(t.flow.entries.filter((e2) => e2.dir === 'out')).toHaveLength(1);
  });

  it('adversarial concurrency: an arena payout draining headroom between compute and emit voids the epoch', async () => {
    const t = setup({ rate: 800n, capBps: 10_000 });
    await t.fund(1_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    // interpose: drain the season the moment the epoch tries to reserve
    const realEmit = t.flow.recordOutflowWithinBudget.bind(t.flow);
    let drained = false;
    t.flow.recordOutflowWithinBudget = async (i) => {
      if (!drained && i.source === 'lp_emission') {
        drained = true;
        await realEmit({
          seasonId: 7,
          source: 'gamblefi_payout',
          amountBase: 900n,
          txSig: 'arena1',
        });
      }
      return realEmit(i);
    };
    const r = await t.svc.runEpochIfDue();
    expect(r.reason).toBe('budget_exceeded');
    expect(r.emissionBase).toBe(0n);
    const epochId = BigInt(Math.floor(t.nowSec() / HOUR));
    expect((await t.db.epoch(t.svc.pool(), epochId))?.status).toBe('void');
    // headroom was never overdrawn
    expect(await t.ledger.headroom(7)).toBe(100n);
    // and the voided epoch's accruals are not part of the outstanding book
    expect(await t.db.outstandingBase(t.svc.pool())).toBe(0n);
  });

  it('an empty pool books a void epoch and reserves nothing', async () => {
    const t = setup();
    await t.fund(10_000n, 'buy1');
    t.setChain([]);
    const r = await t.svc.runEpochIfDue();
    expect(r.reason).toBe('nothing_staked');
    expect(t.flow.entries.filter((e) => e.dir === 'out')).toHaveLength(0);
  });
});

describe('unstake forfeits (anti-mercenary)', () => {
  it('a full exit forfeits unvested accruals and recycles them into headroom', async () => {
    const t = setup({ vest: 10 * HOUR });
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    const r1 = await t.svc.runEpochIfDue();
    expect(r1.emissionBase).toBe(1_000n);
    const afterEpoch1 = await t.ledger.headroom(7);

    // one hour later (10% vested) the staker rugs completely
    t.advance(HOUR);
    t.setChain([]);
    const r2 = await t.svc.runEpochIfDue();
    expect(r2.reason).toBe('nothing_staked');
    expect(r2.forfeitedBase).toBe(900n); // 90% of 1000 was unvested
    expect(await t.ledger.headroom(7)).toBe(afterEpoch1 + 900n);
    const remaining = t.db.accruals[0];
    expect(remaining.forfeitedBase).toBe(900n);
    // the vested 100 stays claimable, nothing more
    const view = await t.svc.positionView(new PublicKey(A));
    expect(view?.claimableBase).toBe('100');
  });

  it('a partial unstake forfeits proportionally and leaves the rest vesting', async () => {
    const t = setup({ vest: 10 * HOUR });
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    await t.svc.runEpochIfDue();
    t.advance(HOUR);
    t.setChain([{ owner: A, amountBase: 60n, lockedUntil: 0, stakedAt: 1 }]); // removed 40%
    const r = await t.svc.runEpochIfDue();
    expect(r.forfeitedBase).toBe(360n); // 40% of the 900 unvested
    expect(t.db.accruals[0].forfeitedBase).toBe(360n);
    // the recycle inflow is on the ledger with the synthetic sig
    expect(t.flow.entries.some((e) => e.source === 'lp_forfeit_recycle' && e.amount === 360n)).toBe(
      true,
    );
  });

  it('forfeit recycling is idempotent per epoch (a re-run cannot double-credit)', async () => {
    const t = setup({ vest: 10 * HOUR });
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    await t.svc.runEpochIfDue();
    t.advance(HOUR);
    t.setChain([]);
    await t.svc.runEpochIfDue();
    const credits = () => t.flow.entries.filter((e) => e.source === 'lp_forfeit_recycle');
    expect(credits()).toHaveLength(1);
    // a duplicate inflow with the same synthetic sig is refused by the ledger
    const dup = await t.ledger.creditInflow({
      seasonId: 7,
      source: 'lp_forfeit_recycle',
      amountBase: 900n,
      txSig: credits()[0].txSig,
    });
    expect(dup.ok).toBe(false);
    expect(credits()).toHaveLength(1);
  });
});

describe('reads and tx builders', () => {
  it('summary reports headroom, outstanding book, and stake totals', async () => {
    const t = setup();
    await t.fund(10_000n, 'buy1');
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    await t.svc.runEpochIfDue();
    const s = await t.svc.summary();
    expect(s.seasonId).toBe(7);
    expect(s.headroomBase).toBe('9000');
    expect(s.outstandingBase).toBe('1000');
    expect(s.totalStakedBase).toBe('100');
    expect(s.stakers).toBe(1);
    expect(s.tiers.map((x) => x.key)).toEqual(['drift', 'ripple', 'tide', 'undertow', 'maelstrom']);
  });

  it('positionView reports tier, weight, and vesting state', async () => {
    const t = setup({ vest: 10 * HOUR });
    await t.fund(10_000n, 'buy1');
    // 366d so the remaining lock stays above the 360d maelstrom floor after we
    // advance 5 hours (the ve-decay boundary is exercised in lp_staking.test.ts)
    const locked = t.nowSec() + 366 * 86_400;
    t.setChain([{ owner: A, amountBase: 100n, lockedUntil: locked, stakedAt: 1 }]);
    await t.svc.runEpochIfDue();
    t.advance(5 * HOUR);
    const v = await t.svc.positionView(new PublicKey(A));
    expect(v?.tierKey).toBe('maelstrom');
    expect(v?.weightBase).toBe('500');
    expect(v?.accruedBase).toBe('1000');
    expect(v?.vestedBase).toBe('500');
    expect(v?.claimableBase).toBe('500');
    expect(await t.svc.positionView(Keypair.generate().publicKey)).toBeNull();
  });

  it('stake tx prepends open_position only for first-time stakers', async () => {
    const t = setup();
    t.setChain([]);
    const owner = Keypair.generate().publicKey;
    const first = await t.svc.buildStakeTx(owner, 100n, 0);
    expect(first.instructions).toHaveLength(2);
    t.setChain([{ owner: owner.toBase58(), amountBase: 100n, lockedUntil: 0, stakedAt: 1 }]);
    const again = await t.svc.buildStakeTx(owner, 100n, 0);
    expect(again.instructions).toHaveLength(1);
    expect(first.feePayer?.equals(owner)).toBe(true);
  });

  it('tx builders refuse malformed amounts and locks', async () => {
    const t = setup();
    const owner = Keypair.generate().publicKey;
    await expect(t.svc.buildStakeTx(owner, 0n, 0)).rejects.toThrow();
    await expect(t.svc.buildStakeTx(owner, 1n, 400 * 86_400)).rejects.toThrow();
    await expect(t.svc.buildUnstakeTx(owner, -1n)).rejects.toThrow();
    await expect(t.svc.buildExtendLockTx(owner, 0)).rejects.toThrow();
  });
});
