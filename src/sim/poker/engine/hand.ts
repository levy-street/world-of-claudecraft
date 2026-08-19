import { type PokerCard, type PokerRank, rankValue, validateDistinctCards } from './cards';
import { pokerInvariant } from './error';

export type PokerHandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

const CATEGORY_SCORE: Record<PokerHandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
};

export interface EvaluatedPokerHand {
  category: PokerHandCategory;
  cards: PokerCard[];
  tiebreak: number[];
}

function compareNumberArrays(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function comparePokerHands(a: EvaluatedPokerHand, b: EvaluatedPokerHand): number {
  const categoryDiff = CATEGORY_SCORE[a.category] - CATEGORY_SCORE[b.category];
  return categoryDiff !== 0 ? categoryDiff : compareNumberArrays(a.tiebreak, b.tiebreak);
}

function cardsByRankDesc(cards: readonly PokerCard[]): PokerCard[] {
  return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
}

function straightHigh(values: readonly number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    if (
      unique[i] - 1 === unique[i + 1] &&
      unique[i + 1] - 1 === unique[i + 2] &&
      unique[i + 2] - 1 === unique[i + 3] &&
      unique[i + 3] - 1 === unique[i + 4]
    ) {
      return unique[i];
    }
  }
  return null;
}

function straightCards(cards: readonly PokerCard[], high: number): PokerCard[] {
  const wanted = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];
  return wanted.map((value) => {
    const card = cards.find((candidate) => rankValue(candidate.rank) === value);
    pokerInvariant(card, 'Straight card is missing');
    return card;
  });
}

export function evaluateFiveCardHand(cards: readonly PokerCard[]): EvaluatedPokerHand {
  validateDistinctCards(cards, 5);
  const sorted = cardsByRankDesc(cards);
  const values = sorted.map((card) => rankValue(card.rank));
  const flush = new Set(cards.map((card) => card.suit)).size === 1;
  const highStraight = straightHigh(values);
  if (flush && highStraight !== null) {
    return {
      category: 'straight-flush',
      cards: straightCards(sorted, highStraight),
      tiebreak: [highStraight],
    };
  }

  const byRank = new Map<PokerRank, PokerCard[]>();
  for (const card of sorted) {
    const group = byRank.get(card.rank) ?? [];
    group.push(card);
    byRank.set(card.rank, group);
  }
  const groups = [...byRank.values()].sort((a, b) => {
    const countDiff = b.length - a.length;
    return countDiff !== 0 ? countDiff : rankValue(b[0].rank) - rankValue(a[0].rank);
  });

  if (groups[0].length === 4) {
    const kicker = groups.find((group) => group.length === 1);
    pokerInvariant(kicker, 'Four of a kind kicker is missing');
    return {
      category: 'four-of-a-kind',
      cards: [...groups[0], kicker[0]],
      tiebreak: [rankValue(groups[0][0].rank), rankValue(kicker[0].rank)],
    };
  }
  if (groups[0].length === 3 && groups[1]?.length === 2) {
    return {
      category: 'full-house',
      cards: [...groups[0], ...groups[1]],
      tiebreak: [rankValue(groups[0][0].rank), rankValue(groups[1][0].rank)],
    };
  }
  if (flush) return { category: 'flush', cards: sorted, tiebreak: values };
  if (highStraight !== null) {
    return {
      category: 'straight',
      cards: straightCards(sorted, highStraight),
      tiebreak: [highStraight],
    };
  }
  if (groups[0].length === 3) {
    const kickers = groups
      .filter((group) => group.length === 1)
      .map((group) => group[0])
      .sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
    return {
      category: 'three-of-a-kind',
      cards: [...groups[0], ...kickers],
      tiebreak: [rankValue(groups[0][0].rank), ...kickers.map((card) => rankValue(card.rank))],
    };
  }
  const pairs = groups
    .filter((group) => group.length === 2)
    .sort((a, b) => rankValue(b[0].rank) - rankValue(a[0].rank));
  if (pairs.length === 2) {
    const kicker = groups.find((group) => group.length === 1);
    pokerInvariant(kicker, 'Two pair kicker is missing');
    return {
      category: 'two-pair',
      cards: [...pairs[0], ...pairs[1], kicker[0]],
      tiebreak: [
        rankValue(pairs[0][0].rank),
        rankValue(pairs[1][0].rank),
        rankValue(kicker[0].rank),
      ],
    };
  }
  if (pairs.length === 1) {
    const kickers = groups
      .filter((group) => group.length === 1)
      .map((group) => group[0])
      .sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
    return {
      category: 'pair',
      cards: [...pairs[0], ...kickers],
      tiebreak: [rankValue(pairs[0][0].rank), ...kickers.map((card) => rankValue(card.rank))],
    };
  }
  return { category: 'high-card', cards: sorted, tiebreak: values };
}

function combinationsOfFive(cards: readonly PokerCard[]): PokerCard[][] {
  const combinations: PokerCard[][] = [];
  for (let a = 0; a < cards.length - 4; a++) {
    for (let b = a + 1; b < cards.length - 3; b++) {
      for (let c = b + 1; c < cards.length - 2; c++) {
        for (let d = c + 1; d < cards.length - 1; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            combinations.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return combinations;
}

export function evaluateSevenCardHand(cards: readonly PokerCard[]): EvaluatedPokerHand {
  pokerInvariant(cards.length === 7, 'Expected 7 cards');
  return evaluateBestPokerHand(cards);
}

export function evaluateBestPokerHand(cards: readonly PokerCard[]): EvaluatedPokerHand {
  validateDistinctCards(cards);
  pokerInvariant(cards.length >= 5 && cards.length <= 7, 'Expected 5 to 7 cards');
  const hands = combinationsOfFive(cards).map(evaluateFiveCardHand);
  pokerInvariant(hands.length > 0, 'No poker hands can be evaluated');
  return hands.reduce((best, candidate) =>
    comparePokerHands(candidate, best) > 0 ? candidate : best,
  );
}
