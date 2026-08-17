// LedgerWriter unit pins (server/gold_ledger.ts). Drives the writer through a
// fake deps bag with zero runtime `pg`, the FakeDb discipline from
// server/CLAUDE.md: the queue, the batching, the corpse aggregation, and the
// chain arithmetic are all pure enough to assert directly, and the properties
// that matter most are the ones a running database would hide.

import { describe, expect, it } from 'vitest';
import {
  CORPSE_AGGREGATION_TICKS,
  type GoldLedgerDeps,
  LedgerWriter,
} from '../../server/gold_ledger';
import type { GoldLedgerInsert } from '../../server/gold_ledger_types';
import type { SimEvent } from '../../src/sim/types';

// A fake insert surface that records every batch and hands back sequential ids,
// exactly as `INSERT ... RETURNING id` does.
function fakeDeps(): GoldLedgerDeps & {
  rows: GoldLedgerInsert[];
  batches: number;
  failNext: boolean;
} {
  let nextId = 1;
  const state = {
    rows: [] as GoldLedgerInsert[],
    batches: 0,
    failNext: false,
    async insertBatch(rows: readonly GoldLedgerInsert[]): Promise<number[]> {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('simulated insert failure');
      }
      state.batches += 1;
      const ids: number[] = [];
      for (const r of rows) {
        // Clone: the writer reuses its row objects for chain stamping, and a
        // test asserting on live references would see later mutations.
        state.rows.push({ ...r });
        ids.push(nextId++);
      }
      return ids;
    },
    async loadChainHeads() {
      return new Map<number, { id: number; balanceAfter: number }>();
    },
  };
  return state;
}

function economyEvent(over: Partial<Extract<SimEvent, { type: 'economy' }>> = {}): SimEvent {
  return {
    type: 'economy',
    pid: 1,
    kind: 'vendor_sell',
    holder: 'purse',
    amount: 100,
    balanceAfter: 100,
    counterparty: null,
    tick: 10,
    zone: 'zone1',
    x: 5,
    z: 6,
    ...over,
  } as SimEvent;
}

function writerWith(deps: GoldLedgerDeps, opts: { queueMax?: number } = {}): LedgerWriter {
  return new LedgerWriter({
    realm: 'test-realm',
    deps,
    resolveActor: (pid) => ({ characterId: 900 + pid, accountId: 50, sessionId: 'sess-1' }),
    queueMax: opts.queueMax,
  });
}

describe('LedgerWriter chain', () => {
  it('chains prev_ledger_id per character, including within one batch', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    // Three movements for one character, one for another, all in one tick.
    w.observe(
      [
        economyEvent({ pid: 1, amount: 100, balanceAfter: 100 }),
        economyEvent({ pid: 2, amount: 50, balanceAfter: 50 }),
        economyEvent({ pid: 1, amount: -30, balanceAfter: 70 }),
      ],
      1,
    );
    await w.drain();

    const forOne = deps.rows.filter((r) => r.characterId === 901);
    expect(forOne).toHaveLength(2);
    // The first row of a character's life has no predecessor.
    expect(forOne[0].prevLedgerId).toBeNull();
    // The second points at the first, NOT at the row physically before it in
    // the batch (which belongs to the other character). A writer that chained
    // on batch position rather than per character would put id 2 here.
    expect(forOne[1].prevLedgerId).toBe(1);
    expect(deps.rows.find((r) => r.characterId === 902)?.prevLedgerId).toBeNull();
  });

  it('keeps balance_after consistent with the chain so a bypass is detectable', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(
      [
        economyEvent({ pid: 1, amount: 100, balanceAfter: 100 }),
        economyEvent({ pid: 1, amount: -40, balanceAfter: 60 }),
      ],
      1,
    );
    await w.drain();
    const rows = deps.rows.filter((r) => r.characterId === 901);
    // The identity the reconciler checks: previous balance plus this amount
    // equals this balance. A mutation that skipped the ledger breaks it here.
    expect((rows[0].balanceAfter ?? 0) + rows[1].amount).toBe(rows[1].balanceAfter);
  });
});

describe('LedgerWriter corpse aggregation', () => {
  it('folds consecutive mob_loot drops for one looter into a single row', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(
      [
        economyEvent({ pid: 1, kind: 'mob_loot', amount: 10, balanceAfter: 10 }),
        economyEvent({ pid: 1, kind: 'mob_loot', amount: 15, balanceAfter: 25 }),
        economyEvent({ pid: 1, kind: 'mob_loot', amount: 5, balanceAfter: 30 }),
      ],
      1,
    );
    await w.drain();
    const rows = deps.rows.filter((r) => r.characterId === 901);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(30);
    // The LATEST balance, not the first: a folded row must describe the purse
    // as it stands after every drop it represents, or the next row's chain
    // check fails against a stale balance.
    expect(rows[0].balanceAfter).toBe(30);
  });

  it('closes the window when a different kind arrives, so kinds never merge', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(
      [
        economyEvent({ pid: 1, kind: 'mob_loot', amount: 10, balanceAfter: 10 }),
        economyEvent({ pid: 1, kind: 'vendor_buy', amount: -4, balanceAfter: 6 }),
      ],
      1,
    );
    await w.drain();
    const rows = deps.rows.filter((r) => r.characterId === 901);
    expect(rows.map((r) => r.kind)).toEqual(['mob_loot', 'vendor_buy']);
    expect(rows[0].amount).toBe(10);
    expect(rows[1].amount).toBe(-4);
  });

  it('does not merge two looters into one row', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(
      [
        economyEvent({ pid: 1, kind: 'mob_loot', amount: 10, balanceAfter: 10 }),
        economyEvent({ pid: 2, kind: 'mob_loot', amount: 10, balanceAfter: 10 }),
      ],
      1,
    );
    await w.drain();
    expect(deps.rows).toHaveLength(2);
    expect(new Set(deps.rows.map((r) => r.characterId))).toEqual(new Set([901, 902]));
  });

  it('lands an open window once the aggregation budget elapses', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe([economyEvent({ pid: 1, kind: 'mob_loot', amount: 10, balanceAfter: 10 })], 1);
    // Still held open: nothing written yet.
    expect(deps.rows).toHaveLength(0);
    w.observe([], 1 + CORPSE_AGGREGATION_TICKS);
    await w.flush();
    expect(deps.rows).toHaveLength(1);
  });
});

describe('LedgerWriter bounded queue', () => {
  it('drops and counts past the cap instead of growing without bound', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps, { queueMax: 3 });
    // Five non-aggregating movements against a queue that holds three. The
    // writer never awaits inside observe, so nothing drains mid-loop.
    const events = Array.from({ length: 5 }, (_, i) =>
      economyEvent({ pid: 1, kind: 'vendor_buy', amount: -1, balanceAfter: 100 - i }),
    );
    // Enqueue without letting the flush run: observe kicks a fire-and-forget
    // flush, so build the overflow in one synchronous batch.
    w.observe(events, 1);
    const stats = w.stats();
    expect(stats.droppedWrites).toBe(2);
    await w.drain();
    expect(deps.rows).toHaveLength(3);
  });

  it('counts a rejected batch as dropped rather than losing it silently', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    deps.failNext = true;
    w.observe([economyEvent({ pid: 1, kind: 'vendor_buy', amount: -5, balanceAfter: 95 })], 1);
    await w.drain();
    // The row is gone (a rejected insert is not retried), but the counter says
    // so: the reconciler reads it and knows its evidence is incomplete rather
    // than reporting a conservation violation for gold that moved fine.
    expect(deps.rows).toHaveLength(0);
    expect(w.stats().droppedWrites).toBe(1);
    expect(w.stats().failedFlushes).toBe(1);
  });
});

describe('LedgerWriter actor resolution', () => {
  it('skips a pid with no live session rather than inventing a character id', async () => {
    const deps = fakeDeps();
    const w = new LedgerWriter({
      realm: 'test-realm',
      deps,
      resolveActor: () => null,
    });
    w.observe([economyEvent({ pid: 1 })], 1);
    await w.drain();
    expect(deps.rows).toHaveLength(0);
    // Not a drop either: nothing was ever queued, so the counter stays clean
    // and an offline host does not look like a failing database.
    expect(w.stats().droppedWrites).toBe(0);
  });

  it('never throws into the world loop when the resolver faults', () => {
    const deps = fakeDeps();
    const w = new LedgerWriter({
      realm: 'test-realm',
      deps,
      resolveActor: () => {
        throw new Error('resolver blew up');
      },
    });
    expect(() => w.observe([economyEvent({ pid: 1 })], 1)).not.toThrow();
  });

  it('ignores non-economy events without allocating rows', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe([{ type: 'tradeDone', pid: 1 } as SimEvent], 1);
    await w.drain();
    expect(deps.rows).toHaveLength(0);
  });
});

describe('LedgerWriter pool rows', () => {
  // A market buy is the shape that broke: one purse row (the buyer's debit) and
  // two pool rows (the seller's box filling, the Merchant's cut burning), all
  // three booked against the SAME character id because the buyer is the actor.
  const marketBuy = [
    economyEvent({ pid: 1, kind: 'market_purchase', amount: -1000, balanceAfter: 4000 }),
    economyEvent({
      pid: 1,
      kind: 'market_escrow_hold',
      holder: 'pool',
      amount: 950,
      balanceAfter: 950,
    }),
    economyEvent({ pid: 1, kind: 'market_fee', holder: 'pool', amount: -50, balanceAfter: null }),
  ];

  it('leaves pool rows out of the chain instead of threading the actor through them', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(marketBuy, 1);
    // A second purse movement, so the row AFTER the pool rows is the one that
    // would have chained onto a box balance under the old behavior.
    w.observe([economyEvent({ pid: 1, kind: 'vendor_buy', amount: -400, balanceAfter: 3600 })], 3);
    await w.drain();

    const rows = deps.rows.filter((r) => r.characterId === 901);
    const purse = rows.filter((r) => r.holder === 'purse');
    const pool = rows.filter((r) => r.holder === 'pool');
    expect(pool).toHaveLength(2);
    // A pool row joins no chain in either direction.
    expect(pool.every((r) => r.prevLedgerId === null)).toBe(true);
    // The purse chain skips straight over them: the vendor_buy points at the
    // market_purchase, not at the escrow row physically between the two.
    expect(purse.map((r) => r.kind)).toEqual(['market_purchase', 'vendor_buy']);
    expect(purse[0].prevLedgerId).toBeNull();
    // market_purchase is written first, so the fake hands it id 1; the pool
    // rows that follow take 2 and 3 and neither becomes the predecessor.
    expect(purse[1].prevLedgerId).toBe(1);
    // And the arithmetic the reconciler checks still holds across the gap.
    expect((purse[0].balanceAfter ?? 0) + purse[1].amount).toBe(purse[1].balanceAfter);
  });

  it('lets sibling pool rows share one statement instead of one round each', async () => {
    const deps = fakeDeps();
    const w = writerWith(deps);
    w.observe(marketBuy, 1);
    await w.drain();
    // Two rounds, not three: the purse row goes first so ids still read in
    // movement order, and the two pool rows then ride together because neither
    // needs an id the other could chain onto.
    expect(deps.batches).toBe(2);
    expect(deps.rows.map((r) => r.kind)).toEqual([
      'market_purchase',
      'market_escrow_hold',
      'market_fee',
    ]);
  });
});
