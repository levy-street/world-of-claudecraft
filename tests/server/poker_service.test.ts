import { describe, expect, it } from 'vitest';
import type { PokerSeatMutation, PokerStore, PokerTableRow } from '../../server/poker_db';
import { createPokerService, POKER_BUY_IN } from '../../server/poker_service';
import { calculateRakeForPots, POKER_RAKE_BPS } from '../../src/sim/poker/rules';

function cloneRow(row: PokerTableRow): PokerTableRow {
  return JSON.parse(JSON.stringify(row)) as PokerTableRow;
}

class MemoryPokerStore implements PokerStore {
  readonly rows = new Map<string, PokerTableRow>();
  readonly seats = new Map<number, { tableId: string; seatIndex: number }>();
  saves = 0;
  loads = 0;

  async close(tableId: string, expectedRevision: number): Promise<void> {
    const row = this.rows.get(tableId);
    if (!row || row.revision !== expectedRevision)
      throw new Error('Poker table changed concurrently');
    this.rows.set(tableId, { ...row, status: 'closed', revision: expectedRevision + 1 });
    for (const [characterId, seat] of this.seats) {
      if (seat.tableId === tableId) this.seats.delete(characterId);
    }
  }

  async create(row: PokerTableRow): Promise<boolean> {
    if (this.rows.has(row.tableId)) return false;
    this.rows.set(row.tableId, cloneRow(row));
    return true;
  }

  async load(tableId: string): Promise<PokerTableRow | null> {
    this.loads++;
    const row = this.rows.get(tableId);
    return row ? cloneRow(row) : null;
  }

  async list(): Promise<PokerTableRow[]> {
    return [...this.rows.values()].map(cloneRow);
  }

  async save(
    row: PokerTableRow,
    expectedRevision: number,
    seatMutation?: PokerSeatMutation,
  ): Promise<number> {
    const current = this.rows.get(row.tableId);
    if (!current || current.revision !== expectedRevision) {
      throw new Error('Poker table changed concurrently');
    }
    if (seatMutation?.type === 'join') {
      if (this.seats.has(seatMutation.characterId)) throw new Error('duplicate character seat');
      if (
        [...this.seats.values()].some(
          (seat) => seat.tableId === row.tableId && seat.seatIndex === seatMutation.seatIndex,
        )
      ) {
        throw new Error('duplicate table seat');
      }
      this.seats.set(seatMutation.characterId, {
        tableId: row.tableId,
        seatIndex: seatMutation.seatIndex,
      });
    } else if (seatMutation?.type === 'leave') {
      this.seats.delete(seatMutation.characterId);
    }
    const revision = expectedRevision + 1;
    this.rows.set(row.tableId, cloneRow({ ...row, revision }));
    this.saves++;
    return revision;
  }
}

function service(store = new MemoryPokerStore(), nowMs = () => 1_000) {
  return createPokerService({
    store,
    featureEnabled: () => true,
    nowMs,
    seed: () => 123,
    secureSeed: () => [1, 2, 3, 4],
    provisionDefaults: false,
  });
}

describe('poker rules', () => {
  it('calculates rake per pot with exact integer math', () => {
    const pots = [{ amount: 1_000 }, { amount: 255 }];
    const rake = calculateRakeForPots(pots, true);
    expect(rake).toEqual([100, 25]);
    expect(rake.reduce((sum, value) => sum + value, 0)).toBe(125);
    expect(rake[0]).toBe(Math.floor((1_000 * POKER_RAKE_BPS) / 10_000));
    expect(calculateRakeForPots([{ amount: 9_007_199_254_740_969 }], true)).toEqual([
      900_719_925_474_096,
    ]);
  });

  it('does not charge rake before the flop', () => {
    expect(calculateRakeForPots([{ amount: 1_000 }], false)).toEqual([0]);
  });
});

describe('poker service', () => {
  it('lists tables and watches without persistent writes', async () => {
    const store = new MemoryPokerStore();
    const poker = service(store);
    await poker.createTable({ tableId: 'table-watch', seats: 2 });
    const savesBeforeWatch = store.saves;
    await poker.watchTable({ tableId: 'table-watch', characterId: 99 });

    expect((await poker.listTables())[0]?.watcherCount).toBe(1);
    expect(store.saves).toBe(savesBeforeWatch);
    const saves = store.saves;
    await poker.stopWatching({ tableId: 'table-watch', characterId: 99 });
    expect((await poker.listTables())[0]?.watcherCount).toBe(0);
    expect(store.saves).toBe(saves);
  });

  it('rejects starting a hand before two players are seated', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-start', seats: 2 });
    await poker.buyIn({ tableId: 'table-start', accountId: 1, characterId: 10, seatIndex: 0 });

    await expect(poker.startHand('table-start')).rejects.toThrow(/at least two/i);
  });

  it('rejects a replayed action sequence after accepting it once', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-action', seats: 2 });
    await poker.buyIn({ tableId: 'table-action', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-action', accountId: 2, characterId: 20, seatIndex: 1 });

    const initial = poker.snapshot('table-action', 10);
    await poker.act({
      tableId: 'table-action',
      accountId: 1,
      characterId: 10,
      handNumber: initial.handNumber,
      actionSequence: initial.actionSequence,
      action: { type: 'call' },
    });
    await expect(
      poker.act({
        tableId: 'table-action',
        accountId: 1,
        characterId: 10,
        handNumber: initial.handNumber,
        actionSequence: initial.actionSequence,
        action: { type: 'call' },
      }),
    ).rejects.toThrow(/sequence is stale/i);
  });

  it('independently rejects spectators, out-of-turn players, future sequences, and bad raises', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-authority', seats: 2 });
    await poker.buyIn({ tableId: 'table-authority', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-authority', accountId: 2, characterId: 20, seatIndex: 1 });
    const current = poker.snapshot('table-authority', 10);

    for (const [accountId, characterId, actionSequence, action] of [
      [99, 99, current.actionSequence, { type: 'call' }],
      [2, 20, current.actionSequence, { type: 'check' }],
      [1, 10, current.actionSequence + 1, { type: 'call' }],
      [1, 10, current.actionSequence, { type: 'raise', to: 21 }],
    ] as const) {
      await expect(
        poker.act({
          tableId: 'table-authority',
          accountId,
          characterId,
          handNumber: current.handNumber,
          actionSequence,
          action,
        }),
      ).rejects.toThrow();
    }
    expect(poker.snapshot('table-authority', 10).actionSequence).toBe(current.actionSequence);
  });

  it('rejects buy-in and watching when the feature flag is disabled', async () => {
    const poker = createPokerService({
      store: new MemoryPokerStore(),
      featureEnabled: () => false,
      nowMs: () => 1_000,
      provisionDefaults: false,
    });

    await expect(
      poker.buyIn({ tableId: 'table-1', accountId: 1, characterId: 10, seatIndex: 0 }),
    ).rejects.toThrow(/disabled/i);
    await expect(poker.watchTable({ tableId: 'table-1', characterId: 10 })).rejects.toThrow(
      /disabled/i,
    );
  });

  it('uses fixed 100BB stacks and keeps spectator snapshots private', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-1', seats: 2 });
    await poker.buyIn({ tableId: 'table-1', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-1', accountId: 2, characterId: 20, seatIndex: 1 });

    const player = poker.snapshot('table-1', 10);
    expect((player.seats[0]?.stack ?? 0) + (player.seats[0]?.committed ?? 0)).toBe(POKER_BUY_IN);
    expect(player.seats[0]?.holeCards).toHaveLength(2);
    expect(player.seats[1]?.holeCards).toBeNull();

    const spectator = poker.snapshot('table-1', null);
    expect(spectator.seats.every((seat) => seat?.holeCards == null)).toBe(true);
    expect(spectator.legalActions).toBeNull();
  });

  it('rebuy fills exactly to 100BB between hands', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-rebuy', seats: 2 });
    await poker.buyIn({ tableId: 'table-rebuy', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-rebuy', accountId: 2, characterId: 20, seatIndex: 1 });
    const snapshot = poker.snapshot('table-rebuy', 10);
    await poker.act({
      tableId: 'table-rebuy',
      accountId: 1,
      characterId: 10,
      handNumber: snapshot.handNumber,
      actionSequence: snapshot.actionSequence,
      action: { type: 'fold' },
    });

    await poker.rebuy({ tableId: 'table-rebuy', accountId: 1, characterId: 10 });
    expect(poker.snapshot('table-rebuy', 10).seats[0]?.stack).toBe(POKER_BUY_IN);
    await expect(
      poker.rebuy({ tableId: 'table-rebuy', accountId: 1, characterId: 10 }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects rebuy while a hand is active', async () => {
    const poker = service();
    await poker.createTable({ tableId: 'table-active-rebuy', seats: 2 });
    await poker.buyIn({
      tableId: 'table-active-rebuy',
      accountId: 1,
      characterId: 10,
      seatIndex: 0,
    });
    await poker.buyIn({
      tableId: 'table-active-rebuy',
      accountId: 2,
      characterId: 20,
      seatIndex: 1,
    });

    await expect(
      poker.rebuy({ tableId: 'table-active-rebuy', accountId: 1, characterId: 10 }),
    ).rejects.toThrow(/between hands/i);
  });

  it('DB-style uniqueness allows only one concurrent table seat per character', async () => {
    const store = new MemoryPokerStore();
    const first = service(store);
    await first.createTable({ tableId: 'table-a', seats: 2 });
    await first.createTable({ tableId: 'table-b', seats: 2 });
    const second = service(store);

    const results = await Promise.allSettled([
      first.buyIn({ tableId: 'table-a', accountId: 1, characterId: 10, seatIndex: 0 }),
      second.buyIn({ tableId: 'table-b', accountId: 1, characterId: 10, seatIndex: 0 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.seats.get(10)?.tableId).toMatch(/^table-[ab]$/);
  });

  it('times out with fold and removes a disconnected player after the hand', async () => {
    let now = 1_000;
    const store = new MemoryPokerStore();
    const poker = service(store, () => now);
    await poker.createTable({ tableId: 'table-timeout', seats: 2 });
    await poker.buyIn({ tableId: 'table-timeout', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-timeout', accountId: 2, characterId: 20, seatIndex: 1 });
    await poker.releaseCharacter(10);

    now += 30_000;
    await poker.tick(now);

    expect(poker.snapshot('table-timeout', 10).street).toBeNull();
    expect(store.seats.has(10)).toBe(false);
  });

  it('checks on timeout when legal and starts the next hand after 2.5 seconds', async () => {
    let now = 1_000;
    const poker = service(new MemoryPokerStore(), () => now);
    await poker.createTable({ tableId: 'table-clock', seats: 2 });
    await poker.buyIn({ tableId: 'table-clock', accountId: 1, characterId: 10, seatIndex: 0 });
    await poker.buyIn({ tableId: 'table-clock', accountId: 2, characterId: 20, seatIndex: 1 });
    const first = poker.snapshot('table-clock', 10);
    await poker.act({
      tableId: 'table-clock',
      accountId: 1,
      characterId: 10,
      handNumber: first.handNumber,
      actionSequence: first.actionSequence,
      action: { type: 'call' },
    });

    now = 31_000;
    await poker.tick(now);
    expect(poker.snapshot('table-clock', 20)).toMatchObject({
      street: 'flop',
      actionSequence: first.actionSequence + 2,
    });

    const flop = poker.snapshot('table-clock', 20);
    await poker.act({
      tableId: 'table-clock',
      accountId: 2,
      characterId: 20,
      handNumber: flop.handNumber,
      actionSequence: flop.actionSequence,
      action: { type: 'fold' },
    });
    const completed = poker.snapshot('table-clock', null);
    expect(completed.street).toBeNull();
    now += 2_499;
    await poker.tick(now);
    expect(poker.snapshot('table-clock', null).handNumber).toBe(completed.handNumber);
    now += 1;
    await poker.tick(now);
    expect(poker.snapshot('table-clock', null)).toMatchObject({
      handNumber: completed.handNumber + 1,
      street: 'preflop',
    });
  });

  it('restores authoritative hand and action sequence after service restart', async () => {
    const store = new MemoryPokerStore();
    const first = service(store);
    await first.createTable({ tableId: 'table-restore', seats: 2 });
    await first.buyIn({ tableId: 'table-restore', accountId: 1, characterId: 10, seatIndex: 0 });
    await first.buyIn({ tableId: 'table-restore', accountId: 2, characterId: 20, seatIndex: 1 });
    const before = first.snapshot('table-restore', 10);
    await first.act({
      tableId: 'table-restore',
      accountId: 1,
      characterId: 10,
      handNumber: before.handNumber,
      actionSequence: before.actionSequence,
      action: { type: 'call' },
    });

    const restored = service(store);
    await restored.initialize();
    expect(restored.snapshot('table-restore', 20)).toMatchObject({
      handNumber: before.handNumber,
      actionSequence: before.actionSequence + 1,
      street: 'preflop',
    });
  });

  it('restores timeout and pending leave metadata after service restart', async () => {
    let now = 1_000;
    const store = new MemoryPokerStore();
    const first = service(store, () => now);
    await first.createTable({ tableId: 'table-restart-timeout', seats: 2 });
    await first.buyIn({
      tableId: 'table-restart-timeout',
      accountId: 1,
      characterId: 10,
      seatIndex: 0,
    });
    await first.buyIn({
      tableId: 'table-restart-timeout',
      accountId: 2,
      characterId: 20,
      seatIndex: 1,
    });
    await first.releaseCharacter(10);

    const restored = service(store, () => now);
    await restored.initialize();
    expect(restored.snapshot('table-restart-timeout', 10).turnDeadlineMs).toBe(31_000);
    now = 31_000;
    await restored.tick(now);

    expect(restored.snapshot('table-restart-timeout', null).street).toBeNull();
    expect(store.seats.has(10)).toBe(false);
  });

  it('rejects unknown fixed-catalog tables without a per-request DB lookup', async () => {
    const store = new MemoryPokerStore();
    const poker = service(store);
    await poker.initialize();
    const loads = store.loads;

    await expect(poker.watchTable({ tableId: 'missing-table', characterId: 10 })).rejects.toThrow(
      /not found/i,
    );
    expect(store.loads).toBe(loads);
  });

  it('quarantines one unrestorable table while keeping healthy tables available', async () => {
    const store = new MemoryPokerStore();
    const first = service(store);
    await first.createTable({ tableId: 'healthy-table', seats: 2 });
    await first.createTable({ tableId: 'broken-table', seats: 2 });
    await first.buyIn({ tableId: 'broken-table', accountId: 7, characterId: 70, seatIndex: 0 });
    const broken = store.rows.get('broken-table');
    if (!broken) throw new Error('Missing broken table fixture');
    store.rows.set('broken-table', { ...broken, payload: { version: 999 } });

    const restored = service(store);
    await restored.initialize();

    expect((await restored.listTables()).map((table) => table.tableId)).toEqual(['healthy-table']);
    expect(store.rows.get('broken-table')?.status).toBe('closed');
    expect(store.seats.has(70)).toBe(false);
  });
});
