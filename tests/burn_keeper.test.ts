import { describe, expect, it, vi } from 'vitest';

// burn_keeper transitively imports server/db (which builds a pg Pool + requires
// DATABASE_URL at import). Stub both so the module loads; the tests drive the
// real BurnKeeper with INJECTED fakes and never touch the pool.
vi.hoisted(() => { process.env.DATABASE_URL = 'postgres://test/test'; });
vi.mock('pg', () => ({ Pool: function Pool() { return { query: vi.fn(), connect: vi.fn() }; } }));

import { BurnKeeper, type BurnExecutor, type BurnStore } from '../server/burn_keeper';
import { DEFAULT_BURN_POLICY } from '../server/burn_policy';
import type { BurnBatchRow } from '../server/db';

const NOW = 1_000_000_000_000;
const usdc = (d: number) => BigInt(Math.round(d * 1_000_000));
type Confirm = 'confirmed' | 'failed' | 'unknown';

function fakeStore() {
  const batches = new Map<string, BurnBatchRow>();
  let last: number | null = null;
  const seed = (b: Partial<BurnBatchRow> & { batchId: string; status: BurnBatchRow['status'] }) => {
    batches.set(b.batchId, {
      source: 'marketplace', usdcIn: 0n, wocBought: 0n, wocBurned: 0n, buyTxSig: null, burnTxSig: null,
      failReason: null, createdAt: new Date(NOW).toISOString(), burnBroadcastAt: null, executedAt: null, ...b,
    });
  };
  const store: BurnStore & { batches: Map<string, BurnBatchRow>; setLast(t: number): void } = {
    batches,
    setLast(t) { last = t; },
    async createBatch(b) {
      if ([...batches.values()].some((x) => x.buyTxSig === b.buyTxSig)) return false;
      seed({ batchId: b.batchId, usdcIn: b.usdcIn, buyTxSig: b.buyTxSig, status: 'swapping' });
      return true;
    },
    async markSwapped(id, woc) { const b = batches.get(id)!; b.status = 'swapped'; b.wocBought = woc; },
    async markBurning(id, sig) { const b = batches.get(id)!; b.status = 'burning'; b.burnTxSig = sig; b.burnBroadcastAt = new Date(NOW).toISOString(); },
    async markBurned(id, woc) { const b = batches.get(id)!; b.status = 'burned'; b.wocBurned = woc; last = NOW; },
    async markFailed(id, reason) { const b = batches.get(id)!; b.status = 'failed'; b.failReason = reason; },
    async openBatches() { return [...batches.values()].filter((b) => ['swapping', 'swapped', 'burning'].includes(b.status)); },
    async lastBurnAt() { return last; },
  };
  return Object.assign(store, { seed });
}

function fakeExec(over: {
  usdc?: bigint; outWoc?: bigint; received?: bigint;
  confirm?: (sig: string) => Confirm; quoteNull?: boolean;
} = {}) {
  let swapN = 0; let burnN = 0;
  const calls = { quote: [] as bigint[], swapSends: [] as string[], burnSends: [] as string[], signBurn: [] as bigint[] };
  const exec: BurnExecutor = {
    vaultUsdcBalance: async () => over.usdc ?? 0n,
    quote: async (inUsdc) => { calls.quote.push(inUsdc); return over.quoteNull ? null : { outWoc: over.outWoc ?? 1000n, raw: { in: inUsdc.toString() } }; },
    signSwap: async () => { const signature = `swap${++swapN}`; return { signature, send: async () => { calls.swapSends.push(signature); } }; },
    confirm: async (sig) => (over.confirm ? over.confirm(sig) : 'confirmed'),
    wocReceived: async () => over.received ?? 700n,
    signBurn: async (amt) => { calls.signBurn.push(amt); const signature = `burn${++burnN}`; return { signature, send: async () => { calls.burnSends.push(signature); } }; },
  };
  return { exec, calls };
}

const keeper = (exec: BurnExecutor, store: BurnStore) =>
  new BurnKeeper(exec, store, DEFAULT_BURN_POLICY, { now: () => NOW, newBatchId: (() => { let n = 0; return () => `b${++n}`; })(), staleMs: 10 * 60 * 1000 });

describe('BurnKeeper.runCycle — swap → burn', () => {
  it('swaps + burns the exact $WOC received in one batch when above threshold', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), received: 700n });
    await keeper(exec, store).runCycle();

    const batch = [...store.batches.values()][0];
    expect(store.batches.size).toBe(1);
    expect(batch.status).toBe('burned');
    expect(batch.usdcIn).toBe(usdc(300));
    expect(batch.wocBought).toBe(700n);
    expect(batch.wocBurned).toBe(700n);   // burns exactly what was received
    expect(calls.signBurn).toEqual([700n]);
    expect(calls.swapSends).toHaveLength(1);
    expect(calls.burnSends).toHaveLength(1);
  });

  it('TWAP-splits a large pool into capped chunks, each a full swap+burn', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(1075), received: 700n });
    await keeper(exec, store).runCycle();

    expect(calls.quote).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), usdc(75)]);
    const statuses = [...store.batches.values()].map((b) => b.status);
    expect(statuses).toEqual(['burned', 'burned', 'burned', 'burned', 'burned']);
    expect(calls.burnSends).toHaveLength(5);
  });

  it('does nothing below the fee floor even past cadence', async () => {
    const store = fakeStore();
    store.setLast(NOW - 100 * 3600 * 1000); // cadence long elapsed
    const { exec, calls } = fakeExec({ usdc: usdc(10) }); // below $25 floor
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

  it('leaves a batch in-flight when the swap does not confirm (recovery later, no burn)', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), confirm: (s) => (s.startsWith('swap') ? 'unknown' : 'confirmed') });
    await keeper(exec, store).runCycle();
    const batch = [...store.batches.values()][0];
    expect(batch.status).toBe('swapping');
    expect(calls.signBurn).toHaveLength(0);
    expect(calls.swapSends).toHaveLength(1); // it WAS broadcast; just unconfirmed in-window
  });

  it('fails the batch (no burn) when the swap reverts', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExec({ usdc: usdc(300), confirm: (s) => (s.startsWith('swap') ? 'failed' : 'confirmed') });
    await keeper(exec, store).runCycle();
    const batch = [...store.batches.values()][0];
    expect(batch.status).toBe('failed');
    expect(calls.signBurn).toHaveLength(0);
  });

  it('is idempotent: a colliding (already-tracked) swap signature is not re-broadcast', async () => {
    const store = fakeStore();
    store.createBatch = async () => false; // simulate the signed swap already recorded
    const { exec, calls } = fakeExec({ usdc: usdc(300) });
    await keeper(exec, store).runCycle();
    expect(calls.swapSends).toHaveLength(0);
    expect(calls.signBurn).toHaveLength(0);
  });
});

describe('BurnKeeper.recover — finish in-flight batches by recorded signature', () => {
  it('defers new work to recovery while a batch is in-flight (never reads the vault)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'old', status: 'swapped', wocBought: 500n });
    const { exec, calls } = fakeExec({ usdc: usdc(300) });
    const vaultSpy = vi.spyOn(exec, 'vaultUsdcBalance');
    await keeper(exec, store).runCycle();
    expect(vaultSpy).not.toHaveBeenCalled(); // recovery path, not a new batch
    expect(calls.quote).toHaveLength(0);
    expect(store.batches.get('old')!.status).toBe('burned');
    expect(store.batches.get('old')!.wocBurned).toBe(500n);
  });

  it('advances a confirmed swap → swapped → burned', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'x', status: 'swapping', buyTxSig: 'swapZ' });
    const { exec } = fakeExec({ received: 640n });
    await keeper(exec, store).recover();
    expect(store.batches.get('x')!.status).toBe('burned');
    expect(store.batches.get('x')!.wocBurned).toBe(640n);
  });

  it('finishes a confirmed burn that was recorded but not yet marked burned', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'y', status: 'burning', burnTxSig: 'burnZ', wocBought: 500n });
    const { exec, calls } = fakeExec({ confirm: () => 'confirmed' });
    await keeper(exec, store).recover();
    expect(store.batches.get('y')!.status).toBe('burned');
    expect(calls.signBurn).toHaveLength(0); // the existing burn confirmed; no re-issue
  });

  it('re-issues a burn whose recorded signature reverted', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'z', status: 'burning', burnTxSig: 'burnOld', wocBought: 500n });
    const { exec, calls } = fakeExec({ confirm: (s) => (s === 'burnOld' ? 'failed' : 'confirmed') });
    await keeper(exec, store).recover();
    expect(calls.signBurn).toEqual([500n]); // re-burned the bought $WOC
    expect(store.batches.get('z')!.status).toBe('burned');
  });

  it('fails a stale swap that truly never landed — no $WOC received (cannot wedge forever)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 's', status: 'swapping', buyTxSig: 'swapStale', createdAt: new Date(NOW - 20 * 60 * 1000).toISOString() });
    const { exec, calls } = fakeExec({ confirm: () => 'unknown', received: 0n });
    await keeper(exec, store).recover();
    expect(store.batches.get('s')!.status).toBe('failed'); // USDC stays in the vault for the next cycle
    expect(calls.signBurn).toHaveLength(0);
  });

  it('RECOVERS a stale swap that actually landed — burns the received $WOC, never strands it', async () => {
    const store = fakeStore();
    store.seed({ batchId: 's2', status: 'swapping', buyTxSig: 'swapLanded', createdAt: new Date(NOW - 20 * 60 * 1000).toISOString() });
    // The swap signature stays unreadable ('unknown'), but the $WOC delta is
    // measurable; the follow-on burn confirms normally.
    const { exec, calls } = fakeExec({ confirm: (s) => (s.startsWith('burn') ? 'confirmed' : 'unknown'), received: 640n });
    await keeper(exec, store).recover();
    expect(store.batches.get('s2')!.status).toBe('burned');
    expect(store.batches.get('s2')!.wocBurned).toBe(640n);
    expect(calls.signBurn).toEqual([640n]);
  });

  it('times burning-staleness from burn broadcast, not swap creation (no premature re-burn)', async () => {
    const store = fakeStore();
    // Swap created long ago, but the burn was broadcast just now: NOT stale yet.
    store.seed({ batchId: 'bb', status: 'burning', burnTxSig: 'burnFresh', wocBought: 500n,
      createdAt: new Date(NOW - 30 * 60 * 1000).toISOString(), burnBroadcastAt: new Date(NOW - 60 * 1000).toISOString() });
    const { exec, calls } = fakeExec({ confirm: () => 'unknown' });
    await keeper(exec, store).recover();
    expect(store.batches.get('bb')!.status).toBe('burning'); // left in flight, NOT re-burned
    expect(calls.signBurn).toHaveLength(0);
  });

  it('leaves a fresh unconfirmed swap in-flight (not yet stale)', async () => {
    const store = fakeStore();
    store.seed({ batchId: 'f', status: 'swapping', buyTxSig: 'swapFresh', createdAt: new Date(NOW - 60 * 1000).toISOString() });
    const { exec } = fakeExec({ confirm: () => 'unknown' });
    await keeper(exec, store).recover();
    expect(store.batches.get('f')!.status).toBe('swapping'); // retried next cycle, not failed
  });
});
