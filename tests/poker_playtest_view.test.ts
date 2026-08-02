import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/sim/poker/engine';
import { Rng } from '../src/sim/rng';
import { buildPokerPlaytestView, pokerActionFromInput } from '../src/ui/poker_playtest_view';

function activeTable(): PokerTable {
  const table = PokerTable.create(
    { id: 'ui', numSeats: 4, smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1_000 },
    new Rng(7),
  );
  table.sitDown(1, 11, 500);
  table.sitDown(3, 33, 500);
  table.startHand();
  return table;
}

describe('poker playtest view', () => {
  it('uses an arbitrary viewer seat for private cards and ownership', () => {
    const view = buildPokerPlaytestView(activeTable().snapshotFor(33), 3);
    expect(view.seats[3]?.own).toBe(true);
    expect(view.seats[1]?.own).toBe(false);
    expect(view.playerCards).toHaveLength(2);
  });

  it('does not assign ownership or cards to a watcher', () => {
    const view = buildPokerPlaytestView(activeTable().snapshotFor(null), null);
    expect(view.seats.some((seat) => seat.own)).toBe(false);
    expect(view.playerCards).toEqual([]);
  });

  it('accepts any whole wager inside the legal range', () => {
    const wager = { kind: 'raise' as const, amount: null, minTo: 40, maxTo: 300 };
    expect(pokerActionFromInput(wager, '137')).toEqual({ type: 'raise', to: 137 });
    expect(pokerActionFromInput(wager, '39')).toBeNull();
    expect(pokerActionFromInput(wager, '301')).toBeNull();
    expect(pokerActionFromInput(wager, '40.5')).toBeNull();
  });

  it('maps amount-free actions without reading wager input', () => {
    expect(pokerActionFromInput({ kind: 'fold', amount: null, minTo: null, maxTo: null })).toEqual({
      type: 'fold',
    });
  });
});
