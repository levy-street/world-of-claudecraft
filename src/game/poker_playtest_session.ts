import {
  type PokerAction,
  PokerTable,
  type PokerViewerSnapshot,
} from '../sim/poker/engine';
import { Rng } from '../sim/rng';

const PLAYER_ID = 1;
const DEALER_ID = 2;
const PLAYER_SEAT = 0;
const DEALER_SEAT = 3;
const STARTING_CHIPS = 1_000;

export interface PokerPlaytestState {
  snapshot: PokerViewerSnapshot;
  playerName: string;
  dealerName: string;
}

/**
 * Browser-local poker playtest. Its chips have no relationship to Copper,
 * character persistence, the economy service, or the database.
 */
export class PokerPlaytestSession {
  private table = this.createTable();

  constructor(private readonly playerName: string) {
    this.startHand();
  }

  state(): PokerPlaytestState {
    return {
      snapshot: this.table.snapshotFor(PLAYER_ID),
      playerName: this.playerName,
      dealerName: 'Test Dealer',
    };
  }

  act(action: PokerAction): void {
    this.table.act(PLAYER_ID, action);
    this.driveDealer();
  }

  nextHand(): void {
    if (this.table.serialize().hand) return;
    const seats = this.table.serialize().seats;
    if ((seats[PLAYER_SEAT]?.stack ?? 0) === 0 || (seats[DEALER_SEAT]?.stack ?? 0) === 0) {
      this.table = this.createTable();
    }
    this.startHand();
  }

  reset(): void {
    this.table = this.createTable();
    this.startHand();
  }

  private createTable(): PokerTable {
    const table = PokerTable.create(
      {
        id: 'local-playtest',
        numSeats: 6,
        smallBlind: 10,
        bigBlind: 20,
        minBuyIn: STARTING_CHIPS,
        maxBuyIn: STARTING_CHIPS,
      },
      new Rng(0x504f4b45),
    );
    table.sitDown(PLAYER_SEAT, PLAYER_ID, STARTING_CHIPS);
    table.sitDown(DEALER_SEAT, DEALER_ID, STARTING_CHIPS);
    return table;
  }

  private startHand(): void {
    this.table.startHand();
    this.driveDealer();
  }

  private driveDealer(): void {
    for (let step = 0; step < 20; step++) {
      const state = this.table.snapshotFor(DEALER_ID);
      if (state.actorSeat !== DEALER_SEAT) return;
      const legal = state.legalActions;
      if (!legal) return;
      if (legal.actions.includes('check')) {
        this.table.act(DEALER_ID, { type: 'check' });
      } else if (legal.actions.includes('call')) {
        this.table.act(DEALER_ID, { type: 'call' });
      } else {
        this.table.act(DEALER_ID, { type: 'fold' });
      }
    }
  }
}
