import { describe, expect, it } from 'vitest';
import {
  createCardHand,
  drawOne,
  playCard,
  STARTING_HAND_SIZE,
  shuffle,
} from '../src/sim/minigames/card_hand';
import { Rng } from '../src/sim/rng';

describe('card_hand', () => {
  it('shuffle is deterministic for a given seed and preserves the multiset', () => {
    const cards = [1, 1, 2, 2, 3, 3];
    const a = shuffle(new Rng(42), cards);
    const b = shuffle(new Rng(42), cards);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...cards].sort());
  });

  it('createCardHand deals a starting hand from a 20-card deck', () => {
    const state = createCardHand(new Rng(1));
    expect(state.hand.length).toBe(STARTING_HAND_SIZE);
    expect(state.deck.length + state.hand.length + state.discard.length).toBe(20);
  });

  it('playCard removes exactly one matching card and discards it', () => {
    const state = createCardHand(new Rng(1));
    const value = state.hand[0];
    const before = state.hand.length;
    const played = playCard(state, value);
    expect(played).toBe(value);
    expect(state.hand.length).toBe(before - 1);
    expect(state.discard).toContain(value);
  });

  it('playCard returns null for a value not in hand', () => {
    const state = createCardHand(new Rng(1));
    const notHeld = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((v) => !state.hand.includes(v));
    expect(notHeld).toBeDefined();
    expect(playCard(state, notHeld as number)).toBeNull();
  });

  it('drawOne reshuffles the discard pile back into the deck once empty, and reports it', () => {
    const rng = new Rng(1);
    const state = createCardHand(rng);
    // Drain the deck entirely, discarding every drawn card so the pool stays
    // in deck+discard (never lost). None of these draws should report a
    // reshuffle: the deck still has cards left every time drawOne runs here.
    while (state.deck.length > 0) {
      expect(drawOne(rng, state)).toBe(false);
      const v = state.hand.pop();
      if (v !== undefined) state.discard.push(v);
    }
    expect(state.deck.length).toBe(0);
    const handCountBefore = state.hand.length;
    // This is the one draw that must trip the reshuffle: the deck is empty
    // going in, and the discard pile gets shuffled back into it.
    expect(drawOne(rng, state)).toBe(true);
    // The discard pile was reshuffled into the deck, then one card drawn from it:
    // the pool stays at 20 total, and the hand grew by exactly one card.
    expect(state.deck.length + state.discard.length + state.hand.length).toBe(20);
    expect(state.hand.length).toBe(handCountBefore + 1);
  });

  it('drawOne reports no reshuffle for an ordinary draw with cards left in the deck', () => {
    const rng = new Rng(2);
    const state = createCardHand(rng);
    expect(state.deck.length).toBeGreaterThan(0);
    expect(drawOne(rng, state)).toBe(false);
  });

  it('drawOne is a no-op (and reports no reshuffle) once deck and discard are both empty', () => {
    const rng = new Rng(3);
    const state = { deck: [], hand: [], discard: [] };
    expect(drawOne(rng, state)).toBe(false);
    expect(state.hand).toEqual([]);
  });

  it('never loses or duplicates a card across deck+hand+discard', () => {
    const rng = new Rng(9);
    const state = createCardHand(rng);
    for (let i = 0; i < 30; i++) {
      if (state.hand.length > 0) {
        playCard(state, state.hand[0]);
      }
      drawOne(rng, state);
      expect(state.deck.length + state.hand.length + state.discard.length).toBe(20);
    }
  });
});
