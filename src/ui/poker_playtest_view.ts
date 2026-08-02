import type { PokerAction, PokerViewerSnapshot } from '../sim/poker/engine';

export interface PokerPlaytestActionView {
  kind: PokerAction['type'];
  amount: number | null;
  minTo: number | null;
  maxTo: number | null;
}

export interface PokerPlaytestView {
  active: boolean;
  street: PokerViewerSnapshot['street'];
  pot: number;
  communityCards: string[];
  playerCards: string[];
  seats: PokerPlaytestSeatView[];
  actorSeat: number | null;
  actions: PokerPlaytestActionView[];
  lastPayout: number;
  rake: number;
}

export interface PokerPlaytestSeatView {
  seat: number;
  occupied: boolean;
  stack: number;
  bet: number;
  folded: boolean;
  acting: boolean;
  cards: string[];
  cardsVisible: boolean;
  own: boolean;
  dealer: boolean;
  blind: 'small' | 'big' | null;
  blindAmount: number;
}

function cardLabel(card: { rank: string; suit: string }): string {
  const suit = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[card.suit] ?? '?';
  return `${card.rank}${suit}`;
}

export function buildPokerPlaytestView(
  snapshot: PokerViewerSnapshot,
  viewerSeat: number | null,
): PokerPlaytestView {
  const legal = snapshot.legalActions;
  const result = snapshot.street === null ? snapshot.lastResult : null;
  const revealedCardsBySeat = new Map(
    result?.revealedHoleCards.map((entry) => [entry.seat, entry.cards.map(cardLabel)]) ?? [],
  );
  const actions: PokerPlaytestActionView[] = [];
  if (legal) {
    for (const kind of legal.actions) {
      if (kind === 'bet' || kind === 'raise') {
        actions.push({ kind, amount: null, minTo: legal.minTo, maxTo: legal.maxTo });
      } else {
        actions.push({
          kind,
          amount: kind === 'call' ? legal.toCall : null,
          minTo: null,
          maxTo: null,
        });
      }
    }
  }
  const occupiedSeats = snapshot.seats.flatMap((seat, index) => (seat ? [index] : []));
  const nextOccupiedSeat = (seat: number): number | null => {
    for (let offset = 1; offset <= snapshot.seats.length; offset++) {
      const candidate = (seat + offset) % snapshot.seats.length;
      if (occupiedSeats.includes(candidate)) return candidate;
    }
    return null;
  };
  const smallBlindSeat =
    snapshot.button === null
      ? null
      : occupiedSeats.length === 2
        ? snapshot.button
        : nextOccupiedSeat(snapshot.button);
  const bigBlindSeat = smallBlindSeat === null ? null : nextOccupiedSeat(smallBlindSeat);
  return {
    active: snapshot.street !== null,
    street: snapshot.street,
    pot: snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0),
    communityCards: (result?.communityCards ?? snapshot.communityCards).map(cardLabel),
    playerCards:
      viewerSeat === null ? [] : (snapshot.seats[viewerSeat]?.holeCards?.map(cardLabel) ?? []),
    seats: Array.from({ length: snapshot.config.numSeats }, (_, seatIndex) => {
      const seat = snapshot.seats[seatIndex] ?? null;
      const own = viewerSeat !== null && seatIndex === viewerSeat;
      const revealedCards = revealedCardsBySeat.get(seatIndex);
      return {
        seat: seatIndex,
        occupied: seat !== null,
        stack: seat?.stack ?? 0,
        bet: seat?.bet ?? 0,
        folded: seat?.folded ?? false,
        acting: snapshot.actorSeat === seatIndex,
        cards: revealedCards ?? (own ? (seat?.holeCards?.map(cardLabel) ?? []) : []),
        cardsVisible:
          revealedCards !== undefined ||
          Boolean(snapshot.street !== null && seat?.inHand && !seat.folded),
        own,
        dealer: snapshot.button === seatIndex,
        blind: smallBlindSeat === seatIndex ? 'small' : bigBlindSeat === seatIndex ? 'big' : null,
        blindAmount:
          smallBlindSeat === seatIndex
            ? snapshot.config.smallBlind
            : bigBlindSeat === seatIndex
              ? snapshot.config.bigBlind
              : 0,
      };
    }),
    actorSeat: snapshot.actorSeat,
    actions,
    lastPayout:
      viewerSeat === null
        ? 0
        : (snapshot.lastResult?.payouts.find((payout) => payout.seat === viewerSeat)?.amount ?? 0),
    rake: snapshot.lastResult?.rake ?? 0,
  };
}

export function pokerActionFromInput(
  action: PokerPlaytestActionView,
  rawAmount?: string,
): PokerAction | null {
  if (action.kind !== 'bet' && action.kind !== 'raise') return { type: action.kind };
  if (rawAmount === undefined || !/^\d+$/.test(rawAmount.trim())) return null;
  const to = Number(rawAmount);
  if (!Number.isSafeInteger(to)) return null;
  if (action.minTo !== null && to < action.minTo) return null;
  if (action.maxTo !== null && to > action.maxTo) return null;
  return { type: action.kind, to };
}
