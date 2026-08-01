import { describe, expect, it } from 'vitest';
import { calculateRakeForPots, POKER_RAKE_BPS } from '../../src/sim/poker/rules';
import { createPokerService, type PokerDbLike } from '../../server/poker_service';

class FakePokerDb implements PokerDbLike {
  private readonly rows: Array<Record<string, unknown>> = [];

  async query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (text.includes('SELECT')) {
      return { rows: this.rows.filter((row) => row.table_id === values?.[0]) };
    }
    if (text.includes('INSERT') || text.includes('UPDATE')) {
      this.rows.push({ table_id: values?.[0], payload: values?.[1], revision: values?.[2] });
      return { rows: [] };
    }
    return { rows: [] };
  }
}

describe('poker rules', () => {
  it('calculates rake per pot with integer math', () => {
    const pots = [{ amount: 1000 }, { amount: 250 }];
    const rake = calculateRakeForPots(pots, true);
    expect(rake).toEqual([100, 25]);
    expect(rake.reduce((sum, value) => sum + value, 0)).toBe(125);
    expect(rake[0]).toBe(Math.floor(1000 * POKER_RAKE_BPS / 10_000));
  });

  it('does not charge rake before the flop', () => {
    expect(calculateRakeForPots([{ amount: 1000 }], false)).toEqual([0]);
  });
});

describe('poker service', () => {
  it('rejects buy-in when the feature flag is disabled', async () => {
    const service = createPokerService({
      db: new FakePokerDb(),
      featureEnabled: () => false,
      nowMs: () => 1_000,
    });

    await expect(
      service.buyIn({ tableId: 'table-1', accountId: 1, characterId: 10, seatIndex: 0 }),
    ).rejects.toThrow(/disabled/i);
  });

  it('tracks buy-in and rebuy atomically and keeps spectator snapshots private', async () => {
    const service = createPokerService({
      db: new FakePokerDb(),
      featureEnabled: () => true,
      nowMs: () => 1_000,
    });

    await service.createTable({ tableId: 'table-1', seats: 2, smallBlind: 10, bigBlind: 20 });
    await service.buyIn({ tableId: 'table-1', accountId: 1, characterId: 10, seatIndex: 0, copper: 2_000 });
    await service.buyIn({ tableId: 'table-1', accountId: 2, characterId: 20, seatIndex: 1, copper: 2_000 });
    await service.startHand('table-1');

    const initial = service.snapshot('table-1', 10);
    expect(initial.seats[0]?.stack).toBe(2_000);
    expect(initial.seats[0]?.escrow).toBe(2_000);
    expect(initial.seats[0]?.holeCards).toHaveLength(2);

    const spectator = service.snapshot('table-1', null);
    expect(spectator.seats[0]?.holeCards).toBeNull();
    expect(spectator.seats[0]?.legalActions).toBeNull();

    await service.rebuy({ tableId: 'table-1', accountId: 1, characterId: 10, copper: 1_000 });
    const afterRebuy = service.snapshot('table-1', 10);
    expect(afterRebuy.seats[0]?.stack).toBe(3_000);
    expect(afterRebuy.seats[0]?.escrow).toBe(3_000);
  });
});
