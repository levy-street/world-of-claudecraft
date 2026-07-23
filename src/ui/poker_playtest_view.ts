import type { PokerAction, PokerViewerSnapshot } from '../sim/poker/engine';

export interface PokerPlaytestActionView {
  action: PokerAction;
  kind: PokerAction['type'];
  amount: number | null;
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

export function buildPokerPlaytestView(snapshot: PokerViewerSnapshot): PokerPlaytestView {
  const legal = snapshot.legalActions;
  const result = snapshot.street === null ? snapshot.lastResult : null;
  const revealedCardsBySeat = new Map(
    result?.revealedHoleCards.map((entry) => [entry.seat, entry.cards.map(cardLabel)]) ?? [],
  );
  const actions: PokerPlaytestActionView[] = [];
  if (legal) {
    for (const kind of legal.actions) {
      if (kind === 'bet' || kind === 'raise') {
        if (legal.minTo !== null) {
          actions.push({ kind, amount: legal.minTo, action: { type: kind, to: legal.minTo } });
        }
      } else {
        actions.push({
          kind,
          amount: kind === 'call' ? legal.toCall : null,
          action: { type: kind },
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
    playerCards: snapshot.seats[0]?.holeCards?.map(cardLabel) ?? [],
    seats: Array.from({ length: 6 }, (_, seatIndex) => {
      const seat = snapshot.seats[seatIndex] ?? null;
      const own = seatIndex === 0;
      const revealedCards = revealedCardsBySeat.get(seatIndex);
      return {
        seat: seatIndex,
        occupied: seat !== null,
        stack: seat?.stack ?? 0,
        bet: seat?.bet ?? 0,
        folded: seat?.folded ?? false,
        acting: snapshot.actorSeat === seatIndex,
        cards: revealedCards ?? (own ? seat?.holeCards?.map(cardLabel) ?? [] : []),
        cardsVisible:
          revealedCards !== undefined || Boolean(snapshot.street !== null && seat?.inHand && !seat.folded),
        own,
        dealer: snapshot.button === seatIndex,
        blind:
          smallBlindSeat === seatIndex ? 'small' : bigBlindSeat === seatIndex ? 'big' : null,
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
      snapshot.lastResult?.payouts.find((payout) => payout.seat === 0)?.amount ?? 0,
  };
}
