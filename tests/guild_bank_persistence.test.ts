// Guild Bank Phase 3, the wiring half: the boot load into a REAL Sim (empty
// book on no row, oversized skip, the parsed-object pin), the round trip, the
// dispatch observer (ledger row + dirty mark on success, neither on refusal),
// the escrow save arm of GameServer.saveCharacter (null-serialize skip,
// fence-miss keeps the dirty mark), the guild_create fee gate, and the
// create/disband transport hooks. Drives the REAL GameServer + Sim with the db
// layer mocked (the guild_stamp_fence idiom).
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
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
  type GuildBankSave,
  type GuildBankWriteResult,
  loadGuildBanksIntoSim,
  mergeGuildBankRow,
} from '../server/guild_bank_state';
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

function commitBooks(
  books: readonly GuildBankSave[] | undefined,
  results: GuildBankWriteResult[] | undefined,
): void {
  for (const gb of books ?? []) {
    const merged = mergeGuildBankRow(durableBooks.get(gb.guildId) ?? null, gb.deltas, {
      oversized: oversizedGuilds.has(gb.guildId),
    });
    if (merged.data !== null) {
      durableBooks.set(gb.guildId, JSON.parse(JSON.stringify(merged.data)));
    }
    results?.push({ guildId: gb.guildId, ...merged.result });
  }
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
function officerSetup(server: GameServer, session: ClientSession, treasury = 100_000): void {
  moveToBanker(server, session.pid);
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
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
      durableChars.set(_characterId, JSON.parse(JSON.stringify(_state)));
      commitBooks(books, results);
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

  it('an oversized/malformed durable row is PRESERVED: the save skips it, the book stays live', async () => {
    // The boot skip rule, carried into the write path: an oversized or
    // structurally-not-a-book row is never overwritten, and retrying cannot
    // help, so the mark is released and the row is left for a human. The LIVE
    // book stays loaded (ops keep working); only the row is untouchable.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'BadRow');
    officerSetup(server, session);
    oversizedGuilds.add(GUILD_ID);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    expect(durableBook()).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(102_000);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
    expect(session.unflushedGuildBankOps.has(GUILD_ID)).toBe(false);
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
    expect(applyGuildBankDeltasTo(fromOriginal, withOp).deficit).toBeNull();
    expect(applyGuildBankDeltasTo(fromCompacted, compacted).deficit).toBeNull();
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
    expect(merged.result).toEqual({
      written: true,
      applied: 1,
      residual: null,
      deficit: null,
      rowUnusable: false,
    });
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
    expect(merged.result.residual).toBeNull();
    expect(merged.result.deficit).toEqual({
      kind: 'treasury_underflow',
      op: 'withdraw_gold',
      itemId: null,
      shortfall: 250,
    });
  });

  it('a PARTIAL shortfall writes what durable truth covered and carries the rest', () => {
    // The alternative (clamping the shortfall away) mints it permanently: the
    // consuming character's purse durably gains what the book never durably
    // lost. Carrying it means the next save settles it against the other
    // officer's committed deposit instead.
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
    expect(merged.data).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
    expect(merged.result.applied).toBe(0);
    expect(merged.result.residual).toEqual({ ...withdraw, copperDelta: -600 });
    expect(merged.result.deficit?.shortfall).toBe(600);
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
    expect(merged.result).toEqual({
      written: true,
      applied: 2,
      residual: null,
      deficit: null,
      rowUnusable: false,
    });
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
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
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
    // The fee save was scheduled (fire-and-forget): the escrow sibling carries
    // the charged purse and the seeded empty book together.
    await vi.waitFor(() => {
      expect(dbMock.saveCharacterAndGuildBankState).toHaveBeenCalled();
    });
    // The seeded book carries NO deltas, so the escrow save writes no
    // guild_banks row at all. That is the correct outcome and not a
    // regression: the boot read LEFT JOINs guilds, so a guild with no row
    // loads exactly the empty book this seed represents, and the first real op
    // creates the row through the upsert.
    expect(durableBook()).toBeUndefined();
    // No stray refund: the purse stays exactly one fee lighter.
    expect(meta.copper).toBe(140_000);
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

  it('guildBankHoldings on the transport reads the live book (null when unloaded)', () => {
    const server = new GameServer();
    joinServer(server, 1, 'Reader');
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toBeNull();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 42, inventory: [], purchasedSlots: 0 });
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toEqual({ copper: 42, items: 0 });
  });

  it('guildBankHoldings fails CLOSED while any session holds an unflushed mark', async () => {
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
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toBeNull();
    // The escrow save commits: the guard opens (self-heals within one save).
    await priv(server).saveCharacter(session);
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
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
