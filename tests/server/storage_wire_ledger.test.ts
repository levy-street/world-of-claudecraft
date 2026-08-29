// Bank Storage phase 11: the wire-side pieces around the purchase flow.
//  - the gold-path mutex refusal in dispatchBankCommand (driven through the
//    REAL flow mutex, not a stub), with the localized error line;
//  - the paid-with rail on buy_slots ledger rows: gold stamps from the
//    dispatch site, claudium stamps from the apply site, legacy calls stay
//    NULL (not recorded);
//  - the owner-only next-rung Claudium price: joined from the cached store
//    by ladder position, absent when cold, when the service is out, when
//    the ladder is full, and after the staleness bound.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storage_wire';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

vi.mock('../../server/claudium_proxy', async (importActual) => {
  const actual = await importActual<typeof import('../../server/claudium_proxy')>();
  return { ...actual, claudiumStore: vi.fn() };
});

import { bankLedgerIdle, diffBankOp, recordBankOp } from '../../server/bank_ledger';
import { type BankSim, bankInfoForWire, dispatchBankCommand } from '../../server/bank_wire';
import type { ClaudiumSpendResult } from '../../server/claudium_proxy';
import { claudiumStore } from '../../server/claudium_proxy';
import { insertBankLedgerRow } from '../../server/db';
import {
  executeStoragePurchase,
  resetStoragePurchasesForTests,
  type StoragePurchaseHost,
} from '../../server/storage_purchases';
import { resetStorageStoreCacheForTests } from '../../server/storage_store_cache';
import type { BankInfo } from '../../src/world_api';

const insertMock = vi.mocked(insertBankLedgerRow);
const storeMock = vi.mocked(claudiumStore);

const WHO = { characterId: 42, accountId: 7 };

function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
    ...over,
  };
}

function makeBankSim(): BankSim & {
  errors: string[];
  buySlots: ReturnType<typeof vi.fn>;
  info: BankInfo;
} {
  const errors: string[] = [];
  const state = {
    info: bankInfo(),
  };
  const buySlots = vi.fn(() => {
    state.info = bankInfo({
      purchasedSlots: state.info.purchasedSlots + 6,
      nextExpansionCost: 1000,
    });
  });
  return {
    errors,
    buySlots,
    get info() {
      return state.info;
    },
    ctx: {
      // `bank` is here because BankSim.ctx.resolve REQUIRES it (server/bank_wire.ts
      // widened the return type in Bank Storage phase 15, and this hand-rolled
      // stub would no longer compile without it). No arm in THIS file drives
      // emitBankSelfKeys; the emitter's own coverage is the end-to-end
      // broadcastSnapshots arms in tests/bank_wire.test.ts. It tracks the state
      // buySlots moves rather than a frozen literal so that a future arm here
      // reads a ladder that really advances.
      resolve: (pid?: number) =>
        pid === 1
          ? { meta: { entityId: 99, bank: { purchasedSlots: state.info.purchasedSlots } } }
          : null,
      error: (_id: number, text: string) => {
        errors.push(text);
      },
    },
    bankInfoFor: () => state.info,
    bankDeposit: vi.fn(),
    bankWithdraw: vi.fn(),
    bankBuySlots: buySlots,
    bankUnlockSocket: vi.fn(),
    bankSocketBag: vi.fn(),
    bankUnsocketBag: vi.fn(),
  };
}

// The store refresh is a promise CHAIN (then / catch / finally); a caller that
// only awaits the fetch being issued can still observe the single-flight latch
// held. Draining a few microtasks settles the whole tail without touching the
// clock, which matters because these cases run on fake timers.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStoragePurchasesForTests();
  resetStorageStoreCacheForTests();
});
afterEach(() => {
  resetStoragePurchasesForTests();
  resetStorageStoreCacheForTests();
  vi.useRealTimers();
});

describe('the gold-path mutex refusal', () => {
  it('refuses bank_buy_slots with the localized line while the REAL flow mutex is held', async () => {
    const sim = makeBankSim();
    // Hold the mutex through a genuinely in-flight purchase (a hanging
    // spend), never a stubbed flag.
    let resolveSpend!: (v: ClaudiumSpendResult) => void;
    const host: StoragePurchaseHost = {
      resolveLiveCharacter: () => ({ characterId: WHO.characterId, pid: 5 }),
      grant: () => ({ status: 'fits' }),
      stageAppliedEffect: vi.fn(() => true),
      saveCharacter: async () => true,
      spend: () =>
        new Promise<ClaudiumSpendResult>((r) => {
          resolveSpend = r;
        }).then((result) => ({ result, neverReached: false })),
      db: {
        begin: async () => ({ inserted: true, existing: null }),
        byKey: async () => null,
        claimSpend: async () => true,
        renewSpendClaim: async () => true,
        releaseSpendClaim: async () => true,
        settle: async () => true,
        discardWithoutDebit: async () => true,
        pendingFor: async () => null,
        openFor: async () => null,
      },
      realm: 'testrealm',
      warn: vi.fn(),
    };
    const purchase = executeStoragePurchase(host, {
      accountId: WHO.accountId,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'wire-key',
    });
    await vi.waitFor(() => {
      if (!resolveSpend) throw new Error('spend not reached');
    });

    dispatchBankCommand(sim, WHO, 'bank_buy_slots', {}, 1);
    expect(sim.buySlots).not.toHaveBeenCalled();
    expect(sim.errors).toEqual(['Your bank has a purchase in progress.']);
    await bankLedgerIdle();
    expect(insertMock).not.toHaveBeenCalled();

    // THE CROSS-CHARACTER ARM, taken while the mutex is genuinely HELD: a
    // guard that ignored its argument (returning "any purchase in flight")
    // would pass every other assertion in this file. Another character's gold
    // buy must flow straight through, untouched.
    const other = makeBankSim();
    dispatchBankCommand(other, { characterId: 900, accountId: 8 }, 'bank_buy_slots', {}, 1);
    expect(other.buySlots).toHaveBeenCalledTimes(1);
    expect(other.errors).toEqual([]);
    // ... and the held character is STILL refused right after, so the pass
    // above is isolation, not the mutex having quietly lapsed.
    dispatchBankCommand(sim, WHO, 'bank_buy_slots', {}, 1);
    expect(sim.buySlots).not.toHaveBeenCalled();
    expect(sim.errors).toHaveLength(2);

    // Released mutex: the gold buy goes through and stamps its rail.
    resolveSpend({ granted: false, balance: 0, costClaudium: 100, reason: 'insufficient_balance' });
    await purchase;
    dispatchBankCommand(sim, WHO, 'bank_buy_slots', {}, 1);
    expect(sim.buySlots).toHaveBeenCalledTimes(1);
    await bankLedgerIdle();
    // Filtered by character, not by call index: the isolation arm above wrote
    // its own row for character 900 through the same module-level insert.
    const ours = insertMock.mock.calls.map((c) => c[0]).filter((r) => r.characterId === 42);
    expect(ours).toHaveLength(1);
    expect(ours[0]).toEqual({
      realm: expect.any(String),
      characterId: 42,
      accountId: 7,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: { paidWith: 'gold' },
      copperDelta: -500,
      purchasedSlotsAfter: 6,
      container: 'personal',
      containerId: null,
    });
    // Exactly the two refusals raised while the mutex was held, and none after.
    expect(sim.errors).toHaveLength(2);
  });

  it('with NO mutex held at all, the gold rail is untouched', () => {
    // The floor case. The cross-character isolation arm lives in the test
    // above, where a mutex is actually held: asserting it here (with nothing
    // held) would pass against a guard that ignored its argument entirely.
    const sim = makeBankSim();
    dispatchBankCommand(sim, { characterId: 900, accountId: 8 }, 'bank_buy_slots', {}, 1);
    expect(sim.buySlots).toHaveBeenCalledTimes(1);
    expect(sim.errors).toEqual([]);
  });
});

describe('the paid-with rail on buy_slots rows', () => {
  it('diffBankOp: legacy null, gold negated price, claudium exactly zero with the SKU id', () => {
    const before = { slots: [], purchasedSlots: 6, nextExpansionCost: 1000 };
    const after = { slots: [], purchasedSlots: 12, nextExpansionCost: 2500 };
    expect(diffBankOp('buy_slots', before, after)).toEqual([
      { itemId: null, count: null, instance: null, copperDelta: -1000, purchasedSlotsAfter: 12 },
    ]);
    expect(diffBankOp('buy_slots', before, after, { paidWith: 'gold' })).toEqual([
      {
        itemId: null,
        count: null,
        instance: { paidWith: 'gold' },
        copperDelta: -1000,
        purchasedSlotsAfter: 12,
      },
    ]);
    // A charter jump: one row, multi-rung move, zero copper, SKU attributed.
    const charterAfter = { slots: [], purchasedSlots: 78, nextExpansionCost: null };
    expect(
      diffBankOp('buy_slots', before, charterAfter, {
        paidWith: 'claudium',
        itemId: 'strongbox_charter_complete',
      }),
    ).toEqual([
      {
        itemId: 'strongbox_charter_complete',
        count: null,
        instance: { paidWith: 'claudium' },
        copperDelta: 0,
        purchasedSlotsAfter: 78,
      },
    ]);
    // A refused/no-op purchase still diffs empty on every rail.
    expect(diffBankOp('buy_slots', before, before, { paidWith: 'claudium' })).toEqual([]);
  });

  it('recordBankOp persists the claudium rail row the apply site sends', async () => {
    recordBankOp(
      'buy_slots',
      WHO,
      { slots: [], purchasedSlots: 0, nextExpansionCost: null },
      { slots: [], purchasedSlots: 12, nextExpansionCost: null },
      { paidWith: 'claudium', itemId: 'strongbox_charter_1' },
    );
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      op: 'buy_slots',
      itemId: 'strongbox_charter_1',
      instance: { paidWith: 'claudium' },
      copperDelta: 0,
      purchasedSlotsAfter: 12,
      container: 'personal',
    });
  });
});

describe('the owner-only next-rung Claudium price', () => {
  const catalog = (rows: { itemId: string; costClaudium: number }[]) => ({
    available: true,
    items: rows.map((r) => ({
      itemId: r.itemId,
      name: r.itemId,
      kind: 'storage' as const,
      costClaudium: r.costClaudium,
      owned: false,
    })),
  });

  it('joins the price by ladder position once the cache is warm, absent while cold', async () => {
    storeMock.mockResolvedValue(
      catalog([
        { itemId: 'strongbox_rung_01', costClaudium: 100 },
        { itemId: 'strongbox_rung_02', costClaudium: 100 },
        { itemId: 'strongbox_rung_09', costClaudium: 150 },
      ]),
    );
    const sim = makeBankSim();
    // Cold cache: the field is simply absent (graceful degradation), and
    // the read kicked the single-flight refresh.
    const cold = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect(cold).not.toBeNull();
    expect('nextRungClaudiumPrice' in (cold as BankInfo)).toBe(false);
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));

    const warm = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect(warm?.nextRungClaudiumPrice).toBe(100);
    // The join follows THIS character's ladder position.
    expect(
      bankInfoForWire(
        { ...sim, bankInfoFor: () => bankInfo({ purchasedSlots: 48 }) },
        { pid: 1, accountId: 7 },
      )?.nextRungClaudiumPrice,
    ).toBe(150);
    // A position whose rung the catalog does not carry stays absent.
    const missing = bankInfoForWire(
      { ...sim, bankInfoFor: () => bankInfo({ purchasedSlots: 12 }) },
      { pid: 1, accountId: 7 },
    );
    expect('nextRungClaudiumPrice' in (missing as BankInfo)).toBe(false);
    // A full ladder has no next rung to price.
    const full = bankInfoForWire(
      { ...sim, bankInfoFor: () => bankInfo({ purchasedSlots: 72, nextExpansionCost: null }) },
      { pid: 1, accountId: 7 },
    );
    expect('nextRungClaudiumPrice' in (full as BankInfo)).toBe(false);
    // One cache serves every read: no per-snapshot fetches happened.
    expect(storeMock).toHaveBeenCalledTimes(1);
  });

  it('an unreachable service leaves the field absent and the sim readout untouched', async () => {
    storeMock.mockResolvedValue({ available: false, items: [] });
    const sim = makeBankSim();
    const info = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));
    expect(info).toEqual(bankInfo());
    const after = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect('nextRungClaudiumPrice' in (after as BankInfo)).toBe(false);
    // Away from a banker the whole readout stays null, price or no price.
    expect(bankInfoForWire({ ...sim, bankInfoFor: () => null }, { pid: 1, accountId: 7 })).toBe(
      null,
    );
  });

  it('an available response with no usable rows keeps the good cache instead of blanking it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    storeMock.mockResolvedValue(catalog([{ itemId: 'strongbox_rung_01', costClaudium: 100 }]));
    const sim = makeBankSim();
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));
    // Drain the refresh chain's tail: waitFor returns as soon as the fetch was
    // ISSUED, but the single-flight latch clears in the .finally two microtasks
    // later, and a still-latched refresh would make the second kick below a
    // silent no-op (which is a rig artifact, not the behaviour under test).
    await flushMicrotasks();
    expect(bankInfoForWire(sim, { pid: 1, accountId: 7 })?.nextRungClaudiumPrice).toBe(100);

    // available:true, but nothing the ladder can price. The outage guard does
    // NOT cover this shape, so it is the one that can silently blank the wire.
    // Three flavours in one refresh: a cosmetic row, a storage row whose id the
    // registry does not carry, and a charter (no ladderIndex).
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'cinderbrand_sword',
          name: 'x',
          kind: 'skin' as const,
          costClaudium: 1000,
          owned: false,
        },
        {
          itemId: 'strongbox_rung_99',
          name: 'x',
          kind: 'storage' as const,
          costClaudium: 100,
          owned: false,
        },
        {
          itemId: 'strongbox_charter_1',
          name: 'x',
          kind: 'storage' as const,
          costClaudium: 500,
          owned: false,
        },
      ],
    });
    // Past the TTL so the read kicks a refresh, but well inside the staleness
    // bound so the answer below is the CACHE's, not an aged-out absence.
    vi.setSystemTime(2_000_000 + 61_000);
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect(storeMock).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(bankInfoForWire(sim, { pid: 1, accountId: 7 })?.nextRungClaudiumPrice).toBe(100);

    // And the kept snapshot keeps its ORIGINAL timestamp: an empty response
    // must not restart the staleness clock, or a permanently broken catalog
    // would serve the same prices forever.
    vi.setSystemTime(2_000_000 + 11 * 60_000);
    const aged = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect('nextRungClaudiumPrice' in (aged as BankInfo)).toBe(false);
  });

  it('an empty response still installs when there is no better snapshot to keep', async () => {
    // The negative arm of the guard above: it protects a NON-EMPTY cache, it
    // does not freeze the cache cold. A first-ever empty catalog must still
    // land (absent on the wire) rather than leave the module fetching forever.
    storeMock.mockResolvedValue({ available: true, items: [] });
    const sim = makeBankSim();
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));
    await flushMicrotasks();
    const info = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect('nextRungClaudiumPrice' in (info as BankInfo)).toBe(false);
    // Cache installed, so a second read inside the TTL does not refetch.
    expect(storeMock).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh is retried no sooner than RETRY_MIN_INTERVAL_MS', async () => {
    // The gate exists so a DOWN service costs one fetch per interval instead
    // of one per snapshot, on a read that runs per session per tick at a
    // banker. Nothing killed it: without a fake clock every read in a test
    // falls inside the interval anyway, so deleting the guard changed no
    // assertion.
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    storeMock.mockResolvedValue({ available: false, items: [] });
    const sim = makeBankSim();
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));
    await flushMicrotasks();

    // Inside the interval: a cold cache still wants a refresh on every read,
    // and the gate is the only thing stopping a per-tick fetch storm.
    for (const dt of [1, 5_000, 14_999]) {
      vi.setSystemTime(3_000_000 + dt);
      bankInfoForWire(sim, { pid: 1, accountId: 7 });
    }
    await flushMicrotasks();
    expect(storeMock).toHaveBeenCalledTimes(1);

    // Past it: exactly one more attempt, not one per read.
    vi.setSystemTime(3_000_000 + 15_001);
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await flushMicrotasks();
    expect(storeMock).toHaveBeenCalledTimes(2);
  });

  it('a snapshot past the staleness bound ages out to absent instead of serving stale prices', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeMock.mockResolvedValue(catalog([{ itemId: 'strongbox_rung_01', costClaudium: 100 }]));
    const sim = makeBankSim();
    bankInfoForWire(sim, { pid: 1, accountId: 7 });
    await vi.waitFor(() => expect(storeMock).toHaveBeenCalledTimes(1));
    expect(bankInfoForWire(sim, { pid: 1, accountId: 7 })?.nextRungClaudiumPrice).toBe(100);
    // The service goes dark; refresh attempts fail from here on.
    storeMock.mockResolvedValue({ available: false, items: [] });
    // Just under the bound: still served.
    vi.setSystemTime(1_000_000 + 9 * 60_000);
    expect(bankInfoForWire(sim, { pid: 1, accountId: 7 })?.nextRungClaudiumPrice).toBe(100);
    // Past the bound: absent.
    vi.setSystemTime(1_000_000 + 11 * 60_000);
    const aged = bankInfoForWire(sim, { pid: 1, accountId: 7 });
    expect('nextRungClaudiumPrice' in (aged as BankInfo)).toBe(false);
  });
});

describe('phase 14: the outage that used to strand the gold rung', () => {
  it('a Claudium press with the service down leaves the gold buy working at the banker', async () => {
    // The whole phase in one arm, driven through the REAL dispatch path rather
    // than the predicate: the price cache is still quoting (that is its
    // documented staleness contract), so the player presses the Claudium tag,
    // the spend never reaches the service, and the very next thing they do is
    // buy the same rung with gold.
    const sim = makeBankSim();
    const settled: [string, string][] = [];
    const discarded: string[] = [];
    const host: StoragePurchaseHost = {
      resolveLiveCharacter: () => ({ characterId: WHO.characterId, pid: 5 }),
      grant: () => ({ status: 'fits' }),
      stageAppliedEffect: vi.fn(() => true),
      saveCharacter: async () => true,
      // The economy service is DOWN: the connection is refused, so no request
      // was delivered and no debit is possible.
      spend: async () => ({
        result: { granted: false, balance: null, costClaudium: null, reason: 'unavailable' },
        neverReached: true,
      }),
      db: {
        begin: async () => ({ inserted: true, existing: null }),
        byKey: async () => null,
        claimSpend: async () => true,
        renewSpendClaim: async () => true,
        releaseSpendClaim: async () => true,
        settle: async (key, status) => {
          settled.push([key, status]);
          return true;
        },
        discardWithoutDebit: async (key) => {
          discarded.push(key);
          return true;
        },
        pendingFor: async () => null,
        openFor: async () => null,
      },
      realm: 'testrealm',
      warn: vi.fn(),
    };

    const res = await executeStoragePurchase(host, {
      accountId: WHO.accountId,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'outage-wire',
    });
    expect(res.granted).toBe(false);
    expect(res.reason).toBe('unavailable');
    // A definitive no-debit refusal leaves no operational history.
    expect(discarded).toEqual(['outage-wire']);
    expect(settled).toEqual([]);

    // THE POINT OF THE PHASE: gold still works, with no refusal line.
    dispatchBankCommand(sim, WHO, 'bank_buy_slots', {}, 1);
    expect(sim.buySlots).toHaveBeenCalledTimes(1);
    expect(sim.errors).toEqual([]);
    await bankLedgerIdle();
    const ours = insertMock.mock.calls.map((c) => c[0]).filter((r) => r.characterId === 42);
    expect(ours).toHaveLength(1);
    // Stamped from the GOLD dispatch site, which is the proof the buy really
    // took the gold rail rather than being swallowed somewhere quieter.
    expect(ours[0].op).toBe('buy_slots');
    expect(ours[0].instance).toEqual({ paidWith: 'gold' });
  });
});
