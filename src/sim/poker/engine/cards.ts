import type { Rng } from '../../rng';
import { pokerInvariant } from './error';

export const POKER_RANKS = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
] as const;
export const POKER_SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

export type PokerRank = (typeof POKER_RANKS)[number];
export type PokerSuit = (typeof POKER_SUITS)[number];

export interface PokerCard {
  rank: PokerRank;
  suit: PokerSuit;
}

export function cardKey(card: PokerCard): string {
  return `${card.rank}:${card.suit}`;
}

export function rankValue(rank: PokerRank): number {
  const value = POKER_RANKS.indexOf(rank);
  pokerInvariant(value >= 0, 'Unknown poker rank');
  return value + 2;
}

export function createDeck(): PokerCard[] {
  const deck: PokerCard[] = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) deck.push({ rank, suit });
  }
  return deck;
}

export function shuffleDeck(rng: Pick<Rng, 'int'>): PokerCard[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function parseCard(value: string): PokerCard {
  const match = /^([2-9TJQKA])([cdhs])$/.exec(value);
  pokerInvariant(match, `Invalid poker card: ${value}`);
  const suitByCode: Record<string, PokerSuit> = {
    c: 'clubs',
    d: 'diamonds',
    h: 'hearts',
    s: 'spades',
  };
  return { rank: match[1] as PokerRank, suit: suitByCode[match[2]] };
}

export function parseCards(values: string): PokerCard[] {
  return values.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function validateDistinctCards(cards: readonly PokerCard[], expected?: number): void {
  if (expected !== undefined) {
    pokerInvariant(cards.length === expected, `Expected ${expected} cards`);
  }
  for (const card of cards) {
    pokerInvariant(POKER_RANKS.includes(card.rank), 'Poker card has an invalid rank');
    pokerInvariant(POKER_SUITS.includes(card.suit), 'Poker card has an invalid suit');
  }
  pokerInvariant(new Set(cards.map(cardKey)).size === cards.length, 'Poker cards must be unique');
}
