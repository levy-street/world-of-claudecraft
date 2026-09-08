// Guild Bank Phase 3, the wiring half: the boot load into a REAL Sim (empty
// book on no row, oversized skip, the parsed-object pin), the round trip, the
// dispatch observer (ledger row + dirty mark on success, neither on refusal),
// the escrow save arm of GameServer.saveCharacter (null-serialize refusal,
// fence-miss keeps the dirty mark), the guild_create fee gate, and the
// create/disband transport hooks. Drives the REAL GameServer + Sim with the db
// layer mocked (the guild_stamp_fence idiom).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterState: vi.fn(async (..._args: any[]) => true),
  // Both are given a real implementation in beforeEach (they run the REAL
  // escrow merge against a fake durable table); the loose signature here keeps
  // vi.hoisted free of imports.
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndGuildBankState: vi.fn(async (..._args: any[]) => true),
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndMarketState: vi.fn(async (..._args: any[]) => true),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async (_guildId: number): Promise<unknown | null> => null),
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
}));

const paidGuildCreateMock = vi.hoisted(() => vi.fn());

vi.mock('../server/guild_create_db', () => ({
  createPaidGuildWithLeaderAtomic: paidGuildCreateMock,
}));

// DURABLE guild membership, the source the escrow CARRIER is now chosen from
// (GameServer.guildBankSaveCarrier reads socialDb.guildMembers, not the session
// stamp, because a refused escrow quarantines and DISCONNECTS the carrier).
// Keyed by guild id; `stampMember` below seats a row and the matching stamp.
const dbGuildMembers = new Map<number, { id: number; rank: string }[]>();

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      // The one statement these tests answer for real: PgSocialDb.guildMembers.
      if (text.includes('FROM guild_members gm JOIN characters c')) {
        const guildId = Number((values ?? [])[0]);
        return { rows: dbGuildMembers.get(guildId) ?? [] };
      }
      return { rows: [] };
    }),
  },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  saveCharacterState: dbMock.saveCharacterState,
  saveCharacterAndGuildBankState: dbMock.saveCharacterAndGuildBankState,
  saveCharacterAndMarketState: dbMock.saveCharacterAndMarketState,
  insertBankLedgerRow: dbMock.insertBankLedgerRow,
  insertBankLedgerRows: dbMock.insertBankLedgerRows,
  loadGuildBankRow: dbMock.loadGuildBankRow,
  loadGuildBankRows: dbMock.loadGuildBankRows,
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // The fence-miss arm kicks the displaced session; leave() releases its lease.
  releaseCharacterLease: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
import { BankLedgerGrowthLimitExceeded } from '../server/bank_ledger_growth_budget';
import { drainLinkChanges } from '../server/discord_link_changes';
import { type ClientSession, GameServer } from '../server/game';
import { compactGuildBankOpLog } from '../server/guild_bank_op_log';
import {
  collectGuildBankDeltas,
  GuildBankEscrowRefused,
  type GuildBankSave,
  type GuildBankWriteResult,
  loadGuildBanksIntoSim,
  mergeGuildBankRow,
  nettedReplayRescueCount,
} from '../server/guild_bank_state';
import { GUILD_BOOK_FLUSH_FAN_OUT_MAX } from '../server/guild_book_holders';
import {
  type GameMetricsCounters,
  type GuildBankIncident,
  noopGameMetricsCounters,
  setGameMetricsCounters,
} from '../server/http/game_signals';
import {
  GUILD_CREATION_FEE_COPPER,
  type GuildBankOpDelta,
  type GuildBankState,
} from '../src/sim/guild_bank';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const GUILD_ID = 913;
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];

// The FAKE DURABLE guild_banks table. The escrow save's payload is a session's
// own delta log, and the row is rebuilt inside the transaction
// (server/db.ts writeGuildBankRow), so the doubles below run the REAL merge:
// asserting on the resulting ROW is the only way these tests can still see
// what a save actually persisted.
const durableBooks = new Map<number, unknown>();
const durableChars = new Map<number, { copper?: number }>();
const oversizedGuilds = new Set<number>();

/** Runs the REAL merge and, like server/db.ts, ABORTS on a refused book half:
 *  nothing is written, character row included, and the caller sees the same
 *  GuildBankEscrowRefused it would see against Postgres. */
function commitBooks(
  books: readonly GuildBankSave[] | undefined,
  results: GuildBankWriteResult[] | undefined,
): void {
  const written: GuildBankWriteResult[] = [];
  const pending: [number, unknown][] = [];
  for (const gb of books ?? []) {
    const merged = mergeGuildBankRow(durableBooks.get(gb.guildId) ?? null, gb.deltas, {
      oversized: oversizedGuilds.has(gb.guildId),
    });
    if (merged.data !== null) pending.push([gb.guildId, JSON.parse(JSON.stringify(merged.data))]);
    written.push({ guildId: gb.guildId, ...merged.result });
  }
  results?.push(...written);
  if (written.some((r) => !r.written)) throw new GuildBankEscrowRefused(written);
  for (const [guildId, data] of pending) durableBooks.set(guildId, data);
}

/** The book row a save actually wrote. */
const durableBook = (guildId = GUILD_ID) => durableBooks.get(guildId);

function fakeWs(): { sent: unknown[]; ws: unknown } {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
      close: () => {},
      terminate: () => {},
    },
  };
}

function joinServer(
  server: GameServer,
  characterId: number,
  name: string,
): { session: ClientSession; sent: unknown[] } {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, sent: fc.sent };
}

// biome-ignore lint/suspicious/noExplicitAny: the tests span private seams (dispatch, social.tx, saveCharacter internals)
const priv = (server: GameServer): any => server as any;

function moveToBanker(server: GameServer, pid: number): void {
  let banker: Entity | null = null;
  for (const e of server.sim.entities.values()) {
    if (e.kind === 'npc' && BANKERS.includes(e.templateId ?? '')) banker = e;
  }
  if (!banker) throw new Error('no banker NPC spawned in the server world');
  const p = server.sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  server.sim.rebucket(p);
}

// A fully authorized officer at a banker with a loaded (OPENED: rung 0
// bought, 24 slots) book and copper.
/** Seat a character's guild membership on BOTH sides: the session stamp the
 *  ops gate reads, and the durable row the escrow carrier is chosen from. Pass
 *  `{ durable: false }` to seat a STALE stamp (a player kicked since login). */
function stampMember(
  server: GameServer,
  session: ClientSession,
  rank: 'leader' | 'officer' | 'member',
  opts: { durable?: boolean } = {},
): void {
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank });
  if (opts.durable === false) return;
  const rows = dbGuildMembers.get(GUILD_ID) ?? [];
  rows.push({ id: session.characterId, rank });
  dbGuildMembers.set(GUILD_ID, rows);
}

function officerSetup(server: GameServer, session: ClientSession, treasury = 100_000): void {
  moveToBanker(server, session.pid);
  stampMember(server, session, 'officer');
  server.sim.loadGuildBank(GUILD_ID, { treasury, inventory: [], purchasedSlots: 24 });
  // Durable truth starts EQUAL to the live book, exactly as the boot load
  // leaves it: the live book is loaded FROM the row.
  durableBooks.set(GUILD_ID, { treasury, inventory: [], purchasedSlots: 24 });
  const meta = server.sim.players.get(session.pid);
  if (!meta) throw new Error('missing meta');
  meta.copper = 500_000;
}

const dispatch = (server: GameServer, session: ClientSession, msg: Record<string, unknown>) =>
  priv(server).dispatchMessage(session, { t: 'cmd', ...msg }, JSON.stringify(msg), 0);

/** Dispatch one op with `hidden` sessions invisible to the dispatch-time
 *  unsettled gate (server/guild_bank_settle_gate.ts): they read as quarantined
 *  for the duration, so the gate sees no holder and the op lands through the
 *  REAL coordinator (journal, log, mark) exactly as every op did before the
 *  gate. The tests that use it pin the refusal/rollback machinery UNDER the
 *  gate, which ordinary dispatch can no longer reach: a dependency the gate
 *  could not see is the shape the backstop exists for. */
function dispatchUnderGate(
  server: GameServer,
  session: ClientSession,
  msg: Record<string, unknown>,
  hidden: readonly ClientSession[],
): void {
  const was = hidden.map((s) => s.escrowQuarantined);
  for (const s of hidden) s.escrowQuarantined = true;
  try {
    dispatch(server, session, msg);
  } finally {
    hidden.forEach((s, n) => {
      s.escrowQuarantined = was[n] ?? false;
    });
  }
}

type CapturedLedgerEffects = {
  batches?: readonly { rows?: readonly Record<string, unknown>[] }[];
};

const ledgerRowsFromEffects = (effects: unknown): readonly Record<string, unknown>[] =>
  ((effects as CapturedLedgerEffects | undefined)?.batches ?? []).flatMap(
    (batch) => batch.rows ?? [],
  );

const queuedLedgerRows = (session: ClientSession): readonly Record<string, unknown>[] =>
  session.bankLedgerJournal.outbox
    .snapshot()
    .batches.flatMap((batch) => batch.rows as readonly Record<string, unknown>[]);

const guildSaveLedgerRows = (callIndex = 0): readonly Record<string, unknown>[] => {
  const call = dbMock.saveCharacterAndGuildBankState.mock.calls[callIndex] as unknown[] | undefined;
  return ledgerRowsFromEffects(call?.[7]);
};

beforeEach(() => {
  paidGuildCreateMock.mockReset();
  paidGuildCreateMock.mockImplementation(
    async (_deps: unknown, args: { fee: { batchKey: string } }) => ({
      durability: 'committed',
      guildId: GUILD_ID,
      feeBatchKey: args.fee.batchKey,
    }),
  );
  dbMock.saveCharacterState.mockClear();
  dbMock.saveCharacterAndGuildBankState.mockClear();
  dbMock.saveCharacterAndMarketState.mockClear();
  dbMock.insertBankLedgerRow.mockClear();
  dbMock.loadGuildBankRow.mockReset();
  dbMock.loadGuildBankRow.mockResolvedValue(null);
  dbMock.loadGuildBankRows.mockClear();
  durableBooks.clear();
  durableChars.clear();
  oversizedGuilds.clear();
  dbGuildMembers.clear();
  dbMock.saveCharacterState.mockImplementation(
    async (characterId: number, _level: number, state: unknown) => {
      durableChars.set(characterId, JSON.parse(JSON.stringify(state)));
      return true;
    },
  );
  dbMock.saveCharacterAndGuildBankState.mockImplementation(
    async (
      _characterId: number,
      _level: number,
      _state: unknown,
      books: readonly GuildBankSave[],
      _nonce?: string,
      results?: GuildBankWriteResult[],
    ) => {
      commitBooks(books, results);
      durableChars.set(_characterId, JSON.parse(JSON.stringify(_state)));
      return true;
    },
  );
  dbMock.saveCharacterAndMarketState.mockImplementation(
    async (
      _characterId: number,
      _level: number,
      _state: unknown,
      _market: unknown,
      _mail: unknown,
      _nonce?: string,
      books?: readonly GuildBankSave[],
      results?: GuildBankWriteResult[],
    ) => {
      commitBooks(books, results);
      return true;
    },
  );
  dbMock.loadGuildBankRows.mockResolvedValue([]);
});

describe('loadGuildBanksIntoSim (the boot load, against a REAL Sim)', () => {
  it('injects parsed rows, gives no-row guilds an empty book, and verifies has()', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const book = {
      treasury: 777,
      inventory: [{ itemId: 'wolf_fang', count: 2 }],
      purchasedSlots: 24,
    };
    const result = loadGuildBanksIntoSim(sim, [
      { guildId: 7, data: book, oversized: false },
      { guildId: 8, data: null, oversized: false }, // pre-feature guild: no row
    ]);
    expect(result).toEqual({ loaded: [7, 8], oversized: [], malformed: [], missing: [] });
    // Every loaded guild is verified live in the map (the acceptance line).
    expect(sim.guildBanks.has(7)).toBe(true);
    expect(sim.guildBanks.has(8)).toBe(true);
    // The boot load sanitizes (normalizeLoadedMaterialSlot), so the unsigned
    // legacy wolf_fang stack picks up its exact provenance on the way in.
    expect(sim.guildBanks.get(7)).toEqual({
      ...book,
      inventory: [{ itemId: 'wolf_fang', count: 2, materialSources: [{ count: 2, source: {} }] }],
    });
    expect(sim.guildBanks.get(8)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 0 });
  });

  it('SKIPS an oversized row entirely: no book, ops stay inert, nothing to overwrite it', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const result = loadGuildBanksIntoSim(sim, [{ guildId: 9, data: null, oversized: true }]);
    expect(result).toEqual({ loaded: [], oversized: [9], malformed: [], missing: [] });
    // NOT loaded as empty: an empty book would be persisted over the real row.
    expect(sim.guildBanks.has(9)).toBe(false);
    // And the null-serialize contract keeps every save skipping it.
    expect(sim.serializeGuildBank(9)).toBeNull();
  });

  it('hands loadGuildBank a PARSED object; a raw JSON string never reaches the sim', () => {
    // The layered parsed-object contract: sanitizeGuildBankState takes
    // objects only (a string yields an empty book by design, pinned in
    // tests/guild_bank.test.ts), and the HOST guard here is stricter still: a
    // string row is classified malformed and SKIPPED (skip-and-preserve),
    // because an empty book loaded in its place would be persisted over the
    // real row by the next escrow save. The DB read therefore always hands
    // parsed JSONB, and an unparsed string can never silently empty a bank.
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const book = { treasury: 555, inventory: [], purchasedSlots: 0 };
    const result = loadGuildBanksIntoSim(sim, [
      { guildId: 7, data: book, oversized: false }, // parsed JSONB: the pg contract
      { guildId: 8, data: JSON.stringify(book), oversized: false }, // a string is NOT parsed
    ]);
    expect(sim.guildBanks.get(7)?.treasury).toBe(555);
    expect(result.malformed).toEqual([8]);
    expect(sim.guildBanks.has(8)).toBe(false);
    expect(sim.serializeGuildBank(8)).toBeNull(); // every save skips it too
  });

  it('reports a guild whose id the load path refuses as missing', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const result = loadGuildBanksIntoSim(sim, [{ guildId: 0, data: null, oversized: false }]);
    expect(result.missing).toEqual([0]);
  });

  it('SKIPS a structurally-not-a-book row (corrupt under the bound): preserve, never salvage', () => {
    // sanitizeGuildBankState would salvage these into a near-empty book that
    // the next escrow save persists OVER the real row. Loads never destroy:
    // a top-level shape mismatch is skip-and-preserve like the oversized arm.
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const result = loadGuildBanksIntoSim(sim, [
      { guildId: 7, data: 'not an object', oversized: false },
      { guildId: 8, data: [1, 2, 3], oversized: false },
      { guildId: 9, data: { treasury: 5, inventory: 'nope', purchasedSlots: 0 }, oversized: false },
      // A well-shaped book still loads (per-slot salvage stays sanitize's job).
      { guildId: 10, data: { treasury: 5, inventory: [], purchasedSlots: 0 }, oversized: false },
    ]);
    expect(result.malformed).toEqual([7, 8, 9]);
    expect(result.loaded).toEqual([10]);
    expect(sim.guildBanks.has(7)).toBe(false);
    expect(sim.guildBanks.has(8)).toBe(false);
    expect(sim.guildBanks.has(9)).toBe(false);
    expect(sim.serializeGuildBank(9)).toBeNull(); // and every save skips it
  });
});

describe('GameServer.loadGuildBanks (boot retry)', () => {
  it('lazy-loads a durable guild created after this process booted', async () => {
    const server = new GameServer();
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: { treasury: 321, inventory: [], purchasedSlots: 24 },
      oversized: false,
      dataBytes: 128,
    });

    await priv(server).guildBankLazyLoader.ensureLoaded(GUILD_ID);

    expect(dbMock.loadGuildBankRow).toHaveBeenCalledWith(GUILD_ID);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
      treasury: 321,
      inventory: [],
      purchasedSlots: 24,
    });
  });

  it('bounds distinct lazy loads and memoizes failures briefly', async () => {
    const server = new GameServer();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    dbMock.loadGuildBankRow.mockImplementation(async (guildId: number) => {
      await blocked;
      return {
        guildId,
        data: { treasury: guildId, inventory: [], purchasedSlots: 0 },
        oversized: false,
        dataBytes: 64,
      };
    });

    const loads = [1, 2, 3, 4, 5].map((guildId) =>
      priv(server).guildBankLazyLoader.ensureLoaded(guildId),
    );
    expect(dbMock.loadGuildBankRow).toHaveBeenCalledTimes(4);
    release();
    await Promise.all(loads);
    expect(server.sim.guildBanks.has(5)).toBe(false);

    dbMock.loadGuildBankRow.mockReset();
    dbMock.loadGuildBankRow.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).guildBankLazyLoader.ensureLoaded(99);
    await priv(server).guildBankLazyLoader.ensureLoaded(99);
    errSpy.mockRestore();
    expect(dbMock.loadGuildBankRow).toHaveBeenCalledTimes(1);
  });

  it('retries a transient read failure and loads on a later attempt', async () => {
    const server = new GameServer();
    dbMock.loadGuildBankRows
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce([
        { guildId: 7, data: { treasury: 3, inventory: [], purchasedSlots: 0 }, oversized: false },
      ]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await server.loadGuildBanks();
    errSpy.mockRestore();
    expect(dbMock.loadGuildBankRows).toHaveBeenCalledTimes(2);
    expect(server.sim.guildBanks.get(7)?.treasury).toBe(3);
  });

  it('gives up loudly after every retry without throwing (the realm still boots)', async () => {
    const server = new GameServer();
    dbMock.loadGuildBankRows.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(server.loadGuildBanks()).resolves.toBeUndefined();
    const loud = errSpy.mock.calls.some((c) => String(c[0]).includes('GUILD BANKS UNAVAILABLE'));
    errSpy.mockRestore();
    expect(loud).toBe(true);
    expect(server.sim.guildBanks.size).toBe(0);
  });
});

describe('the round trip (serialize -> reload on a fresh Sim)', () => {
  it('a book with treasury, plain and instanced stacks, and expansions deep-equals', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Round');
    officerSetup(server, session, 60_000);
    server.sim.addItem('wolf_fang', 4);
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, session, { cmd: 'guild_bank_deposit', slot: idx, count: 4 });
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 12_345 });
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    const serialized = server.sim.serializeGuildBank(GUILD_ID);
    expect(serialized).not.toBeNull();

    // Restart shape: a fresh sim boot-loads the serialized row.
    const sim2 = new Sim({ seed: 99, playerClass: 'mage', autoEquip: false });
    loadGuildBanksIntoSim(sim2, [{ guildId: GUILD_ID, data: serialized, oversized: false }]);
    expect(sim2.guildBanks.get(GUILD_ID)).toEqual(serialized);
    expect(sim2.serializeGuildBank(GUILD_ID)).toEqual(serialized);
  });
});

describe('the dispatch observer: ledger rows + the dirty mark', () => {
  it('a successful op queues exactly one guild row and marks the book dirty', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Off');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_500 });
    expect([...session.dirtyGuildBanks.keys()]).toEqual([GUILD_ID]);
    expect(queuedLedgerRows(session)).toHaveLength(1);
    expect(queuedLedgerRows(session)[0]).toMatchObject({
      characterId: 1,
      op: 'deposit_gold',
      copperDelta: 1_500,
      purchasedSlotsAfter: 24,
      container: 'guild',
      containerId: GUILD_ID,
    });
  });

  it('opening the bank (rung 0) queues an open_bank row: purse charged, treasury untouched', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Opener');
    moveToBanker(server, session.pid);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    server.sim.loadGuildBank(GUILD_ID, { treasury: 5_000, inventory: [], purchasedSlots: 0 });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 100_000;
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    // The sim resolved rung 0: purse-paid, 24 slots granted, treasury as-was.
    expect(meta.copper).toBe(10_000);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
      treasury: 5_000,
      inventory: [],
      purchasedSlots: 24,
    });
    expect([...session.dirtyGuildBanks.keys()]).toEqual([GUILD_ID]);
    // The observer renamed the op: open_bank, never buy_slots (the audit's
    // treasury replay excludes purse-paid rows by this name).
    expect(session.unflushedGuildBankOps.get(GUILD_ID)).toEqual([
      {
        op: 'open_bank',
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        materialSources: null,
        copperDelta: -90_000,
        // ABSOLUTE, never relative: "this op moved the ladder 0 -> 24". A
        // relative "+24" replayed onto a base that already opened would grant
        // the rung twice.
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 24,
      },
    ]);
    expect(queuedLedgerRows(session)).toHaveLength(1);
    expect(queuedLedgerRows(session)[0]).toMatchObject({
      characterId: 1,
      op: 'open_bank',
      copperDelta: -90_000,
      purchasedSlotsAfter: 24,
      container: 'guild',
      containerId: GUILD_ID,
    });
    // A later expansion still records plain buy_slots from the treasury.
    meta.copper = 100_000; // refill the purse for the treasury top-up deposit
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 30_000 });
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    const ops = queuedLedgerRows(session).slice(-2);
    expect(ops.map((o) => o.op)).toEqual(['deposit_gold', 'buy_slots']);
    expect(ops[1].copperDelta).toBe(-25_000); // rung 1, treasury-paid
  });

  it('a tampered below-base count still records open_bank (the rung derivation matches the sim)', () => {
    // A live count below the opened base is NOT a valid ladder position, but
    // the sim's buy op floors it to rung 0 and charges the PURSE. The
    // observer must derive the rung the same way (guildBankRungsBought), not
    // compare against literal zero: naming this row buy_slots would count
    // purse copper in the audit's treasury replay and let a later revert
    // mint 90_000 treasury copper.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'TamperedOpen');
    moveToBanker(server, session.pid);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    server.sim.loadGuildBank(GUILD_ID, { treasury: 5_000, inventory: [], purchasedSlots: 0 });
    const book = server.sim.guildBanks.get(GUILD_ID);
    if (!book) throw new Error('missing book');
    book.purchasedSlots = 6; // hostile: below the 24-slot base (load-path floor bypassed)
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 100_000;
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    expect(meta.copper).toBe(10_000); // rung 0: purse-paid
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(5_000); // never the treasury
    expect(queuedLedgerRows(session)).toHaveLength(1);
    expect(queuedLedgerRows(session)[0]).toMatchObject({
      op: 'open_bank',
      copperDelta: -90_000,
      // purchasedSlotsBefore is NOT a ledger column (insertBankLedgerRow picks
      // its columns explicitly); it rides the in-memory delta only, asserted
      // just below.
      purchasedSlotsAfter: 30,
    });
    // The tampered live count IS the op's own before witness, so a replay
    // demands durable truth already stand at (or past) it rather than
    // granting the rung onto a base that never paid for it.
    expect(session.unflushedGuildBankOps.get(GUILD_ID)?.[0]).toMatchObject({
      op: 'open_bank',
      purchasedSlotsBefore: 6,
      purchasedSlotsAfter: 30,
    });
  });

  it('a purse-poor rung-0 open is refused: no row, nothing dirty, nothing granted', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'PoorOpener');
    moveToBanker(server, session.pid);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    server.sim.loadGuildBank(GUILD_ID, { treasury: 10_000_000, inventory: [], purchasedSlots: 0 });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 89_999; // treasury wealth must not substitute for the purse
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    expect(meta.copper).toBe(89_999);
    expect(server.sim.guildBanks.get(GUILD_ID)?.purchasedSlots).toBe(0);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    expect(session.dirtyGuildBanks.size).toBe(0);
  });

  it('a refused op (treasury short) writes NO row and marks nothing dirty', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Poor');
    officerSetup(server, session, 100);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 5_000 });
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    expect(session.dirtyGuildBanks.size).toBe(0);
  });

  it('a member-rank op is refused: no row, nothing dirty', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Member');
    officerSetup(server, session);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'member' });
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_500 });
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    expect(session.dirtyGuildBanks.size).toBe(0);
  });
});

describe('the escrow save arm (GameServer.saveCharacter)', () => {
  it('a dirty book rides the acting character save and the mark clears on success', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Saver');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    await priv(server).saveCharacter(session);
    expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalledTimes(1);
    const [charId, , , books] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as never[];
    expect(charId).toBe(1);
    // The PAYLOAD is this session's own deltas, never the shared live book...
    expect(books).toEqual([
      {
        guildId: GUILD_ID,
        deltas: [
          {
            op: 'deposit_gold',
            itemId: null,
            count: null,
            instance: null,
            craftedRecipeId: null,
            materialSources: null,
            copperDelta: 2_000,
            purchasedSlotsBefore: 24,
            purchasedSlotsAfter: 24,
          },
        ],
      },
    ]);
    // ...and the ROW is durable truth with that delta replayed onto it.
    expect(durableBook()).toEqual({ treasury: 102_000, inventory: [], purchasedSlots: 24 });
    // The plain single-statement save was NOT used (the book needs the txn)...
    expect(dbMock.saveCharacterState).not.toHaveBeenCalled();
    // ...and the dirty mark released.
    expect(session.dirtyGuildBanks.size).toBe(0);
    // A clean follow-up save goes back to the plain path.
    await priv(server).saveCharacter(session);
    expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1);
    expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalledTimes(1);
  });

  it('a dirty book that vanishes before save refuses the whole atomic escrow', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Skipper');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    // The book vanishes before the save flushes (the evict-then-reload shape).
    // Persisting the reduced purse and its ledger evidence without the book
    // would split one accepted mutation across two durability boundaries.
    server.sim.evictGuildBank(GUILD_ID);
    await expect(priv(server).saveCharacter(session)).resolves.toBe(false);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(dbMock.saveCharacterState).not.toHaveBeenCalled();
    expect(durableChars.has(session.characterId)).toBe(false);
    expect(session.escrowQuarantined).toBe(true);
    expect(session.dirtyGuildBanks.size).toBe(0);
    expect(session.unflushedGuildBankOps.size).toBe(0);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'escrow_deficit', containerId: GUILD_ID }),
    );
    await vi.waitFor(() => expect(session.left).toBe(true));
  });

  it("a fence-miss undoes ONLY this session's own ops on the live book", async () => {
    // The displaced session's op mutated the live book, but its character
    // half rolled back: without the undo the sim stays AHEAD of what this
    // session can ever persist. The undo is SYNCHRONOUS and unconditional
    // (no cross-session scan, no evict, no reload): under the escrow root fix
    // a session's ops exist in no other session's payload, so durable truth
    // can never have been advanced by them.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Fenced');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(102_000); // live, ahead
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(session);
    // Live state returned to durable truth; the doomed session's mark cleared.
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
      treasury: 100_000,
      inventory: [],
      purchasedSlots: 24,
    });
    expect(durableBook()).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
    expect(session.unflushedGuildBankOps.has(GUILD_ID)).toBe(false);
    await vi.waitFor(() => expect(session.left).toBe(true));
    expect(session.escrowQuarantined).toBe(true);
    // Teardown must not retry the now-reverted guild-ledger prefix through a
    // final market save after the lease is already known to be gone.
    expect(dbMock.saveCharacterAndMarketState).not.toHaveBeenCalled();
  });

  it('a fence-miss while ANOTHER session is dirty REVERTS only the fenced ops (no dupe)', async () => {
    // The Phase 3 QA BLOCKING regression: officer B (an alt) holds a dirty
    // mark; officer A deposits gold and an item, then A's escrow fences out
    // (character half guaranteed rolled back, so A's durable bags/purse keep
    // the deposited value). Without a revert, A's orphaned book mutations
    // would ride B's next save: a deterministic, attacker-timable dupe. The
    // fix surgically reverts A's unflushed ops from the live book, leaving
    // B's legitimate unflushed op intact; no evict, no reload.
    const server = new GameServer();
    const a = joinServer(server, 1, 'FencedA').session;
    const b = joinServer(server, 2, 'DirtyB').session;
    officerSetup(server, a);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 50_000;
    // B first: the alt parks a dirty mark on the shared book.
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    // A's doomed ops: gold AND an item.
    server.sim.addItem('wolf_fang', 4);
    const aMeta = server.sim.players.get(a.pid);
    if (!aMeta) throw new Error('missing meta');
    const idx = aMeta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: idx, count: 4 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(103_000);
    a.leaseNonce = 'stale-nonce';
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(a);
    const book = server.sim.guildBanks.get(GUILD_ID);
    // ...but A's orphaned mutations are GONE from the live book: the item is
    // no longer in the book (it stays in A's durable bags), and only B's
    // deposit survives on the treasury.
    expect(book?.treasury).toBe(101_000);
    expect(book?.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);
    // A's marks and log are consumed; B's stay for B's own escrow save, so
    // B's next save persists a book WITHOUT A's orphaned ops (no dupe).
    expect(a.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
    expect(a.unflushedGuildBankOps.has(GUILD_ID)).toBe(false);
    expect(b.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    await priv(server).saveCharacter(b);
    const call = dbMock.saveCharacterAndGuildBankState.mock.calls.at(-1) as never[];
    const [savedCharId] = call;
    expect(savedCharId).toBe(2);
    // B's commit carries B's 1_000 and NOTHING of A's: A's fenced ops reach
    // durable state through no path at all.
    expect(durableBook()).toEqual({ treasury: 101_000, inventory: [], purchasedSlots: 24 });
  });

  it('an oversized/malformed durable row is PRESERVED, and the save is REFUSED with it', async () => {
    // The boot skip rule, carried into the write path: an oversized or
    // structurally-not-a-book row is never overwritten. Retrying cannot help,
    // so the save is refused exactly like a deficit rather than committing a
    // character half whose book half was silently dropped: whatever the reason
    // the book half cannot be written, the character half must not commit
    // without it.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'BadRow');
    officerSetup(server, session);
    oversizedGuilds.add(GUILD_ID);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    expect(durableBook()).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
    expect(durableChars.has(1)).toBe(false); // the character half never landed
    expect(session.escrowQuarantined).toBe(true);
    // The session's own op came back off the live book with it.
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_000);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
    expect(session.unflushedGuildBankOps.has(GUILD_ID)).toBe(false);
    // And it can never persist again: its live state was abandoned.
    await priv(server).saveCharacter(session);
    expect(durableChars.has(1)).toBe(false);
  });

  it('an op landing mid-save keeps the book scheduled (the seq guard)', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Racer');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    // While the save transaction is in flight, another op dirties the book.
    dbMock.saveCharacterAndGuildBankState.mockImplementationOnce(async () => {
      dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 500 });
      return true;
    });
    await priv(server).saveCharacter(session);
    // The mid-save mark survives the release, so the next save carries it.
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  });

  it('a leave-path save (withMarket) carries the books through the market sibling', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Leaver');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    await priv(server).saveCharacter(session, { withMarket: true });
    expect(dbMock.saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
    const call = dbMock.saveCharacterAndMarketState.mock.calls[0] as never[];
    expect((call[6] as { guildId: number }[]).map((b) => b.guildId)).toEqual([GUILD_ID]);
    expect(durableBook()).toEqual({ treasury: 102_000, inventory: [], purchasedSlots: 24 });
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
  });
});

describe('escrow snapshot consistency across the serial-writer wait', () => {
  it('an op dispatched DURING the queue wait lands in both halves or neither, never one', async () => {
    // The database-review BLOCKING: the character blob used to be serialized
    // BEFORE the serial-writer wait while the book was serialized inside the
    // queued thunk, so a deposit dispatched during the wait persisted the
    // item in the bags snapshot (T0) AND the book snapshot (T1): a dupe on
    // crash. Both halves are now captured in one synchronous step inside the
    // thunk.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'MidWait');
    officerSetup(server, session);
    server.sim.addItem('wolf_fang', 1);
    // Pre-dirty the book so the save routes through the queued escrow path.
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    // Occupy the shared serial writer so the save has a real queue wait.
    let releaseWriter: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    void priv(server).enqueueMarketWrite(() => blocker);
    const savePromise = priv(server).saveCharacter(session);
    // While the save waits on the queue, the officer deposits the item.
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, session, { cmd: 'guild_bank_deposit', slot: idx });
    releaseWriter?.();
    await savePromise;
    const [, , state] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as unknown as [
      number,
      number,
      { inventory: { itemId: string }[] },
    ];
    const inBags = state.inventory.some((s) => s.itemId === 'wolf_fang');
    const inBook =
      (durableBook() as { inventory: { itemId: string }[] }).inventory.some(
        (s) => s.itemId === 'wolf_fang',
      ) ?? false;
    // One copy total across the committed transaction: in the book, not the bags.
    expect(inBook).toBe(true);
    expect(inBags).toBe(false);
    // The mid-wait op was fully captured, so its mark and log are consumed.
    expect(session.dirtyGuildBanks.size).toBe(0);
    expect(session.unflushedGuildBankOps.size).toBe(0);
  });

  it('a silent level move DURING the queue wait still feeds the linked-member change queue', async () => {
    // Release-merge mirror (v0.34.0 lastPersistedLevel): the level feed is
    // delta-gated on the SERIALIZED level, and on this branch the escrow arm
    // persists the re-serialized snapshot (snap.level), not the T0 blob. A
    // gate that read the T0 level would miss a silent mid-wait
    // setPlayerLevel (dev_level / GM join / PBE boost) for this save, and
    // forever when this save was the leave flush (the next join re-seeds
    // lastPersistedLevel from the newer blob).
    drainLinkChanges();
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'MidLevel');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    let releaseWriter: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    void priv(server).enqueueMarketWrite(() => blocker);
    const savePromise = priv(server).saveCharacter(session);
    // While the save waits on the queue, a silent level set lands.
    server.sim.setPlayerLevel(7, session.pid);
    releaseWriter?.();
    await savePromise;
    // The escrow row carried the NEW level...
    const [, savedLevel] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as unknown as [
      number,
      number,
    ];
    expect(savedLevel).toBe(7);
    // ...and the feed gate tracked the PERSISTED level and fired exactly once.
    expect(session.lastPersistedLevel).toBe(7);
    expect(drainLinkChanges()).toEqual([{ accountId: session.accountId, kinds: ['flex'] }]);
  });
});

describe('the guild bank op guard (the keep-forever ledger write meter)', () => {
  const dispatchAt = (
    server: GameServer,
    session: ClientSession,
    msg: Record<string, unknown>,
    receivedAtMs: number,
  ) =>
    priv(server).dispatchMessage(session, { t: 'cmd', ...msg }, JSON.stringify(msg), receivedAtMs);

  it('caps a ledger-write flood at the bucket and refills over time', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Flooder');
    officerSetup(server, session);
    const t0 = Date.now();
    // The burst allows 10 ops; the 11th (same instant) is dropped before the
    // sim runs, so it writes no ledger row and moves no copper.
    for (let i = 0; i < 11; i++) {
      dispatchAt(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1 }, t0);
    }
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_010);
    expect(queuedLedgerRows(session)).toHaveLength(10);
    // Two tokens per second of refill: five seconds later the next op runs.
    // Re-stamp explicitly so this assertion does not depend on the async
    // join-time social snapshot's scheduling against the mocked social DB.
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    dispatchAt(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1 }, t0 + 5_000);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_011);
  });
});

describe('the exact unflushed-op journal (bounded memory under a failing DB)', () => {
  it('keeps more than 500 commands exact and clears only their committed prefix', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'Overflow').session;
    officerSetup(server, a);
    const commandCount = 501;
    const t0 = Date.now();
    for (let i = 0; i < commandCount; i++) {
      priv(server).dispatchMessage(
        a,
        { t: 'cmd', cmd: 'guild_bank_deposit_gold', amount: 1 },
        '{"cmd":"guild_bank_deposit_gold","amount":1}',
        t0 + i * 500,
      );
    }

    const log = a.unflushedGuildBankOps.get(GUILD_ID) ?? [];
    expect(log).toHaveLength(commandCount);
    expect(log.every((delta) => delta.op === 'deposit_gold' && delta.copperDelta === 1)).toBe(true);
    const snapshot = a.bankLedgerJournal.outbox.snapshot();
    expect(snapshot.batches).toHaveLength(commandCount);
    expect(snapshot.rowCount).toBe(commandCount);
    expect(queuedLedgerRows(a).map((row) => row.copperDelta)).toEqual(
      Array.from({ length: commandCount }, () => 1),
    );

    await expect(priv(server).saveCharacter(a)).resolves.toBe(true);
    expect(a.unflushedGuildBankOps.get(GUILD_ID) ?? []).toEqual([]);
    expect(a.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    expect(durableBook()).toEqual({
      treasury: 100_000 + commandCount,
      inventory: [],
      purchasedSlots: 24,
    });
  });

  it('compaction keeps ladder steps verbatim and in place (they are order sensitive)', () => {
    const gold = (copperDelta: number): GuildBankOpDelta => ({
      op: copperDelta > 0 ? 'deposit_gold' : 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const expansion: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -25_000,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    const compacted = compactGuildBankOpLog([gold(10), gold(-4), expansion, gold(7), gold(1)]);
    expect(compacted).toEqual([gold(6), expansion, gold(8)]);
  });

  it('compaction nets an admin_purge as a removal, never as an unrecognised passthrough', () => {
    // The operator purge is a removal everywhere else in the machinery, so it
    // must net here too: falling into the "shape I do not understand"
    // passthrough would move it to the END of its segment, which reorders it
    // against the deposits it was meant to cancel.
    const item = (op: 'deposit' | 'withdraw' | 'admin_purge', count: number): GuildBankOpDelta => ({
      op,
      itemId: 'wolf_fang',
      count,
      instance: null,
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    // deposit 3, purge 2, withdraw 1 nets to nothing at all.
    expect(
      compactGuildBankOpLog([item('deposit', 3), item('admin_purge', 2), item('withdraw', 1)]),
    ).toEqual([]);
    // A purge with nothing to cancel it survives, as one net removal.
    expect(compactGuildBankOpLog([item('admin_purge', 2), item('admin_purge', 1)])).toEqual([
      item('withdraw', 3),
    ]);
  });

  it("a fence-miss after compaction still undoes exactly this session's own work", () => {
    // The other half of the retired pin: with the log preserved rather than
    // dropped, the fence-out undo stays SURGICAL even past the cap, so a
    // second officer's unflushed deposit survives instead of being
    // vaporized by a reload (which is what the old pin asserted as correct).
    const server = new GameServer();
    const a = joinServer(server, 1, 'Overflow').session;
    const b = joinServer(server, 2, 'OtherDirty').session;
    officerSetup(server, a);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 50_000;
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    a.unflushedGuildBankOps.set(
      GUILD_ID,
      Array.from({ length: 500 }, () => ({
        op: 'deposit_gold' as const,
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      })),
    );
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_500);
    // biome-ignore lint/suspicious/noExplicitAny: driving the private undo directly
    (server as any).revertOwnGuildBookOps(a, [GUILD_ID]);
    // A's 500 is gone; B's un-flushed 1_000 SURVIVES (the old pin asserted
    // the opposite, and tests/audit_conc_guild_bank.test.ts is that same
    // vaporization written as a failure).
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_000);
  });
});

describe('the capture/commit skew that the shared-book payload used to allow', () => {
  it("a fenced session's undo landing inside another save's window mints nothing", async () => {
    // The regression this whole change exists for, and the one that used to be
    // unfixable by any reconcile. Two officers share one book. B's escrow save
    // fences out; B's undo runs in B's continuation, which resumes as soon as
    // B's thunk settles, i.e. STRICTLY INSIDE A's in-flight write window. When
    // A's payload was the shared live book, A committed the PRE-undo snapshot
    // and B's rolled-back op became durable anyway: minted copper, no crash
    // required, and nothing left holding a dirty mark to converge it.
    //
    // Under the escrow root fix A's payload is A's OWN deltas, so where B's
    // undo lands in the timeline cannot matter at all.
    const server = new GameServer();
    const a = joinServer(server, 1, 'LiveA').session;
    const b = joinServer(server, 2, 'FencedB').session;
    officerSetup(server, a);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 500_000;
    await priv(server).saveCharacter(a);
    await priv(server).saveCharacter(b);
    server.sim.setPlayerGuildMembership(a.pid, { guildId: GUILD_ID, rank: 'officer' });
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const startCopper = (durableChars.get(1)?.copper ?? 0) + (durableChars.get(2)?.copper ?? 0);
    expect(startCopper).toBe(1_000_000);

    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_500);

    // A's write is in flight; B's fence-out undo runs inside that window.
    const real = dbMock.saveCharacterAndGuildBankState.getMockImplementation();
    if (!real) throw new Error('missing impl');
    dbMock.saveCharacterAndGuildBankState.mockImplementationOnce(
      // biome-ignore lint/suspicious/noExplicitAny: forwarding the double's own args
      async (...args: any[]) => {
        // biome-ignore lint/suspicious/noExplicitAny: driving the private undo directly
        (server as any).revertOwnGuildBookOps(b, [GUILD_ID]);
        return real(...args);
      },
    );
    await priv(server).saveCharacter(a);

    // The live book lost B's 1_000 (B can never persist it) and kept A's 500.
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_500);
    // And the DURABLE row agrees, because A only ever persisted A's own delta:
    // B's op is in nobody's payload. Live and durable converge with no crash
    // window and nothing left to reconcile.
    expect(durableBook()).toEqual({ treasury: 100_500, inventory: [], purchasedSlots: 24 });
    const endCopper = (durableChars.get(1)?.copper ?? 0) + (durableChars.get(2)?.copper ?? 0);
    // A's 500 left A's durable purse; B's 1_000 never left B's.
    expect(endCopper).toBe(startCopper - 500);
    expect(endCopper + (durableBook() as { treasury: number }).treasury).toBe(
      startCopper + 100_000,
    );
  });
});

describe('collectGuildBankDeltas (the null-serialize skip, unit)', () => {
  const delta = (copperDelta: number): GuildBankOpDelta => ({
    op: 'deposit_gold',
    itemId: null,
    count: null,
    instance: null,
    craftedRecipeId: null,
    copperDelta,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  });

  it("skips guilds whose live book is absent and carries the session's OWN deltas", () => {
    const books = new Map<number, GuildBankState>([
      [7, { treasury: 5, inventory: [], purchasedSlots: 0 }],
    ]);
    const logs = new Map<number, GuildBankOpDelta[]>([
      [7, [delta(5)]],
      [8, [delta(9)]],
    ]);
    expect(
      collectGuildBankDeltas(
        (gid) => books.get(gid) ?? null,
        (gid) => logs.get(gid) ?? [],
        [7, 8],
      ),
    ).toEqual([{ guildId: 7, deltas: [delta(5)] }]);
  });

  it('emits saves in ascending guild-id order (the global row-lock order)', () => {
    // Two escrow transactions carrying overlapping book sets must lock
    // guild_banks rows in one global order or they can deadlock.
    const book = { treasury: 1, inventory: [], purchasedSlots: 0 };
    const saves = collectGuildBankDeltas(
      () => book,
      () => [],
      [9, 3, 7],
    );
    expect(saves.map((s2) => s2.guildId)).toEqual([3, 7, 9]);
  });
});

describe('mergeGuildBankRow (the escrow merge, unit)', () => {
  it('applies onto the EMPTY book when the guild has no row yet', () => {
    const merged = mergeGuildBankRow(null, [
      {
        op: 'deposit_gold',
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 400,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(merged.data).toEqual({ treasury: 400, inventory: [], purchasedSlots: 0 });
    expect(merged.result).toEqual({ written: true, deficit: null, rowUnusable: false });
  });

  it('PRESERVES an oversized or structurally-not-a-book row instead of overwriting it', () => {
    for (const [raw, opts] of [
      [null, { oversized: true }],
      [{ inventory: 'nope' }, {}],
      [[1, 2, 3], {}],
    ] as [unknown, { oversized?: boolean }][]) {
      const merged = mergeGuildBankRow(raw, [], opts);
      expect(merged.data).toBeNull();
      expect(merged.result.rowUnusable).toBe(true);
      expect(merged.result.deficit).toBeNull();
    }
  });

  it('measures the merged blob in UTF-8 BYTES, the unit both SQL gates use', () => {
    // REGRESSION (the write/read unit mismatch): the SQL gates bound
    // octet_length(data::text), i.e. BYTES, while this gate used to measure
    // JS string LENGTH (UTF-16 code units). A book padded with multi-byte
    // text therefore passed the write gate and landed durable at a size the
    // BOOT READ then skips as oversized, quarantining that guild's book for
    // good: the exact failure this bound exists to prevent.
    //
    // The padding rides itemId, which is deliberately UNCAPPED by the load
    // path (an unknown-but-string id is dormant recoverable data: items are
    // never destroyed), so it is what a tampered row can actually carry
    // through to a write. One 3-byte character per code unit, sized to sit
    // UNDER the bound by string length and OVER it by bytes; the assertions
    // below fix both measurements so a future edit cannot make this vacuous.
    const padding = '一'.repeat(100_000); // 100k units, 300k UTF-8 bytes
    const book = {
      treasury: 0,
      inventory: [{ itemId: padding, count: 1 }],
      purchasedSlots: 24,
    };
    const serialized = JSON.stringify(book);
    expect(serialized.length).toBeLessThan(262_144); // would have PASSED the old gate
    expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(262_144); // SQL sees this
    const merged = mergeGuildBankRow(book, []);
    expect(merged.data).toBeNull();
    expect(merged.result.rowUnusable).toBe(true);

    // Control: the same book with ASCII padding of the same BYTE size is
    // refused too, and an ordinary book still writes. Without these the test
    // could pass on a gate that refuses everything.
    const ascii = { ...book, inventory: [{ itemId: 'a'.repeat(300_000), count: 1 }] };
    expect(mergeGuildBankRow(ascii, []).result.rowUnusable).toBe(true);
    const ordinary = {
      treasury: 5,
      inventory: [{ itemId: 'wolf_fang', count: 1 }],
      purchasedSlots: 24,
    };
    expect(mergeGuildBankRow(ordinary, []).result.rowUnusable).toBe(false);
  });

  it('reports a DEFICIT (and writes nothing) when durable truth cannot satisfy the replay', () => {
    const withdraw = {
      op: 'withdraw_gold' as const,
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -250,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    };
    const merged = mergeGuildBankRow({ treasury: 0, inventory: [], purchasedSlots: 24 }, [
      withdraw,
    ]);
    expect(merged.data).toBeNull();
    expect(merged.result.written).toBe(false);
    expect(merged.result.deficit).toEqual({
      kind: 'treasury_underflow',
      op: 'withdraw_gold',
      itemId: null,
      shortfall: 250,
      copperDelta: -250,
    });
  });

  it('a PARTIAL shortfall is refused too: no half-write, ever', () => {
    // Writing the covered part while the paired CHARACTER half commits mints
    // exactly the difference, which is why the whole transaction rolls back
    // and retries instead.
    const withdraw = {
      op: 'withdraw_gold' as const,
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -1_000,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    };
    const merged = mergeGuildBankRow({ treasury: 400, inventory: [], purchasedSlots: 24 }, [
      withdraw,
    ]);
    expect(merged.data).toBeNull();
    expect(merged.result.written).toBe(false);
    expect(merged.result.deficit?.shortfall).toBe(600);
    expect(merged.result.deficit?.copperDelta).toBe(-1_000);
  });

  it('retries a stalled ordered replay with the log NETTED, and takes it when it lands', () => {
    // A stall can be an artifact of CROSS-SESSION ordering rather than a real
    // shortfall: this officer withdrew while the live book still held another
    // officer's copper, and the durable replay put that officer's whole log
    // first. Netting removes the intermediate dip without changing the outcome.
    const gold = (copperDelta: number) => ({
      op: copperDelta > 0 ? ('deposit_gold' as const) : ('withdraw_gold' as const),
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const merged = mergeGuildBankRow({ treasury: 100, inventory: [], purchasedSlots: 24 }, [
      gold(-500), // alone, this underflows the durable base...
      gold(900), // ...but the log as a whole leaves the treasury at 500.
    ]);
    expect(merged.data).toEqual({ treasury: 500, inventory: [], purchasedSlots: 24 });
    expect(merged.result).toEqual({ written: true, deficit: null, rowUnusable: false });
  });
});

describe('the guild_create fee gate + the create/disband hooks', () => {
  it('refuses a poor founder BEFORE any DB work, with the pinned localized line', () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Pauper');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = GUILD_CREATION_FEE_COPPER - 1;
    const createSpy = vi.fn(async () => {});
    priv(server).social.guildCreate = createSpy;
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    expect(createSpy).not.toHaveBeenCalled(); // nothing created, nothing charged
    expect(meta.copper).toBe(GUILD_CREATION_FEE_COPPER - 1);
    const events = sent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]);
    expect(events).toContainEqual({
      type: 'error',
      // Byte-identical to the server_i18n sample pin.
      text: 'You need 1 gold to found a guild.',
    });
  });

  it('a zero/zero charge anomaly refuses inside the save FIFO without DB work', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'ShortCharge');
    session.leaseNonce = 'lease:short-charge';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    vi.spyOn(server.sim, 'chargeGuildCreationFeeFor').mockReturnValueOnce(0);
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    expect(paidGuildCreateMock).not.toHaveBeenCalled();
    expect(meta.copper).toBe(150_000);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    const events = sent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]);
    expect(events).toContainEqual({
      type: 'error',
      text: 'You need 1 gold to found a guild.',
    });
  });

  it('refunds an exactly measured nonzero short charge and creates nothing', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'ShortCharge');
    session.leaseNonce = 'lease:short-charge-refund';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    vi.spyOn(server.sim, 'chargeGuildCreationFeeFor').mockImplementationOnce(() => {
      meta.copper -= 5_000;
      return 5_000;
    });

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    expect(paidGuildCreateMock).not.toHaveBeenCalled();
    expect(meta.copper).toBe(150_000);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
    const events = sent.flatMap((message) => {
      return ((message as { list?: unknown[] }).list ?? []) as never[];
    });
    expect(events).toContainEqual({ type: 'error', text: 'You need 1 gold to found a guild.' });
  });

  it('quarantines an unprovable charge mismatch without refunding or writing', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Mismatch');
    session.leaseNonce = 'lease:charge-mismatch';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    vi.spyOn(server.sim, 'chargeGuildCreationFeeFor').mockImplementationOnce(() => {
      meta.copper -= 5_000;
      return GUILD_CREATION_FEE_COPPER;
    });
    const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;
    errorSpy.mockRestore();

    expect(paidGuildCreateMock).not.toHaveBeenCalled();
    expect(meta.copper).toBe(145_000);
    expect(session.escrowQuarantined).toBe(true);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(1);
    expect(await server.saveCharacter(session)).toBe(false);
    expect(dbMock.saveCharacterState).not.toHaveBeenCalled();
    expect(kickSpy).toHaveBeenCalled();
  });

  it.each(['dirty_book', 'queued_guild_ledger'] as const)(
    'refuses paid creation before charging when %s effects need an escrow save',
    async (blocker) => {
      const server = new GameServer();
      const { session, sent } = joinServer(server, 1, 'EscrowFirst');
      session.leaseNonce = `lease:${blocker}`;
      const meta = server.sim.players.get(session.pid);
      if (!meta) throw new Error('missing meta');
      meta.copper = 150_000;
      if (blocker === 'dirty_book') {
        session.dirtyGuildBanks.set(GUILD_ID, 1);
      } else {
        const queued = session.bankLedgerJournal.admission.tryReserve(1, 1, 'guild');
        if (!queued) throw new Error('missing guild ledger reservation');
        expect(
          queued.commit(
            [
              {
                realm: session.bankLedgerJournal.outbox.owner.realm,
                characterId: session.characterId,
                accountId: session.accountId,
                op: 'deposit_gold',
                itemId: null,
                count: null,
                instance: null,
                copperDelta: 1,
                purchasedSlotsAfter: 0,
                container: 'guild',
                containerId: GUILD_ID,
              },
            ],
            {
              guildId: GUILD_ID,
              deltas: [
                {
                  op: 'deposit_gold',
                  itemId: null,
                  count: null,
                  instance: null,
                  craftedRecipeId: null,
                  copperDelta: 1,
                  purchasedSlotsBefore: 0,
                  purchasedSlotsAfter: 0,
                },
              ],
            },
          ),
        ).toBe(true);
      }
      const chargeSpy = vi.spyOn(server.sim, 'chargeGuildCreationFeeFor');

      dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
      await session.guildCreateSettlement;

      expect(chargeSpy).not.toHaveBeenCalled();
      expect(paidGuildCreateMock).not.toHaveBeenCalled();
      expect(meta.copper).toBe(150_000);
      expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
      expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
      const events = sent.flatMap((message) => {
        return ((message as { list?: unknown[] }).list ?? []) as never[];
      });
      expect(events).toContainEqual({
        type: 'error',
        text: 'You are busy. Try again in a moment.',
      });
    },
  );

  it('lets a founder at exactly the fee through to the create', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Exact');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = GUILD_CREATION_FEE_COPPER;
    const createSpy = vi.fn(async () => {});
    priv(server).social.guildCreate = createSpy;
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('orders an older save before one atomic post-charge guild snapshot', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Founder');
    session.leaseNonce = 'lease:atomic-success';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;

    // Both enqueue in one turn. The older save must serialize before the fee
    // mutation; charging synchronously at dispatch would make that queued save
    // carry the fee ahead of the guild transaction.
    const olderSave = server.saveCharacter(session);
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    expect(meta.copper).toBe(150_000);

    await olderSave;
    await session.guildCreateSettlement;
    const oldState = dbMock.saveCharacterState.mock.calls[0]?.[2] as { copper?: number };
    const atomicArgs = paidGuildCreateMock.mock.calls[0]?.[1] as {
      state: { copper?: number };
      fee: { batchKey: string; chargedCopper: number; purseCopperDelta: number };
    };
    expect(oldState.copper).toBe(150_000);
    expect(atomicArgs.state.copper).toBe(140_000);
    expect(atomicArgs.fee).toMatchObject({
      chargedCopper: GUILD_CREATION_FEE_COPPER,
      purseCopperDelta: -GUILD_CREATION_FEE_COPPER,
    });
    expect(atomicArgs.fee.batchKey).toMatch(/^ledger:/);
    expect(paidGuildCreateMock).toHaveBeenCalledTimes(1);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(queuedLedgerRows(session).filter((row) => row.op === 'create_fee')).toEqual([]);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
      treasury: 0,
      inventory: [],
      purchasedSlots: 0,
    });
    expect(meta.copper).toBe(140_000);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
  });

  it('commits one founder credit that survives restart without double-crediting live state', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'DurableFounder');
    session.leaseNonce = 'lease:durable-founder';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    const durableStates: CharacterState[] = [];
    paidGuildCreateMock.mockImplementationOnce(
      async (_deps: unknown, args: { state: CharacterState; fee: { batchKey: string } }) => {
        durableStates.push(JSON.parse(JSON.stringify(args.state)) as CharacterState);
        return {
          durability: 'committed',
          guildId: GUILD_ID,
          feeBatchKey: args.fee.batchKey,
        };
      },
    );

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    expect(meta.deedStats.counters.guildsFounded).toBe(1);
    const durableState = durableStates[0];
    expect(durableState?.deedStats?.counters?.guildsFounded).toBe(1);
    if (!durableState) throw new Error('paid creator did not commit a character state');
    const restarted = new Sim({ seed: 9913, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restarted.addPlayer('warrior', 'DurableFounder', {
      state: durableState,
    });
    expect(restarted.meta(restoredPid)?.deedStats.counters.guildsFounded).toBe(1);
  });

  it('refunds the exact origin and creates nothing when the atomic save loses its lease', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Founder');
    session.leaseNonce = 'lease:fenced';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    paidGuildCreateMock.mockResolvedValueOnce({
      durability: 'not_committed',
      reason: 'lease_lost',
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;
    errSpy.mockRestore();

    expect(meta.copper).toBe(150_000);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(queuedLedgerRows(session).filter((row) => row.op === 'create_fee')).toEqual([]);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
  });

  it('refunds a proved rollback exactly once for name and database refusals', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Refused');
    session.leaseNonce = 'lease:refused';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    const chargeSpy = vi.spyOn(server.sim, 'chargeGuildCreationFeeFor');
    for (const result of [
      { durability: 'not_committed', reason: 'name_taken' } as const,
      {
        durability: 'not_committed',
        reason: 'database_error',
        error: new Error('db down'),
      } as const,
    ]) {
      meta.copper = 150_000;
      paidGuildCreateMock.mockResolvedValueOnce(result);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
      await session.guildCreateSettlement;
      errSpy.mockRestore();

      expect(meta.copper).toBe(150_000);
      expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
      expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
      expect(queuedLedgerRows(session).filter((row) => row.op === 'create_fee')).toEqual([]);
    }
    expect(chargeSpy).toHaveBeenCalledTimes(2);
  });

  it('refunds then quarantines a paid create refused by the durable ledger ceiling', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'GrowthRefused');
    session.leaseNonce = 'lease:growth-refused';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    const refusal = new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000);
    paidGuildCreateMock.mockResolvedValueOnce({
      durability: 'not_committed',
      reason: 'database_error',
      error: refusal,
    });
    let growthRefusals = 0;
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      bankLedgerGrowthLimitRefused() {
        growthRefusals++;
      },
    });
    const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
      await session.guildCreateSettlement;

      expect(meta.copper).toBe(150_000);
      expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
      expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
      expect(session.escrowQuarantined).toBe(true);
      expect(growthRefusals).toBe(1);
      expect(kickSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      setGameMetricsCounters(noopGameMetricsCounters);
    }
  });

  it('re-checks funds after a queued spend and never founds a discounted guild', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Piper');
    session.leaseNonce = 'lease:pipeline';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = GUILD_CREATION_FEE_COPPER;
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const olderWrite = server.enqueueCharacterWrite(session.characterId, async () => {
      started();
      await blocked;
    });
    await startedPromise;

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    const settlement = session.guildCreateSettlement;
    expect(meta.copper).toBe(GUILD_CREATION_FEE_COPPER);
    // A second create cannot claim another fee while the first waits.
    dispatch(server, session, { cmd: 'guild_create', name: 'Second Banner' });
    // Model a valid spend that ran while the older persistence job held the
    // FIFO. The creator must re-check at start, before charging or DB work.
    meta.copper = 0;
    release();
    await olderWrite;
    await settlement;

    expect(paidGuildCreateMock).not.toHaveBeenCalled();
    expect(meta.copper).toBe(0);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
    const events = sent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]);
    expect(events).toContainEqual({ type: 'error', text: 'You need 1 gold to found a guild.' });
  });

  it('leave cancels an unstarted queued create and releases its exact reservation', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'QueuedLeaver');
    session.leaseNonce = 'lease:queued-leaver';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;

    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const olderWrite = server.enqueueCharacterWrite(session.characterId, async () => {
      started();
      await blocked;
    });
    await startedPromise;

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    const settlement = session.guildCreateSettlement;
    expect(settlement).toBeDefined();
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(1);
    expect(session.bankLedgerJournal.outbox.usage.reservedEncodedBytes).toBeGreaterThan(0);

    const leaving = server.leave(session, 'queued create cancellation');
    await settlement;
    const usageAfterCancellation = session.bankLedgerJournal.outbox.usage;
    release();
    await Promise.all([olderWrite, leaving]);

    expect(paidGuildCreateMock).not.toHaveBeenCalled();
    expect(meta.copper).toBe(150_000);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(usageAfterCancellation.reservedRows).toBe(0);
    expect(usageAfterCancellation.reservedEncodedBytes).toBe(0);
  });

  it('admits only two paid creates per process and refuses a third without reserving it', async () => {
    const server = new GameServer();
    const first = joinServer(server, 1, 'First');
    const second = joinServer(server, 2, 'Second');
    const third = joinServer(server, 3, 'Third');
    for (const { session } of [first, second, third]) {
      session.leaseNonce = `lease:${session.characterId}`;
      const meta = server.sim.players.get(session.pid);
      if (!meta) throw new Error('missing meta');
      meta.copper = 150_000;
    }

    const releases: Array<() => void> = [];
    const starts: Promise<void>[] = [];
    const olderWrites = [first.session, second.session].map((session) => {
      let started!: () => void;
      let release!: () => void;
      starts.push(new Promise<void>((resolve) => (started = resolve)));
      const blocked = new Promise<void>((resolve) => (release = resolve));
      releases.push(release);
      return server.enqueueCharacterWrite(session.characterId, async () => {
        started();
        await blocked;
      });
    });
    await Promise.all(starts);

    dispatch(server, first.session, { cmd: 'guild_create', name: 'First Banner' });
    dispatch(server, second.session, { cmd: 'guild_create', name: 'Second Banner' });
    expect(priv(server).paidGuildCreation.pendingCount).toBe(2);
    dispatch(server, third.session, { cmd: 'guild_create', name: 'Third Banner' });

    const thirdEvents = third.sent.flatMap(
      (message) => ((message as { list?: unknown[] }).list ?? []) as never[],
    );
    expect(thirdEvents).toContainEqual({
      type: 'error',
      text: 'You are busy. Try again in a moment.',
    });
    expect(third.session.guildCreateSettlement).toBeUndefined();
    expect(third.session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
    expect(paidGuildCreateMock).not.toHaveBeenCalled();

    const settlements = [first.session, second.session].map((session) => {
      priv(server).paidGuildCreation.cancelQueuedForLeave(session);
      return session.guildCreateSettlement;
    });
    await Promise.all(settlements);
    for (const release of releases) release();
    await Promise.all(olderWrites);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
  });

  it('aborts a paid create that remains queued for the full 70-second bound', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'TimedOut');
    session.leaseNonce = 'lease:timed-out';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const olderWrite = server.enqueueCharacterWrite(session.characterId, async () => {
      started();
      await blocked;
    });
    await startedPromise;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
      const settlement = session.guildCreateSettlement;
      expect(settlement).toBeDefined();
      await vi.advanceTimersByTimeAsync(69_999);
      expect(priv(server).paidGuildCreation.pendingCount).toBe(1);
      expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await settlement;
      expect(paidGuildCreateMock).not.toHaveBeenCalled();
      expect(meta.copper).toBe(150_000);
      expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
      expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
      expect(session.bankLedgerJournal.outbox.usage.reservedEncodedBytes).toBe(0);
    } finally {
      release();
      await olderWrite;
      vi.useRealTimers();
    }
  });

  it('awaits a started atomic create before the leave flush and teardown', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Leaver');
    session.leaseNonce = 'lease:leaver';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    let settleAtomic!: () => void;
    const blocked = new Promise<void>((resolve) => {
      settleAtomic = resolve;
    });
    paidGuildCreateMock.mockImplementationOnce(
      async (_deps: unknown, args: { fee: { batchKey: string } }) => {
        await blocked;
        return {
          durability: 'committed',
          guildId: GUILD_ID,
          feeBatchKey: args.fee.batchKey,
        };
      },
    );
    const order: string[] = [];
    const created = priv(server).social.tx.onGuildCreated.bind(priv(server).social.tx);
    vi.spyOn(priv(server).social.tx, 'onGuildCreated').mockImplementation((...args: unknown[]) => {
      const [characterId, guildId] = args as [number, number];
      order.push('created-hook');
      created(characterId, guildId);
    });
    dbMock.saveCharacterAndMarketState.mockImplementationOnce(async () => {
      order.push('final-save');
      return true;
    });

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await vi.waitFor(() => expect(paidGuildCreateMock).toHaveBeenCalledTimes(1));
    const leaving = server.leave(session, 'test disconnect');
    let left = false;
    void leaving.then(() => {
      left = true;
    });
    await Promise.resolve();
    expect(left).toBe(false);
    expect(server.sim.entities.has(session.pid)).toBe(true);

    settleAtomic();
    await leaving;
    expect(order).toEqual(['created-hook', 'final-save']);
    expect(server.sim.entities.has(session.pid)).toBe(false);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true);
  });

  it('never refunds a replacement session when the original rollback settles late', async () => {
    const server = new GameServer();
    const { session: origin } = joinServer(server, 1, 'Origin');
    const { session: replacement } = joinServer(server, 2, 'Replacement');
    origin.leaseNonce = 'lease:origin';
    replacement.leaseNonce = 'lease:replacement';
    const originMeta = server.sim.players.get(origin.pid);
    const replacementMeta = server.sim.players.get(replacement.pid);
    if (!originMeta || !replacementMeta) throw new Error('missing meta');
    originMeta.copper = 150_000;
    replacementMeta.copper = 777;
    let settleAtomic!: () => void;
    const blocked = new Promise<void>((resolve) => {
      settleAtomic = resolve;
    });
    paidGuildCreateMock.mockImplementationOnce(async () => {
      await blocked;
      return { durability: 'not_committed', reason: 'name_taken' };
    });
    vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, origin, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await vi.waitFor(() => expect(paidGuildCreateMock).toHaveBeenCalledTimes(1));
    // Simulate the authority slot changing while the original DB request is
    // in flight. Refund logic must compare the exact session object, not only
    // the reusable character id.
    priv(server).sessionsByCharacterId.set(origin.characterId, replacement);
    settleAtomic();
    await origin.guildCreateSettlement;
    errSpy.mockRestore();

    expect(originMeta.copper).toBe(140_000);
    expect(replacementMeta.copper).toBe(777);
    expect(origin.escrowQuarantined).toBe(true);
  });

  it('never refunds or saves an unresolved COMMIT ambiguity', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Unknown');
    session.leaseNonce = 'lease:ambiguous';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    paidGuildCreateMock.mockImplementationOnce(
      async (_deps: unknown, args: { fee: { batchKey: string } }) => ({
        durability: 'commit_ambiguous',
        guildId: GUILD_ID,
        feeBatchKey: args.fee.batchKey,
        error: new Error('commit answer lost'),
      }),
    );
    const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    errSpy.mockRestore();
    expect(meta.copper).toBe(140_000);
    expect(session.escrowQuarantined).toBe(true);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(1);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(await server.saveCharacter(session)).toBe(false);
    expect(dbMock.saveCharacterState).not.toHaveBeenCalled();
    expect(kickSpy).toHaveBeenCalled();
  });

  it('keeps committed success hooks authoritative when exact local acknowledgement fails', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Committed');
    session.leaseNonce = 'lease:committed-ack-failure';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    vi.spyOn(session.bankLedgerJournal.outbox, 'canAcknowledge').mockReturnValue(false);
    const membershipSpy = vi.spyOn(server.sim, 'setPlayerGuildMembership');
    vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    errSpy.mockRestore();
    expect(meta.copper).toBe(140_000);
    expect(session.escrowQuarantined).toBe(true);
    expect(session.bankLedgerJournal.outbox.usage.reservedRows).toBe(0);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true);
    expect(membershipSpy).toHaveBeenCalledWith(session.pid, {
      guildId: GUILD_ID,
      rank: 'leader',
    });
    const events = sent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]);
    expect(events).toContainEqual({
      type: 'log',
      text: 'You found the guild <Iron Vanguard>! You are its Guild Master.',
      color: '#40ff7f',
    });
  });

  it('quarantines a mismatched committed fee identity without undoing durable success', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'CommittedMismatch');
    session.leaseNonce = 'lease:committed-fee-mismatch';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    paidGuildCreateMock.mockResolvedValueOnce({
      durability: 'committed',
      guildId: GUILD_ID,
      feeBatchKey: 'ledger:different-durable-fee',
    });
    const refundSpy = vi.spyOn(server.sim, 'refundGuildCreationFeeFor');
    const membershipSpy = vi.spyOn(server.sim, 'setPlayerGuildMembership');
    const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await session.guildCreateSettlement;

    errSpy.mockRestore();
    expect(refundSpy).not.toHaveBeenCalled();
    expect(meta.copper).toBe(140_000);
    expect(session.escrowQuarantined).toBe(true);
    expect(priv(server).paidGuildCreation.pendingCount).toBe(0);
    expect(session.bankLedgerJournal.outbox.usage).toMatchObject({
      reservedRows: 0,
      reservedEncodedBytes: 0,
    });
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true);
    expect(membershipSpy).toHaveBeenCalledWith(session.pid, {
      guildId: GUILD_ID,
      rank: 'leader',
    });
    expect(kickSpy).toHaveBeenCalled();
    const events = sent.flatMap((message) => {
      return ((message as { list?: unknown[] }).list ?? []) as never[];
    });
    expect(events).toContainEqual({
      type: 'log',
      text: 'You found the guild <Iron Vanguard>! You are its Guild Master.',
      color: '#40ff7f',
    });
  });

  it('acknowledges only the captured prefix and preserves a mid-transaction ledger suffix', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Suffix');
    session.leaseNonce = 'lease:suffix';
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    let settleAtomic!: () => void;
    const atomicBlocked = new Promise<void>((resolve) => {
      settleAtomic = resolve;
    });
    paidGuildCreateMock.mockImplementationOnce(
      async (_deps: unknown, args: { fee: { batchKey: string } }) => {
        await atomicBlocked;
        return {
          durability: 'committed',
          guildId: GUILD_ID,
          feeBatchKey: args.fee.batchKey,
        };
      },
    );

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await vi.waitFor(() => expect(paidGuildCreateMock).toHaveBeenCalledTimes(1));
    const suffix = session.bankLedgerJournal.admission.tryReserve(1, 0, 'personal');
    expect(suffix).not.toBeNull();
    expect(
      suffix?.commit([
        {
          realm: session.bankLedgerJournal.outbox.owner.realm,
          characterId: session.characterId,
          accountId: session.accountId,
          op: 'deposit',
          itemId: 'wolf_fang',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 0,
          container: 'personal',
          containerId: null,
        },
      ]),
    ).toBe(true);
    meta.bank.purchasedSlots = 6;
    const storageSuffix = {
      realm: session.bankLedgerJournal.outbox.owner.realm,
      accountId: session.accountId,
      characterId: session.characterId,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'guild-create-storage-suffix',
      spendClaimToken: '00000000-0000-4000-8000-000000000001',
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    expect(server.stageStorageAppliedEffect(storageSuffix)).toBe(true);
    settleAtomic();
    await session.guildCreateSettlement;

    const remaining = queuedLedgerRows(session);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ op: 'deposit', itemId: 'wolf_fang', count: 1 });
    expect(session.pendingStorageAppliedEffects).toEqual([storageSuffix]);
  });

  it('onGuildCreated is a live-only durable-book mirror, even without a local founder', async () => {
    const server = new GameServer();
    joinServer(server, 1, 'Bystander');
    priv(server).social.tx.onGuildCreated(999999, GUILD_ID);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true);
    await bankLedgerIdle();
    // The atomic creator owns the durable fee. This transport hook can never
    // enqueue a duplicate receipt or dirty the new empty book.
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
  });

  it('onGuildDisbanded evicts the book and clears every session dirty mark and op log', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Wind');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    expect(session.unflushedGuildBankOps.has(GUILD_ID)).toBe(true);
    priv(server).social.tx.onGuildDisbanded(GUILD_ID);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
    // The marks and logs clear too: no re-serialization attempts (or revert
    // attempts) against a guild id whose row no longer exists.
    expect(session.dirtyGuildBanks.size).toBe(0);
    expect(session.unflushedGuildBankOps.size).toBe(0);
  });

  it('beginGuildBankDelete reads the live book (null when unloaded)', () => {
    const server = new GameServer();
    joinServer(server, 1, 'Reader');
    expect(priv(server).social.tx.beginGuildBankDelete(GUILD_ID)).toBeNull();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 42, inventory: [], purchasedSlots: 0 });
    expect(priv(server).social.tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 42, items: 0 });
  });

  it('beginGuildBankDelete fails CLOSED while any session holds an unflushed mark', async () => {
    // The disband guard proves LIVE state only; the cascade destroys the
    // DURABLE row. While an op that emptied the live book is still unflushed,
    // a disband would destroy escrow value a crash could never recover, so
    // the transport read reports null (the guard refuses) until the escrow
    // save commits.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Unflushed');
    officerSetup(server, session, 1_000);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 1_000 });
    // The live book is empty now, but the withdrawal is not yet durable.
    expect(server.sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    expect(priv(server).social.tx.beginGuildBankDelete(GUILD_ID)).toBeNull();
    // The escrow save commits: the guard opens (self-heals within one save).
    await priv(server).saveCharacter(session);
    expect(priv(server).social.tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
  });

  // Two officers alternating LADDER rungs: officer A's rung waits on officer
  // B's opening while officer B's next rung waits on officer A's, so neither
  // replay can ever apply first. (This used to be described as the ONLY shape
  // that can deadlock both replays, gold and items being unable to: true for
  // one fungible, false for two item identities, which is the 2026-09-01
  // production incident the unsettled gate now refuses at dispatch; see the
  // gate's own describe block below.) The gate refuses a rung on top of an
  // unsettled one, so the deadlock is SEEDED under it: B's opening and both
  // gold deposits go through dispatch (never gated), the two rungs are
  // dispatched with the other officer hidden from the gate.
  function ladderDeadlock(server: GameServer, a: ClientSession, b: ClientSession): void {
    officerSetup(server, a, 0);
    durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 0 });
    const book = server.sim.guildBanks.get(GUILD_ID);
    if (!book) throw new Error('missing book');
    book.purchasedSlots = 0; // unopened, matching the durable row
    moveToBanker(server, b.pid);
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 500_000;
    const stampBoth = () => {
      server.sim.setPlayerGuildMembership(a.pid, { guildId: GUILD_ID, rank: 'officer' });
      server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    };
    stampBoth();
    dispatch(server, b, { cmd: 'guild_bank_buy_slots' }); // B opens, 0 -> 24
    stampBoth();
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 25_000 });
    // A buys rung 1, 24 -> 30, on top of B's unsettled opening.
    dispatchUnderGate(server, a, { cmd: 'guild_bank_buy_slots' }, [b]);
    stampBoth();
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    // B buys rung 2, 30 -> 36, on top of A's unsettled rung.
    dispatchUnderGate(server, b, { cmd: 'guild_bank_buy_slots' }, [a]);
    stampBoth();
    expect(server.sim.guildBanks.get(GUILD_ID)?.purchasedSlots).toBe(36);
    // Neither log can be replayed: A's rung needs the ladder at exactly 24
    // (B's opening), B's needs it at exactly 30 (A's rung).
    expect(a.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    expect(b.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  }

  it('the retry BOUND is reachable: a mutual deficit ends in a rollback, not a spin', async () => {
    // Without the bound both sessions would refuse forever and neither
    // character would ever save again.
    const server = new GameServer();
    const a = joinServer(server, 1, 'MutualA').session;
    const b = joinServer(server, 2, 'MutualB').session;
    ladderDeadlock(server, a, b);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // biome-ignore lint/suspicious/noExplicitAny: reading a private static pin
    const cap = (GameServer as any).GUILD_BANK_DEFICIT_MAX_SKIPS as number;
    expect(cap).toBeGreaterThan(1);
    for (let i = 0; i < cap + 2 && !a.escrowQuarantined; i++) {
      await priv(server).saveCharacter(a);
      if (i === 0) expect(a.escrowQuarantined).toBe(false); // it RETRIES first
    }
    errSpy.mockRestore();
    expect(a.escrowQuarantined).toBe(true); // ...and the bound ends it
    expect(a.dirtyGuildBanks.size).toBe(0);
    expect(durableChars.has(1)).toBe(false); // nothing of A's ever committed
  });

  it("a session's LAST save resolves a refusal instead of waiting for a retry", async () => {
    // The leave flush and the shutdown flush's second pass are the last save a
    // session gets. Choosing "retry" there tears the session down with its
    // whole progress discarded and no log line and no ledger row saying why,
    // because the retry never comes.
    const server = new GameServer();
    const a = joinServer(server, 1, 'LeaverA').session;
    const b = joinServer(server, 2, 'StuckB').session;
    ladderDeadlock(server, a, b);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbMock.insertBankLedgerRow.mockClear();
    // Straight to the leave flush, with no ordinary save first: B is dirty, so
    // the retry arm's condition is fully satisfied and an ordinary save here
    // would come back un-quarantined with one skip spent. The leave flush must
    // not, because there is no save after it to spend the next one on.
    await priv(server).saveCharacterOnLeave(a);
    errSpy.mockRestore();
    await bankLedgerIdle();
    expect(a.escrowQuarantined).toBe(true);
    expect(durableChars.has(1)).toBe(false);
    const rows = dbMock.insertBankLedgerRow.mock.calls.map((c) => (c as unknown[])[0]);
    expect(rows).toContainEqual(
      expect.objectContaining({ op: 'escrow_deficit', characterId: 1, containerId: GUILD_ID }),
    );
  });

  it('a refusal FLUSHES what it is waiting on, so the ordinary case clears at once', async () => {
    // The blocked window is the cost this design charges an innocent officer:
    // while a refusal is outstanding that character persists nothing at all,
    // guild bank or not. Waiting a full autosave interval for the other
    // officer's commit would multiply that cost by every retry, so a refusal
    // flushes the sessions it is waiting on instead.
    const server = new GameServer();
    const a = joinServer(server, 1, 'WaiterA').session;
    const b = joinServer(server, 2, 'DepositorB').session;
    officerSetup(server, a, 0);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 500_000;
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 40_000 });
    server.sim.setPlayerGuildMembership(a.pid, { guildId: GUILD_ID, rank: 'officer' });
    // A's withdraw of B's unsettled copper is exactly what the dispatch-time
    // gate now refuses, so it is dispatched with B hidden from the gate to
    // reach the refusal arm.
    dispatchUnderGate(server, a, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 }, [b]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(a); // refused, and flushes B
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    expect(a.escrowQuarantined).toBe(false);
    // B's deposit is durable now, so A's very next save lands both halves.
    server.sim.setPlayerGuildMembership(a.pid, { guildId: GUILD_ID, rank: 'officer' });
    await priv(server).saveCharacter(a);
    errSpy.mockRestore();
    expect(a.escrowQuarantined).toBe(false);
    expect(a.dirtyGuildBanks.size).toBe(0);
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
    expect(durableChars.get(1)?.copper).toBe(540_000);
  });

  it('a save ENQUEUED before the rollback cannot land after it', async () => {
    // The quarantine guard has to sit inside the queued closure, not only at
    // the call, or a save queued a moment earlier runs after the rollback has
    // undone this session's book ops while its character blob still reflects
    // them: exactly the mint the rollback prevented.
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'RacerA');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'StuckB').session;
    ladderDeadlock(server, a, b);
    const purse = server.sim.players.get(a.pid)?.copper;
    expect(purse).toBe(475_000); // A paid 25_000 into the treasury
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Occupy the serial writer, enqueue A's save behind it, THEN quarantine A,
    // then let the queue drain.
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    void priv(server).enqueueMarketWrite(() => blocker);
    const queued = priv(server).saveCharacter(a);
    // The rollback lands while that save is still waiting on the queue.
    // biome-ignore lint/suspicious/noExplicitAny: driving the private rollback
    (server as any).handleGuildBankEscrowRefusal(
      a,
      [{ guildId: GUILD_ID, written: false, deficit: null, rowUnusable: true }],
      true,
    );
    expect(a.escrowQuarantined).toBe(true);
    // The kick's WIRE argument is the matcher-covered takeover literal, never
    // the internal cause (kickSession sends its SECOND argument on the wire;
    // this pins the guild-bank arm the same way the escrow-queue suite pins
    // the market arm).
    expect(aJoin.sent).toContainEqual({ t: 'error', error: 'character taken over' });
    release?.();
    await queued;
    errSpy.mockRestore();
    expect(durableChars.has(1)).toBe(false); // the queued save landed nothing
    expect(b).toBeDefined();
  });

  it('COUNTS the netted rescues, so the fallback is visible rather than silent', () => {
    // The netted retry forgives an ORDERING artifact, never a genuine consume,
    // but it is the one place a refusal is turned back into a write, so how
    // often it fires is worth an operator's eye.
    const gold = (copperDelta: number) => ({
      op: copperDelta > 0 ? ('deposit_gold' as const) : ('withdraw_gold' as const),
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const before = nettedReplayRescueCount();
    // Ordered: -500 underflows a base of 100. Netted: +400, which lands.
    expect(
      mergeGuildBankRow({ treasury: 100, inventory: [], purchasedSlots: 24 }, [
        gold(-500),
        gold(900),
      ]).result.written,
    ).toBe(true);
    expect(nettedReplayRescueCount()).toBe(before + 1);
    // A clean ordered replay does not touch the counter.
    expect(
      mergeGuildBankRow({ treasury: 100, inventory: [], purchasedSlots: 24 }, [gold(900)]).result
        .written,
    ).toBe(true);
    expect(nettedReplayRescueCount()).toBe(before + 1);
    // And a GENUINE consume is still refused, not rescued.
    expect(
      mergeGuildBankRow({ treasury: 100, inventory: [], purchasedSlots: 24 }, [gold(-500)]).result
        .written,
    ).toBe(false);
    expect(nettedReplayRescueCount()).toBe(before + 1);
  });

  it('an unusable row refuses the WHOLE save and rolls the session back', async () => {
    // The row is preserved for a human and retrying cannot help, so the save
    // is refused exactly like a deficit: the character half must not commit
    // without the book half, whatever the reason the book half could not be
    // written.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'BadRow2');
    officerSetup(server, session);
    oversizedGuilds.add(GUILD_ID);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dbMock.insertBankLedgerRow.mockClear();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    await bankLedgerIdle();
    expect(durableChars.has(1)).toBe(false); // the character half never landed
    expect(session.escrowQuarantined).toBe(true);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_000); // undone
    const rows = dbMock.insertBankLedgerRow.mock.calls.map((c) => (c as unknown[])[0]);
    expect(rows).toContainEqual(
      expect.objectContaining({ op: 'escrow_deficit', containerId: GUILD_ID }),
    );
  });

  it("the cap compaction leaves an IN-FLIGHT save's captured prefix alone", async () => {
    // The post-commit release consumes the carried prefix BY INDEX, so a
    // compaction that reshuffled the log while the write was awaited would
    // make it eat the wrong entries: persisting work twice, or dropping it.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'CapRacer');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const real = dbMock.saveCharacterAndGuildBankState.getMockImplementation();
    if (!real) throw new Error('missing impl');
    dbMock.saveCharacterAndGuildBankState.mockImplementationOnce(
      // biome-ignore lint/suspicious/noExplicitAny: forwarding the double's own args
      async (...args: any[]) => {
        // Mid-write: pad the log past the cap so the next op compacts it.
        const log = session.unflushedGuildBankOps.get(GUILD_ID) ?? [];
        session.unflushedGuildBankOps.set(GUILD_ID, [
          ...log,
          ...Array.from({ length: 500 }, () => ({
            op: 'deposit_gold' as const,
            itemId: null,
            count: null,
            instance: null,
            craftedRecipeId: null,
            copperDelta: 0,
            purchasedSlotsBefore: 24,
            purchasedSlotsAfter: 24,
          })),
        ]);
        server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
        dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 4_000 });
        return real(...args);
      },
    );
    await priv(server).saveCharacter(session);
    // The two carried deposits are durable and consumed exactly once...
    expect(durableBook()).toEqual({ treasury: 103_000, inventory: [], purchasedSlots: 24 });
    // ...and the mid-write op is still queued, not swallowed by the splice.
    const rest = session.unflushedGuildBankOps.get(GUILD_ID) ?? [];
    expect(rest.reduce((n, d) => n + d.copperDelta, 0)).toBe(4_000);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    // A second save drains it, with no double-persist.
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    await priv(server).saveCharacter(session);
    expect(durableBook()).toEqual({ treasury: 107_000, inventory: [], purchasedSlots: 24 });
  });

  it('an exhausted leave flush undoes the books it could never commit', async () => {
    // The leave save retries then gives up; the session tears down, so its
    // live-book mutations can never converge to durable truth and the guard
    // loses sight of them. The give-up arm runs the same synchronous undo the
    // fence-out arm runs.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'GoneWrong');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(60_000);
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    // Every leave-flush attempt fails (the market sibling carries the books
    // on the withMarket leave path).
    dbMock.saveCharacterAndMarketState.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacterOnLeave(session);
    errSpy.mockRestore();
    dbMock.saveCharacterAndMarketState.mockResolvedValue(true);
    // Live state returned to durable truth: the unflushable withdrawal is
    // gone from the live book (its character half never persisted either).
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
    expect(session.dirtyGuildBanks.size).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Guild bank incident counters (server/http/game_signals.ts). Every arm below
// used to report ONLY through console.error / console.warn, i.e. it was
// invisible to production alerting on the dupe-sensitive paths. Each test
// drives the REAL code path (dispatch -> saveCharacter -> reconcile, or the
// real ledger recorder) with a recording sink installed in the process-wide
// slot, the tests/game_state_metrics.test.ts idiom.
// ---------------------------------------------------------------------------

function recordingIncidents(): { sink: GameMetricsCounters; kinds: GuildBankIncident[] } {
  const kinds: GuildBankIncident[] = [];
  return {
    kinds,
    sink: {
      ...noopGameMetricsCounters,
      guildBankIncident(kind) {
        kinds.push(kind);
      },
    },
  };
}

describe('the unsettled gate (server/guild_bank_settle_gate.ts) at the real dispatch seam', () => {
  afterEach(() => {
    setGameMetricsCounters(noopGameMetricsCounters);
  });

  // English on the wire; the client matcher re-localizes it (guild.bankSettling).
  const NOTICE = 'The guild bank is still saving a recent change. Try again in a moment.';
  /** Every player-facing error line a fake socket received. */
  const notices = (sent: unknown[]): string[] =>
    sent.flatMap((frame) => {
      const f = frame as { t?: string; list?: { type?: string; text?: string }[] };
      if (f.t !== 'events') return [];
      return (f.list ?? []).filter((e) => e.type === 'error').map((e) => e.text ?? '');
    });
  /** A second officer of the same guild at the banker, with copper. */
  function secondOfficer(server: GameServer, b: ClientSession): void {
    moveToBanker(server, b.pid);
    stampMember(server, b, 'officer');
    const meta = server.sim.players.get(b.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;
  }
  /** Re-seat the officer stamps after any await: the join's async social load
   *  lands there and re-stamps from the (mocked, empty) social read, exactly
   *  why the ladder tests above call stampBoth() between their steps. */
  const restamp = (server: GameServer, ...sessions: ClientSession[]): void => {
    for (const s of sessions) {
      server.sim.setPlayerGuildMembership(s.pid, { guildId: GUILD_ID, rank: 'officer' });
    }
  };
  const bagIndex = (server: GameServer, pid: number, itemId: string): number => {
    const idx = server.sim.players.get(pid)?.inventory.findIndex((s) => s.itemId === itemId) ?? -1;
    if (idx < 0) throw new Error(`${itemId} is not in the bags of ${pid}`);
    return idx;
  };
  const liveBook = (server: GameServer) => {
    const book = server.sim.guildBanks.get(GUILD_ID);
    if (!book) throw new Error('missing book');
    return book;
  };
  const bookIndex = (server: GameServer, itemId: string): number => {
    const idx = liveBook(server).inventory.findIndex((s) => s.itemId === itemId);
    if (idx < 0) throw new Error(`${itemId} is not in the book`);
    return idx;
  };
  const bookCount = (server: GameServer, itemId: string): number =>
    liveBook(server)
      .inventory.filter((s) => s.itemId === itemId)
      .reduce((n, s) => n + s.count, 0);
  const durableBags = (characterId: number) =>
    (durableChars.get(characterId) as { inventory?: { itemId: string; count: number }[] })
      ?.inventory ?? [];

  it('the 2026-09-01 shape: two officers swapping two materials inside one save window quarantine nobody and strand nothing', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Legs');
    const bJoin = joinServer(server, 2, 'Glands');
    const a = aJoin.session;
    const b = bJoin.session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    server.sim.addItem('spider_leg', 20, a.pid);
    server.sim.addItem('venom_gland', 20, b.pid);
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: bagIndex(server, a.pid, 'spider_leg') });
    dispatch(server, b, {
      cmd: 'guild_bank_deposit',
      slot: bagIndex(server, b.pid, 'venom_gland'),
    });
    expect(bookCount(server, 'spider_leg')).toBe(20);
    expect(bookCount(server, 'venom_gland')).toBe(20);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    // B reaches for A's not-yet-durable spider legs: refused at dispatch, the
    // book untouched, B's log still only its own deposit and its mark
    // unchanged, the notice sent, and A flushed on the spot.
    const bSeq = b.dirtyGuildBanks.get(GUILD_ID);
    dispatch(server, b, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(bJoin.sent)).toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(20);
    expect(b.unflushedGuildBankOps.get(GUILD_ID)?.map((d) => d.op)).toEqual(['deposit']);
    expect(b.dirtyGuildBanks.get(GUILD_ID)).toBe(bSeq);
    expect(rec.kinds).toEqual(['unsettled_refused']);
    await vi.waitFor(() => expect(a.dirtyGuildBanks.size).toBe(0));
    restamp(server, a, b);
    // A reaches for B's venom glands: the mirror image, and B is flushed.
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'venom_gland') });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    restamp(server, a, b);
    // Both stacks are settled now: the retries land, and so do both saves.
    dispatch(server, b, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'venom_gland') });
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(await priv(server).saveCharacter(b)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
    expect(b.escrowQuarantined).toBe(false);
    expect(rec.kinds).toEqual(['unsettled_refused', 'unsettled_refused']);
    // The swap went through durably, and the live book equals the durable
    // one: no phantom stack survives for the next officer to trip over.
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
    expect(server.sim.serializeGuildBank(GUILD_ID)).toEqual(durableBook());
    expect(durableBags(1)).toContainEqual(
      expect.objectContaining({ itemId: 'venom_gland', count: 20 }),
    );
    expect(durableBags(2)).toContainEqual(
      expect.objectContaining({ itemId: 'spider_leg', count: 20 }),
    );
  });

  it('a gold withdraw beyond the settled treasury is refused and lands after the flush; one within it passes at once', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Taker');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Giver').session;
    officerSetup(server, a, 100_000);
    secondOfficer(server, b);
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 40_000 });
    // 100_000 is settled: it passes even while B's 40_000 is not.
    dispatch(server, a, { cmd: 'guild_bank_withdraw_gold', amount: 100_000 });
    expect(notices(aJoin.sent)).not.toContain(NOTICE);
    expect(liveBook(server).treasury).toBe(40_000);
    // The remaining 40_000 is B's unsettled deposit: refused, and B flushed.
    dispatch(server, a, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    expect(liveBook(server).treasury).toBe(40_000);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    restamp(server, a);
    dispatch(server, a, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 });
    expect(liveBook(server).treasury).toBe(0);
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
    expect(durableChars.get(1)?.copper).toBe(640_000);
  });

  it("a rung bought on top of another officer's unsettled rung is refused, never deadlocked", async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'RungA');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'OpenerB').session;
    officerSetup(server, a, 0);
    durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 0 });
    liveBook(server).purchasedSlots = 0; // unopened, matching the durable row
    secondOfficer(server, b);
    dispatch(server, b, { cmd: 'guild_bank_buy_slots' }); // B opens, 0 -> 24, unsettled
    expect(liveBook(server).purchasedSlots).toBe(24);
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 100_000 });
    dispatch(server, a, { cmd: 'guild_bank_buy_slots' }); // refused: B's opening is unsettled
    expect(notices(aJoin.sent)).toContain(NOTICE);
    expect(liveBook(server).purchasedSlots).toBe(24);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    restamp(server, a);
    dispatch(server, a, { cmd: 'guild_bank_buy_slots' });
    expect(liveBook(server).purchasedSlots).toBe(30);
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
    expect(durableBook()).toEqual(expect.objectContaining({ purchasedSlots: 30 }));
  });

  it('refuses selected unsettled material sources at dispatch and flushes their depositor', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Buyer');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Gatherer').session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    server.sim.addItem('copper_ore', 5, a.pid);
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: bagIndex(server, a.pid, 'copper_ore') });
    expect(await priv(server).saveCharacter(a)).toBe(true);
    restamp(server, a, b);
    const meta = server.sim.players.get(b.pid);
    if (!meta) throw new Error('missing gatherer');
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 5,
      materialSources: [
        { source: { gatherer: { kind: 'character', id: 2, name: 'Gatherer' } }, count: 5 },
      ],
    });
    dispatch(server, b, { cmd: 'guild_bank_deposit', slot: bagIndex(server, b.pid, 'copper_ore') });
    const inventory = liveBook(server).inventory;
    const slot = bookIndex(server, 'copper_ore');
    const target = captureMaterialStackSelection(inventory, 'copper_ore', slot);
    if (!target) throw new Error('missing material selection');
    const sourceIndex = inventory[slot].materialSources?.findIndex(
      (bucket) => bucket.source.gatherer?.id === 2,
    );
    if (sourceIndex === undefined || sourceIndex < 0) throw new Error('missing gathered source');
    dispatch(server, a, {
      cmd: 'guild_bank_withdraw',
      slot,
      count: 5,
      selection: { itemId: 'copper_ore', target, quantities: [{ sourceIndex, count: 5 }] },
    });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    expect(bookCount(server, 'copper_ore')).toBe(10);
    expect(a.dirtyGuildBanks.size).toBe(0);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    restamp(server, a, b);
    dispatch(server, a, {
      cmd: 'guild_bank_withdraw',
      slot,
      count: 5,
      selection: { itemId: 'copper_ore', target, quantities: [{ sourceIndex, count: 5 }] },
    });
    expect(bookCount(server, 'copper_ore')).toBe(5);
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
  });

  it('a session may take back its OWN unsettled deposit while another officer is dirty on the book', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Own');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Bystander').session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    server.sim.addItem('spider_leg', 20, a.pid);
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: bagIndex(server, a.pid, 'spider_leg') });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 5_000 });
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent)).not.toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(0);
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
  });

  it("a departing officer's deposit stays unsettled until their leave flush lands, and only the staying holder is flushed", async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Stayer');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Leaver').session;
    const c = joinServer(server, 3, 'Holder').session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    secondOfficer(server, c);
    server.sim.addItem('spider_leg', 20, b.pid);
    server.sim.addItem('spider_leg', 20, c.pid);
    dispatch(server, b, { cmd: 'guild_bank_deposit', slot: bagIndex(server, b.pid, 'spider_leg') });
    // C feeds the same dependency (the flush reaches only contributing holders).
    dispatch(server, c, { cmd: 'guild_bank_deposit', slot: bagIndex(server, c.pid, 'spider_leg') });
    // The window between leave() and the leave flush's commit: B's deposit is
    // on the live book, not durable, and B's own flush is already in flight.
    b.left = true;
    dbMock.saveCharacterAndGuildBankState.mockClear();
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(40);
    // The positive control: the staying holder IS flushed by that refusal...
    await vi.waitFor(() => expect(c.dirtyGuildBanks.size).toBe(0));
    // ...and the departing one is not (its mark survives, no save was queued
    // for it): only C's character id reached the escrow save.
    expect(b.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    const saved = dbMock.saveCharacterAndGuildBankState.mock.calls.map((call) => call[0]);
    expect(saved).toEqual([3]);
  });

  it("three officers: one holder's uncommitted withdrawal never hides another holder's deposit", async () => {
    // Durable truth holds 10 spider legs. B deposits 10 more (unsettled), C
    // withdraws 10 (settled copies, so C's gate passes). A single cross-holder
    // net would read 0 and let A take B's copies; per-session positives keep
    // B's 10 unsettled until B commits.
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Taker');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Depositor').session;
    const cJoin = joinServer(server, 3, 'Remover');
    const c = cJoin.session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    secondOfficer(server, c);
    liveBook(server).inventory.push({ itemId: 'spider_leg', count: 10 });
    durableBooks.set(GUILD_ID, {
      treasury: 0,
      inventory: [{ itemId: 'spider_leg', count: 10 }],
      purchasedSlots: 24,
    });
    server.sim.addItem('spider_leg', 10, b.pid);
    dispatch(server, b, { cmd: 'guild_bank_deposit', slot: bagIndex(server, b.pid, 'spider_leg') });
    expect(bookCount(server, 'spider_leg')).toBe(20);
    dispatch(server, c, {
      cmd: 'guild_bank_withdraw',
      slot: bookIndex(server, 'spider_leg'),
      count: 10,
    });
    expect(notices(cJoin.sent)).not.toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(10);
    // The 10 left on the live book are B's: A is refused, and B is flushed.
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(10);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    restamp(server, a, c);
    // B's deposit is durable now; C's withdrawal is still unsettled but it is
    // a REMOVAL, so it hides nothing: A's retry passes and every save lands.
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent).filter((text) => text === NOTICE)).toHaveLength(1);
    expect(bookCount(server, 'spider_leg')).toBe(0);
    expect(await priv(server).saveCharacter(c)).toBe(true);
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(a.escrowQuarantined).toBe(false);
    expect(c.escrowQuarantined).toBe(false);
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
    expect(server.sim.serializeGuildBank(GUILD_ID)).toEqual(durableBook());
  });

  it('the holder flush is COALESCED: refusals while a flush is queued or running never stack a second save', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Spammer');
    const a = aJoin.session;
    const b = joinServer(server, 2, 'Holder').session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    server.sim.addItem('spider_leg', 20, b.pid);
    dispatch(server, b, { cmd: 'guild_bank_deposit', slot: bagIndex(server, b.pid, 'spider_leg') });
    dbMock.saveCharacterAndGuildBankState.mockClear();
    // Three refusals back to back while the first flush is still queued.
    for (let n = 0; n < 3; n++) {
      dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    }
    expect(notices(aJoin.sent).filter((text) => text === NOTICE)).toHaveLength(3);
    await vi.waitFor(() => expect(b.dirtyGuildBanks.size).toBe(0));
    // ONE save for the holder, not three: the flush is one in flight per
    // holder with a single re-arm, and the re-arm finds the holder clean.
    const saved = dbMock.saveCharacterAndGuildBankState.mock.calls.map((call) => call[0]);
    expect(saved).toEqual([2]);
    expect(b.guildBookFlushInFlight).toBe(false);
    expect(b.guildBookFlushRearm).toBe(false);
  });

  it('a plain member with unsettled work in the book is refused by the sim, never by the gate', async () => {
    // A read-only view never reaches the gate: no notice from it, no
    // incident, and no holder flush a member could force.
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Depositor');
    const a = aJoin.session;
    const mJoin = joinServer(server, 2, 'Member');
    const m = mJoin.session;
    officerSetup(server, a, 0);
    moveToBanker(server, m.pid);
    stampMember(server, m, 'member');
    server.sim.addItem('spider_leg', 20, a.pid);
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: bagIndex(server, a.pid, 'spider_leg') });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockClear();
    dispatch(server, m, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(mJoin.sent)).not.toContain(NOTICE);
    expect(bookCount(server, 'spider_leg')).toBe(20);
    expect(rec.kinds).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(a.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  });

  it('a refusal flushes ONLY the holder whose work feeds it, never an unrelated holder', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Taker');
    const a = aJoin.session;
    const legs = joinServer(server, 2, 'LegsHolder').session;
    const copper = joinServer(server, 3, 'CopperHolder').session;
    officerSetup(server, a, 0);
    secondOfficer(server, legs);
    secondOfficer(server, copper);
    server.sim.addItem('spider_leg', 20, legs.pid);
    dispatch(server, legs, {
      cmd: 'guild_bank_deposit',
      slot: bagIndex(server, legs.pid, 'spider_leg'),
    });
    dispatch(server, copper, { cmd: 'guild_bank_deposit_gold', amount: 5_000 });
    dbMock.saveCharacterAndGuildBankState.mockClear();
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    await vi.waitFor(() => expect(legs.dirtyGuildBanks.size).toBe(0));
    const saved = dbMock.saveCharacterAndGuildBankState.mock.calls.map((call) => call[0]);
    expect(saved).toEqual([2]);
    expect(copper.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  });

  it('a refusal flushes at most GUILD_BOOK_FLUSH_FAN_OUT_MAX holders, however many feed it', async () => {
    const server = new GameServer();
    const aJoin = joinServer(server, 1, 'Taker');
    const a = aJoin.session;
    officerSetup(server, a, 0);
    const holders: ClientSession[] = [];
    for (let n = 0; n < GUILD_BOOK_FLUSH_FAN_OUT_MAX + 1; n++) {
      const h = joinServer(server, 10 + n, `Holder${n}`).session;
      secondOfficer(server, h);
      server.sim.addItem('spider_leg', 4, h.pid);
      dispatch(server, h, {
        cmd: 'guild_bank_deposit',
        slot: bagIndex(server, h.pid, 'spider_leg'),
      });
      holders.push(h);
    }
    expect(bookCount(server, 'spider_leg')).toBe(4 * holders.length);
    dbMock.saveCharacterAndGuildBankState.mockClear();
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: bookIndex(server, 'spider_leg') });
    expect(notices(aJoin.sent)).toContain(NOTICE);
    await vi.waitFor(() =>
      expect(holders.filter((h) => h.dirtyGuildBanks.size === 0)).toHaveLength(
        GUILD_BOOK_FLUSH_FAN_OUT_MAX,
      ),
    );
    await Promise.resolve();
    const saved = dbMock.saveCharacterAndGuildBankState.mock.calls.map((call) => call[0]);
    expect(saved).toHaveLength(GUILD_BOOK_FLUSH_FAN_OUT_MAX);
    expect(holders.filter((h) => h.dirtyGuildBanks.size > 0)).toHaveLength(1);
  });

  it('the holder index follows a commit, a leave, and a disband at the server seams, and agrees with a full scan', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'IdxA').session;
    const b = joinServer(server, 2, 'IdxB').session;
    const c = joinServer(server, 3, 'IdxC').session;
    officerSetup(server, a, 0);
    secondOfficer(server, b);
    secondOfficer(server, c);
    const index = priv(server).guildBookHolders as {
      holders(g: number, e: ClientSession | null, o: { includeLeaving: boolean }): ClientSession[];
      readonly size: number;
    };
    const holders = () => index.holders(GUILD_ID, null, { includeLeaving: true });
    // The oracle: the index must say exactly what a scan of every live
    // session says, so a mark or log site that forgets the index shows here.
    const scan = () =>
      [...(priv(server).sessionsByCharacterId.values() as Iterable<ClientSession>)].filter(
        (s) => !s.escrowQuarantined && s.dirtyGuildBanks.has(GUILD_ID),
      );
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    dispatch(server, c, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    expect(holders()).toEqual([a, b, c]);
    expect(holders()).toEqual(scan());
    // A commit releases A's mark: gone from the index.
    expect(await priv(server).saveCharacter(a)).toBe(true);
    expect(holders()).toEqual([b, c]);
    expect(holders()).toEqual(scan());
    // A leave tears B down (its leave flush lands first): dropped.
    await server.leave(b, 'test disconnect');
    expect(holders()).toEqual([c]);
    expect(holders()).toEqual(scan());
    // A disband drops the guild entirely.
    priv(server).social.tx.onGuildDisbanded(GUILD_ID);
    expect(holders()).toEqual([]);
    expect(index.size).toBe(0);
  });
});

describe('guild bank incident counters at their real emission sites', () => {
  afterEach(() => {
    setGameMetricsCounters(noopGameMetricsCounters);
  });

  it('counts escrow_save_failed when a save carrying a book throws', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Thrower');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockRejectedValueOnce(new Error('db down'));
    await expect(priv(server).saveCharacter(session)).rejects.toThrow('db down');
    // The counter OBSERVES: the rejection still propagates unchanged, and the
    // dirty mark still survives for the next save attempt.
    expect(rec.kinds).toEqual(['escrow_save_failed']);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  });

  it.each([
    { label: 'guild-book', withMarket: false },
    { label: 'market-and-guild-book', withMarket: true },
  ])(
    'a durable growth refusal on the $label save quarantines and reverts without escrow_save_failed',
    async ({ withMarket }) => {
      const server = new GameServer();
      const { session } = joinServer(server, 1, 'GrowthBound');
      officerSetup(server, session);
      dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 5_000 });
      expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(95_000);
      expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);

      const rec = recordingIncidents();
      let growthRefusals = 0;
      setGameMetricsCounters({
        ...rec.sink,
        bankLedgerGrowthLimitRefused() {
          growthRefusals++;
        },
      });
      const refusal = new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000);
      const save = withMarket
        ? dbMock.saveCharacterAndMarketState
        : dbMock.saveCharacterAndGuildBankState;
      save.mockRejectedValueOnce(refusal);
      const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(priv(server).saveCharacter(session, { withMarket })).rejects.toBe(refusal);
        await Promise.resolve();

        expect(save).toHaveBeenCalledTimes(1);
        expect(growthRefusals).toBe(1);
        expect(rec.kinds).toEqual(['reconcile']);
        expect(rec.kinds).not.toContain('escrow_save_failed');
        expect(session.escrowQuarantined).toBe(true);
        expect(session.dirtyGuildBanks.size).toBe(0);
        expect(session.unflushedGuildBankOps.size).toBe(0);
        expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_000);
        expect(durableBook()).toEqual({
          treasury: 100_000,
          inventory: [],
          purchasedSlots: 24,
        });
        expect(kickSpy).toHaveBeenCalledWith(
          session,
          'character state could not be saved',
          'bank ledger full',
        );

        await expect(priv(server).saveCharacter(session, { withMarket })).resolves.toBe(false);
        expect(save).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
        kickSpy.mockRestore();
      }
    },
  );

  it('a growth refusal reverts every guild-book prefix carried by one save', async () => {
    const secondGuildId = GUILD_ID + 1;
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'MultiGuildGrowth');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 5_000 });

    server.sim.loadGuildBank(secondGuildId, {
      treasury: 200_000,
      inventory: [],
      purchasedSlots: 24,
    });
    server.sim.setPlayerGuildMembership(session.pid, {
      guildId: secondGuildId,
      rank: 'officer',
    });
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 7_000 });
    expect([...session.dirtyGuildBanks.keys()].sort((a, b) => a - b)).toEqual([
      GUILD_ID,
      secondGuildId,
    ]);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(95_000);
    expect(server.sim.guildBanks.get(secondGuildId)?.treasury).toBe(193_000);

    const rec = recordingIncidents();
    let growthRefusals = 0;
    setGameMetricsCounters({
      ...rec.sink,
      bankLedgerGrowthLimitRefused() {
        growthRefusals++;
      },
    });
    const refusal = new BankLedgerGrowthLimitExceeded(10_000_000, 2, 10_000_000);
    dbMock.saveCharacterAndGuildBankState.mockRejectedValueOnce(refusal);
    const kickSpy = vi.spyOn(priv(server), 'kickSession').mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(priv(server).saveCharacter(session)).rejects.toBe(refusal);
      await Promise.resolve();

      expect(growthRefusals).toBe(1);
      expect(rec.kinds).toEqual(['reconcile', 'reconcile']);
      expect(session.dirtyGuildBanks.size).toBe(0);
      expect(session.unflushedGuildBankOps.size).toBe(0);
      expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_000);
      expect(server.sim.guildBanks.get(secondGuildId)?.treasury).toBe(200_000);
    } finally {
      errorSpy.mockRestore();
      kickSpy.mockRestore();
    }
  });

  it('books NO escrow_save_failed when the failed save carried no guild book', async () => {
    // The decisive negative: an ordinary character save that throws is not a
    // guild bank incident, or the series would be noise.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Plain');
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterState.mockRejectedValueOnce(new Error('db down'));
    await expect(priv(server).saveCharacter(session)).rejects.toThrow('db down');
    expect(rec.kinds).toEqual([]);
  });

  it('counts save_fenced_out plus the reconcile it triggers on a fenced book save', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Fenced');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    const treasuryBefore = server.sim.guildBanks.get(GUILD_ID)?.treasury ?? -1;
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(treasuryBefore + 2_000);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    warnSpy.mockRestore();
    // Fence-out first, then one reconcile for the one carried guild. The
    // reconcile is the SURGICAL revert (the escrow root fix removed the
    // evict-and-reload arm entirely), so nothing is re-read from durable truth
    // and no book_unloaded can follow it.
    expect(rec.kinds).toEqual(['save_fenced_out', 'reconcile']);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(treasuryBefore);
  });

  it('books NO save_fenced_out when the fenced save carried no guild book', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'PlainFenced');
    session.leaseNonce = 'stale-nonce';
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterState.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    warnSpy.mockRestore();
    expect(rec.kinds).toEqual([]);
  });

  it('books NO reconcile when the fenced save carried a book it had not touched', async () => {
    // The reconcile counter is per GUILD WITH WORK TO UNDO. A session holding a
    // dirty mark whose unflushed log is already empty is bookkeeping, not an
    // incident, or the series would be noise on every ordinary fence-out.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'EmptyLog');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    session.dirtyGuildBanks.set(GUILD_ID, 1); // marked, but nothing logged
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    warnSpy.mockRestore();
    expect(rec.kinds).toEqual(['save_fenced_out']);
  });

  it('counts escrow_save_failed then escrow_quarantined when a refusal cannot resolve', async () => {
    // The terminal arm of the escrow design: the book half is refused, no other
    // session can ever make the missing value durable, so the session is rolled
    // back and quarantined. Both the failed save and the quarantine are
    // counted, and the quarantine is counted ONCE for the session while the
    // reverts it triggers are counted per guild.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Doomed');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 5_000 });
    expect(session.unflushedGuildBankOps.get(GUILD_ID)?.length).toBe(1);
    // Durable truth never held that copper (nobody else is dirty), so the
    // merge refuses and no retry can ever change that.
    durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    // escrow_save_failed is booked on this TERMINAL arm (the save really did
    // fail for good), not at the throw site, so a refusal that merely retries
    // never reaches it.
    expect(rec.kinds).toEqual(['escrow_save_failed', 'escrow_quarantined', 'reconcile']);
    expect(session.escrowQuarantined).toBe(true);
  });

  it('counts escrow_refused_retry, and NOT escrow_save_failed, on a retried refusal', async () => {
    // ORDINARY CONCURRENCY between two officers of one guild: the refusal
    // resolves as soon as the other session commits, nothing was consumed, and
    // the marks and log are exactly as they were. Sharing escrow_save_failed
    // made that counter useless for `> 0` alerting, which is the whole point of
    // the split, so this test's decisive assertion is the ABSENCE of
    // escrow_save_failed, not only the presence of the new kind.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Waiter');
    const { session: other } = joinServer(server, 2, 'Holder');
    officerSetup(server, session);
    moveToBanker(server, other.pid);
    server.sim.setPlayerGuildMembership(other.pid, { guildId: GUILD_ID, rank: 'officer' });
    const otherMeta = server.sim.players.get(other.pid);
    if (!otherMeta) throw new Error('missing meta');
    otherMeta.copper = 500_000;
    // The other officer deposits and does NOT flush: durable truth is behind
    // the live book by exactly their deposit.
    dispatch(server, other, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    expect(other.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    // This officer consumes value durable truth does not hold yet, so its own
    // escrow replay is refused until the other one commits.
    // The dispatch-time gate now refuses exactly this consume, so it is
    // dispatched with the other officer hidden from the gate to reach the
    // refusal arm.
    dispatchUnderGate(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 120_000 }, [
      other,
    ]);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    await priv(server).saveCharacter(session);
    expect(rec.kinds).toEqual(['escrow_refused_retry']);
    expect(rec.kinds).not.toContain('escrow_save_failed');
    // Nothing was consumed: the mark and the unflushed log survive for the retry.
    expect(session.escrowQuarantined).toBe(false);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    expect(session.unflushedGuildBankOps.get(GUILD_ID)?.length).toBe(1);
  });

  it('counts book_unloaded once per guild the BOOT load leaves unloaded', async () => {
    const server = new GameServer();
    dbMock.loadGuildBankRows.mockResolvedValueOnce([
      { guildId: 7, data: null, oversized: true }, // oversized
      { guildId: 8, data: 'not an object', oversized: false }, // malformed
      { guildId: 9, data: { treasury: 1, inventory: [], purchasedSlots: 24 }, oversized: false },
    ]);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await server.loadGuildBanks();
    errSpy.mockRestore();
    // Exactly the two skipped guilds; the healthy book books nothing.
    expect(rec.kinds).toEqual(['book_unloaded', 'book_unloaded']);
    expect(server.sim.guildBanks.has(9)).toBe(true);
  });

  it('quarantines and counts ledger_write_failed when post-mutation projection fails', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Ledger');
    officerSetup(server, session);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    vi.spyOn(session.bankLedgerJournal.outbox, 'commit').mockImplementationOnce(() => {
      throw new Error('projection rejected');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 }),
    ).toThrow('projection rejected');
    errSpy.mockRestore();
    expect(rec.kinds).toEqual(['ledger_write_failed', 'reconcile']);
    expect(session.escrowQuarantined).toBe(true);
    // The mutation cannot be saved without its exact evidence, so the live
    // shared book is restored before teardown can persist this character.
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_000);
  });

  it('books nothing at all on a healthy op + save (the vacuity guard)', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Healthy');
    officerSetup(server, session);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    await priv(server).saveCharacter(session);
    await bankLedgerIdle();
    expect(rec.kinds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The admin dormant-slot escape hatch (GameServer.adminPurgeGuildBankSlot).
// The v1 limitation it remedies: an item a later content change flags
// soulbound / noMarketList / transfer-locked is refused in BOTH directions, so
// it can never be withdrawn, guildBankHoldings stays non-zero forever, and the
// guild can never disband. These pin that the remedy rides the ONE observed
// mutation path (ledger row + unflushed delta + fenced escrow save), that its
// scope cannot reach an ordinary item, and that it actually unblocks a disband.
// ---------------------------------------------------------------------------

// A copy the pipe refuses in both directions, seated directly in the book the
// way a content change would leave one behind.
const DORMANT_SLOT = { itemId: 'wolf_fang', count: 2, instance: { boundTo: 424242 } };
// The same slot after it has ridden the material-source-aware load or
// delta/revert machinery at least once (normalizeMaterialStack /
// applyGuildBankDeltasTo's composition-aware merge): the unrecorded-gatherer
// bucket is now explicit. seatBook (loadGuildBank) stamps it on the way in;
// seatDormant's direct push does not, until a purge-then-revert cycle rebuilds
// the slot through the same composition algebra.
const NORMALIZED_DORMANT_SLOT = {
  ...DORMANT_SLOT,
  materialSources: [{ count: 2, source: {} }],
};

// Seat the copy in the LIVE book AND in durable truth, which is what a stranded
// dormant slot actually is: a row that has been durable since long before the
// content change that flagged it. Under the escrow design a purge persists as a
// REMOVAL replayed onto durable truth (applyGuildBankDeltasTo), so a copy that
// existed only in the live book would make every purge refuse for want of the
// item, which would pin the harness rather than the behaviour.
function seatDormant(server: GameServer, slot: Record<string, unknown> = DORMANT_SLOT): void {
  const live = server.sim.guildBanks.get(GUILD_ID);
  if (!live) throw new Error('missing book');
  live.inventory.push({ ...slot } as never);
  const durable = durableBooks.get(GUILD_ID) as { inventory?: unknown[] } | undefined;
  if (Array.isArray(durable?.inventory)) {
    durable.inventory.push(JSON.parse(JSON.stringify(slot)));
  }
}

/** Load one book into the live sim AND into durable truth, the way the boot
 *  load leaves them (the live book IS the row). For the carrier tests, which
 *  seat a book without officerSetup's banker/rank scaffolding. */
function seatBook(server: GameServer, state: GuildBankState): void {
  server.sim.loadGuildBank(GUILD_ID, JSON.parse(JSON.stringify(state)));
  durableBooks.set(GUILD_ID, JSON.parse(JSON.stringify(state)));
}

describe('adminPurgeGuildBankSlot (the operator escape hatch)', () => {
  const OPERATOR = 4242; // the acting admin account id

  it('purges through runGuildBankOp: ledger row, dirty mark, and the fenced escrow save', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server);
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    expect(result).toEqual({
      ok: true,
      removed: { itemId: 'wolf_fang', count: 2 },
      carrierCharacterId: session.characterId,
    });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([]);
    // The observed mutation path carried both the audit row and the
    // per-session delta through the same save transaction.
    const rows = guildSaveLedgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      op: 'admin_purge',
      container: 'guild',
      containerId: GUILD_ID,
      itemId: 'wolf_fang',
      count: 2,
      copperDelta: 0,
      // ATTRIBUTION: the acting OPERATOR's account, never the carrier's owner.
      accountId: OPERATOR,
      characterId: session.characterId,
    });
    // Evidence: the REAL instance payload, not the wire projection.
    expect(rows[0].instanceJson).toBe('{"boundTo":424242}');
    expect(session.unflushedGuildBankOps.get(GUILD_ID) ?? []).toEqual([]); // consumed by the save
    // It rode the SAME fenced escrow save (never a standalone book write), and
    // the call awaited it: the mark is already released when the call returns.
    expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalledTimes(1);
    const [, , , books] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as never[];
    // The payload is this session's own DELTA LOG (the escrow root fix), never
    // the shared live book, and the purge is in it as a removal carrying the
    // real instance payload: that is what makes it replayable onto durable
    // truth and revertible on a fence-out, exactly like a player withdraw.
    expect(books).toEqual([
      {
        guildId: GUILD_ID,
        deltas: [
          {
            op: 'admin_purge',
            itemId: 'wolf_fang',
            count: 2,
            instance: { boundTo: 424242 },
            craftedRecipeId: null,
            copperDelta: 0,
            purchasedSlotsBefore: 24,
            purchasedSlotsAfter: 24,
            // The exact per-source legs the differ read off the book, signed
            // negative for a removal (guild_bank_op_coordinator.ts).
            materialSources: [{ count: -2, source: {} }],
          },
        ],
      },
    ]);
    // And the replay actually landed: durable truth lost the copy too.
    expect(durableBook()).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
  });

  it('books the ledger row to the OPERATOR even when the carrier is a different account', async () => {
    // The bystander test: the carrier lends its escrow transaction and nothing
    // else. Its account must never be recorded as the actor.
    const server = new GameServer();
    const { session } = joinServer(server, 77, 'Carrier');
    officerSetup(server, session);
    seatDormant(server);
    await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    const row = guildSaveLedgerRows()[0];
    if (!row) throw new Error('missing transactional admin-purge row');
    expect(row.accountId).toBe(OPERATOR);
    expect(row.accountId).not.toBe(session.accountId);
  });

  it('REFUSES an ordinary withdrawable slot: no mutation, no ledger row, no mark', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server, { itemId: 'wolf_fang', count: 5 }); // plain, withdrawable
    expect(await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR)).toEqual({
      ok: false,
      reason: 'not_dormant',
    });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([
      { itemId: 'wolf_fang', count: 5 },
    ]);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    expect(session.dirtyGuildBanks.size).toBe(0);
  });

  it('REFUSES when the named item does not match the slot (the index-shift guard)', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server);
    expect(
      await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'final_argument_greatblade', OPERATOR),
    ).toEqual({
      ok: false,
      reason: 'not_dormant',
    });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1);
    expect(session.dirtyGuildBanks.size).toBe(0);
  });

  it('refuses an unloaded book and an out-of-range index without mutating anything', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server);
    expect(await server.adminPurgeGuildBankSlot(GUILD_ID + 1, 0, 'wolf_fang', OPERATOR)).toEqual({
      ok: false,
      reason: 'no_book',
    });
    // A non-positive / malformed guild id refuses on the same fail-closed arm,
    // which is what keeps the two dispatch arms equivalent on a degenerate id.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(
        await server.adminPurgeGuildBankSlot(bad, 0, 'wolf_fang', OPERATOR),
        String(bad),
      ).toEqual({ ok: false, reason: 'no_book' });
    }
    expect(await server.adminPurgeGuildBankSlot(GUILD_ID, 7, 'wolf_fang', OPERATOR)).toEqual({
      ok: false,
      reason: 'not_dormant',
    });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    expect(session.dirtyGuildBanks.size).toBe(0);
  });

  it('refuses with no carrier when nobody from the guild is online', async () => {
    // Books persist only inside a character's fenced escrow transaction, so a
    // purge with no session to ride would mutate a live book it could never
    // persist. Refuse instead. An UNRELATED online player is not a carrier.
    const server = new GameServer();
    joinServer(server, 1, 'Stranger'); // no guild membership stamped
    seatBook(server, { treasury: 0, inventory: [{ ...DORMANT_SLOT }], purchasedSlots: 24 });
    expect(await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR)).toEqual({
      ok: false,
      reason: 'no_carrier',
    });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
  });

  it.each([
    ['already leaving', (session: ClientSession) => (session.left = true)],
    ['quarantined', (session: ClientSession) => (session.escrowQuarantined = true)],
  ])('never selects an %s session as the purge carrier', async (_label, makeUnusable) => {
    const server = new GameServer();
    const session = joinServer(server, 1, 'Unavailable').session;
    stampMember(server, session, 'officer');
    seatBook(server, { treasury: 0, inventory: [{ ...DORMANT_SLOT }], purchasedSlots: 24 });
    makeUnusable(session);

    await expect(
      server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR),
    ).resolves.toEqual({ ok: false, reason: 'no_carrier' });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([NORMALIZED_DORMANT_SLOT]);
    expect(session.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
  });

  it('rechecks the exact carrier after the fresh roster read', async () => {
    const server = new GameServer();
    const session = joinServer(server, 1, 'LeavingDuringLookup').session;
    stampMember(server, session, 'officer');
    seatBook(server, { treasury: 0, inventory: [{ ...DORMANT_SLOT }], purchasedSlots: 24 });
    let releaseLookup!: () => void;
    vi.spyOn(priv(server).socialDb, 'guildMembersFresh').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseLookup = () => resolve([{ id: session.characterId, rank: 'officer' }]);
        }),
    );

    const purging = server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    await vi.waitFor(() => expect(releaseLookup).toBeTypeOf('function'));
    session.left = true;
    releaseLookup();

    await expect(purging).resolves.toEqual({ ok: false, reason: 'no_carrier' });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([NORMALIZED_DORMANT_SLOT]);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
  });

  it('prefers an officer-plus carrier over a plain member', async () => {
    const server = new GameServer();
    const member = joinServer(server, 1, 'Grunt').session;
    const officer = joinServer(server, 2, 'Boss').session;
    stampMember(server, member, 'member');
    stampMember(server, officer, 'officer');
    seatBook(server, { treasury: 0, inventory: [{ ...DORMANT_SLOT }], purchasedSlots: 24 });
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    expect(result.ok && result.carrierCharacterId).toBe(officer.characterId);
    // Neither session keeps a mark: the awaited save released the officer's.
    expect(officer.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
    expect(member.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
  });

  it('a member-only guild still gets a carrier (the fallback)', async () => {
    const server = new GameServer();
    const member = joinServer(server, 1, 'Grunt').session;
    stampMember(server, member, 'member');
    seatBook(server, { treasury: 0, inventory: [{ ...DORMANT_SLOT }], purchasedSlots: 24 });
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    expect(result.ok && result.carrierCharacterId).toBe(member.characterId);
  });

  it('reports save_failed when the escrow REFUSES the purge, and the copy comes back', async () => {
    // The other way a purge can fail to land under the escrow design, and the
    // one the fence-out arm does not cover: the merge replays the admin_purge
    // as a REMOVAL onto durable truth and finds nothing there to remove (the
    // copy is live-only), so the whole transaction rolls back, the carrier is
    // quarantined, and revertOwnGuildBookOps puts the copy back on the live
    // book. The operator must be told it did not land.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    // Live-only on purpose: seatDormant would seat durable truth too.
    const live = server.sim.guildBanks.get(GUILD_ID);
    if (!live) throw new Error('missing book');
    live.inventory.push({ ...DORMANT_SLOT } as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    errSpy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'save_failed' });
    // Reverted, not left removed: the admin_purge delta replays backward
    // exactly like a player withdraw would, through the same composition-aware
    // merge that stamps the unrecorded-gatherer bucket back on.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([NORMALIZED_DORMANT_SLOT]);
    // And the refusal rolled the CHARACTER half back with it, so the carrier is
    // quarantined and holds no leftover book work.
    expect(session.escrowQuarantined).toBe(true);
    expect(session.dirtyGuildBanks.size).toBe(0);
    expect(session.unflushedGuildBankOps.size).toBe(0);
    // Durable truth is untouched: nothing was written for a refused escrow.
    expect(durableBook()).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
  });

  it('confirms THIS copy is gone, not the item TOTAL (a concurrent withdraw cannot fake it)', async () => {
    // REGRESSION: the durability check compared the book's total item count
    // before and after, so a withdraw of an UNRELATED item inside the save
    // window lowered the total and made a REVERTED purge report success: the
    // one direction a destructive tool must never err in. The witness is now
    // the specific copy (item id, craft provenance, instance payload).
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    const live = server.sim.guildBanks.get(GUILD_ID);
    if (!live) throw new Error('missing book');
    // An ordinary stack beside the dormant copy, live-only so the purge's own
    // escrow save is REFUSED (the copy comes back) exactly as before.
    live.inventory.push({ itemId: 'wolf_fang', count: 5 } as never);
    live.inventory.push({ ...DORMANT_SLOT } as never);
    const dormantIndex = live.inventory.length - 1;
    // The concurrent unrelated withdraw: it lands while the save is out, so
    // the book's TOTAL falls even though the purged copy came back.
    dbMock.saveCharacterAndGuildBankState.mockImplementationOnce(async () => {
      const book = server.sim.guildBanks.get(GUILD_ID);
      if (book) book.inventory = book.inventory.filter((s) => s.itemId !== 'wolf_fang');
      return false; // fenced out: the purge is reverted
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(
      GUILD_ID,
      dormantIndex,
      DORMANT_SLOT.itemId,
      OPERATOR,
    );
    errSpy.mockRestore();
    warnSpy.mockRestore();
    // The copy is back on the book, so the honest answer is save_failed even
    // though the book now holds FEWER items than it did before the purge.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toContainEqual(NORMALIZED_DORMANT_SLOT);
    expect(result).toEqual({ ok: false, reason: 'save_failed' });
  });

  it('a carrier is never charged for the purge it carries', async () => {
    // The carrier only lends its escrow transaction: pin that its own purse and
    // bags are untouched (the row names the operator, pinned separately).
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server);
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    const purse = meta.copper;
    const bags = JSON.stringify(meta.inventory);
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    expect(result.ok).toBe(true);
    expect(meta.copper).toBe(purse);
    expect(JSON.stringify(meta.inventory)).toBe(bags);
  });

  it('will NOT carry on a stale stamp: an ex-member is not put on the kick path', async () => {
    // REGRESSION (the review's carrier finding): the carrier used to be chosen
    // off the SESSION stamp, on the reasoning that a stale one is harmless
    // because a carrier only lends its transaction. That holds until the arm
    // that matters: a REFUSED escrow QUARANTINES and DISCONNECTS the carrier,
    // so a stamp lagging a kick would roll back and kick a player who is no
    // longer in the guild, for an operator's act. Membership is now a fresh
    // durable read.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'ExMember');
    moveToBanker(server, session.pid);
    stampMember(server, session, 'officer', { durable: false }); // kicked since login
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    seatDormant(server);

    expect(await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR)).toEqual({
      ok: false,
      reason: 'no_carrier',
    });
    // Refused means REFUSED: nothing mutated, nothing marked, nothing logged.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1);
    expect(session.dirtyGuildBanks.size).toBe(0);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();

    // Positive control: the SAME session carries once the durable row exists,
    // so the refusal above is the membership read and not the scaffolding.
    dbGuildMembers.set(GUILD_ID, [{ id: session.characterId, rank: 'officer' }]);
    const ok = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    expect(ok.ok && ok.carrierCharacterId).toBe(session.characterId);
  });

  it('refuses (never falls back to the stamp) when the membership read fails', async () => {
    // Fail closed: an unavailable database must not silently reopen the stale
    // carrier path the fresh read exists to close.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Officer');
    officerSetup(server, session);
    seatDormant(server);
    const poolMock = vi.mocked((await import('../server/db')).pool.query);
    poolMock.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    errSpy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'no_carrier' });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1);
  });

  it('reports save_failed (never a bare success) when the escrow save throws', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Thrower');
    officerSetup(server, session);
    seatDormant(server);
    dbMock.saveCharacterAndGuildBankState.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    errSpy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'save_failed' });
    // The live book is still purged and the mark survives, so a later save
    // converges; the operator is simply not told it is done.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([]);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
  });

  it('reports save_failed when a fence-out REVERTS the purge (the copy comes back)', async () => {
    // The optimism trap the awaited durability check exists to close: the purge
    // rides the same unflushed-delta log, so a save that never lands puts the
    // copy back. The operator must not be told the slot is cleared.
    const server = new GameServer();
    const a = joinServer(server, 1, 'FencedA').session;
    const b = joinServer(server, 2, 'DirtyB').session;
    officerSetup(server, a);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 50_000;
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 }); // B stays dirty
    expect(b.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    seatDormant(server);
    a.leaseNonce = 'stale-nonce';
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR);
    warnSpy.mockRestore();
    errSpy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'save_failed' });
    // Surgically restored, with B's legitimate op intact and no reload.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([NORMALIZED_DORMANT_SLOT]);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_000);
  });

  it('end to end: purging the last dormant slot lets a blocked disband proceed', async () => {
    // The whole point. Before: the book holds an unwithdrawable copy, the
    // withdraw refuses it, and the disband guard reads non-empty forever.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Leader');
    officerSetup(server, session, 0);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'leader' });
    seatDormant(server);
    dispatch(server, session, { cmd: 'guild_bank_withdraw', slot: 0 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toHaveLength(1); // refused
    // The fail-closed disband-guard read (server/social.ts calls it through
    // beginGuildBankDelete): non-empty, so the disband refuses.
    expect(server.sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 1 });

    expect((await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', OPERATOR)).ok).toBe(
      true,
    );
    // The awaited escrow save already committed, so the fail-closed disband
    // guard is open the moment the call returns.
    expect(server.sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    // And the window the disband actually takes now opens for it.
    expect(priv(server).social.tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    priv(server).social.tx.endGuildBankDelete(GUILD_ID);
  });
});
