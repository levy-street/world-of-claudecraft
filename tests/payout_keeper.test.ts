import { describe, expect, it, vi } from 'vitest';

// payout_keeper transitively imports server/db (pg Pool + DATABASE_URL at import).
// Stub both so the module loads; the tests drive the real PayoutKeeper with
// INJECTED fakes and never touch the pool.
vi.hoisted(() => { process.env.DATABASE_URL = 'postgres://test/test'; });
vi.mock('pg', () => ({ Pool: function Pool() { return { query: vi.fn(), connect: vi.fn() }; } }));

import { PayoutKeeper, type KeeperOpts, type PayoutExecutor, type PayoutStore } from '../server/payout_keeper';
import { DEFAULT_PAYOUT_POLICY } from '../server/payout_policy';
import type { PayoutBatchRow } from '../server/payout_db';

const NOW = 1_000_000_000_000;
const usdc = (d: number) => BigInt(Math.round(d * 1_000_000));
type Confirm = 'confirmed' | 'failed' | 'unknown';

function fakeStore() {
  const batches = new Map<string, PayoutBatchRow>();
  let last: number | null = null;
  const seed = (b: Partial<PayoutBatchRow> & { batchId: string; status: PayoutBatchRow['status'] }) => {
    batches.set(b.batchId, {
      mode: 'burn', source: 'marketplace', usdcIn: 0n, wocBought: 0n, wocSettled: 0n, buyTxSig: null, settleTxSig: null,
      failReason: null, seasonId: null, dest: null, createdAt: new Date(NOW).toISOString(), settleBroadcastAt: null, executedAt: null, ...b,
    });
  };
  const store: PayoutStore & { batches: Map<string, PayoutBatchRow>; setLast(t: number): void } = {
    batches,
    setLast(t) { last = t; },
    async createBatch(b) {
      if ([...batches.values()].some((x) => x.buyTxSig === b.buyTxSig)) return false;
      seed({ batchId: b.batchId, usdcIn: b.usdcIn, buyTxSig: b.buyTxSig, status: 'swapping' });
      return true;
    },
    async markSwapped(id, woc) { const b = batches.get(id)!; b.status = 'swapped'; b.wocBought = woc; },
    async markSettling(id, sig) { const b = batches.get(id)!; b.status = 'settling'; b.settleTxSig = sig; b.settleBroadcastAt = new Date(NOW).toISOString(); },
    async markSettled(id, woc) { const b = batches.get(id)!; b.status = 'settled'; b.wocSettled = woc; last = NOW; },
    async markFailed(id, reason) { const b = batches.get(id)!; b.status = 'failed'; b.failReason = reason; },
    async openBatches() { return [...batches.values()].filter((b) => ['swapping', 'swapped', 'settling'].includes(b.status)); },
    async lastSettleAt() { return last; },
  };
  return Object.assign(store, { seed });
}

function fakeExec(over: {
  usdc?: bigint; outWoc?: bigint; received?: bigint;
  confirm?: (sig: string) => Confirm; quoteNull?: boolean;
} = {}) {
  let swapN = 0; let settleN = 0;
  const calls = { quote: [] as bigint[], swapSends: [] as string[], settleSends: [] as string[], signSettle: [] as bigint[] };
  const exec: PayoutExecutor = {
    vaultUsdcBalance: async () => over.usdc ?? 0n,
    quote: async (inUsdc) => { calls.quote.push(inUsdc); return over.quoteNull ? null : { outWoc: over.outWoc ?? 1000n, raw: { in: inUsdc.toString() } }; },
    signSwap: async () => { const signature = `swap${++swapN}`; return { signature, send: async () => { calls.swapSends.push(signature); } }; },
    confirm: async (sig) => (over.confirm ? over.confirm(sig) : 'confirmed'),
    wocReceived: async () => over.received ?? 700n,
    signSettle: async (amt) => { calls.signSettle.push(amt); const signature = `settle${++settleN}`; return { signature, send: async () => { calls.settleSends.push(signature); } }; },
  };
  return { exec, calls };
}

const keeper = (exec: PayoutExecutor, store: PayoutStore, onSettled?: KeeperOpts['onSettled']) =>
  new PayoutKeeper(exec, store, DEFAULT_PAYOUT_POLICY, { now: () => NOW, newBatchId: (() => { let n = 0; return () => `b${++n}`; })(), staleMs: 10 * 60 * 1000, onSettled });

describe('PayoutKeeper.runCycle — swap → settle', () => {
  it('swaps + settles the exact $WOC received in one batch when above threshold', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), received: 700n });
    await keeper(exec, store).runCycle();

    const batch = [...store.batches.values()][0];
    expect(store.batches.size).toBe(1);
    expect(batch.status).toBe('settled');
    expect(batch.usdcIn).toBe(usdc(300));
    expect(batch.wocBought).toBe(700n);
    expect(batch.wocSettled).toBe(700n); // settles exactly what was received
    expect(calls.signSettle).toEqual([700n]);
    expect(calls.swapSends).toHaveLength(1);
    expect(calls.settleSends).toHaveLength(1);
  });

  it('TWAP-splits a large pool into capped chunks, each a full swap+settle', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(1075), received: 700n });
    await keeper(exec, store).runCycle();

    expect(calls.quote).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), usdc(75)]);
    expect([...store.batches.values()].map((b) => b.status)).toEqual(['settled', 'settled', 'settled', 'settled', 'settled']);
    expect(calls.settleSends).toHaveLength(5);
  });

  it('does nothing below the fee floor even past cadence', async () => {
    const store = fakeStore();
    store.setLast(NOW - 100 * 3600 * 1000);
    const { exec, calls } = fakeExec({ usdc: usdc(10) });
    await keeper(exec, store).runCycle();
    expect(store.batches.size).toBe(0);
    expect(calls.quote).toHaveLength(0);
  });

  it('leaves a no-route chunk for the next cycle (no batch row, no send)', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), quoteNull: true });
    await keeper(exec, store).runCycle();
    expect(store.batches.size).toBe(0);
    expect(calls.swapSends).toHaveLength(0);
  });

  it('leaves a batch in-flight when the swap does not confirm (recovery later, no settle)', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), confirm: (s) => (s.startsWith('swap') ? 'unknown' : 'confirmed') });
    await keeper(exec, store).runCycle();
    expect([...store.batches.values()][0].status).toBe('swapping');
    expect(calls.signSettle).toHaveLength(0);
    expect(calls.swapSends).toHaveLength(1);
  });

  it('fails the batch (no settle) when the swap reverts', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), confirm: (s) => (s.startsWith('swap') ? 'failed' : 'confirmed') });
    await keeper(exec, store).runCycle();
    expect([...store.batches.values()][0].status).toBe('failed');
    expect(calls.signSettle).toHaveLength(0);
  });

  it('is idempotent: a colliding (already-tracked) swap signature is not re-broadcast', async () => {
    const store = fakeStore();
    store.createBatch = async () => false;
    const { exec, calls } = fakeExec({ usdc: usdc(300) });
    await keeper(exec, store).runCycle();
    expect(calls.swapSends).toHaveLength(0);
    expect(calls.signSettle).toHaveLength(0);
  });
});

describe('PayoutKeeper top_up — onSettled credits the reward pool', () => {
  it('fires onSettled once with the settled $WOC + settle signature', async () => {
    const store = fakeStore();
    const { exec } = fakeExec({ usdc: usdc(300), received: 700n });
    const onSettled = vi.fn(async () => {});
    await keeper(exec, store, onSettled).runCycle();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ batchId: 'b1', wocSettled: 700n, settleTxSig: 'settle1' });
  });

  it('passes the settle signature through recovery so the ledger credit key is stable (idempotent)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'r', status: 'settling', settleTxSig: 'settleZ', wocBought: 500n });
    const { exec } = fakeExec({ confirm: () => 'confirmed' });
    const onSettled = vi.fn(async () => {});
    await keeper(exec, store, onSettled).recover();
    expect(store.batches.get('r')!.status).toBe('settled');
    expect(onSettled).toHaveBeenCalledWith({ batchId: 'r', wocSettled: 500n, settleTxSig: 'settleZ' });
  });
});

describe('PayoutKeeper.recover — finish in-flight batches by recorded signature', () => {
  it('defers new work to recovery while a batch is in-flight (never reads the vault)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'old', status: 'swapped', wocBought: 500n });
    const { exec, calls } = fakeExec({ usdc: usdc(300) });
    const vaultSpy = vi.spyOn(exec, 'vaultUsdcBalance');
    await keeper(exec, store).runCycle();
    expect(vaultSpy).not.toHaveBeenCalled();
    expect(calls.quote).toHaveLength(0);
    expect(store.batches.get('old')!.status).toBe('settled');
    expect(store.batches.get('old')!.wocSettled).toBe(500n);
  });

  it('advances a confirmed swap → swapped → settled', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'x', status: 'swapping', buyTxSig: 'swapZ' });
    const { exec } = fakeExec({ received: 640n });
    await keeper(exec, store).recover();
    expect(store.batches.get('x')!.status).toBe('settled');
    expect(store.batches.get('x')!.wocSettled).toBe(640n);
  });

  it('finishes a confirmed settle that was recorded but not yet marked settled', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'y', status: 'settling', settleTxSig: 'settleZ', wocBought: 500n });
    const { exec, calls } = fakeExec({ confirm: () => 'confirmed' });
    await keeper(exec, store).recover();
    expect(store.batches.get('y')!.status).toBe('settled');
    expect(calls.signSettle).toHaveLength(0);
  });

  it('re-issues a settle whose recorded signature reverted', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'z', status: 'settling', settleTxSig: 'settleOld', wocBought: 500n });
    const { exec, calls } = fakeExec({ confirm: (s) => (s === 'settleOld' ? 'failed' : 'confirmed') });
    await keeper(exec, store).recover();
    expect(calls.signSettle).toEqual([500n]);
    expect(store.batches.get('z')!.status).toBe('settled');
  });

  it('fails a stale swap that truly never landed — no $WOC received (cannot wedge forever)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 's', status: 'swapping', buyTxSig: 'swapStale', createdAt: new Date(NOW - 20 * 60 * 1000).toISOString() });
    const { exec, calls } = fakeExec({ confirm: () => 'unknown', received: 0n });
    await keeper(exec, store).recover();
    expect(store.batches.get('s')!.status).toBe('failed');
    expect(calls.signSettle).toHaveLength(0);
  });

  it('RECOVERS a stale swap that actually landed — settles the received $WOC, never strands it', async () => {
    const store = fakeStore();
    store.seed({ batchId: 's2', status: 'swapping', buyTxSig: 'swapLanded', createdAt: new Date(NOW - 20 * 60 * 1000).toISOString() });
    const { exec, calls } = fakeExec({ confirm: (s) => (s.startsWith('settle') ? 'confirmed' : 'unknown'), received: 640n });
    await keeper(exec, store).recover();
    expect(store.batches.get('s2')!.status).toBe('settled');
    expect(store.batches.get('s2')!.wocSettled).toBe(640n);
    expect(calls.signSettle).toEqual([640n]);
  });

  it('times settling-staleness from settle broadcast, not swap creation (no premature re-settle)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'bb', status: 'settling', settleTxSig: 'settleFresh', wocBought: 500n,
      createdAt: new Date(NOW - 30 * 60 * 1000).toISOString(), settleBroadcastAt: new Date(NOW - 60 * 1000).toISOString() });
    const { exec, calls } = fakeExec({ confirm: () => 'unknown' });
    await keeper(exec, store).recover();
    expect(store.batches.get('bb')!.status).toBe('settling');
    expect(calls.signSettle).toHaveLength(0);
  });

  it('leaves a fresh unconfirmed swap in-flight (not yet stale)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'f', status: 'swapping', buyTxSig: 'swapFresh', createdAt: new Date(NOW - 60 * 1000).toISOString() });
    const { exec } = fakeExec({ confirm: () => 'unknown' });
    await keeper(exec, store).recover();
    expect(store.batches.get('f')!.status).toBe('swapping');
  });
});
