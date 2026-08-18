import { type PokerAction, PokerTable } from '../src/sim/poker/engine';
import type { PokerClientSnapshot } from '../src/sim/poker/protocol';
import { Rng } from '../src/sim/rng';
import {
  createPokerStore,
  type PokerQuery,
  type PokerSeatMutation,
  type PokerStore,
  type PokerTableRow,
} from './poker_db';
import {
  clearPokerSitOut,
  decodePokerSitOut,
  encodePokerSitOut,
  markPokerSitOut,
  pokerSitOutLeavesAfterHand,
  type PokerSitOutEntry,
  type PokerSitOutState,
} from './poker_sit_out';

export const POKER_SMALL_BLIND = 10;
export const POKER_BIG_BLIND = 20;
export const POKER_BUY_IN = POKER_BIG_BLIND * 100;
export const POKER_TURN_TIMEOUT_MS = 30_000;
export const POKER_NEXT_HAND_DELAY_MS = 2_500;
export const POKER_MAX_CONCURRENT_MUTATIONS = 4;
export const DEFAULT_POKER_TABLE_IDS = [
  'low-stakes-1',
  'low-stakes-2',
  'low-stakes-3',
  'low-stakes-4',
] as const;

export interface PokerDbLike {
  query: PokerQuery;
}

export interface PokerServiceDeps {
  db?: PokerDbLike;
  store?: PokerStore;
  realm?: string;
  featureEnabled: () => boolean;
  nowMs: () => number;
  seed?: () => number;
  secureSeed?: () => [number, number, number, number];
  provisionDefaults?: boolean;
  onChanged?: (tableId: string, result: boolean) => void;
  audit?: (event: {
    type: 'action' | 'join' | 'leave' | 'rebuy' | 'sit_in' | 'stop_watch' | 'watch';
    tableId: string;
    accountId?: number;
    characterId: number;
    handNumber?: number;
    actionSequence?: number;
    action?: PokerAction['type'];
    completed?: boolean;
    rake?: number;
    amount?: number;
    payouts?: Array<{ characterId: number; amount: number }>;
  }) => void;
}

export interface PokerTableCreateInput {
  tableId: string;
  seats: number;
  smallBlind?: number;
  bigBlind?: number;
}

export interface PokerBuyInInput {
  tableId: string;
  accountId: number;
  characterId: number;
  seatIndex: number;
}

export interface PokerRebuyInput {
  tableId: string;
  accountId: number;
  characterId: number;
}

export interface PokerActInput {
  tableId: string;
  accountId: number;
  characterId: number;
  handNumber: number;
  actionSequence: number;
  action: PokerAction;
  automatic?: 'timeout' | 'sit_out';
}

export type PokerWireSnapshot = PokerClientSnapshot;

interface PokerTableRecord {
  tableId: string;
  state: PokerTable;
  revision: number;
  watchers: Set<number>;
  leaveAfterHand: Set<number>;
  sitOut: PokerSitOutState;
  turnDeadlineMs: number | null;
  nextHandAtMs: number | null;
  retryDelayMs: number;
}

interface PokerPersistedPayload {
  version: 1;
  table: ReturnType<PokerTable['serialize']>;
  turnDeadlineMs: number | null;
  nextHandAtMs: number | null;
  leaveAfterHand: number[];
  sitOut?: PokerSitOutEntry[];
}

function statusOf(state: PokerTable): PokerTableRow['status'] {
  return state.snapshotFor(null).street === null ? 'waiting' : 'playing';
}

function rowFor(record: PokerTableRecord, state = record.state): PokerTableRow {
  const snapshot = state.snapshotFor(null);
  const payload: PokerPersistedPayload = {
    version: 1,
    table: state.serialize(),
    turnDeadlineMs: record.turnDeadlineMs,
    nextHandAtMs: record.nextHandAtMs,
    leaveAfterHand: [...record.leaveAfterHand],
    sitOut: encodePokerSitOut(record.sitOut),
  };
  return {
    tableId: record.tableId,
    payload,
    revision: record.revision,
    status: statusOf(state),
    handNumber: snapshot.handNumber,
    actionSequence: snapshot.actionSequence,
  };
}

function seatedEntries(state: PokerTable): Array<{ characterId: number; seatIndex: number }> {
  return state
    .snapshotFor(null)
    .seats.flatMap((seat, seatIndex) => (seat ? [{ characterId: seat.playerId, seatIndex }] : []));
}

function cloneTable(state: PokerTable): PokerTable {
  return PokerTable.restore(state.serialize());
}

export function createPokerService(deps: PokerServiceDeps) {
  const resolvedStore =
    deps.store ??
    (deps.db ? createPokerStore(deps.db.query.bind(deps.db), deps.realm ?? 'default') : null);
  if (!resolvedStore) throw new Error('Poker store is required');
  const store: PokerStore = resolvedStore;

  const tables = new Map<string, PokerTableRecord>();
  const unavailableTables = new Set<string>();
  const tableByCharacter = new Map<number, string>();
  const accountByCharacter = new Map<number, number>();
  const watchedTableByCharacter = new Map<number, string>();
  const mutatingTables = new Set<string>();
  let mutationCount = 0;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let ticking = false;
  let fallbackSeed = 0x504f4b45;

  function enabled(): void {
    if (!deps.featureEnabled()) throw new Error('Poker feature is disabled');
  }

  function audit(event: Parameters<NonNullable<PokerServiceDeps['audit']>>[0]): void {
    try {
      deps.audit?.(event);
    } catch (error) {
      console.error('poker audit sink failed:', error);
    }
  }

  function recordFromRow(row: PokerTableRow): PokerTableRecord {
    const raw = row.payload as Partial<PokerPersistedPayload>;
    const wrapped = raw?.version === 1 && raw.table !== undefined;
    const tablePayload = wrapped ? raw.table : row.payload;
    if (
      tablePayload &&
      typeof tablePayload === 'object' &&
      !Array.isArray(tablePayload) &&
      typeof (tablePayload as { tableSeed?: unknown }).tableSeed === 'number'
    ) {
      throw new Error('Legacy 32-bit poker seed requires table quarantine');
    }
    const state = PokerTable.restore(tablePayload);
    const snapshot = state.snapshotFor(null);
    const funded = snapshot.seats.filter((seat) => seat && seat.stack > 0).length;
    const sitOut = decodePokerSitOut(wrapped ? raw.sitOut : undefined);
    const seatedIds = new Set(seatedEntries(state).map((entry) => entry.characterId));
    for (const characterId of sitOut.keys()) {
      if (!seatedIds.has(characterId)) sitOut.delete(characterId);
    }
    let turnDeadlineMs = wrapped
      ? Number.isSafeInteger(raw.turnDeadlineMs)
        ? (raw.turnDeadlineMs as number)
        : null
      : snapshot.street === null
        ? null
        : deps.nowMs() + POKER_TURN_TIMEOUT_MS;
    const actor = snapshot.actorSeat === null ? null : snapshot.seats[snapshot.actorSeat]?.playerId;
    if (snapshot.street !== null && actor && sitOut.has(actor)) turnDeadlineMs = deps.nowMs();
    return {
      tableId: row.tableId,
      state,
      revision: row.revision,
      watchers: new Set(),
      leaveAfterHand: new Set(
        wrapped && Array.isArray(raw.leaveAfterHand)
          ? raw.leaveAfterHand.filter(Number.isSafeInteger)
          : [],
      ),
      sitOut,
      turnDeadlineMs,
      nextHandAtMs: wrapped
        ? Number.isSafeInteger(raw.nextHandAtMs)
          ? (raw.nextHandAtMs as number)
          : null
        : snapshot.street === null && funded >= 2
          ? deps.nowMs() + POKER_NEXT_HAND_DELAY_MS
          : null,
      retryDelayMs: 1_000,
    };
  }

  function indexRecord(record: PokerTableRecord): void {
    const entries = seatedEntries(record.state);
    for (const { characterId } of entries) {
      const other = tableByCharacter.get(characterId);
      if (other && other !== record.tableId) {
        throw new Error('Character is seated at multiple poker tables');
      }
    }
    for (const { characterId } of entries) tableByCharacter.set(characterId, record.tableId);
  }

  async function initialize(): Promise<void> {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const rows = await store.list();
      for (const row of rows) {
        try {
          const record = recordFromRow(row);
          indexRecord(record);
          tables.set(record.tableId, record);
        } catch (error) {
          unavailableTables.add(row.tableId);
          await store.close(row.tableId, row.revision).catch((closeError) => {
            console.error('failed to quarantine poker table:', closeError);
          });
          console.error('quarantined unrestorable poker table:', error);
        }
      }
      if (deps.provisionDefaults !== false && deps.featureEnabled()) {
        for (const tableId of DEFAULT_POKER_TABLE_IDS) {
          if (!tables.has(tableId) && !unavailableTables.has(tableId)) {
            await createTable({ tableId, seats: 6 });
          }
        }
      }
      initialized = true;
    })();
    try {
      await initializePromise;
    } finally {
      initializePromise = null;
    }
  }

  async function ensureLoaded(tableId: string): Promise<PokerTableRecord> {
    await initialize();
    const existing = tables.get(tableId);
    if (existing) return existing;
    throw new Error('Poker table not found');
  }

  async function saveClone(
    record: PokerTableRecord,
    next: PokerTable,
    seatMutation?: PokerSeatMutation,
    metadata?: Partial<
      Pick<PokerTableRecord, 'leaveAfterHand' | 'sitOut' | 'turnDeadlineMs' | 'nextHandAtMs'>
    >,
  ): Promise<void> {
    const persistedRecord: PokerTableRecord = { ...record, ...metadata, state: next };
    const nextRow = rowFor(persistedRecord, next);
    const revision = await store.save(nextRow, record.revision, seatMutation);
    record.state = next;
    record.revision = revision;
    record.retryDelayMs = 1_000;
    if (metadata?.leaveAfterHand) record.leaveAfterHand = metadata.leaveAfterHand;
    if (metadata?.sitOut) record.sitOut = metadata.sitOut;
    if (metadata?.turnDeadlineMs !== undefined) record.turnDeadlineMs = metadata.turnDeadlineMs;
    if (metadata?.nextHandAtMs !== undefined) record.nextHandAtMs = metadata.nextHandAtMs;
  }

  function turnDeadlineFor(
    state: PokerTable,
    sitOut: PokerSitOutState,
    nowMs: number,
  ): number | null {
    const snapshot = state.snapshotFor(null);
    if (snapshot.street === null || snapshot.actorSeat === null) return null;
    const actor = snapshot.seats[snapshot.actorSeat]?.playerId;
    return actor && sitOut.has(actor) ? nowMs : nowMs + POKER_TURN_TIMEOUT_MS;
  }

  async function mutate(record: PokerTableRecord, run: () => Promise<void>): Promise<void> {
    if (mutatingTables.has(record.tableId) || mutationCount >= POKER_MAX_CONCURRENT_MUTATIONS) {
      throw new Error('Poker table is busy');
    }
    mutatingTables.add(record.tableId);
    mutationCount++;
    try {
      await run();
    } finally {
      mutatingTables.delete(record.tableId);
      mutationCount--;
    }
  }

  async function createTable(input: PokerTableCreateInput): Promise<void> {
    enabled();
    if (
      input.smallBlind !== undefined &&
      (input.smallBlind !== POKER_SMALL_BLIND || input.bigBlind !== POKER_BIG_BLIND)
    ) {
      throw new Error('Only the fixed 10/20 poker table is supported');
    }
    if (!Number.isSafeInteger(input.seats) || input.seats < 2 || input.seats > 6) {
      throw new Error('Poker tables require 2 to 6 seats');
    }
    if (tables.has(input.tableId)) throw new Error('Poker table already exists');
    const seed = deps.seed?.() ?? fallbackSeed++;
    const state = PokerTable.create(
      {
        id: input.tableId,
        numSeats: input.seats,
        smallBlind: POKER_SMALL_BLIND,
        bigBlind: POKER_BIG_BLIND,
        minBuyIn: POKER_BUY_IN,
        maxBuyIn: POKER_BUY_IN,
      },
      new Rng(seed),
      deps.secureSeed?.(),
    );
    const record: PokerTableRecord = {
      tableId: input.tableId,
      state,
      revision: 0,
      watchers: new Set(),
      leaveAfterHand: new Set(),
      sitOut: new Map(),
      turnDeadlineMs: null,
      nextHandAtMs: null,
      retryDelayMs: 1_000,
    };
    if (!(await store.create(rowFor(record)))) {
      const existing = await store.load(input.tableId);
      if (!existing) throw new Error('Poker table could not be created');
      tables.set(input.tableId, recordFromRow(existing));
      return;
    }
    tables.set(input.tableId, record);
  }

  async function startHand(tableId: string): Promise<void> {
    enabled();
    const record = await ensureLoaded(tableId);
    let completed = false;
    await mutate(record, async () => {
      const next = cloneTable(record.state);
      next.startHand();
      const nowMs = deps.nowMs();
      const snapshot = next.snapshotFor(null);
      completed = snapshot.street === null;
      const pendingLeaves = new Set(record.leaveAfterHand);
      if (completed) {
        for (const characterId of pokerSitOutLeavesAfterHand(record.sitOut, snapshot.handNumber)) {
          pendingLeaves.add(characterId);
        }
      }
      await saveClone(record, next, undefined, {
        leaveAfterHand: pendingLeaves,
        turnDeadlineMs: turnDeadlineFor(next, record.sitOut, nowMs),
        nextHandAtMs: completed ? nowMs + POKER_NEXT_HAND_DELAY_MS : null,
      });
      if (completed) await retryPendingLeaves(record, nowMs);
    });
    deps.onChanged?.(tableId, completed);
  }

  async function completePendingLeaves(record: PokerTableRecord): Promise<void> {
    if (record.state.snapshotFor(null).street !== null) return;
    let pendingLeaves = new Set(record.leaveAfterHand);
    let sitOut = new Map(record.sitOut);
    let metadataDirty = false;
    for (const characterId of [...pendingLeaves]) {
      const seat = seatedEntries(record.state).find((entry) => entry.characterId === characterId);
      pendingLeaves.delete(characterId);
      sitOut.delete(characterId);
      if (!seat) {
        metadataDirty = true;
        continue;
      }
      const next = cloneTable(record.state);
      const amount = next.standUp(characterId);
      await saveClone(
        record,
        next,
        {
          type: 'leave',
          accountId: accountByCharacter.get(characterId) ?? 0,
          characterId,
          seatIndex: seat.seatIndex,
        },
        { leaveAfterHand: new Set(pendingLeaves), sitOut: new Map(sitOut) },
      );
      metadataDirty = false;
      tableByCharacter.delete(characterId);
      accountByCharacter.delete(characterId);
      audit({ type: 'leave', tableId: record.tableId, characterId, amount });
    }
    if (metadataDirty) {
      await saveClone(record, cloneTable(record.state), undefined, {
        leaveAfterHand: pendingLeaves,
        sitOut,
      });
    }
  }

  async function retryPendingLeaves(record: PokerTableRecord, nowMs: number): Promise<boolean> {
    try {
      await completePendingLeaves(record);
      return true;
    } catch (error) {
      record.nextHandAtMs = nowMs + record.retryDelayMs;
      record.retryDelayMs = Math.min(record.retryDelayMs * 2, 30_000);
      console.error('poker pending leave cleanup failed:', error);
      return false;
    }
  }

  async function maybeStartAfterJoin(record: PokerTableRecord): Promise<void> {
    if (record.leaveAfterHand.size > 0) {
      let cleaned = false;
      await mutate(record, async () => {
        cleaned = await retryPendingLeaves(record, deps.nowMs());
      });
      deps.onChanged?.(record.tableId, false);
      if (!cleaned) return;
    }
    const snapshot = record.state.snapshotFor(null);
    const funded = snapshot.seats.filter((seat) => seat && seat.stack > 0).length;
    if (snapshot.street === null && funded >= 2) await startHand(record.tableId);
  }

  async function act(input: PokerActInput): Promise<void> {
    enabled();
    const record = await ensureLoaded(input.tableId);
    let completed = false;
    await mutate(record, async () => {
      const current = record.state.snapshotFor(input.characterId);
      if (current.handNumber !== input.handNumber) throw new Error('Poker hand number is stale');
      if (current.actionSequence !== input.actionSequence) {
        throw new Error('Poker action sequence is stale');
      }
      const seat = seatedEntries(record.state).find(
        (entry) => entry.characterId === input.characterId,
      );
      if (!seat || current.actorSeat !== seat.seatIndex) {
        throw new Error('It is not this player turn');
      }
      const next = cloneTable(record.state);
      next.act(input.characterId, input.action);
      const nextSnapshot = next.snapshotFor(null);
      completed = nextSnapshot.street === null;
      let sitOut = new Map(record.sitOut);
      if (input.automatic === 'timeout') {
        sitOut = markPokerSitOut(sitOut, input.characterId, current.handNumber);
      } else if (input.automatic === undefined) {
        sitOut = clearPokerSitOut(sitOut, input.characterId);
      }
      const pendingLeaves = new Set(record.leaveAfterHand);
      if (completed) {
        for (const characterId of pokerSitOutLeavesAfterHand(sitOut, nextSnapshot.handNumber)) {
          pendingLeaves.add(characterId);
        }
      }
      const nowMs = deps.nowMs();
      await saveClone(record, next, undefined, {
        leaveAfterHand: pendingLeaves,
        sitOut,
        turnDeadlineMs: turnDeadlineFor(next, sitOut, nowMs),
        nextHandAtMs: completed ? nowMs + POKER_NEXT_HAND_DELAY_MS : null,
      });
      if (completed) await retryPendingLeaves(record, nowMs);
    });
    deps.onChanged?.(input.tableId, completed);
    const result = record.state.snapshotFor(null).lastResult;
    audit({
      type: 'action',
      tableId: input.tableId,
      accountId: input.accountId,
      characterId: input.characterId,
      handNumber: input.handNumber,
      actionSequence: input.actionSequence,
      action: input.action.type,
      completed,
      rake: completed ? (result?.rake ?? 0) : undefined,
      payouts: completed
        ? result?.payouts.map((payout) => ({
            characterId: payout.playerId,
            amount: payout.amount,
          }))
        : undefined,
    });
  }

  return {
    initialize,
    createTable,
    startHand,

    async buyIn(input: PokerBuyInInput): Promise<void> {
      enabled();
      const record = await ensureLoaded(input.tableId);
      if (watchedTableByCharacter.has(input.characterId)) {
        throw new Error('Stop watching before joining a poker table');
      }
      if (tableByCharacter.has(input.characterId)) {
        throw new Error('Character is already seated at a poker table');
      }
      await mutate(record, async () => {
        const next = cloneTable(record.state);
        next.sitDown(input.seatIndex, input.characterId, POKER_BUY_IN);
        await saveClone(record, next, {
          type: 'join',
          accountId: input.accountId,
          characterId: input.characterId,
          seatIndex: input.seatIndex,
        });
        tableByCharacter.set(input.characterId, input.tableId);
        accountByCharacter.set(input.characterId, input.accountId);
      });
      deps.onChanged?.(input.tableId, false);
      audit({
        type: 'join',
        tableId: input.tableId,
        accountId: input.accountId,
        characterId: input.characterId,
        amount: POKER_BUY_IN,
      });
      await maybeStartAfterJoin(record);
    },

    async rebuy(input: PokerRebuyInput): Promise<void> {
      enabled();
      const record = await ensureLoaded(input.tableId);
      let rebuyAmount = 0;
      await mutate(record, async () => {
        const seat = seatedEntries(record.state).find(
          (entry) => entry.characterId === input.characterId,
        );
        if (!seat) throw new Error('Character is not seated');
        const snapshot = record.state.snapshotFor(input.characterId);
        if (snapshot.street !== null) throw new Error('Rebuy is only allowed between hands');
        const stack = snapshot.seats[seat.seatIndex]?.stack ?? POKER_BUY_IN;
        const amount = POKER_BUY_IN - stack;
        if (amount <= 0) throw new Error('Rebuy not allowed');
        const next = cloneTable(record.state);
        next.addToStack(input.characterId, amount);
        await saveClone(record, next);
        rebuyAmount = amount;
      });
      deps.onChanged?.(input.tableId, false);
      audit({
        type: 'rebuy',
        tableId: input.tableId,
        accountId: input.accountId,
        characterId: input.characterId,
        amount: rebuyAmount,
      });
    },

    async sitIn(input: { tableId: string; characterId: number }): Promise<void> {
      enabled();
      const record = await ensureLoaded(input.tableId);
      let changed = false;
      await mutate(record, async () => {
        const seated = seatedEntries(record.state).some(
          (entry) => entry.characterId === input.characterId,
        );
        if (!seated) throw new Error('Character is not seated');
        if (!record.sitOut.has(input.characterId)) return;
        const sitOut = clearPokerSitOut(record.sitOut, input.characterId);
        await saveClone(record, cloneTable(record.state), undefined, {
          sitOut,
          turnDeadlineMs: turnDeadlineFor(record.state, sitOut, deps.nowMs()),
        });
        changed = true;
      });
      if (!changed) return;
      deps.onChanged?.(input.tableId, false);
      audit({ type: 'sit_in', tableId: input.tableId, characterId: input.characterId });
    },

    async leaveTable(input: { tableId: string; characterId: number }): Promise<void> {
      const record = await ensureLoaded(input.tableId);
      if (record.state.snapshotFor(null).street !== null) {
        const seat = seatedEntries(record.state).find(
          (entry) => entry.characterId === input.characterId,
        );
        if (!seat) return;
        await mutate(record, async () => {
          const pendingLeaves = new Set(record.leaveAfterHand).add(input.characterId);
          await saveClone(record, cloneTable(record.state), undefined, {
            leaveAfterHand: pendingLeaves,
          });
        });
        audit({ type: 'leave', tableId: input.tableId, characterId: input.characterId });
        return;
      }
      await mutate(record, async () => {
        const seat = seatedEntries(record.state).find(
          (entry) => entry.characterId === input.characterId,
        );
        if (!seat) return;
        const next = cloneTable(record.state);
        const amount = next.standUp(input.characterId);
        await saveClone(
          record,
          next,
          {
            type: 'leave',
            accountId: accountByCharacter.get(input.characterId) ?? 0,
            characterId: input.characterId,
            seatIndex: seat.seatIndex,
          },
          { sitOut: clearPokerSitOut(record.sitOut, input.characterId) },
        );
        tableByCharacter.delete(input.characterId);
        accountByCharacter.delete(input.characterId);
        audit({ type: 'leave', tableId: input.tableId, characterId: input.characterId, amount });
      });
      deps.onChanged?.(input.tableId, false);
    },

    snapshot(tableId: string, viewerId: number | null): PokerWireSnapshot {
      const record = tables.get(tableId);
      if (!record) throw new Error('Poker table not found');
      const snapshot = record.state.snapshotFor(viewerId);
      return {
        ...snapshot,
        revision: record.revision,
        viewerSeat:
          viewerId === null
            ? null
            : (seatedEntries(record.state).find((entry) => entry.characterId === viewerId)
                ?.seatIndex ?? null),
        watching: viewerId !== null && record.watchers.has(viewerId),
        turnDeadlineMs: record.turnDeadlineMs,
        sitOutSeats: seatedEntries(record.state).flatMap((entry) =>
          record.sitOut.has(entry.characterId) ? [entry.seatIndex] : [],
        ),
      };
    },

    act,

    async listTables(): Promise<
      Array<{
        tableId: string;
        watcherCount: number;
        seatedCount: number;
        inHand: boolean;
        openSeats: number[];
      }>
    > {
      enabled();
      await initialize();
      return [...tables.values()].map((record) => {
        const snapshot = record.state.snapshotFor(null);
        return {
          tableId: record.tableId,
          watcherCount: record.watchers.size,
          seatedCount: snapshot.seats.filter(Boolean).length,
          inHand: snapshot.street !== null,
          openSeats: snapshot.seats.flatMap((seat, index) => (seat ? [] : [index])),
        };
      });
    },

    async watchTable(input: { tableId: string; characterId: number }): Promise<void> {
      enabled();
      const record = await ensureLoaded(input.tableId);
      if (tableByCharacter.has(input.characterId)) {
        throw new Error('Seated players cannot watch another poker table');
      }
      const other = watchedTableByCharacter.get(input.characterId);
      if (other && other !== input.tableId)
        throw new Error('Character is already watching a table');
      record.watchers.add(input.characterId);
      watchedTableByCharacter.set(input.characterId, input.tableId);
      audit({ type: 'watch', tableId: input.tableId, characterId: input.characterId });
    },

    async stopWatching(input: { tableId: string; characterId: number }): Promise<void> {
      const record = await ensureLoaded(input.tableId);
      record.watchers.delete(input.characterId);
      if (watchedTableByCharacter.get(input.characterId) === input.tableId) {
        watchedTableByCharacter.delete(input.characterId);
      }
      audit({ type: 'stop_watch', tableId: input.tableId, characterId: input.characterId });
    },

    tableForCharacter(characterId: number): string | null {
      return tableByCharacter.get(characterId) ?? watchedTableByCharacter.get(characterId) ?? null;
    },

    viewerIds(tableId: string): number[] {
      const record = tables.get(tableId);
      if (!record) return [];
      return [
        ...new Set([
          ...seatedEntries(record.state).map((entry) => entry.characterId),
          ...record.watchers,
        ]),
      ];
    },

    async releaseCharacter(characterId: number): Promise<void> {
      const watched = watchedTableByCharacter.get(characterId);
      if (watched) {
        await this.stopWatching({ tableId: watched, characterId });
        return;
      }
      const seated = tableByCharacter.get(characterId);
      if (seated) await this.leaveTable({ tableId: seated, characterId });
    },

    async tick(nowMs = deps.nowMs()): Promise<void> {
      if (ticking || !deps.featureEnabled()) return;
      ticking = true;
      try {
        await initialize();
        for (const record of tables.values()) {
          let snapshot = record.state.snapshotFor(null);
          if (snapshot.street === null && record.leaveAfterHand.size > 0) {
            if (record.nextHandAtMs !== null && nowMs < record.nextHandAtMs) continue;
            let cleaned = false;
            await mutate(record, async () => {
              cleaned = await retryPendingLeaves(record, nowMs);
            });
            if (cleaned) deps.onChanged?.(record.tableId, false);
            continue;
          }
          snapshot = record.state.snapshotFor(null);
          if (
            snapshot.street !== null &&
            record.turnDeadlineMs !== null &&
            nowMs >= record.turnDeadlineMs &&
            snapshot.actorSeat !== null
          ) {
            const actor = snapshot.seats[snapshot.actorSeat]?.playerId;
            if (!actor) continue;
            const legal = record.state.snapshotFor(actor).legalActions;
            const action: PokerAction = legal?.actions.includes('check')
              ? { type: 'check' }
              : { type: 'fold' };
            const automatic = record.sitOut.has(actor) ? 'sit_out' : 'timeout';
            await act({
              tableId: record.tableId,
              accountId: accountByCharacter.get(actor) ?? 0,
              characterId: actor,
              handNumber: snapshot.handNumber,
              actionSequence: snapshot.actionSequence,
              action,
              automatic,
            }).catch((error) => {
              record.turnDeadlineMs = nowMs + record.retryDelayMs;
              record.retryDelayMs = Math.min(record.retryDelayMs * 2, 30_000);
              console.error('poker timeout action failed:', error);
            });
          } else if (
            snapshot.street === null &&
            record.nextHandAtMs !== null &&
            nowMs >= record.nextHandAtMs &&
            snapshot.seats.filter((seat) => seat && seat.stack > 0).length >= 2
          ) {
            await startHand(record.tableId).catch((error) => {
              record.nextHandAtMs = nowMs + record.retryDelayMs;
              record.retryDelayMs = Math.min(record.retryDelayMs * 2, 30_000);
              console.error('poker next hand failed:', error);
            });
          }
        }
      } finally {
        ticking = false;
      }
    },
  };
}

export type PokerService = ReturnType<typeof createPokerService>;
