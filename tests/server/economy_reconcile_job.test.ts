// Reconciliation pass pins (server/economy_reconcile_job.ts). Driven through a
// fake evidence bag with zero runtime `pg` and an injected online set, the
// FakeDb discipline from server/CLAUDE.md.
//
// What this suite is really about is the pass REFUSING to page. The checks
// themselves are pinned next door; the job is the layer that decides which
// evidence is admissible, and every bug in it looks like an operator being
// woken up for a player who simply had not saved yet. So most cases here stage
// a perfectly healthy realm and assert silence.

import { describe, expect, it } from 'vitest';
import type { EconomyAlert, SupplySnapshot } from '../../server/economy_reconcile';
import type { EconomyWindowRow, PurseDisagreement } from '../../server/economy_reconcile_db';
import {
  createEconomyReconcileJob,
  ECONOMY_RECONCILE_ADVISORY_LOCK_KEY,
  type EconomyReconcileCursor,
  type EconomyReconcileDeps,
  groupByCharacter,
  realmLockKey,
  splitBySettlement,
} from '../../server/economy_reconcile_job';

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function supply(over: Partial<SupplySnapshot> = {}): SupplySnapshot {
  return {
    purses: 0,
    bankVaults: 0,
    guildTreasuries: 0,
    unclaimedMailCoin: 0,
    marketEscrow: 0,
    ...over,
  };
}

let nextRowId = 1;
function windowRow(over: Partial<EconomyWindowRow> = {}): EconomyWindowRow {
  const { id, ...rest } = over;
  return {
    id: id ?? nextRowId++,
    characterId: 1,
    kind: 'mob_loot',
    holder: 'purse',
    amount: 0,
    balanceAfter: 0,
    prevLedgerId: null,
    counterpartyKind: null,
    counterpartyId: null,
    simTick: 10,
    createdAt: NOW - HOUR,
    ...rest,
  };
}

function disagreement(over: Partial<PurseDisagreement> = {}): PurseDisagreement {
  return {
    characterId: 1,
    ledgerBalance: 100,
    persistedCopper: 0,
    ledgerAt: NOW - HOUR,
    savedAt: NOW - 2 * HOUR,
    ...over,
  };
}

// A fake lock client that always grants, plus a record of what it was asked.
function fakeLock() {
  const queries: { text: string; values: unknown[] }[] = [];
  const state = {
    queries,
    acquired: true,
    released: 0,
    destroyed: 0,
    connect: async () => ({
      async query(text: string, values: unknown[] = []) {
        queries.push({ text, values });
        if (text.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: state.acquired }] };
        }
        return { rows: [] };
      },
      release(destroy?: boolean) {
        state.released += 1;
        if (destroy) state.destroyed += 1;
      },
    }),
  };
  return state;
}

interface Harness {
  deps: EconomyReconcileDeps;
  lock: ReturnType<typeof fakeLock>;
  cursor: EconomyReconcileCursor | null;
  filed: EconomyAlert[];
  notified: EconomyAlert[];
  info: string[];
  errors: string[];
}

function harness(
  over: Partial<{
    cursor: EconomyReconcileCursor | null;
    rows: EconomyWindowRow[];
    disagreements: PurseDisagreement[];
    closing: SupplySnapshot;
    online: Set<number>;
    droppedWrites: number;
    maxRowId: number;
    windowRows: number;
    alreadyOpen: string[];
  }> = {},
): Harness {
  const lock = fakeLock();
  const h: Harness = {
    lock,
    cursor: over.cursor === undefined ? { lastRowId: 0, openingSupply: 0 } : over.cursor,
    filed: [],
    notified: [],
    info: [],
    errors: [],
    deps: null as unknown as EconomyReconcileDeps,
  };
  h.deps = {
    realm: 'test-realm',
    connect: lock.connect,
    windowRows: over.windowRows,
    maxRowId: async () => over.maxRowId ?? 1000,
    loadWindow: async () => over.rows ?? [],
    loadPurseDisagreements: async () => over.disagreements ?? [],
    supplySnapshot: async () => over.closing ?? supply(),
    onlineCharacterIds: () => over.online ?? new Set<number>(),
    droppedWrites: () => over.droppedWrites ?? 0,
    insertAlerts: async (alerts) => {
      // The real table dedupes against its open queue; a case that needs to
      // model a duplicate sets `alreadyOpen` and this returns only the rest,
      // which is exactly what the notification is driven off.
      const fresh = alerts.filter((a) => !(over.alreadyOpen ?? []).includes(a.kind));
      h.filed.push(...fresh);
      return [...fresh];
    },
    notify: (filed) => h.notified.push(...filed),
    loadCursor: async () => h.cursor,
    saveCursor: async (c) => {
      h.cursor = c;
    },
    onInfo: (m) => h.info.push(m),
    onError: (scope, err) => h.errors.push(`${scope}: ${String(err)}`),
  };
  return h;
}

describe('splitBySettlement', () => {
  it('calls an offline character whose save postdates their ledger settled', () => {
    const d = disagreement({ ledgerAt: NOW - 2 * HOUR, savedAt: NOW - HOUR });
    const out = splitBySettlement([d], new Set());
    expect(out.settled).toEqual([d]);
    expect(out.unsettledCopper).toBe(0);
  });

  it('never settles a character with a live session, however old their save looks', () => {
    // The trap this guards: `characters.updated_at` moves for writes that are
    // not purse saves (a hotbar layout, an appearance reroll). A timestamp
    // comparison alone would call a mid-session player settled and page for a
    // purse that was simply still in flight.
    const d = disagreement({ ledgerAt: NOW - 2 * HOUR, savedAt: NOW - HOUR });
    const out = splitBySettlement([d], new Set([d.characterId]));
    expect(out.settled).toEqual([]);
    expect(out.unsettled).toEqual([d]);
    expect(out.unsettledCopper).toBe(100);
  });

  it('never settles an offline character whose save predates their last movement', () => {
    const out = splitBySettlement(
      [disagreement({ ledgerAt: NOW - HOUR, savedAt: NOW - 2 * HOUR })],
      new Set(),
    );
    expect(out.settled).toEqual([]);
  });

  it('sums drift by magnitude so opposite drifts do not cancel into certainty', () => {
    // One player up 100, another down 100. Netting them would report a bound of
    // zero and turn a 200-copper gap into a critical, which is precisely the
    // false page the bound exists to prevent.
    const out = splitBySettlement(
      [
        disagreement({ characterId: 1, ledgerBalance: 100, persistedCopper: 0 }),
        disagreement({ characterId: 2, ledgerBalance: 0, persistedCopper: 100 }),
      ],
      new Set([1, 2]),
    );
    expect(out.unsettledCopper).toBe(200);
  });
});

describe('groupByCharacter', () => {
  it('keeps each character rows in id order', () => {
    const rows = [
      windowRow({ id: 1, characterId: 7 }),
      windowRow({ id: 2, characterId: 8 }),
      windowRow({ id: 3, characterId: 7 }),
    ];
    const grouped = groupByCharacter(rows);
    expect(grouped.get(7)?.map((r) => r.id)).toEqual([1, 3]);
    expect(grouped.get(8)?.map((r) => r.id)).toEqual([2]);
  });
});

describe('the first pass establishes a baseline instead of accusing history', () => {
  it('records the cursor and reports nothing', async () => {
    const h = harness({ cursor: null, closing: supply({ purses: 50_000 }), maxRowId: 900 });
    const job = createEconomyReconcileJob(h.deps);
    const result = await job.runOnce();
    expect(result?.alerts).toEqual([]);
    // Without an opening figure the identity has no left-hand side, so checking
    // it would compare the realm's entire coin stock against one window's
    // faucets and report the whole economy as a duplication.
    expect(h.cursor).toEqual({ lastRowId: 900, openingSupply: 50_000 });
    expect(h.filed).toEqual([]);
  });
});

describe('a healthy realm stays silent', () => {
  it('files nothing when the window explains every coin', async () => {
    const rows = [
      windowRow({ id: 10, characterId: 1, kind: 'mob_loot', amount: 500, balanceAfter: 500 }),
      windowRow({
        id: 11,
        characterId: 1,
        kind: 'vendor_buy',
        amount: -200,
        balanceAfter: 300,
        prevLedgerId: 10,
      }),
    ];
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      rows,
      closing: supply({ purses: 300 }),
      maxRowId: 11,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    expect(result?.alerts).toEqual([]);
    expect(h.cursor).toEqual({ lastRowId: 11, openingSupply: 300 });
  });

  it('does not page for a player who is simply mid-session', async () => {
    // The single most common shape on a live realm: a logged-in player looted
    // 500 copper, the ledger has it, the save timer has not fired. Purses read
    // 0 while the ledger says 500.
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      rows: [
        windowRow({ id: 10, characterId: 1, kind: 'mob_loot', amount: 500, balanceAfter: 500 }),
      ],
      disagreements: [disagreement({ characterId: 1, ledgerBalance: 500, persistedCopper: 0 })],
      online: new Set([1]),
      closing: supply({ purses: 0 }),
      maxRowId: 10,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    // The gap is 500 and unsaved state can account for exactly 500, so this
    // degrades to a warning rather than a page, and no balance_mismatch is
    // raised against the player at all.
    expect(result?.alerts.map((a) => a.kind)).toEqual(['evidence_incomplete']);
    expect(result?.alerts[0].severity).toBe('warning');
  });
});

describe('the pass still pages for what save lag cannot explain', () => {
  it('reports a settled character whose save disagrees with the ledger', async () => {
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      // No rows this window at all: the character was robbed a week ago and has
      // not moved a coin since. A window-scoped comparison would never see them.
      rows: [],
      disagreements: [
        disagreement({
          characterId: 4,
          ledgerBalance: 100,
          persistedCopper: 9_999,
          ledgerAt: NOW - 2 * HOUR,
          savedAt: NOW - HOUR,
        }),
      ],
      closing: supply({ purses: 9_999 }),
      maxRowId: 9,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    const balance = result?.alerts.filter((a) => a.kind === 'balance_mismatch') ?? [];
    expect(balance).toHaveLength(1);
    expect(balance[0].severity).toBe('critical');
    expect(balance[0].characterId).toBe(4);
    expect(balance[0].delta).toBe(9_899);
    expect(h.filed.length).toBe(result?.alerts.length);
  });

  it('pages for the part of a supply gap bigger than the drift bound', async () => {
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      rows: [
        windowRow({ id: 10, characterId: 1, kind: 'mob_loot', amount: 100, balanceAfter: 100 }),
      ],
      // 100 minted, but the world is holding 5000. One mid-session player can
      // account for 400 of that; the other 4500 cannot be save lag.
      disagreements: [disagreement({ characterId: 1, ledgerBalance: 100, persistedCopper: 500 })],
      online: new Set([1]),
      closing: supply({ purses: 5_000 }),
      maxRowId: 10,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    expect(result?.alerts.map((a) => a.kind)).toContain('supply_mismatch');
    expect(result?.unsettledCopper).toBe(400);
  });
});

describe('the cursor never skips a window', () => {
  it('advances to the last row read, not the ceiling, when the window is capped', async () => {
    const rows = [
      windowRow({ id: 10, characterId: 1, amount: 10, balanceAfter: 10 }),
      windowRow({ id: 11, characterId: 1, amount: 10, balanceAfter: 20, prevLedgerId: 10 }),
    ];
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      rows,
      windowRows: 2, // the window came back full: a backlog is waiting
      closing: supply({ purses: 20 }),
      maxRowId: 5_000,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    // Jumping to 5000 would leave everything between 11 and 5000 permanently
    // unexamined, which is the one failure mode a reconciler must not have.
    expect(h.cursor?.lastRowId).toBe(11);
    // And the opening supply is NOT carried forward from a partial window: the
    // rows that would explain the rest of the move have not been read, so
    // baking the measured figure in would hide this pass's delta from every
    // later pass.
    expect(h.cursor?.openingSupply).toBe(0);
    expect(result?.rowsRead).toBe(2);
  });

  it('holds the cursor at the ceiling when a complete window was empty', async () => {
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      rows: [],
      closing: supply(),
      maxRowId: 42,
    });
    await createEconomyReconcileJob(h.deps).runOnce();
    // Nothing moved, so every id up to the ceiling is accounted for.
    expect(h.cursor?.lastRowId).toBe(42);
  });
});

describe('one pass per realm', () => {
  it('takes a two-key advisory lock namespaced by realm', async () => {
    const h = harness({ cursor: null });
    await createEconomyReconcileJob(h.deps).runOnce();
    const lockCall = h.lock.queries.find((q) => q.text.includes('pg_try_advisory_lock'));
    expect(lockCall?.values).toEqual([
      ECONOMY_RECONCILE_ADVISORY_LOCK_KEY,
      realmLockKey('test-realm'),
    ]);
    // Unlocked on the same client, and the connection goes back to the pool.
    expect(h.lock.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(h.lock.destroyed).toBe(0);
    expect(h.lock.released).toBe(1);
  });

  it('does nothing at all when a peer holds the lock', async () => {
    const h = harness({ cursor: null });
    h.lock.acquired = false;
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    expect(result).toBeNull();
    // Critically, the cursor is untouched: the peer's pass covers this window,
    // and a loser that advanced the cursor would skip it for both of them.
    expect(h.cursor).toBeNull();
  });

  it('hashes a realm to a stable positive key every process agrees on', () => {
    expect(realmLockKey('alpha')).toBe(realmLockKey('alpha'));
    expect(realmLockKey('alpha')).not.toBe(realmLockKey('beta'));
    expect(realmLockKey('alpha')).toBeGreaterThanOrEqual(0);
    expect(realmLockKey('alpha')).toBeLessThanOrEqual(0x7f_ff_ff_ff);
  });
});

describe('a failing pass does not consume the window', () => {
  it('leaves the cursor alone and reports the error', async () => {
    const h = harness({ cursor: { lastRowId: 9, openingSupply: 0 } });
    h.deps = {
      ...h.deps,
      loadWindow: async () => {
        throw new Error('database went away');
      },
    };
    await expect(createEconomyReconcileJob(h.deps).runOnce()).rejects.toThrow('database went away');
    expect(h.cursor).toEqual({ lastRowId: 9, openingSupply: 0 });
    // The lock is still released on the way out, or every later pass would lose
    // the try-lock and reconciliation would silently stop.
    expect(h.lock.released).toBe(1);
  });
});

describe('the operator is told about filings, not about findings', () => {
  const robbed = {
    characterId: 4,
    ledgerBalance: 100,
    persistedCopper: 9_999,
    ledgerAt: NOW - 2 * HOUR,
    savedAt: NOW - HOUR,
  };

  it('notifies exactly what the table accepted', async () => {
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      disagreements: [disagreement(robbed)],
      closing: supply({ purses: 9_999 }),
      maxRowId: 9,
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    expect(h.notified.map((a) => a.kind)).toEqual(h.filed.map((a) => a.kind));
    expect(h.notified.some((a) => a.kind === 'balance_mismatch')).toBe(true);
    expect(result?.filed).toBe(h.filed.length);
  });

  it('stays quiet when the finding is already an open row', async () => {
    // The pass re-finds an unresolved violation every fifteen minutes. The table
    // dedupes it against the open queue, and the notification follows the table:
    // otherwise one incident interrupts a human four times an hour until they
    // mute the channel, and the message they then miss is the second incident.
    const h = harness({
      cursor: { lastRowId: 9, openingSupply: 0 },
      disagreements: [disagreement(robbed)],
      closing: supply({ purses: 9_999 }),
      maxRowId: 9,
      alreadyOpen: ['balance_mismatch', 'supply_mismatch', 'evidence_incomplete'],
    });
    const result = await createEconomyReconcileJob(h.deps).runOnce();
    // Still FOUND, which is what the metrics count, and still reported back.
    expect(result?.alerts.length).toBeGreaterThan(0);
    // But nothing new landed, so nobody is interrupted.
    expect(h.notified).toEqual([]);
    expect(result?.filed).toBe(0);
  });
});
