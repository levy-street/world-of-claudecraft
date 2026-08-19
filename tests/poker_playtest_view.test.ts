import { describe, expect, it } from 'vitest';
import { PokerTable, type PokerViewerSnapshot } from '../src/sim/poker/engine';
import { parseCards } from '../src/sim/poker/engine/cards';
import { Rng } from '../src/sim/rng';
import {
  buildPokerPlaytestView,
  pokerActionFromInput,
  stepPokerWager,
} from '../src/ui/poker_playtest_view';

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

function streetSnapshot(board: string): PokerViewerSnapshot {
  const communityCards = parseCards(board);
  return {
    tableId: 'ui',
    config: {
      id: 'ui',
      numSeats: 2,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 100,
      maxBuyIn: 1_000,
    },
    handNumber: 1,
    actionSequence: 0,
    button: 0,
    street: communityCards.length === 3 ? 'flop' : communityCards.length === 4 ? 'turn' : 'river',
    actorSeat: 0,
    communityCards,
    pots: [{ amount: 20, eligibleSeats: [0, 1] }],
    seats: [
      {
        seat: 0,
        playerId: 11,
        stack: 490,
        bet: 0,
        committed: 10,
        inHand: true,
        folded: false,
        allIn: false,
        holeCards: parseCards('As Ad'),
      },
      null,
    ],
    legalActions: null,
    lastResult: null,
  };
}

describe('poker playtest view', () => {
  it('uses an arbitrary viewer seat for private cards and ownership', () => {
    const view = buildPokerPlaytestView(activeTable().snapshotFor(33), 3);
    expect(view.seats[3]?.own).toBe(true);
    expect(view.seats[1]?.own).toBe(false);
    expect(view.playerCards).toHaveLength(2);
    expect(view.handCategory).toBeNull();
    expect([...view.communityCards, ...view.seats[3].cards].some((card) => card.highlighted)).toBe(
      false,
    );
  });

  it('does not assign ownership or cards to a watcher', () => {
    const view = buildPokerPlaytestView(activeTable().snapshotFor(null), null);
    expect(view.seats.some((seat) => seat.own)).toBe(false);
    expect(view.playerCards).toEqual([]);
  });

  it.each([
    ['flop', 'Kd 9h 7c', ['A♠', 'A♦', 'K♦', '9♥', '7♣']],
    ['turn', 'Kd 9h 7c 2s', ['A♠', 'A♦', 'K♦', '9♥', '7♣']],
    ['river', 'Kd 9h 7c 2s Kc', ['A♠', 'A♦', 'K♦', 'K♣', '9♥']],
  ] as const)('highlights the selected five on the %s', (_street, board, selected) => {
    const view = buildPokerPlaytestView(streetSnapshot(board), 0);
    const highlighted = [...view.communityCards, ...view.seats[0].cards]
      .filter((card) => card.highlighted)
      .map((card) => card.label);

    expect(view.handCategory).toBe(board.endsWith('Kc') ? 'two-pair' : 'pair');
    expect(highlighted).toEqual(expect.arrayContaining([...selected]));
    expect(highlighted).toHaveLength(5);
  });

  it('highlights the showdown winner and exposes the winning category', () => {
    const snapshot = streetSnapshot('Kd 9h 7c 2s Kc');
    snapshot.config.numSeats = 3;
    snapshot.seats[1] = {
      seat: 1,
      playerId: 33,
      stack: 0,
      bet: 0,
      committed: 100,
      inHand: true,
      folded: false,
      allIn: true,
      holeCards: null,
    };
    snapshot.seats[2] = {
      seat: 2,
      playerId: 44,
      stack: 0,
      bet: 0,
      committed: 100,
      inHand: true,
      folded: false,
      allIn: true,
      holeCards: null,
    };
    snapshot.street = null;
    snapshot.actorSeat = null;
    snapshot.lastResult = {
      handNumber: 1,
      communityCards: snapshot.communityCards,
      pots: [
        { amount: 300, eligibleSeats: [0, 1, 2] },
        { amount: 100, eligibleSeats: [1, 2] },
      ],
      payouts: [
        { seat: 0, playerId: 11, amount: 300 },
        { seat: 1, playerId: 33, amount: 100 },
      ],
      winners: [0, 1],
      revealedHoleCards: [
        { seat: 0, cards: parseCards('As Ad') },
        { seat: 1, cards: parseCards('Qs Jd') },
        { seat: 2, cards: parseCards('Ts 8d') },
      ],
      rake: 0,
      rakeByPot: [0, 0],
    };

    const view = buildPokerPlaytestView(snapshot, 0);
    expect(view.winnerHandCategories[0]).toBe('two-pair');
    expect(view.winnerHandCategories[1]).toBe('pair');
    expect(view.highlightedWinnerSeat).toBe(0);
    expect(
      [...view.communityCards, ...view.seats[0].cards].filter((card) => card.highlighted),
    ).toHaveLength(5);
    expect(view.seats[1].cards.some((card) => card.highlighted)).toBe(false);
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

  it('steps wager totals by one big blind and clamps to the legal range', () => {
    const wager = { kind: 'raise' as const, amount: null, minTo: 40, maxTo: 95 };
    expect(stepPokerWager(wager, 40, 20, 1)).toBe(60);
    expect(stepPokerWager(wager, 60, 20, 1)).toBe(80);
    expect(stepPokerWager(wager, 80, 20, 1)).toBe(95);
    expect(stepPokerWager(wager, 95, 20, -1)).toBe(80);
    expect(stepPokerWager(wager, 40, 20, -1)).toBe(40);
  });
});
