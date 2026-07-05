// The LP fee-share distributor over fakes: claim planning (vesting, forfeits,
// oldest-first allocation, vault clamp), the durable payout machine (intent
// before broadcast, confirm/failed/stale recovery, no double pay while a row
// is in flight), the dust floor, and the per-cycle cap.
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LP_DISTRIBUTOR_POLICY,
  LpDistributor,
  type LpDistributorChain,
  planClaim,
} from '../server/lp_distributor';
import type { LpAccrualRow, LpPayoutRow } from '../server/lp_staking_db';

const POOL = 'PoolKey111111111111111111111111111111111111';
const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();

const accrual = (over: Partial<LpAccrualRow>): LpAccrualRow => ({
  accrualId: 1,
  pool: POOL,
  epochId: 1n,
  owner: A,
  amountBase: 1_000n,
  accruedAt: 0,
  forfeitedBase: 0n,
  paidBase: 0n,
  ...over,
});

describe('planClaim (pure)', () => {
  const VEST = 100;
  it('claims only the vested, unpaid remainder, oldest accrual first', () => {
    const plan = planClaim(
      A,
      [
        accrual({ accrualId: 1, amountBase: 1_000n, accruedAt: 0, paidBase: 200n }),
        accrual({ accrualId: 2, amountBase: 1_000n, accruedAt: 50 }),
      ],
      VEST,
      100, // accrual 1 fully vested, accrual 2 half vested
      1_000_000n,
    );
    expect(plan.amountBase).toBe(800n + 500n);
    expect(plan.allocations).toEqual([
      { accrualId: 1, amountBase: 800n },
      { accrualId: 2, amountBase: 500n },
    ]);
  });
  it('never claims past the forfeit ceiling', () => {
    const plan = planClaim(
      A,
      [accrual({ amountBase: 1_000n, forfeitedBase: 700n, accruedAt: 0 })],
      VEST,
      1_000,
      1_000_000n,
    );
    expect(plan.amountBase).toBe(300n);
  });
  it('clamps to the vault cap mid-allocation', () => {
    const plan = planClaim(
      A,
      [accrual({ accrualId: 1, accruedAt: 0 }), accrual({ accrualId: 2, accruedAt: 0 })],
      VEST,
      1_000,
      1_500n,
    );
    expect(plan.amountBase).toBe(1_500n);
    expect(plan.allocations).toEqual([
      { accrualId: 1, amountBase: 1_000n },
      { accrualId: 2, amountBase: 500n },
    ]);
  });
  it('nothing vested yet = empty plan', () => {
    expect(planClaim(A, [accrual({ accruedAt: 1_000 })], VEST, 1_000, 10n).amountBase).toBe(0n);
  });
});

// ----- distributor over fakes -----

interface FakeState {
  accruals: LpAccrualRow[];
  payouts: Map<string, LpPayoutRow>;
}

function fakeDb(state: FakeState) {
  return {
    async ownersWithOpenAccruals() {
      return [
        ...new Set(
          state.accruals
            .filter((a) => a.amountBase - a.forfeitedBase - a.paidBase > 0n)
            .map((a) => a.owner),
        ),
      ].sort();
    },
    async openAccrualsForOwner(_pool: string, owner: string) {
      return state.accruals.filter(
        (a) => a.owner === owner && a.amountBase - a.forfeitedBase - a.paidBase > 0n,
      );
    },
    async insertLpPayout(row: Omit<LpPayoutRow, 'status' | 'createdAt'>) {
      if ([...state.payouts.values()].some((p) => p.txSig === row.txSig)) return false;
      state.payouts.set(row.payoutId, {
        ...row,
        status: 'broadcasting',
        createdAt: new Date(1_000_000).toISOString(),
      });
      return true;
    },
    async broadcastingLpPayouts() {
      return [...state.payouts.values()].filter((p) => p.status === 'broadcasting');
    },
    async confirmLpPayout(payoutId: string) {
      const p = state.payouts.get(payoutId);
      if (!p || p.status !== 'broadcasting') return;
      p.status = 'confirmed';
      for (const alloc of p.allocations) {
        const a = state.accruals.find((x) => x.accrualId === alloc.accrualId);
        if (a && a.forfeitedBase + a.paidBase + alloc.amountBase <= a.amountBase)
          a.paidBase += alloc.amountBase;
      }
    },
    async markLpPayoutFailed(payoutId: string) {
      const p = state.payouts.get(payoutId);
      if (p && p.status === 'broadcasting') p.status = 'failed';
    },
  };
}

let chainInstance = 0;
function fakeChain(
  over: {
    vault?: bigint;
    exists?: boolean;
    confirm?: (sig: string) => 'confirmed' | 'failed' | 'unknown';
  } = {},
) {
  let n = 0;
  const salt = ++chainInstance; // real signatures differ per blockhash; fakes must too
  const sent: string[] = [];
  const chain: LpDistributorChain & { sent: string[] } = {
    sent,
    distributionExists: async () => over.exists ?? true,
    signOpenDistribution: async () => ({
      signature: 'open1',
      send: async () => void sent.push('open1'),
    }),
    vaultBalanceBase: async () => over.vault ?? 1_000_000n,
    signPayout: async (recipient, amount) => {
      n += 1;
      const signature = `pay:c${salt}n${n}:${recipient.toBase58().slice(0, 4)}:${amount}`;
      return { signature, send: async () => void sent.push(signature) };
    },
    confirm: async (sig) => (over.confirm ? over.confirm(sig) : 'confirmed'),
  };
  return chain;
}

function distributor(
  state: FakeState,
  chain: LpDistributorChain,
  policyOver: Partial<typeof DEFAULT_LP_DISTRIBUTOR_POLICY> = {},
  nowMs = 2_000_000,
) {
  let payoutN = 0;
  return new LpDistributor({
    poolKey: POOL,
    vestSeconds: 100,
    chain,
    db: fakeDb(state),
    policy: { ...DEFAULT_LP_DISTRIBUTOR_POLICY, minPayoutBase: 100n, ...policyOver },
    now: () => nowMs,
    newPayoutId: () => `p${++payoutN}`,
    toPublicKey: (b58) => new PublicKey(b58),
  });
}

describe('LpDistributor.runCycle', () => {
  it('pays fully vested claims and applies paid_base through confirm', async () => {
    const state: FakeState = {
      accruals: [accrual({ owner: A }), accrual({ accrualId: 2, owner: B, amountBase: 400n })],
      payouts: new Map(),
    };
    const chain = fakeChain();
    const r = await distributor(state, chain).runCycle();
    expect(r.paid).toBe(2);
    expect(r.paidBase).toBe(1_400n);
    expect(state.accruals[0].paidBase).toBe(1_000n);
    expect(state.accruals[1].paidBase).toBe(400n);
    // a second cycle finds nothing left to pay
    const r2 = await distributor(state, chain).runCycle();
    expect(r2.paid).toBe(0);
  });

  it('bootstraps the on-chain distribution when absent', async () => {
    const state: FakeState = { accruals: [], payouts: new Map() };
    const chain = fakeChain({ exists: false });
    await distributor(state, chain).runCycle();
    expect(chain.sent).toContain('open1');
  });

  it('skips claims under the dust floor and stops at the per-cycle cap', async () => {
    const state: FakeState = {
      accruals: [
        accrual({ accrualId: 1, owner: A, amountBase: 50n }), // below floor
        accrual({ accrualId: 2, owner: B, amountBase: 500n }),
        accrual({ accrualId: 3, owner: Keypair.generate().publicKey.toBase58(), amountBase: 500n }),
      ],
      payouts: new Map(),
    };
    const r = await distributor(state, fakeChain(), { maxPerCycle: 1 }).runCycle();
    expect(r.paid).toBe(1); // the cap stopped the cycle after one payment
    expect(r.paidBase).toBe(500n);
    expect(state.accruals[0].paidBase).toBe(0n); // the dust claim is never paid
  });

  it('clamps to the vault balance and pays the remainder next cycle', async () => {
    const state: FakeState = {
      accruals: [accrual({ owner: A, amountBase: 1_000n })],
      payouts: new Map(),
    };
    const r1 = await distributor(state, fakeChain({ vault: 600n })).runCycle();
    expect(r1.paidBase).toBe(600n);
    expect(state.accruals[0].paidBase).toBe(600n);
    const r2 = await distributor(state, fakeChain({ vault: 1_000_000n })).runCycle();
    expect(r2.paidBase).toBe(400n);
    expect(state.accruals[0].paidBase).toBe(1_000n);
  });

  it('an unknown confirmation leaves the row broadcasting; recovery confirms it and never pays twice', async () => {
    const state: FakeState = { accruals: [accrual({ owner: A })], payouts: new Map() };
    let confirmMode: 'unknown' | 'confirmed' = 'unknown';
    const chain = fakeChain({ confirm: () => confirmMode });
    const d = distributor(state, chain);
    const r1 = await d.runCycle();
    expect(r1.paid).toBe(0);
    expect(state.accruals[0].paidBase).toBe(0n); // nothing applied yet
    // next cycle: the sig confirms during recovery; the claim must not re-pay
    confirmMode = 'confirmed';
    const r2 = await d.runCycle();
    expect(r2.recovered).toBe(1);
    expect(r2.paid).toBe(0);
    expect(state.accruals[0].paidBase).toBe(1_000n);
    expect(chain.sent.filter((s) => s.startsWith('pay'))).toHaveLength(1); // one broadcast ever
  });

  it('a failed payout releases the claim for a fresh retry', async () => {
    const state: FakeState = { accruals: [accrual({ owner: A })], payouts: new Map() };
    let fail = true;
    const chain = fakeChain({ confirm: () => (fail ? 'failed' : 'confirmed') });
    const d = distributor(state, chain);
    await d.runCycle();
    expect(state.accruals[0].paidBase).toBe(0n);
    fail = false;
    const r2 = await d.runCycle();
    expect(r2.paid).toBe(1);
    expect(state.accruals[0].paidBase).toBe(1_000n);
  });

  it('a stale unconfirmable payout is failed by recovery, then retried', async () => {
    const state: FakeState = { accruals: [accrual({ owner: A })], payouts: new Map() };
    const chain = fakeChain({ confirm: () => 'unknown' });
    await distributor(state, chain).runCycle(); // leaves a broadcasting row (createdAt = 1_000_000)
    const staleSig = [...state.payouts.values()][0].txSig;
    // a later cycle far past staleMs marks it failed and re-pays fresh
    const chain2 = fakeChain({ confirm: (sig) => (sig === staleSig ? 'unknown' : 'confirmed') });
    const d2 = distributor(state, chain2, { staleMs: 1_000 }, 5_000_000);
    const r = await d2.runCycle();
    expect(r.recovered).toBe(1); // stale row failed
    expect(r.paid).toBe(1); // fresh payment landed
    expect(state.accruals[0].paidBase).toBe(1_000n);
  });

  it('an owner with an in-flight payout is never paid concurrently', async () => {
    const state: FakeState = { accruals: [accrual({ owner: A })], payouts: new Map() };
    const chain = fakeChain({ confirm: () => 'unknown' });
    // staleMs wide enough that the row stays legitimately in flight
    const d = distributor(state, chain, { staleMs: 60 * 60 * 1000 });
    await d.runCycle(); // in flight
    const r2 = await d.runCycle(); // recovery says unknown (not stale), owner skipped
    expect(r2.paid).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(chain.sent.filter((s) => s.startsWith('pay'))).toHaveLength(1);
  });
});
