// Pure deck/hand engine for the Card Duel minigame (docs: Card Master NPC,
// src/sim/social/card_duel.ts). No SimContext, no class coupling: any player
// can hold a CardHandState. Determinism: shuffling draws only from the `Rng`
// passed in, never `Math.random`.

export const DECK_SIZE = 20;
export const STARTING_HAND_SIZE = 4;

// A card is just a numbered value 1..10, two of each (push-your-luck: higher
// value wins the round). No spell-school/ability reference: the minigame
// resolves entirely on the numbers, not combat effects.
export interface CardHandState {
  deck: number[];
  hand: number[];
  discard: number[];
}

function buildDeck(): number[] {
  const deck: number[] = [];
  for (let v = 1; v <= DECK_SIZE / 2; v++) {
    deck.push(v, v);
  }
  return deck;
}

// Fisher-Yates using the shared deterministic Rng.
export function shuffle(rng: { next(): number }, cards: number[]): number[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createCardHand(rng: { next(): number }): CardHandState {
  const deck = shuffle(rng, buildDeck());
  const hand: number[] = [];
  for (let i = 0; i < STARTING_HAND_SIZE; i++) {
    const card = deck.pop();
    if (card !== undefined) hand.push(card);
  }
  return { deck, hand, discard: [] };
}

// Draws one card into the hand, reshuffling the discard pile back into the
// deck first if the deck is empty (deck+discard is a closed pool of 20).
export function drawOne(rng: { next(): number }, state: CardHandState): void {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return;
    state.deck = shuffle(rng, state.discard);
    state.discard = [];
  }
  const card = state.deck.pop();
  if (card !== undefined) state.hand.push(card);
}

// Plays (removes) one card by value from the hand into the discard pile.
// Returns the played value, or null if the hand does not hold that card.
export function playCard(state: CardHandState, value: number): number | null {
  const idx = state.hand.indexOf(value);
  if (idx === -1) return null;
  state.hand.splice(idx, 1);
  state.discard.push(value);
  return value;
}
