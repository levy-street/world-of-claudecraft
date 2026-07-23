import type { Rng } from '../../rng';
import { Rng as SeededRng } from '../../rng';
import { cardKey, type PokerCard, shuffleDeck, validateDistinctCards } from './cards';
import { pokerInvariant } from './error';
import { comparePokerHands, evaluateSevenCardHand } from './hand';

export type PokerPlayerId = number;
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';
export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; to: number }
  | { type: 'raise'; to: number }
  | { type: 'all-in' };

export interface PokerTableConfig {
  id: string;
  numSeats: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  minBuyIn: number;
  maxBuyIn: number;
}

interface PokerSeatState {
  playerId: PokerPlayerId;
  stack: number;
  streetBet: number;
  committed: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  holeCards: PokerCard[];
}

interface PokerHandState {
  handNumber: number;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: PokerStreet;
  deck: PokerCard[];
  deckIndex: number;
  burned: PokerCard[];
  communityCards: PokerCard[];
  actorSeat: number | null;
  currentBet: number;
  minFullRaise: number;
  pendingSeats: number[];
  raiseRights: number[];
}

export interface PokerPotSnapshot {
  amount: number;
  eligibleSeats: number[];
}

export interface PokerSeatSnapshot {
  seat: number;
  playerId: PokerPlayerId;
  stack: number;
  bet: number;
  committed: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  holeCards: PokerCard[] | null;
}

export interface PokerLegalActions {
  actions: Array<PokerAction['type']>;
  toCall: number;
  minTo: number | null;
  maxTo: number | null;
}

export interface PokerHandResult {
  handNumber: number;
  communityCards: PokerCard[];
  pots: PokerPotSnapshot[];
  payouts: Array<{ seat: number; playerId: PokerPlayerId; amount: number }>;
  winners: number[];
  revealedHoleCards: Array<{ seat: number; cards: PokerCard[] }>;
}

export interface PokerViewerSnapshot {
  tableId: string;
  config: PokerTableConfig;
  handNumber: number;
  button: number | null;
  street: PokerStreet | null;
  actorSeat: number | null;
  communityCards: PokerCard[];
  pots: PokerPotSnapshot[];
  seats: Array<PokerSeatSnapshot | null>;
  legalActions: PokerLegalActions | null;
  lastResult: PokerHandResult | null;
}

export interface PokerTableStateV1 {
  version: 1;
  config: PokerTableConfig;
  tableSeed: number;
  handNumber: number;
  lastButton: number;
  seats: Array<PokerSeatState | null>;
  hand: PokerHandState | null;
  lastResult: PokerHandResult | null;
  chipTotal: number;
}

interface PokerPot {
  amount: number;
  eligibleSeats: number[];
}

const STREETS: PokerStreet[] = ['preflop', 'flop', 'turn', 'river'];
const MAX_CARDS = 52;
const MAX_SEATS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedArray(value: unknown, label: string, maxLength: number): unknown[] {
  pokerInvariant(Array.isArray(value), `${label} must be an array`);
  pokerInvariant(value.length <= maxLength, `${label} is too large`);
  return value;
}

function requireRestorableState(value: unknown): PokerTableStateV1 {
  pokerInvariant(isRecord(value), 'Poker table state must be an object');
  pokerInvariant(value.version === 1, 'Unsupported poker table state version');
  pokerInvariant(isRecord(value.config), 'Poker table config is missing');
  boundedArray(value.seats, 'Poker seats', MAX_SEATS);
  if (value.hand !== null) {
    pokerInvariant(isRecord(value.hand), 'Poker hand state is invalid');
    boundedArray(value.hand.deck, 'Poker deck', MAX_CARDS);
    boundedArray(value.hand.burned, 'Burned cards', 3);
    boundedArray(value.hand.communityCards, 'Community cards', 5);
    boundedArray(value.hand.pendingSeats, 'Pending seats', MAX_SEATS);
    boundedArray(value.hand.raiseRights, 'Raise rights', MAX_SEATS);
  }
  if (value.lastResult !== null) {
    pokerInvariant(isRecord(value.lastResult), 'Poker result state is invalid');
    boundedArray(value.lastResult.communityCards, 'Result community cards', 5);
    const pots = boundedArray(value.lastResult.pots, 'Result pots', MAX_SEATS);
    boundedArray(value.lastResult.payouts, 'Result payouts', MAX_SEATS);
    boundedArray(value.lastResult.winners, 'Result winners', MAX_SEATS);
    const revealed = boundedArray(value.lastResult.revealedHoleCards, 'Revealed hands', MAX_SEATS);
    for (const pot of pots) {
      pokerInvariant(isRecord(pot), 'Result pot is invalid');
      boundedArray(pot.eligibleSeats, 'Eligible seats', MAX_SEATS);
    }
    for (const entry of revealed) {
      pokerInvariant(isRecord(entry), 'Revealed hand is invalid');
      boundedArray(entry.cards, 'Revealed cards', 2);
    }
  }
  for (const seat of value.seats as unknown[]) {
    if (seat === null) continue;
    pokerInvariant(isRecord(seat), 'Poker seat state is invalid');
    boundedArray(seat.holeCards, 'Hole cards', 2);
  }
  return value as unknown as PokerTableStateV1;
}

function cloneCard(card: PokerCard): PokerCard {
  return { ...card };
}

function cloneCards(cards: readonly PokerCard[]): PokerCard[] {
  return cards.map(cloneCard);
}

function cloneConfig(config: PokerTableConfig): PokerTableConfig {
  return { ...config };
}

function validateInteger(value: number, label: string, min = 0): void {
  pokerInvariant(Number.isSafeInteger(value) && value >= min, `${label} must be an integer`);
}

function normalizedConfig(config: PokerTableConfig): PokerTableConfig {
  pokerInvariant(typeof config.id === 'string', 'Poker table id must be a string');
  pokerInvariant(config.id.trim().length > 0, 'Poker table id is required');
  validateInteger(config.numSeats, 'Seat count', 2);
  pokerInvariant(config.numSeats <= 6, 'Poker tables support at most 6 seats');
  validateInteger(config.smallBlind, 'Small blind', 1);
  validateInteger(config.bigBlind, 'Big blind', 1);
  pokerInvariant(config.bigBlind >= config.smallBlind, 'Big blind must cover the small blind');
  validateInteger(config.ante ?? 0, 'Ante');
  validateInteger(config.minBuyIn, 'Minimum buy-in', 1);
  validateInteger(config.maxBuyIn, 'Maximum buy-in', 1);
  pokerInvariant(config.maxBuyIn >= config.minBuyIn, 'Maximum buy-in must cover minimum buy-in');
  pokerInvariant(
    Number.isSafeInteger(config.maxBuyIn * config.numSeats),
    'Maximum table buy-ins exceed the safe chip range',
  );
  return { ...config, ante: config.ante ?? 0 };
}

function mixHandSeed(tableSeed: number, handNumber: number): number {
  let value = (tableSeed ^ Math.imul(handNumber, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  value = (value ^ (value >>> 16)) >>> 0;
  return value === 0 ? 0x6d2b79f5 : value;
}

export class PokerTable {
  private readonly configValue: PokerTableConfig;
  private readonly tableSeed: number;
  private seatsValue: Array<PokerSeatState | null>;
  private handNumberValue = 0;
  private lastButton = -1;
  private handValue: PokerHandState | null = null;
  private lastResultValue: PokerHandResult | null = null;
  private chipTotalValue = 0;

  private constructor(config: PokerTableConfig, tableSeed: number) {
    this.configValue = normalizedConfig(config);
    this.tableSeed = tableSeed >>> 0 || 0x6d2b79f5;
    this.seatsValue = new Array(this.configValue.numSeats).fill(null);
  }

  static create(config: PokerTableConfig, rng: Pick<Rng, 'int'>): PokerTable {
    return new PokerTable(config, rng.int(1, 0xffffffff));
  }

  static restore(value: unknown): PokerTable {
    const state = requireRestorableState(value);
    validateInteger(state.tableSeed, 'Table seed', 1);
    pokerInvariant(state.tableSeed <= 0xffffffff, 'Table seed is outside uint32 range');
    const table = new PokerTable(state.config, state.tableSeed);
    validateInteger(state.handNumber, 'Hand number');
    validateInteger(state.chipTotal, 'Chip total');
    pokerInvariant(
      Number.isInteger(state.lastButton) &&
        state.lastButton >= -1 &&
        state.lastButton < table.configValue.numSeats,
      'Invalid dealer button',
    );
    pokerInvariant(state.seats.length === table.configValue.numSeats, 'Seat count changed');
    table.handNumberValue = state.handNumber;
    table.lastButton = state.lastButton;
    table.seatsValue = state.seats.map((seat) => (seat ? table.cloneSeat(seat) : null));
    table.handValue = state.hand ? table.cloneHand(state.hand) : null;
    table.lastResultValue = state.lastResult ? table.cloneResult(state.lastResult) : null;
    table.chipTotalValue = state.chipTotal;
    table.validateRestoredState();
    return table;
  }

  config(): PokerTableConfig {
    return cloneConfig(this.configValue);
  }

  sitDown(seatIndex: number, playerId: PokerPlayerId, buyIn: number): void {
    this.validateSeatIndex(seatIndex);
    validateInteger(playerId, 'Player id', 1);
    validateInteger(buyIn, 'Buy-in', 1);
    pokerInvariant(!this.handValue, 'Players may sit only between hands');
    pokerInvariant(this.seatsValue[seatIndex] === null, 'Poker seat is occupied');
    pokerInvariant(!this.seatForPlayer(playerId), 'Player is already seated');
    pokerInvariant(
      buyIn >= this.configValue.minBuyIn && buyIn <= this.configValue.maxBuyIn,
      'Buy-in is outside the table limits',
    );
    pokerInvariant(Number.isSafeInteger(this.chipTotalValue + buyIn), 'Table chips overflow');
    this.seatsValue[seatIndex] = {
      playerId,
      stack: buyIn,
      streetBet: 0,
      committed: 0,
      inHand: false,
      folded: false,
      allIn: false,
      holeCards: [],
    };
    this.chipTotalValue += buyIn;
    this.assertChipConservation();
  }

  standUp(playerId: PokerPlayerId): number {
    pokerInvariant(!this.handValue, 'Players may stand only between hands');
    const found = this.seatForPlayer(playerId);
    pokerInvariant(found, 'Player is not seated');
    const amount = found.seat.stack;
    this.seatsValue[found.index] = null;
    this.chipTotalValue -= amount;
    this.assertChipConservation();
    return amount;
  }

  startHand(): void {
    pokerInvariant(!this.handValue, 'Poker hand is already active');
    const participating = this.occupiedSeatIndices().filter(
      (seatIndex) => (this.seatsValue[seatIndex]?.stack ?? 0) > 0,
    );
    pokerInvariant(participating.length >= 2, 'At least two funded players are required');
    this.handNumberValue++;
    this.lastResultValue = null;
    this.lastButton = this.nextSeat(this.lastButton, participating);
    const headsUp = participating.length === 2;
    const smallBlindSeat = headsUp
      ? this.lastButton
      : this.nextSeat(this.lastButton, participating);
    const bigBlindSeat = this.nextSeat(smallBlindSeat, participating);
    const handRng = new SeededRng(mixHandSeed(this.tableSeed, this.handNumberValue));
    this.handValue = {
      handNumber: this.handNumberValue,
      button: this.lastButton,
      smallBlindSeat,
      bigBlindSeat,
      street: 'preflop',
      deck: shuffleDeck(handRng),
      deckIndex: 0,
      burned: [],
      communityCards: [],
      actorSeat: null,
      currentBet: 0,
      minFullRaise: this.configValue.bigBlind,
      pendingSeats: [],
      raiseRights: [],
    };
    for (const [seatIndex, seat] of this.seatsValue.entries()) {
      if (!seat) continue;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.inHand = participating.includes(seatIndex);
      seat.folded = false;
      seat.allIn = false;
      seat.holeCards = [];
      if (seat.inHand) this.postForcedBet(seatIndex, this.configValue.ante ?? 0);
    }
    this.postForcedBet(smallBlindSeat, this.configValue.smallBlind);
    this.postForcedBet(bigBlindSeat, this.configValue.bigBlind);
    this.handValue.currentBet = Math.max(
      this.seatsValue[smallBlindSeat]?.streetBet ?? 0,
      this.seatsValue[bigBlindSeat]?.streetBet ?? 0,
    );
    this.dealHoleCards(participating);
    this.resetActionSets();
    const firstToAct = headsUp ? smallBlindSeat : this.nextSeat(bigBlindSeat, participating);
    this.handValue.actorSeat = this.nextPendingSeat(firstToAct - 1);
    this.progressIfNoAction();
    this.assertChipConservation();
  }

  legalActionsFor(playerId: PokerPlayerId): PokerLegalActions | null {
    const hand = this.handValue;
    const found = this.seatForPlayer(playerId);
    if (!hand || !found || hand.actorSeat !== found.index) return null;
    const seat = found.seat;
    const toCall = Math.max(0, hand.currentBet - seat.streetBet);
    const maxTo = seat.streetBet + seat.stack;
    const actions: Array<PokerAction['type']> = ['fold'];
    if (toCall === 0) actions.push('check');
    else actions.push('call');
    let minTo: number | null = null;
    if (seat.stack > 0 && hand.currentBet === 0) {
      if (maxTo >= this.configValue.bigBlind) {
        actions.push('bet');
        minTo = this.configValue.bigBlind;
      }
    } else if (
      seat.stack > toCall &&
      hand.currentBet > 0 &&
      hand.raiseRights.includes(found.index) &&
      maxTo >=
        (hand.currentBet < hand.minFullRaise
          ? hand.minFullRaise
          : hand.currentBet + hand.minFullRaise)
    ) {
      actions.push('raise');
      minTo =
        hand.currentBet < hand.minFullRaise
          ? hand.minFullRaise
          : hand.currentBet + hand.minFullRaise;
    }
    if (
      seat.stack > 0 &&
      (maxTo <= hand.currentBet || hand.currentBet === 0 || hand.raiseRights.includes(found.index))
    ) {
      actions.push('all-in');
    }
    return { actions, toCall: Math.min(toCall, seat.stack), minTo, maxTo };
  }

  act(playerId: PokerPlayerId, action: PokerAction): void {
    const before = this.chipsInTable();
    const hand = this.handValue;
    const found = this.seatForPlayer(playerId);
    pokerInvariant(hand && found, 'Poker hand or player is missing');
    pokerInvariant(hand.actorSeat === found.index, 'It is not this player turn');
    const legal = this.legalActionsFor(playerId);
    pokerInvariant(legal?.actions.includes(action.type), 'Poker action is not legal');
    const seatIndex = found.index;
    const seat = found.seat;
    const previousBet = hand.currentBet;

    if (action.type === 'fold') {
      seat.folded = true;
      this.finishPlayerAction(seatIndex);
    } else if (action.type === 'check') {
      pokerInvariant(hand.currentBet === seat.streetBet, 'Cannot check facing a bet');
      this.finishPlayerAction(seatIndex);
    } else if (action.type === 'call') {
      this.commitFromStack(seat, Math.min(seat.stack, hand.currentBet - seat.streetBet));
      this.finishPlayerAction(seatIndex);
    } else {
      const target = action.type === 'all-in' ? seat.streetBet + seat.stack : action.to;
      validateInteger(target, 'Bet target', 1);
      pokerInvariant(target <= seat.streetBet + seat.stack, 'Bet exceeds player stack');
      if (action.type === 'all-in' && target <= hand.currentBet) {
        this.commitFromStack(seat, seat.stack);
        this.finishPlayerAction(seatIndex);
        pokerInvariant(this.chipsInTable() === before, 'Poker action changed the chip total');
        this.afterAction(seatIndex);
        this.assertChipConservation();
        return;
      }
      pokerInvariant(target > hand.currentBet, 'Bet must increase the current bet');
      if (action.type === 'bet') {
        pokerInvariant(previousBet === 0, 'Bet is available only before an opening bet');
      }
      if (action.type === 'raise') {
        pokerInvariant(previousBet > 0, 'Raise requires an existing bet');
        pokerInvariant(hand.raiseRights.includes(seatIndex), 'Raise rights are not open');
      }
      const increase = target - previousBet;
      const isFullRaise = increase >= hand.minFullRaise;
      const completesOpeningBet =
        previousBet > 0 && previousBet < hand.minFullRaise && target === hand.minFullRaise;
      const isAllIn = target === seat.streetBet + seat.stack;
      pokerInvariant(
        isFullRaise || completesOpeningBet || isAllIn,
        'Only an all-in or opening-bet completion may be below the minimum raise',
      );
      this.commitFromStack(seat, target - seat.streetBet);
      hand.currentBet = target;
      this.removeFromSet(hand.pendingSeats, seatIndex);
      this.removeFromSet(hand.raiseRights, seatIndex);
      const otherActionable = this.actionableSeatIndices().filter((index) => index !== seatIndex);
      if (isFullRaise) {
        hand.minFullRaise = increase;
        hand.pendingSeats = [...otherActionable];
        hand.raiseRights = [...otherActionable];
      } else {
        for (const index of otherActionable) {
          const other = this.seatsValue[index];
          if (other && other.streetBet < hand.currentBet && !hand.pendingSeats.includes(index)) {
            hand.pendingSeats.push(index);
          }
          if (
            other &&
            hand.currentBet - other.streetBet >= hand.minFullRaise &&
            !hand.raiseRights.includes(index)
          ) {
            hand.raiseRights.push(index);
          }
        }
      }
    }

    pokerInvariant(this.chipsInTable() === before, 'Poker action changed the chip total');
    this.afterAction(seatIndex);
    this.assertChipConservation();
  }

  snapshotFor(viewerId: PokerPlayerId | null): PokerViewerSnapshot {
    const hand = this.handValue;
    const viewer = viewerId === null ? null : this.seatForPlayer(viewerId);
    return {
      tableId: this.configValue.id,
      config: cloneConfig(this.configValue),
      handNumber: this.handNumberValue,
      button: hand?.button ?? (this.lastButton >= 0 ? this.lastButton : null),
      street: hand?.street ?? null,
      actorSeat: hand?.actorSeat ?? null,
      communityCards: cloneCards(hand?.communityCards ?? []),
      pots: this.buildPots().map((pot) => ({ ...pot, eligibleSeats: [...pot.eligibleSeats] })),
      seats: this.seatsValue.map((seat, index) => {
        if (!seat) return null;
        const showOwnCards = hand && viewer?.index === index;
        return {
          seat: index,
          playerId: seat.playerId,
          stack: seat.stack,
          bet: seat.streetBet,
          committed: seat.committed,
          inHand: seat.inHand,
          folded: seat.folded,
          allIn: seat.allIn,
          holeCards: showOwnCards ? cloneCards(seat.holeCards) : null,
        };
      }),
      legalActions: viewerId === null ? null : this.legalActionsFor(viewerId),
      lastResult: this.lastResultValue ? this.cloneResult(this.lastResultValue) : null,
    };
  }

  serialize(): PokerTableStateV1 {
    return {
      version: 1,
      config: cloneConfig(this.configValue),
      tableSeed: this.tableSeed,
      handNumber: this.handNumberValue,
      lastButton: this.lastButton,
      seats: this.seatsValue.map((seat) => (seat ? this.cloneSeat(seat) : null)),
      hand: this.handValue ? this.cloneHand(this.handValue) : null,
      lastResult: this.lastResultValue ? this.cloneResult(this.lastResultValue) : null,
      chipTotal: this.chipTotalValue,
    };
  }

  chipTotal(): number {
    return this.chipTotalValue;
  }

  private validateSeatIndex(seatIndex: number): void {
    pokerInvariant(
      Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex < this.configValue.numSeats,
      'Invalid poker seat',
    );
  }

  private occupiedSeatIndices(): number[] {
    return this.seatsValue.flatMap((seat, index) => (seat ? [index] : []));
  }

  private activeSeatIndices(): number[] {
    return this.seatsValue.flatMap((seat, index) => (seat?.inHand && !seat.folded ? [index] : []));
  }

  private actionableSeatIndices(): number[] {
    return this.seatsValue.flatMap((seat, index) =>
      seat?.inHand && !seat.folded && !seat.allIn ? [index] : [],
    );
  }

  private seatForPlayer(playerId: PokerPlayerId): { index: number; seat: PokerSeatState } | null {
    const index = this.seatsValue.findIndex((seat) => seat?.playerId === playerId);
    const seat = index >= 0 ? this.seatsValue[index] : null;
    return seat ? { index, seat } : null;
  }

  private nextSeat(from: number, candidates: readonly number[]): number {
    pokerInvariant(candidates.length > 0, 'No poker seat candidate exists');
    const allowed = new Set(candidates);
    for (let offset = 1; offset <= this.configValue.numSeats; offset++) {
      const index = (from + offset + this.configValue.numSeats) % this.configValue.numSeats;
      if (allowed.has(index)) return index;
    }
    throw new Error('Unreachable poker seat search');
  }

  private nextPendingSeat(from: number): number | null {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    if (hand.pendingSeats.length === 0) return null;
    return this.nextSeat(from, hand.pendingSeats);
  }

  private postForcedBet(seatIndex: number, amount: number): void {
    if (amount <= 0) return;
    const seat = this.seatsValue[seatIndex];
    pokerInvariant(seat?.inHand, 'Forced bet player is missing');
    this.commitFromStack(seat, Math.min(amount, seat.stack));
  }

  private commitFromStack(seat: PokerSeatState, amount: number): void {
    validateInteger(amount, 'Committed chips');
    pokerInvariant(amount <= seat.stack, 'Committed chips exceed stack');
    seat.stack -= amount;
    seat.streetBet += amount;
    seat.committed += amount;
    if (seat.stack === 0) seat.allIn = true;
  }

  private drawCard(): PokerCard {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    pokerInvariant(hand.deckIndex < hand.deck.length, 'Poker deck is empty');
    return cloneCard(hand.deck[hand.deckIndex++]);
  }

  private dealHoleCards(participating: readonly number[]): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    const first = this.nextSeat(hand.button, participating);
    const order: number[] = [];
    let current = first;
    do {
      order.push(current);
      current = this.nextSeat(current, participating);
    } while (current !== first);
    for (let pass = 0; pass < 2; pass++) {
      for (const seatIndex of order) {
        const seat = this.seatsValue[seatIndex];
        pokerInvariant(seat, 'Dealt poker seat is missing');
        seat.holeCards.push(this.drawCard());
      }
    }
  }

  private resetActionSets(): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    const actionable = this.actionableSeatIndices();
    hand.pendingSeats = [...actionable];
    hand.raiseRights = [...actionable];
  }

  private finishPlayerAction(seatIndex: number): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    this.removeFromSet(hand.pendingSeats, seatIndex);
    this.removeFromSet(hand.raiseRights, seatIndex);
  }

  private removeFromSet(values: number[], value: number): void {
    const index = values.indexOf(value);
    if (index >= 0) values.splice(index, 1);
  }

  private afterAction(lastActor: number): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    if (this.activeSeatIndices().length === 1) {
      this.settleHand(false);
      return;
    }
    hand.pendingSeats = hand.pendingSeats.filter((index) =>
      this.actionableSeatIndices().includes(index),
    );
    if (hand.pendingSeats.length > 0) {
      hand.actorSeat = this.nextPendingSeat(lastActor);
      return;
    }
    this.advanceStreetOrShowdown();
  }

  private progressIfNoAction(): void {
    const hand = this.handValue;
    if (!hand) return;
    const actionable = this.actionableSeatIndices();
    hand.pendingSeats = hand.pendingSeats.filter((index) => actionable.includes(index));
    if (this.activeSeatIndices().length === 1) {
      this.settleHand(false);
    } else if (
      actionable.length <= 1 &&
      actionable.every(
        (seatIndex) => (this.seatsValue[seatIndex]?.streetBet ?? 0) === hand.currentBet,
      )
    ) {
      hand.pendingSeats = [];
      this.advanceStreetOrShowdown();
    } else if (hand.pendingSeats.length === 0) {
      this.advanceStreetOrShowdown();
    }
  }

  private advanceStreetOrShowdown(): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    if (hand.street === 'river') {
      this.settleHand(true);
      return;
    }
    const streetIndex = STREETS.indexOf(hand.street);
    hand.street = STREETS[streetIndex + 1];
    hand.burned.push(this.drawCard());
    const count = hand.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) hand.communityCards.push(this.drawCard());
    for (const seat of this.seatsValue) {
      if (seat) seat.streetBet = 0;
    }
    hand.currentBet = 0;
    hand.minFullRaise = this.configValue.bigBlind;
    this.resetActionSets();
    hand.actorSeat = this.nextPendingSeat(hand.button);
    this.progressIfNoAction();
  }

  private buildPots(): PokerPot[] {
    const contributors = this.seatsValue.flatMap((seat, index) =>
      seat && seat.committed > 0 ? [{ seat, index }] : [],
    );
    const levels = [...new Set(contributors.map(({ seat }) => seat.committed))].sort(
      (a, b) => a - b,
    );
    const pots: PokerPot[] = [];
    let previous = 0;
    for (const level of levels) {
      const covering = contributors.filter(({ seat }) => seat.committed >= level);
      const amount = (level - previous) * covering.length;
      if (amount > 0) {
        pots.push({
          amount,
          eligibleSeats: covering
            .filter(({ seat }) => seat.inHand && !seat.folded)
            .map(({ index }) => index),
        });
      }
      previous = level;
    }
    return pots;
  }

  private settleHand(showdown: boolean): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    if (showdown) {
      while (hand.communityCards.length < 5) {
        hand.burned.push(this.drawCard());
        const count = hand.communityCards.length === 0 ? 3 : 1;
        for (let i = 0; i < count; i++) hand.communityCards.push(this.drawCard());
      }
    }
    const pots = this.buildPots();
    const payouts = new Map<number, number>();
    const winners = new Set<number>();
    for (const pot of pots) {
      pokerInvariant(pot.eligibleSeats.length > 0, 'Poker pot has no eligible player');
      let winningSeats: number[];
      if (pot.eligibleSeats.length === 1 || !showdown) {
        winningSeats = [pot.eligibleSeats[0]];
      } else {
        const ranked = pot.eligibleSeats.map((seatIndex) => {
          const seat = this.seatsValue[seatIndex];
          pokerInvariant(seat, 'Poker winner seat is missing');
          return {
            seatIndex,
            hand: evaluateSevenCardHand([...seat.holeCards, ...hand.communityCards]),
          };
        });
        const best = ranked.reduce((current, candidate) =>
          comparePokerHands(candidate.hand, current.hand) > 0 ? candidate : current,
        ).hand;
        winningSeats = ranked
          .filter((candidate) => comparePokerHands(candidate.hand, best) === 0)
          .map((candidate) => candidate.seatIndex);
      }
      const basePayout = Math.floor(pot.amount / winningSeats.length);
      let odd = pot.amount % winningSeats.length;
      for (const seatIndex of winningSeats) {
        payouts.set(seatIndex, (payouts.get(seatIndex) ?? 0) + basePayout);
        winners.add(seatIndex);
      }
      let cursor = hand.button;
      while (odd > 0) {
        cursor = this.nextSeat(cursor, winningSeats);
        payouts.set(cursor, (payouts.get(cursor) ?? 0) + 1);
        odd--;
      }
    }
    for (const [seatIndex, amount] of payouts) {
      const seat = this.seatsValue[seatIndex];
      pokerInvariant(seat, 'Poker payout seat is missing');
      seat.stack += amount;
    }
    const revealedHoleCards = showdown
      ? this.activeSeatIndices().map((seatIndex) => ({
          seat: seatIndex,
          cards: cloneCards(this.seatsValue[seatIndex]?.holeCards ?? []),
        }))
      : [];
    this.lastResultValue = {
      handNumber: hand.handNumber,
      communityCards: cloneCards(hand.communityCards),
      pots: pots.map((pot) => ({ amount: pot.amount, eligibleSeats: [...pot.eligibleSeats] })),
      payouts: [...payouts.entries()].map(([seat, amount]) => ({
        seat,
        playerId: this.seatsValue[seat]?.playerId ?? 0,
        amount,
      })),
      winners: [...winners],
      revealedHoleCards,
    };
    for (const seat of this.seatsValue) {
      if (!seat) continue;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.inHand = false;
      seat.folded = false;
      seat.allIn = false;
      seat.holeCards = [];
    }
    this.handValue = null;
  }

  private chipsInTable(): number {
    return this.seatsValue.reduce((sum, seat) => sum + (seat ? seat.stack + seat.committed : 0), 0);
  }

  private assertChipConservation(): void {
    pokerInvariant(this.chipsInTable() === this.chipTotalValue, 'Poker chips are not conserved');
  }

  private cloneSeat(seat: PokerSeatState): PokerSeatState {
    return { ...seat, holeCards: cloneCards(seat.holeCards) };
  }

  private cloneHand(hand: PokerHandState): PokerHandState {
    return {
      ...hand,
      deck: cloneCards(hand.deck),
      burned: cloneCards(hand.burned),
      communityCards: cloneCards(hand.communityCards),
      pendingSeats: [...hand.pendingSeats],
      raiseRights: [...hand.raiseRights],
    };
  }

  private cloneResult(result: PokerHandResult): PokerHandResult {
    return {
      ...result,
      communityCards: cloneCards(result.communityCards),
      pots: result.pots.map((pot) => ({ ...pot, eligibleSeats: [...pot.eligibleSeats] })),
      payouts: result.payouts.map((payout) => ({ ...payout })),
      winners: [...result.winners],
      revealedHoleCards: result.revealedHoleCards.map((entry) => ({
        seat: entry.seat,
        cards: cloneCards(entry.cards),
      })),
    };
  }

  private validateRestoredState(): void {
    const playerIds = this.seatsValue.flatMap((seat) => (seat ? [seat.playerId] : []));
    pokerInvariant(new Set(playerIds).size === playerIds.length, 'Duplicate poker player');
    for (const seat of this.seatsValue) {
      if (!seat) continue;
      validateInteger(seat.playerId, 'Player id', 1);
      validateInteger(seat.stack, 'Player stack');
      validateInteger(seat.streetBet, 'Player street bet');
      validateInteger(seat.committed, 'Player commitment');
      pokerInvariant(seat.streetBet <= seat.committed, 'Street bet exceeds commitment');
      pokerInvariant(typeof seat.inHand === 'boolean', 'Invalid in-hand flag');
      pokerInvariant(typeof seat.folded === 'boolean', 'Invalid folded flag');
      pokerInvariant(typeof seat.allIn === 'boolean', 'Invalid all-in flag');
      pokerInvariant(!(seat.folded && seat.allIn), 'Folded seat cannot be all-in');
      pokerInvariant(seat.allIn === (seat.inHand && seat.stack === 0), 'Invalid all-in state');
      pokerInvariant(
        seat.holeCards.length === 0 || seat.holeCards.length === 2,
        'Invalid hole cards',
      );
      pokerInvariant(
        seat.inHand === (seat.holeCards.length === 2),
        'Hole cards do not match active seat state',
      );
      if (!seat.inHand) {
        pokerInvariant(
          seat.streetBet === 0 && seat.committed === 0 && !seat.folded,
          'Inactive seat retains hand state',
        );
      }
      validateDistinctCards(seat.holeCards);
    }
    if (this.handValue) {
      const hand = this.handValue;
      pokerInvariant(hand.handNumber === this.handNumberValue, 'Active hand number changed');
      pokerInvariant(this.lastButton === hand.button, 'Active dealer button changed');
      this.validateSeatIndex(hand.button);
      this.validateSeatIndex(hand.smallBlindSeat);
      this.validateSeatIndex(hand.bigBlindSeat);
      pokerInvariant(hand.smallBlindSeat !== hand.bigBlindSeat, 'Blind seats overlap');
      pokerInvariant(STREETS.includes(hand.street), 'Invalid poker street');
      validateInteger(hand.deckIndex, 'Deck index');
      pokerInvariant(hand.deckIndex <= hand.deck.length, 'Deck index exceeds deck');
      validateDistinctCards(hand.deck, 52);
      const expectedDeck = shuffleDeck(new SeededRng(mixHandSeed(this.tableSeed, hand.handNumber)));
      pokerInvariant(
        expectedDeck.every((card, index) => cardKey(card) === cardKey(hand.deck[index])),
        'Restored poker deck does not match its seed',
      );
      this.validateRestoredDeal();
      this.validateRestoredActionState();
    } else {
      pokerInvariant(
        this.seatsValue.every((seat) => !seat?.inHand),
        'Inactive table retains an active seat',
      );
    }
    this.validateRestoredResult();
    this.assertChipConservation();
  }

  private validateRestoredDeal(): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    const participating = this.seatsValue.flatMap((seat, index) => (seat?.inHand ? [index] : []));
    pokerInvariant(participating.length >= 2, 'Active hand has too few players');
    pokerInvariant(participating.includes(hand.button), 'Dealer is not in the active hand');
    pokerInvariant(participating.includes(hand.smallBlindSeat), 'Small blind is not active');
    pokerInvariant(participating.includes(hand.bigBlindSeat), 'Big blind is not active');
    const expectedSmallBlind =
      participating.length === 2 ? hand.button : this.nextSeat(hand.button, participating);
    const expectedBigBlind = this.nextSeat(expectedSmallBlind, participating);
    pokerInvariant(hand.smallBlindSeat === expectedSmallBlind, 'Small blind position changed');
    pokerInvariant(hand.bigBlindSeat === expectedBigBlind, 'Big blind position changed');

    const dealOrder: number[] = [];
    const first = this.nextSeat(hand.button, participating);
    let current = first;
    do {
      dealOrder.push(current);
      current = this.nextSeat(current, participating);
    } while (current !== first);

    let deckIndex = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const seatIndex of dealOrder) {
        const seat = this.seatsValue[seatIndex];
        pokerInvariant(
          seat && cardKey(seat.holeCards[pass]) === cardKey(hand.deck[deckIndex]),
          'Restored hole-card deal order changed',
        );
        deckIndex++;
      }
    }
    const streetIndex = STREETS.indexOf(hand.street);
    const expectedCommunity = [0, 3, 4, 5][streetIndex];
    pokerInvariant(
      hand.communityCards.length === expectedCommunity && hand.burned.length === streetIndex,
      'Restored board does not match its street',
    );
    let boardIndex = 0;
    for (let street = 1; street <= streetIndex; street++) {
      pokerInvariant(
        cardKey(hand.burned[street - 1]) === cardKey(hand.deck[deckIndex++]),
        'Restored burn-card order changed',
      );
      const count = street === 1 ? 3 : 1;
      for (let card = 0; card < count; card++) {
        pokerInvariant(
          cardKey(hand.communityCards[boardIndex++]) === cardKey(hand.deck[deckIndex++]),
          'Restored board-card order changed',
        );
      }
    }
    pokerInvariant(hand.deckIndex === deckIndex, 'Restored poker draw count changed');
  }

  private validateRestoredActionState(): void {
    const hand = this.handValue;
    pokerInvariant(hand, 'Poker hand is missing');
    validateInteger(hand.currentBet, 'Current bet');
    validateInteger(hand.minFullRaise, 'Minimum full raise', 1);
    const actionable = this.actionableSeatIndices();
    const validateSeatSet = (values: number[], label: string): void => {
      pokerInvariant(new Set(values).size === values.length, `${label} contains duplicates`);
      for (const seatIndex of values) {
        this.validateSeatIndex(seatIndex);
        pokerInvariant(actionable.includes(seatIndex), `${label} contains an inactive seat`);
      }
    };
    validateSeatSet(hand.pendingSeats, 'Pending seats');
    validateSeatSet(hand.raiseRights, 'Raise rights');
    pokerInvariant(
      hand.raiseRights.every((seat) => hand.pendingSeats.includes(seat)),
      'Raise rights are not pending',
    );
    pokerInvariant(
      actionable.every(
        (seatIndex) =>
          (this.seatsValue[seatIndex]?.streetBet ?? 0) >= hand.currentBet ||
          hand.pendingSeats.includes(seatIndex),
      ),
      'A caller with chips is missing from pending action',
    );
    pokerInvariant(hand.pendingSeats.length > 0, 'Active hand has no pending action');
    pokerInvariant(
      hand.actorSeat !== null && hand.pendingSeats.includes(hand.actorSeat),
      'Actor is not pending',
    );
    pokerInvariant(
      this.seatsValue.every((seat) => !seat || seat.streetBet <= hand.currentBet),
      'Street bet exceeds current bet',
    );
    pokerInvariant(
      Math.max(...this.seatsValue.map((seat) => seat?.streetBet ?? 0)) === hand.currentBet,
      'Current bet does not match seat bets',
    );
  }

  private validateRestoredResult(): void {
    const result = this.lastResultValue;
    if (!result) return;
    validateInteger(result.handNumber, 'Result hand number', 1);
    pokerInvariant(result.handNumber <= this.handNumberValue, 'Result is from a future hand');
    pokerInvariant(
      result.communityCards.length === 0 || result.communityCards.length === 5,
      'Invalid result board',
    );
    const revealedCards = result.revealedHoleCards.flatMap((entry) => entry.cards);
    validateDistinctCards([...result.communityCards, ...revealedCards]);
    let potTotal = 0;
    for (const pot of result.pots) {
      validateInteger(pot.amount, 'Result pot', 1);
      pokerInvariant(Number.isSafeInteger(potTotal + pot.amount), 'Result pots overflow');
      potTotal += pot.amount;
      pokerInvariant(pot.eligibleSeats.length > 0, 'Result pot has no eligible seat');
      for (const seat of pot.eligibleSeats) this.validateSeatIndex(seat);
    }
    let payoutTotal = 0;
    for (const payout of result.payouts) {
      this.validateSeatIndex(payout.seat);
      validateInteger(payout.playerId, 'Result player id', 1);
      validateInteger(payout.amount, 'Result payout', 1);
      pokerInvariant(Number.isSafeInteger(payoutTotal + payout.amount), 'Result payouts overflow');
      payoutTotal += payout.amount;
    }
    pokerInvariant(payoutTotal === potTotal, 'Result payouts do not match pots');
    pokerInvariant(
      result.winners.every((seat) => result.payouts.some((payout) => payout.seat === seat)),
      'Result winner has no payout',
    );
    for (const entry of result.revealedHoleCards) {
      this.validateSeatIndex(entry.seat);
      pokerInvariant(entry.cards.length === 2, 'Invalid revealed hand');
    }
  }
}
