import { describe, expect, it } from 'vitest';
import {
  cardKey,
  type PokerAction,
  PokerRuleError,
  PokerTable,
  type PokerTableConfig,
  type PokerTableStateV1,
} from '../src/sim/poker/engine';
import { Rng } from '../src/sim/rng';

const CONFIG: PokerTableConfig = {
  id: 'copper-10-20',
  numSeats: 6,
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 100,
  maxBuyIn: 2_000,
};

function tableWithPlayers(stacks: number[], seed = 42): PokerTable {
  const table = PokerTable.create(CONFIG, new Rng(seed));
  stacks.forEach((stack, index) => {
    table.sitDown(index, index + 1, stack);
  });
  return table;
}

function persistedChipTotal(table: PokerTable): number {
  return table
    .serialize()
    .seats.reduce((sum, seat) => sum + (seat ? seat.stack + seat.committed : 0), 0);
}

describe('deterministic poker table', () => {
  it('deals the same private snapshot from the same seed and seating', () => {
    const run = () => {
      const table = tableWithPlayers([1_000, 1_000, 1_000], 77);
      table.startHand();
      return table.serialize();
    };
    expect(run()).toEqual(run());
  });

  it('pins the injected seed to a known shuffled deck and distinguishes another seed', () => {
    const deckFor = (seed: number): string[] => {
      const table = tableWithPlayers([1_000, 1_000], seed);
      table.startHand();
      return table.serialize().hand?.deck.slice(0, 10).map(cardKey) ?? [];
    };
    expect(deckFor(77)).toEqual([
      'K:diamonds',
      'A:diamonds',
      '7:diamonds',
      '9:diamonds',
      '3:clubs',
      'Q:spades',
      'T:hearts',
      '3:diamonds',
      'Q:hearts',
      '8:spades',
    ]);
    expect(deckFor(78)).not.toEqual(deckFor(77));
  });

  it('draws one seed from the injected Rng and uses its persisted table stream afterward', () => {
    const rng = new Rng(77);
    const draws: number[] = [];
    rng.setObserver((value) => draws.push(value));
    const table = PokerTable.create(CONFIG, rng);
    expect(draws).toHaveLength(1);
    table.sitDown(0, 1, 1_000);
    table.sitDown(1, 2, 1_000);
    table.startHand();
    expect(draws).toHaveLength(1);
  });

  it('conserves chips across seating, hand start, check, and cash-out lifecycle operations', () => {
    const table = PokerTable.create(CONFIG, new Rng(7));
    table.sitDown(0, 1, 500);
    expect(table.chipTotal()).toBe(500);
    expect(persistedChipTotal(table)).toBe(500);
    table.sitDown(1, 2, 700);
    expect(table.chipTotal()).toBe(1_200);
    expect(persistedChipTotal(table)).toBe(1_200);

    table.startHand();
    expect(persistedChipTotal(table)).toBe(1_200);
    const actorId = table.snapshotFor(null).actorSeat === 0 ? 1 : 2;
    const legal = table.legalActionsFor(actorId);
    table.act(actorId, legal?.actions.includes('check') ? { type: 'check' } : { type: 'call' });
    expect(persistedChipTotal(table)).toBe(1_200);

    while (table.serialize().hand) {
      const snapshot = table.snapshotFor(null);
      const seat = snapshot.actorSeat;
      expect(seat).not.toBeNull();
      if (seat === null) break;
      const playerId = snapshot.seats[seat]?.playerId;
      expect(playerId).toBeDefined();
      if (playerId === undefined) break;
      const actions = table.legalActionsFor(playerId);
      table.act(
        playerId,
        actions?.actions.includes('check') ? { type: 'check' } : { type: 'call' },
      );
    }
    const beforeCashOut = table.chipTotal();
    const cashOut = table.standUp(1);
    expect(table.chipTotal()).toBe(beforeCashOut - cashOut);
    expect(persistedChipTotal(table)).toBe(beforeCashOut - cashOut);
  });

  it('keeps hole cards private to their viewer', () => {
    const table = tableWithPlayers([1_000, 1_000, 1_000]);
    table.startHand();
    const playerOne = table.snapshotFor(1);
    const spectator = table.snapshotFor(null);
    expect(playerOne.seats[0]?.holeCards).toHaveLength(2);
    expect(playerOne.seats[1]?.holeCards).toBeNull();
    expect(playerOne.seats[2]?.holeCards).toBeNull();
    expect(spectator.seats.every((seat) => seat?.holeCards == null)).toBe(true);
    expect(table.snapshotFor(2).legalActions).toBeNull();
    expect(JSON.stringify(playerOne)).not.toContain('tableSeed');
    expect(JSON.stringify(playerOne)).not.toContain('"deck"');
    expect(table.snapshotFor(999_999).legalActions).toBeNull();
    expect(table.snapshotFor(999_999).seats.every((seat) => seat?.holeCards == null)).toBe(true);
  });

  it('does not reopen raise rights after a short all-in', () => {
    const table = tableWithPlayers([1_000, 1_000, 130]);
    table.startHand();
    table.act(1, { type: 'raise', to: 100 });
    table.act(2, { type: 'call' });
    table.act(3, { type: 'all-in' });

    const firstResponder = table.legalActionsFor(1);
    expect(firstResponder?.toCall).toBe(30);
    expect(firstResponder?.actions).toContain('call');
    expect(firstResponder?.actions).not.toContain('raise');
    expect(firstResponder?.actions).not.toContain('all-in');
    table.act(1, { type: 'call' });

    const secondResponder = table.legalActionsFor(2);
    expect(secondResponder?.toCall).toBe(30);
    expect(secondResponder?.actions).not.toContain('raise');
    expect(secondResponder?.actions).not.toContain('all-in');
  });

  it('keeps raise rights for a player who has not acted before a short all-in', () => {
    const table = tableWithPlayers([1_000, 130, 1_000, 1_000]);
    table.startHand();
    table.act(4, { type: 'raise', to: 100 });
    table.act(1, { type: 'call' });
    table.act(2, { type: 'all-in' });

    expect(table.legalActionsFor(3)?.actions).toContain('raise');
  });

  it('reopens raise rights after a full raise', () => {
    const table = tableWithPlayers([1_000, 1_000, 1_000]);
    table.startHand();
    table.act(1, { type: 'raise', to: 100 });
    table.act(2, { type: 'raise', to: 180 });
    table.act(3, { type: 'fold' });

    expect(table.legalActionsFor(1)?.actions).toContain('raise');
  });

  it('reopens raise rights when cumulative short all-ins reach a full raise', () => {
    const table = tableWithPlayers([1_000, 130, 180, 1_000]);
    table.startHand();
    table.act(4, { type: 'raise', to: 100 });
    table.act(1, { type: 'call' });
    table.act(2, { type: 'all-in' });
    table.act(3, { type: 'all-in' });

    const reopened = table.legalActionsFor(4);
    expect(reopened?.toCall).toBe(80);
    expect(reopened?.actions).toContain('raise');
    expect(reopened?.actions).toContain('all-in');
  });

  it('allows an incomplete opening all-in to be completed without reopening its caller', () => {
    const setupIncompleteOpening = (): PokerTable => {
      const table = PokerTable.create({ ...CONFIG, minBuyIn: 1 }, new Rng(42));
      [100, 35, 100].forEach((stack, index) => {
        table.sitDown(index, index + 1, stack);
      });
      table.startHand();
      table.act(1, { type: 'call' });
      table.act(2, { type: 'call' });
      table.act(3, { type: 'check' });
      table.act(2, { type: 'all-in' });
      table.act(3, { type: 'call' });
      return table;
    };

    const table = setupIncompleteOpening();
    const completion = table.legalActionsFor(1);
    expect(completion?.toCall).toBe(15);
    expect(completion?.minTo).toBe(20);
    expect(completion?.actions).toContain('raise');
    expect(() => table.act(1, { type: 'raise', to: 21 })).toThrow(PokerRuleError);
    table.act(1, { type: 'raise', to: 20 });

    const priorCaller = table.legalActionsFor(3);
    expect(priorCaller?.toCall).toBe(5);
    expect(priorCaller?.actions).toContain('call');
    expect(priorCaller?.actions).not.toContain('raise');
    expect(priorCaller?.actions).not.toContain('all-in');

    const fullRaise = setupIncompleteOpening();
    fullRaise.act(1, { type: 'raise', to: 35 });
    expect(fullRaise.legalActionsFor(3)?.actions).toContain('raise');
  });

  it('runs out an all-in hand and conserves every chip', () => {
    const table = tableWithPlayers([100, 100]);
    table.startHand();
    table.act(1, { type: 'all-in' });
    table.act(2, { type: 'call' });

    const state = table.serialize();
    expect(state.hand).toBeNull();
    expect(table.chipTotal()).toBe(180);
    expect(state.seats.reduce((sum, seat) => sum + (seat?.stack ?? 0), 0)).toBe(180);
    expect(state.lastResult?.communityCards).toHaveLength(5);
    expect(state.lastResult?.rake).toBe(20);
    expect(state.lastResult?.rakeByPot).toEqual([20]);
    expect(state.lastResult?.payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(180);
  });

  it('returns an uncalled all-in excess before building pots or charging rake', () => {
    const table = tableWithPlayers([500, 100]);
    table.startHand();
    table.act(1, { type: 'all-in' });
    table.act(2, { type: 'call' });

    const result = table.serialize().lastResult;
    expect(result?.pots.map((pot) => pot.amount)).toEqual([200]);
    expect(result?.rakeByPot).toEqual([20]);
    expect(
      (result?.payouts.reduce((sum, payout) => sum + payout.amount, 0) ?? 0) + (result?.rake ?? 0),
    ).toBe(200);
    expect(table.chipTotal()).toBe(580);
  });

  it('supports a persisted 128-bit server seed without collapsing it to one word', () => {
    const deckFor = (seed: [number, number, number, number]): string[] => {
      const table = PokerTable.create(CONFIG, new Rng(1), seed);
      table.sitDown(0, 1, 1_000);
      table.sitDown(1, 2, 1_000);
      table.startHand();
      const restored = PokerTable.restore(table.serialize());
      expect(restored.serialize()).toEqual(table.serialize());
      return table.serialize().hand?.deck.map(cardKey) ?? [];
    };

    expect(deckFor([1, 2, 3, 4])).not.toEqual(deckFor([1, 2, 3, 5]));
  });

  it('still consumes exactly one shared RNG draw when a secure server seed is provided', () => {
    const rng = new Rng(77);
    const draws: number[] = [];
    rng.setObserver((value) => draws.push(value));
    PokerTable.create(CONFIG, rng, [1, 2, 3, 4]);
    expect(draws).toHaveLength(1);
  });

  it('conserves chips through folds, calls, raises, side pots, and cash-out', () => {
    const table = tableWithPlayers([500, 300, 100]);
    table.startHand();
    table.act(1, { type: 'raise', to: 200 });
    table.act(2, { type: 'call' });
    table.act(3, { type: 'all-in' });
    table.act(2, { type: 'all-in' });
    table.act(1, { type: 'call' });

    const state = table.serialize();
    expect(state.hand).toBeNull();
    expect(table.chipTotal()).toBe(830);
    expect(state.seats.reduce((sum, seat) => sum + (seat?.stack ?? 0), 0)).toBe(830);
    expect(state.lastResult?.pots.map((pot) => pot.amount)).toEqual([300, 400]);
    expect(state.lastResult?.rakeByPot).toEqual([30, 40]);
    expect(
      (state.lastResult?.payouts.reduce((sum, payout) => sum + payout.amount, 0) ?? 0) +
        (state.lastResult?.rake ?? 0),
    ).toBe(700);
    const playerOneBeforeCashOut = state.seats[0]?.stack ?? 0;
    expect(table.standUp(1)).toBe(playerOneBeforeCashOut);
    expect(table.chipTotal()).toBe(830 - playerOneBeforeCashOut);
  });

  it('takes no rake when a hand ends before the flop', () => {
    const table = tableWithPlayers([100, 100]);
    table.startHand();
    table.act(1, { type: 'fold' });

    const result = table.serialize().lastResult;
    expect(result?.communityCards).toEqual([]);
    expect(result?.rake).toBe(0);
    expect(result?.payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(
      result?.pots.reduce((sum, pot) => sum + pot.amount, 0),
    );
  });

  it('publishes and persists the next expected action sequence', () => {
    const table = tableWithPlayers([100, 100]);
    table.startHand();
    expect(table.snapshotFor(1).actionSequence).toBe(0);
    table.act(1, { type: 'call' });
    expect(table.snapshotFor(2).actionSequence).toBe(1);
    expect(table.serialize().actionSequence).toBe(1);
  });

  it('round-trips an active hand and continues byte-identically', () => {
    const original = tableWithPlayers([1_000, 1_000, 1_000], 91);
    original.startHand();
    original.act(1, { type: 'raise', to: 80 });
    const encoded = JSON.stringify(original.serialize());
    const restored = PokerTable.restore(JSON.parse(encoded) as PokerTableStateV1);

    expect(restored.serialize()).toEqual(original.serialize());
    expect(restored.snapshotFor(2)).toEqual(original.snapshotFor(2));

    for (const table of [original, restored]) {
      table.act(2, { type: 'call' });
      table.act(3, { type: 'call' });
      table.act(2, { type: 'check' });
      table.act(3, { type: 'check' });
      table.act(1, { type: 'check' });
    }
    expect(restored.serialize()).toEqual(original.serialize());

    for (const table of [original, restored]) {
      for (let step = 0; table.serialize().hand && step < 30; step++) {
        const snapshot = table.snapshotFor(null);
        const actorSeat = snapshot.actorSeat;
        const actorId = actorSeat === null ? null : snapshot.seats[actorSeat]?.playerId;
        expect(actorId).not.toBeNull();
        if (actorId === null || actorId === undefined) break;
        const legal = table.legalActionsFor(actorId);
        table.act(actorId, legal?.actions.includes('check') ? { type: 'check' } : { type: 'call' });
      }
      table.startHand();
    }
    expect(restored.serialize()).toEqual(original.serialize());
  });

  it('conserves chips after every legal action across deterministic table sizes', () => {
    const exercised = new Set<PokerAction['type']>();
    for (let seed = 1; seed <= 30; seed++) {
      const count = 2 + (seed % 5);
      const stacks = Array.from({ length: count }, (_, index) => 300 + index * 40);
      const table = tableWithPlayers(stacks, seed);
      const expectedTotal = stacks.reduce((sum, stack) => sum + stack, 0);
      table.startHand();
      for (let step = 0; table.serialize().hand && step < 100; step++) {
        const publicState = table.snapshotFor(null);
        const actorSeat = publicState.actorSeat;
        expect(actorSeat).not.toBeNull();
        const actorId = actorSeat === null ? null : publicState.seats[actorSeat]?.playerId;
        expect(actorId).not.toBeNull();
        if (actorId === null || actorId === undefined) break;
        const legal = table.legalActionsFor(actorId);
        expect(legal).not.toBeNull();
        if (!legal) break;

        if (step % 13 === 12) {
          exercised.add('fold');
          table.act(actorId, { type: 'fold' });
        } else if (legal.actions.includes('bet') && step % 5 === 0 && legal.minTo !== null) {
          exercised.add('bet');
          table.act(actorId, { type: 'bet', to: legal.minTo });
        } else if (legal.actions.includes('raise') && step % 7 === 0 && legal.minTo !== null) {
          exercised.add('raise');
          table.act(actorId, { type: 'raise', to: legal.minTo });
        } else if (legal.actions.includes('all-in') && step % 11 === 10) {
          exercised.add('all-in');
          table.act(actorId, { type: 'all-in' });
        } else if (legal.actions.includes('call')) {
          exercised.add('call');
          table.act(actorId, { type: 'call' });
        } else {
          exercised.add('check');
          table.act(actorId, { type: 'check' });
        }

        const persisted = table.serialize();
        const actualTotal = persisted.seats.reduce(
          (sum, seat) => sum + (seat ? seat.stack + seat.committed : 0),
          0,
        );
        const expectedOutstanding = expectedTotal - (persisted.lastResult?.rake ?? 0);
        expect(actualTotal).toBe(expectedOutstanding);
        expect(persisted.chipTotal).toBe(expectedOutstanding);
      }
      expect(table.serialize().hand).toBeNull();
    }
    expect([...exercised].sort()).toEqual(['all-in', 'bet', 'call', 'check', 'fold', 'raise']);
  });

  it('rejects corrupted persistence instead of accepting duplicated cards or chips', () => {
    const table = tableWithPlayers([1_000, 1_000]);
    table.startHand();
    const badCards = table.serialize();
    const first = badCards.seats[0]?.holeCards[0];
    expect(first).toBeDefined();
    if (badCards.seats[1] && first) badCards.seats[1].holeCards[0] = first;
    expect(() => PokerTable.restore(badCards)).toThrow(PokerRuleError);

    const badChips = table.serialize();
    if (badChips.seats[0]) badChips.seats[0].stack++;
    expect(() => PokerTable.restore(badChips)).toThrow(PokerRuleError);

    const badDeck = table.serialize();
    expect(badDeck.hand).not.toBeNull();
    if (badDeck.hand) {
      [badDeck.hand.deck[20], badDeck.hand.deck[21]] = [
        badDeck.hand.deck[21],
        badDeck.hand.deck[20],
      ];
    }
    expect(() => PokerTable.restore(badDeck)).toThrow(/deck does not match its seed/);

    const badActor = table.serialize();
    if (badActor.hand) badActor.hand.actorSeat = 5;
    expect(() => PokerTable.restore(badActor)).toThrow(PokerRuleError);
  });

  it('rejects unsupported, malformed, and unsafe persisted values with PokerRuleError', () => {
    expect(() => PokerTable.restore({ version: 2 })).toThrow(/Unsupported/);
    expect(() => PokerTable.restore({ version: 1, seats: 'many' })).toThrow(PokerRuleError);
    expect(() =>
      PokerTable.create(
        { ...CONFIG, maxBuyIn: Math.floor(Number.MAX_SAFE_INTEGER / 6) + 1 },
        new Rng(1),
      ),
    ).toThrow(/safe chip range/);
  });

  it('round-trips a between-hand state with its version pinned to 1', () => {
    const table = tableWithPlayers([100, 100]);
    table.startHand();
    table.act(1, { type: 'all-in' });
    table.act(2, { type: 'call' });
    const state = table.serialize();
    expect(state.version).toBe(1);
    expect(state.hand).toBeNull();
    expect(PokerTable.restore(JSON.parse(JSON.stringify(state))).serialize()).toEqual(state);
  });
});
