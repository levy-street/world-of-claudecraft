import { PokerTable, type PokerViewerSnapshot, type PokerAction } from '../src/sim/poker/engine';
import { Rng } from '../src/sim/rng';
import { loadPokerTable, savePokerTable } from './poker_db';

export interface PokerDbLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface PokerServiceDeps {
  db: PokerDbLike;
  featureEnabled: () => boolean;
  nowMs: () => number;
}

export interface PokerTableCreateInput {
  tableId: string;
  seats: number;
  smallBlind: number;
  bigBlind: number;
}

export interface PokerBuyInInput {
  tableId: string;
  accountId: number;
  characterId: number;
  seatIndex: number;
  copper?: number;
}

export interface PokerRebuyInput {
  tableId: string;
  accountId: number;
  characterId: number;
  copper?: number;
}

interface PokerSeatView {
  seat: number;
  playerId: number;
  stack: number;
  escrow: number;
  folded: boolean;
  inHand: boolean;
  holeCards: Array<{ rank: string; suit: string }> | null;
  legalActions: Array<string> | null;
}

interface PokerTableRecord {
  tableId: string;
  state: PokerTable;
  seatByCharacter: Map<number, number>;
  revision: number;
  createdAtMs: number;
}

function normalizeSnapshot(snapshot: PokerViewerSnapshot): PokerSeatView[] {
  return snapshot.seats.map((seat, index) => ({
    seat: index,
    playerId: seat?.playerId ?? 0,
    stack: seat?.stack ?? 0,
    escrow: seat?.stack ?? 0,
    folded: seat?.folded ?? false,
    inHand: seat?.inHand ?? false,
    holeCards: seat?.holeCards ? seat.holeCards.map((card) => ({ rank: card.rank, suit: card.suit })) : null,
    legalActions: snapshot.legalActions ? snapshot.legalActions.actions : null,
  }));
}

export function createPokerService(deps: PokerServiceDeps) {
  const tables = new Map<string, PokerTableRecord>();

  async function persist(table: PokerTableRecord): Promise<void> {
    await savePokerTable(deps.db.query.bind(deps.db), table.tableId, table.state.serialize(), table.revision);
  }

  async function load(tableId: string): Promise<PokerTableRecord | undefined> {
    const row = await loadPokerTable(deps.db.query.bind(deps.db), tableId);
    if (!row) return undefined;
    const table = PokerTable.restore(row.payload);
    return {
      tableId,
      state: table,
      seatByCharacter: new Map<number, number>(),
      revision: row.revision,
      createdAtMs: deps.nowMs(),
    };
  }

  async function ensureLoaded(tableId: string): Promise<PokerTableRecord> {
    const existing = tables.get(tableId);
    if (existing) return existing;
    const loaded = await load(tableId);
    if (loaded) {
      tables.set(tableId, loaded);
      return loaded;
    }
    throw new Error(`Poker table ${tableId} not found`);
  }

  return {
    async createTable(input: PokerTableCreateInput): Promise<void> {
      if (!deps.featureEnabled()) throw new Error('Poker feature is disabled');
      if (tables.has(input.tableId)) throw new Error('Poker table already exists');
      const table = PokerTable.create(
        {
          id: input.tableId,
          numSeats: input.seats,
          smallBlind: input.smallBlind,
          bigBlind: input.bigBlind,
          minBuyIn: 2_000,
          maxBuyIn: 2_000,
        },
        new Rng(0x504f4b45),
      );
      const record: PokerTableRecord = {
        tableId: input.tableId,
        state: table,
        seatByCharacter: new Map<number, number>(),
        revision: 1,
        createdAtMs: deps.nowMs(),
      };
      tables.set(input.tableId, record);
      await persist(record);
    },

    async buyIn(input: PokerBuyInInput): Promise<void> {
      if (!deps.featureEnabled()) throw new Error('Poker feature is disabled');
      const record = await ensureLoaded(input.tableId);
      const seatIndex = input.seatIndex ?? 0;
      if (record.seatByCharacter.has(input.characterId)) throw new Error('Character is already seated');
      record.state.sitDown(seatIndex, input.characterId, input.copper ?? 2_000);
      record.seatByCharacter.set(input.characterId, seatIndex);
      record.revision++;
      await persist(record);
    },

    async rebuy(input: PokerRebuyInput): Promise<void> {
      if (!deps.featureEnabled()) throw new Error('Poker feature is disabled');
      const record = await ensureLoaded(input.tableId);
      const seatIndex = record.seatByCharacter.get(input.characterId);
      if (seatIndex === undefined) throw new Error('Character is not seated');
      const snapshot = record.state.snapshotFor(input.characterId);
      const currentStack = snapshot.seats[seatIndex]?.stack ?? 0;
      const amount = Math.max(0, 2_000 - currentStack);
      if (amount <= 0) throw new Error('Rebuy not allowed');
      record.state.addToStack(input.characterId, input.copper ?? amount);
      record.revision++;
      await persist(record);
    },

    async leaveTable(input: { tableId: string; characterId: number }): Promise<void> {
      const record = await ensureLoaded(input.tableId);
      const seatIndex = record.seatByCharacter.get(input.characterId);
      if (seatIndex === undefined) return;
      const cashOut = record.state.standUp(input.characterId);
      record.seatByCharacter.delete(input.characterId);
      record.revision++;
      await persist(record);
      void cashOut;
    },

    snapshot(tableId: string, viewerId: number | null): { tableId: string; seats: PokerSeatView[]; handNumber: number } {
      const record = tables.get(tableId) ?? undefined;
      if (!record) {
        return { tableId, seats: [], handNumber: 0 };
      }
      const snapshot = record.state.snapshotFor(viewerId ?? null);
      return {
        tableId,
        seats: normalizeSnapshot(snapshot),
        handNumber: snapshot.handNumber,
      };
    },

    async startHand(tableId: string): Promise<void> {
      const record = await ensureLoaded(tableId);
      record.state.startHand();
      record.revision++;
      await persist(record);
    },

    async act(tableId: string, actorId: number, action: PokerAction): Promise<void> {
      const record = await ensureLoaded(tableId);
      record.state.act(actorId, action);
      record.revision++;
      await persist(record);
    },

    async settle(tableId: string): Promise<void> {
      const record = await ensureLoaded(tableId);
      record.revision++;
      await persist(record);
    },
  };
}

export type PokerService = ReturnType<typeof createPokerService>;
