import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/sim/poker/engine/cards';
import {
  comparePokerHands,
  evaluateSevenCardHand,
  type PokerHandCategory,
} from '../src/sim/poker/engine/hand';

const STANDARD_VECTORS: Array<{
  cards: string;
  category: PokerHandCategory;
  tiebreak: number[];
  bestRanks: string[];
}> = [
  {
    cards: 'As Kd 9h 7c 4s 3d 2c',
    category: 'high-card',
    tiebreak: [14, 13, 9, 7, 4],
    bestRanks: ['A', 'K', '9', '7', '4'],
  },
  {
    cards: 'As Ad Kd 9h 7c 4s 2c',
    category: 'pair',
    tiebreak: [14, 13, 9, 7],
    bestRanks: ['A', 'A', 'K', '9', '7'],
  },
  {
    cards: 'As Ad Kd Kh 7c 4s 2c',
    category: 'two-pair',
    tiebreak: [14, 13, 7],
    bestRanks: ['A', 'A', 'K', 'K', '7'],
  },
  {
    cards: 'As Ad Ah Kd 9h 7c 2s',
    category: 'three-of-a-kind',
    tiebreak: [14, 13, 9],
    bestRanks: ['A', 'A', 'A', 'K', '9'],
  },
  {
    cards: 'As 2d 3h 4c 5s Kd Qc',
    category: 'straight',
    tiebreak: [5],
    bestRanks: ['5', '4', '3', '2', 'A'],
  },
  {
    cards: 'As Js 9s 6s 3s Kd Qc',
    category: 'flush',
    tiebreak: [14, 11, 9, 6, 3],
    bestRanks: ['A', 'J', '9', '6', '3'],
  },
  {
    cards: 'As Ad Ah Kd Kh 7c 2s',
    category: 'full-house',
    tiebreak: [14, 13],
    bestRanks: ['A', 'A', 'A', 'K', 'K'],
  },
  {
    cards: 'As Ad Ah Ac Kd Qh Js',
    category: 'four-of-a-kind',
    tiebreak: [14, 13],
    bestRanks: ['A', 'A', 'A', 'A', 'K'],
  },
  {
    cards: '9s Ts Js Qs Ks 2d 3c',
    category: 'straight-flush',
    tiebreak: [13],
    bestRanks: ['K', 'Q', 'J', 'T', '9'],
  },
];

describe('poker hand evaluation', () => {
  it.each(STANDARD_VECTORS)(
    'selects the standard best five and tiebreak for $category',
    ({ cards, category, tiebreak, bestRanks }) => {
      const evaluated = evaluateSevenCardHand(parseCards(cards));
      expect(evaluated.category).toBe(category);
      expect(evaluated.tiebreak).toEqual(tiebreak);
      expect(evaluated.cards.map((card) => card.rank)).toEqual(bestRanks);
    },
  );

  it('orders every standard category from weakest to strongest', () => {
    const evaluated = STANDARD_VECTORS.map((vector) =>
      evaluateSevenCardHand(parseCards(vector.cards)),
    );
    for (let index = 1; index < evaluated.length; index++) {
      expect(comparePokerHands(evaluated[index], evaluated[index - 1])).toBeGreaterThan(0);
    }
  });

  it('treats two triplets as a full house using the higher trips', () => {
    const hand = evaluateSevenCardHand(parseCards('As Ad Ah Ks Kd Kh 2c'));
    expect(hand.category).toBe('full-house');
    expect(hand.tiebreak).toEqual([14, 13]);
  });

  it('uses the highest remaining kicker with four of a kind', () => {
    const hand = evaluateSevenCardHand(parseCards('As Ad Ah Ac Ks Qd Jh'));
    expect(hand.category).toBe('four-of-a-kind');
    expect(hand.tiebreak).toEqual([14, 13]);
  });

  it('uses five-high for a wheel and ranks six-high above it', () => {
    const wheel = evaluateSevenCardHand(parseCards('As 2d 3h 4c 5s Kd Qc'));
    const sixHigh = evaluateSevenCardHand(parseCards('2s 3d 4h 5c 6s Kd Qc'));
    expect(wheel.tiebreak).toEqual([5]);
    expect(comparePokerHands(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('compares full houses by trips before the pair', () => {
    const acesOverTwos = evaluateSevenCardHand(parseCards('As Ad Ah 2s 2d Kc Qc'));
    const kingsOverAces = evaluateSevenCardHand(parseCards('Ks Kd Kh As Ad Qc Jc'));
    expect(comparePokerHands(acesOverTwos, kingsOverAces)).toBeGreaterThan(0);
  });
});
