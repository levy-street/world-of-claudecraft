// Guild Bank Phase 3, the wiring half: the boot load into a REAL Sim (empty
// book on no row, oversized skip, the parsed-object pin), the round trip, the
// dispatch observer (ledger row + dirty mark on success, neither on refusal),
// the escrow save arm of GameServer.saveCharacter (null-serialize skip,
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
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
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
  loadGuildBankRows: dbMock.loadGuildBankRows,
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // The fence-miss arm kicks the displaced session; leave() releases its lease.
  releaseCharacterLease: vi.fn(async () => {}),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
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
import {
  type GameMetricsCounters,
  type GuildBankIncident,
  noopGameMetricsCounters,
  setGameMetricsCounters,
} from '../server/http/game_signals';
import {
  applyGuildBankDeltasTo,
  GUILD_CREATION_FEE_COPPER,
  type GuildBankOpDelta,
  type GuildBankState,
} from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
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

beforeEach(() => {
  dbMock.saveCharacterState.mockClear();
  dbMock.saveCharacterAndGuildBankState.mockClear();
  dbMock.saveCharacterAndMarketState.mockClear();
  dbMock.insertBankLedgerRow.mockClear();
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
    expect(sim.guildBanks.get(7)).toEqual(book);
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
  it('a successful op writes exactly one guild row and marks the book dirty', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Off');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_500 });
    expect([...session.dirtyGuildBanks.keys()]).toEqual([GUILD_ID]);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(1);
    expect((dbMock.insertBankLedgerRow.mock.calls[0] as unknown[])[0]).toMatchObject({
      characterId: 1,
      op: 'deposit_gold',
      copperDelta: 1_500,
      purchasedSlotsAfter: 24,
      container: 'guild',
      containerId: GUILD_ID,
    });
  });

  it('opening the bank (rung 0) writes an open_bank row: purse charged, treasury untouched', async () => {
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
        copperDelta: -90_000,
        // ABSOLUTE, never relative: "this op moved the ladder 0 -> 24". A
        // relative "+24" replayed onto a base that already opened would grant
        // the rung twice.
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 24,
      },
    ]);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(1);
    expect((dbMock.insertBankLedgerRow.mock.calls[0] as unknown[])[0]).toMatchObject({
      characterId: 1,
      op: 'open_bank',
      copperDelta: -90_000,
      purchasedSlotsAfter: 24,
      container: 'guild',
      containerId: GUILD_ID,
    });
    // A later expansion still records plain buy_slots from the treasury.
    dbMock.insertBankLedgerRow.mockClear();
    meta.copper = 100_000; // refill the purse for the treasury top-up deposit
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 30_000 });
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    await bankLedgerIdle();
    const ops = dbMock.insertBankLedgerRow.mock.calls.map(
      (c) => (c as unknown[])[0] as { op: string; copperDelta: number },
    );
    expect(ops.map((o) => o.op)).toEqual(['deposit_gold', 'buy_slots']);
    expect(ops[1].copperDelta).toBe(-25_000); // rung 1, treasury-paid
  });

  it('a tampered below-base count still records open_bank (the rung derivation matches the sim)', async () => {
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
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(1);
    expect((dbMock.insertBankLedgerRow.mock.calls[0] as unknown[])[0]).toMatchObject({
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

  it('a null serializeGuildBank SKIPS that book (never an empty book over a real row)', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Skipper');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    // The book vanishes before the save flushes (the evict-then-reload shape):
    // serialize now returns null and the write for that guild must be skipped.
    server.sim.evictGuildBank(GUILD_ID);
    await priv(server).saveCharacter(session);
    expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalledTimes(1);
    const [, , , books] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as never[];
    expect(books).toEqual([]);
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

  it('caps a ledger-write flood at the bucket and refills over time', async () => {
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
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(10);
    // Two tokens per second of refill: five seconds later the next op runs.
    // The awaited ledger idle let the join-time social snapshot resolve
    // against the EMPTY mocked social DB, which re-stamped membership null
    // (correct server behavior; not under test here): re-stamp the officer.
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
    dispatchAt(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1 }, t0 + 5_000);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(100_011);
  });
});

describe('the unflushed-op log cap (bounded memory under a failing DB)', () => {
  it('COMPACTS the log at the cap, semantics-preserving, and never drops it', () => {
    // RETIRED (and replaced): this used to pin "the cap drops the log and the
    // reconcile falls back to evict-and-reload from durable truth". Under the
    // escrow root fix the log IS the write payload, so dropping it would
    // discard committed-intent work, and there is no evict-and-reload arm to
    // fall back to: the old pin's precondition is unconstructible. Its SOUND
    // half (a partial log must never be trusted) survives here, strengthened
    // from a prohibition into a positive obligation: the compacted log must
    // replay to exactly the same book as the original.
    // biome-ignore lint/suspicious/noExplicitAny: reading a private static pin
    expect((GameServer as any).GUILD_BANK_UNFLUSHED_OP_CAP).toBe(500);
    const server = new GameServer();
    const a = joinServer(server, 1, 'Overflow').session;
    officerSetup(server, a);
    // Fill A's log past the cap with a realistic mixture (gold both ways, an
    // item in and out, and a ladder step), then one more op trips it.
    const synthetic: GuildBankOpDelta[] = [];
    for (let i = 0; i < 500; i++) {
      const base = {
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      };
      if (i % 4 === 0) synthetic.push({ ...base, op: 'deposit_gold', copperDelta: 7 });
      else if (i % 4 === 1) synthetic.push({ ...base, op: 'withdraw_gold', copperDelta: -3 });
      else if (i % 4 === 2) {
        synthetic.push({ ...base, op: 'deposit', itemId: 'wolf_fang', count: 2, copperDelta: 0 });
      } else {
        synthetic.push({ ...base, op: 'withdraw', itemId: 'wolf_fang', count: 1, copperDelta: 0 });
      }
    }
    const original = synthetic.map((d) => ({ ...d }));
    a.unflushedGuildBankOps.set(GUILD_ID, [...synthetic]);
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    const compacted = a.unflushedGuildBankOps.get(GUILD_ID) ?? [];

    // 1. Memory is bounded: the whole run collapses to a handful of entries.
    expect(compacted.length).toBeGreaterThan(0);
    expect(compacted.length).toBeLessThan(10);
    // 2. NOTHING was dropped: replaying the compacted log and replaying the
    //    original leave a durable book in exactly the same state. This is the
    //    positive obligation the retired pin's "must not trust a partial log"
    //    rule becomes.
    const withOp = [
      ...original,
      {
        op: 'deposit_gold' as const,
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 500,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
      },
    ];
    const base = (): GuildBankState => ({
      treasury: 100_000,
      inventory: [{ itemId: 'wolf_fang', count: 3 }],
      purchasedSlots: 24,
    });
    const fromOriginal = base();
    const fromCompacted = base();
    expect(applyGuildBankDeltasTo(fromOriginal, withOp)).toBeNull();
    expect(applyGuildBankDeltasTo(fromCompacted, compacted)).toBeNull();
    expect(fromCompacted.treasury).toBe(fromOriginal.treasury);
    expect(fromCompacted.purchasedSlots).toBe(fromOriginal.purchasedSlots);
    const multiset = (b: GuildBankState) => {
      const m = new Map<string, number>();
      for (const slot of b.inventory) m.set(slot.itemId, (m.get(slot.itemId) ?? 0) + slot.count);
      return [...m.entries()].sort();
    };
    expect(multiset(fromCompacted)).toEqual(multiset(fromOriginal));
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

  it('a short charge at the gate refuses and refunds; never a discounted guild', () => {
    // The purse check and the charge run in the same synchronous block, but a
    // pid can resolve meta-only (no live entity) and charge 0: the gate must
    // refuse rather than reserve a short amount and found a free guild.
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'ShortCharge');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    vi.spyOn(server.sim, 'chargeGuildCreationFeeFor').mockReturnValueOnce(0);
    const createSpy = vi.fn(async () => true);
    priv(server).social.guildCreate = createSpy;
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    expect(createSpy).not.toHaveBeenCalled();
    expect(priv(server).pendingGuildCreateFees.size).toBe(0);
    const events = sent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]);
    expect(events).toContainEqual({
      type: 'error',
      text: 'You need 1 gold to found a guild.',
    });
  });

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

  it('a successful create charges at the GATE, seeds the book, writes create_fee, saves', async () => {
    // Reserve-at-gate (Phase 3 QA): the fee leaves the purse synchronously at
    // dispatch, BEFORE any DB work; the committed success arm consumes the
    // reservation (ledger row + escrow save) and never charges again.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Founder');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    // Stub the create as its committed success arm firing the transport hook.
    priv(server).social.guildCreate = vi.fn(async () => {
      priv(server).social.tx.onGuildCreated(1, GUILD_ID);
      return true;
    });
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    // Charged exactly once, at the gate, synchronously.
    expect(meta.copper).toBe(140_000);
    // The seed: ops never lazily create a book, so without this the founder's
    // bank would be silent-inert until a realm restart.
    await vi.waitFor(() => {
      expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
        treasury: 0,
        inventory: [],
        purchasedSlots: 0,
      });
    });
    // The fee save carries the charged purse and the seeded empty book
    // together, and the create_fee row is written only AFTER it commits (the
    // durability ordering: a row written first would book a payment that a
    // fenced-out save never made).
    await vi.waitFor(() => {
      expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalled();
    });
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(1);
    expect((dbMock.insertBankLedgerRow.mock.calls[0] as unknown[])[0]).toMatchObject({
      op: 'create_fee',
      characterId: 1,
      copperDelta: -GUILD_CREATION_FEE_COPPER,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: GUILD_ID,
    });
    // The seeded book carries no deltas, so what lands is the empty book the
    // seed represents (which is also what a guild with no row loads at boot).
    expect(durableBook()).toEqual({ treasury: 0, inventory: [], purchasedSlots: 0 });
    // No stray refund: the purse stays exactly one fee lighter.
    expect(meta.copper).toBe(140_000);
  });

  it('books NO create_fee (and counts the incident) when the fee save is fenced out', async () => {
    // REGRESSION (create-then-never-persist-charge): the fee is deducted from
    // the LIVE purse at the gate and reaches the database only through this
    // session's character half. That save used to be fire-and-forget, so a
    // fence-out (a same-account takeover discards the session's state) left
    // the guild created, the durable purse untouched, and a create_fee row
    // standing as if it had been paid: a free guild, booked as sold.
    // revertOwnGuildBookOps cannot help, because the fee is not a BOOK delta.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Founder');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    const durableBefore = { ...(durableChars.get(session.characterId) ?? {}) };
    priv(server).social.guildCreate = vi.fn(async () => {
      priv(server).social.tx.onGuildCreated(1, GUILD_ID);
      return true;
    });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    // The takeover fence: the write reports it did not land.
    dbMock.saveCharacterAndGuildBankState.mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    await vi.waitFor(() => expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalled());
    await bankLedgerIdle();
    await vi.waitFor(() => expect(rec.kinds).toContain('create_fee_unpaid'));
    warnSpy.mockRestore();
    errSpy.mockRestore();

    // The audit does not claim a payment that never landed...
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled();
    // ...the durable character row was never advanced by this save...
    expect(durableChars.get(session.characterId) ?? {}).toEqual(durableBefore);
    // ...and the failure is machine-readable, not just a log line.
    expect(rec.kinds).toContain('create_fee_unpaid');
    dbMock.saveCharacterAndGuildBankState.mockReset();
  });

  it('a refused create REFUNDS the reserved fee exactly once, on every refusal arm', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Refused');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    for (const failure of [
      async () => false, // name taken / already in a guild: the refusal arm
      async () => {
        throw new Error('db down'); // the error arm refunds too
      },
    ]) {
      meta.copper = 150_000;
      priv(server).social.guildCreate = vi.fn(failure);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
      // Reserved synchronously at the gate...
      expect(meta.copper).toBe(140_000);
      // ...and returned when the create reports failure.
      await vi.waitFor(() => {
        expect(meta.copper).toBe(150_000);
      });
      errSpy.mockRestore();
      // The reservation is consumed: nothing left to double-refund.
      expect(priv(server).pendingGuildCreateFees.size).toBe(0);
      await bankLedgerIdle();
      expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled(); // no create_fee row
    }
  });

  it('a pipelined spend can no longer dodge the fee (reserve-at-gate)', async () => {
    // The old create-then-charge exploit: dispatch guild_create, then spend
    // the purse before the deferred charge lands, founding the guild for
    // residue. Now the fee is gone from the purse before the create's DB work
    // even starts, so there is nothing left to spend out from under it.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Piper');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = GUILD_CREATION_FEE_COPPER; // exactly the fee
    let resolveCreate: ((v: boolean) => void) | undefined;
    priv(server).social.guildCreate = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          // Mirror the real contract: guildCreate returns true only AFTER the
          // committed success arm fired onGuildCreated (which consumes the
          // fee reservation).
          resolveCreate = (v: boolean) => {
            if (v) priv(server).social.tx.onGuildCreated(1, GUILD_ID);
            resolve(v);
          };
        }),
    );
    dispatch(server, session, { cmd: 'guild_create', name: 'Iron Vanguard' });
    // The purse is already empty while the create is in flight: any pipelined
    // spend now fails for lack of copper instead of eating the fee.
    expect(meta.copper).toBe(0);
    // A pipelined SECOND create is dropped outright (one reservation per
    // character), never double-charged.
    dispatch(server, session, { cmd: 'guild_create', name: 'Second Banner' });
    expect(priv(server).social.guildCreate).toHaveBeenCalledTimes(1);
    resolveCreate?.(true);
    await vi.waitFor(() => {
      expect(priv(server).pendingGuildCreateFees.size).toBe(0);
    });
    expect(meta.copper).toBe(0); // the fee stayed paid
  });

  it('onGuildCreated for a vanished founder still seeds the book; the gate fee stands', async () => {
    // The founder paid at the gate, so vanishing before the commit no longer
    // yields a free guild: their leave flush persists the charged purse, and
    // the success arm still writes the create_fee row from the reservation.
    const server = new GameServer();
    joinServer(server, 1, 'Bystander');
    priv(server).social.tx.onGuildCreated(999999, GUILD_ID);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true); // boot parity for the restart
    await bankLedgerIdle();
    // No reservation existed here (the hook fired without a gate charge), so
    // no ledger row: the row always mirrors an actual reservation.
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

  // Two officers alternating LADDER rungs is the only shape that can deadlock
  // both replays at once: gold and items cannot, because the live book never
  // goes below zero, so at least one session's net is non-negative and lands
  // (and the flush a refusal fires then unblocks the other). A rung, by
  // contrast, replays only onto the exact position its witness names, so
  // officer A's rung waits on officer B's opening while officer B's next rung
  // waits on officer A's.
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
    dispatch(server, a, { cmd: 'guild_bank_buy_slots' }); // A buys rung 1, 24 -> 30
    stampBoth();
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    dispatch(server, b, { cmd: 'guild_bank_buy_slots' }); // B buys rung 2, 30 -> 36
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
    dispatch(server, a, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 });
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
    const a = joinServer(server, 1, 'RacerA').session;
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
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 120_000 });
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

  it('counts ledger_write_failed when a guild bank_ledger insert rejects', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Ledger');
    officerSetup(server, session);
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.insertBankLedgerRow.mockRejectedValueOnce(new Error('insert rejected'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    await bankLedgerIdle();
    errSpy.mockRestore();
    expect(rec.kinds).toEqual(['ledger_write_failed']);
    // The op itself still landed: the observer never faults the dispatch path.
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_000);
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
    // The observed mutation path did its two jobs: the audit row and the
    // per-session unflushed delta the fence-out revert depends on.
    await bankLedgerIdle();
    const rows = (
      dbMock.insertBankLedgerRow.mock.calls as unknown as Record<string, unknown>[][]
    ).map((c) => c[0]);
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
    expect(rows[0].instance).toEqual({ boundTo: 424242 });
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
    await bankLedgerIdle();
    const row = (
      dbMock.insertBankLedgerRow.mock.calls as unknown as Record<string, unknown>[][]
    )[0][0];
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
    expect(await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'reins_grag_bear', OPERATOR)).toEqual({
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
    // exactly like a player withdraw would.
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([DORMANT_SLOT]);
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
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toContainEqual(DORMANT_SLOT);
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
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([DORMANT_SLOT]);
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
