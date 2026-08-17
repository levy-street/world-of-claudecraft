// What the gold ledger observer COSTS the world loop, measured rather than
// argued.
//
// The claim in server/gold_ledger.ts is that `observe` is safe to call from the
// tick: it never awaits, it never throws into the loop, and a tick with no
// economy event does one type comparison per event and allocates nothing. Those
// are exactly the properties that, if they quietly stopped holding, would show
// up as realm-wide tick jitter rather than as a failing economy test.
//
// DELIBERATELY NOT A WALL-CLOCK BUDGET. A "this must run in under N ms"
// assertion measures the machine at least as much as the code: it goes red on a
// loaded CI box and green on a fast one for changes that are identical, and a
// flaky perf gate teaches people to re-run rather than to look. Every assertion
// here counts WORK instead (database calls issued, rows queued, whether a
// promise was awaited), which is deterministic, is what actually scales with
// realm size, and fails for a real reason or not at all.

import { describe, expect, it } from 'vitest';
import { LedgerWriter } from '../server/gold_ledger';
import type { GoldLedgerInsert } from '../server/gold_ledger_types';
import type { SimEvent } from '../src/sim/types';

/**
 * A deps bag that counts every call and models a STALLED database: while
 * stalled, every insert parks forever, which is what lets a test prove the loop
 * did not wait for it. `release()` un-stalls and settles everything already
 * parked, so a later drain can actually finish (a single-shot resolver would
 * free only the newest batch and hang the drain on the next one).
 */
function countingDeps() {
  const parked: (() => void)[] = [];
  const state = {
    insertCalls: 0,
    seedCalls: 0,
    stalled: true,
    rows: [] as GoldLedgerInsert[],
    release(): void {
      state.stalled = false;
      for (const resolve of parked.splice(0)) resolve();
    },
    async insertBatch(rows: readonly GoldLedgerInsert[]): Promise<number[]> {
      state.insertCalls += 1;
      const firstId = state.rows.length + 1;
      for (const r of rows) state.rows.push({ ...r });
      if (state.stalled) await new Promise<void>((resolve) => parked.push(resolve));
      return rows.map((_, i) => firstId + i);
    },
    async loadChainHeads() {
      state.seedCalls += 1;
      return new Map<number, { id: number; balanceAfter: number }>();
    },
  };
  return state;
}

function writer(deps: ReturnType<typeof countingDeps>) {
  return new LedgerWriter({
    realm: 'bench-realm',
    deps,
    resolveActor: (pid) => ({ characterId: 900 + pid, accountId: 1, sessionId: null }),
  });
}

function economyEvent(over: Partial<Extract<SimEvent, { type: 'economy' }>> = {}): SimEvent {
  return {
    type: 'economy',
    pid: 1,
    kind: 'vendor_sell',
    holder: 'purse',
    amount: 10,
    balanceAfter: 10,
    counterparty: null,
    tick: 1,
    zone: 'zone1',
    x: 0,
    z: 0,
    ...over,
  } as SimEvent;
}

/**
 * Let queued microtasks run. The flush chain awaits its chain-seed read before
 * it reaches the insert, so a synchronous assertion right after `observe` sees
 * a flush that has started but not yet issued its statement. Bounded turns
 * rather than a timer: this stays deterministic on any machine.
 */
async function settle(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** A tick's worth of ordinary non-economy traffic, the overwhelmingly common case. */
function quietTick(n: number): SimEvent[] {
  return Array.from({ length: n }, (_, i) => ({ type: 'damage', pid: i }) as unknown as SimEvent);
}

describe('a tick with no coin movement costs nothing', () => {
  it('issues no database call at all across a thousand busy-but-coinless ticks', () => {
    const deps = countingDeps();
    const w = writer(deps);
    // 1000 ticks x 200 events: a heavy combat realm where nobody trades a coin.
    for (let tick = 0; tick < 1000; tick++) w.observe(quietTick(200), tick);
    // The whole point of the observer being safe to call from the loop: on the
    // common path it reaches neither the pool nor the queue.
    expect(deps.insertCalls).toBe(0);
    expect(deps.seedCalls).toBe(0);
    expect(w.stats().queueDepth).toBe(0);
    expect(w.stats().rowsWritten).toBe(0);
  });

  it('does not grow its queue when the actor has no durable character', () => {
    const deps = countingDeps();
    const w = new LedgerWriter({
      realm: 'bench-realm',
      deps,
      // An offline or headless host: no session behind any pid.
      resolveActor: () => null,
    });
    for (let tick = 0; tick < 500; tick++) w.observe([economyEvent({ pid: tick })], tick);
    expect(w.stats().queueDepth).toBe(0);
    // Not counted as a drop either: nothing was ever queued, so a headless host
    // must not look like a failing database on the dashboards.
    expect(w.stats().droppedWrites).toBe(0);
  });
});

describe('the loop never waits for the ledger', () => {
  it('returns from observe while the insert is still in flight', async () => {
    const deps = countingDeps();
    const w = writer(deps);

    // The insert this kicks off never settles until release() is called.
    w.observe([economyEvent({ kind: 'quest_reward', amount: 50, balanceAfter: 50 })], 1);

    // The loop keeps ticking with a write outstanding. If observe awaited
    // anything, these calls could not run at all and the test would hang here
    // rather than fail, which is itself the signal.
    for (let tick = 2; tick < 200; tick++) w.observe(quietTick(50), tick);

    // The flush is past its chain-seed read and parked on the insert.
    await settle();
    expect(deps.insertCalls).toBe(1);

    // Let the pending write finish so the writer can be drained cleanly.
    deps.release();
    await w.drain();
    expect(deps.rows).toHaveLength(1);
  });

  it('coalesces a burst behind ONE in-flight flush instead of one per tick', async () => {
    const deps = countingDeps();
    const w = writer(deps);
    // Sixty ticks each moving coin, with the first flush stuck. A writer that
    // started a fresh flush per tick would issue sixty concurrent statements at
    // exactly the moment the database is already struggling.
    for (let tick = 1; tick <= 60; tick++) {
      w.observe(
        [economyEvent({ pid: tick, kind: 'vendor_buy', amount: -1, balanceAfter: 100 - tick })],
        tick,
      );
    }
    // ONE flush was started, not sixty: the chain-seed read is the first thing
    // a flush does, so its call count is the number of flushes in flight.
    expect(deps.seedCalls).toBe(1);
    await settle();
    expect(deps.insertCalls).toBe(1);
    deps.release();
    await w.drain();
  });
});

describe('the queue bound holds under a stalled database', () => {
  it('drops and counts past the cap rather than growing without limit', async () => {
    const deps = countingDeps();
    const w = new LedgerWriter({
      realm: 'bench-realm',
      deps,
      resolveActor: (pid) => ({ characterId: 900 + pid, accountId: 1, sessionId: null }),
      queueMax: 100,
    });
    // Movements arriving faster than a stalled database can take them.
    const MOVEMENTS = 1500;
    for (let i = 0; i < MOVEMENTS; i++) {
      w.observe([economyEvent({ pid: i, kind: 'vendor_buy', amount: -1, balanceAfter: i })], i + 1);
    }
    const stalled = w.stats();
    // THE BOUND, which is what protects memory: an unbounded queue would trade
    // a visible, counted drop for an invisible OOM that takes the realm with it.
    expect(stalled.queueDepth).toBeLessThanOrEqual(100);
    expect(stalled.droppedWrites).toBeGreaterThan(0);

    // CONSERVATION, asserted after the stall clears. Mid-flush a batch has been
    // spliced out of the queue and not yet handed to the insert, so it is in no
    // counter at all and any exact sum taken here would be wrong for a reason
    // that says nothing about the writer. Once drained, every movement has
    // reached exactly one of the two terminal states.
    deps.release();
    await w.drain();
    const settled = w.stats();
    expect(settled.queueDepth).toBe(0);
    expect(settled.rowsWritten + settled.droppedWrites).toBe(MOVEMENTS);
  });
});

describe('the observer cannot fault the world loop', () => {
  it('survives a resolver that throws on every single event', () => {
    const deps = countingDeps();
    const w = new LedgerWriter({
      realm: 'bench-realm',
      deps,
      resolveActor: () => {
        throw new Error('session map exploded');
      },
    });
    // A throw here would take the TICK down over an audit-trail concern, which
    // is the one thing an observer must never do.
    for (let tick = 1; tick <= 100; tick++) {
      expect(() => w.observe([economyEvent()], tick)).not.toThrow();
    }
  });
});
