// Guild Bank Phase 3, the wiring half: the boot load into a REAL Sim (empty
// book on no row, oversized skip, the parsed-object pin), the round trip, the
// dispatch observer (ledger row + dirty mark on success, neither on refusal),
// the escrow save arm of GameServer.saveCharacter (null-serialize skip,
// fence-miss keeps the dirty mark), the guild_create fee gate, and the
// create/disband transport hooks. Drives the REAL GameServer + Sim with the db
// layer mocked (the guild_stamp_fence idiom).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
  loadGuildBankRow: vi.fn(
    async (guildId: number): Promise<{ guildId: number; data: unknown; oversized: boolean }> => ({
      guildId,
      data: null,
      oversized: false,
    }),
  ),
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  saveCharacterState: dbMock.saveCharacterState,
  saveCharacterAndGuildBankState: dbMock.saveCharacterAndGuildBankState,
  saveCharacterAndMarketState: dbMock.saveCharacterAndMarketState,
  insertBankLedgerRow: dbMock.insertBankLedgerRow,
  loadGuildBankRows: dbMock.loadGuildBankRows,
  loadGuildBankRow: dbMock.loadGuildBankRow,
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
import { collectGuildBankSaves, loadGuildBanksIntoSim } from '../server/guild_bank_state';
import {
  type GameMetricsCounters,
  type GuildBankIncident,
  noopGameMetricsCounters,
  setGameMetricsCounters,
} from '../server/http/game_signals';
import { GUILD_CREATION_FEE_COPPER, type GuildBankState } from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const GUILD_ID = 913;
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];

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
  dbMock.loadGuildBankRow.mockClear();
  dbMock.saveCharacterState.mockResolvedValue(true);
  dbMock.saveCharacterAndGuildBankState.mockResolvedValue(true);
  dbMock.saveCharacterAndMarketState.mockResolvedValue(true);
  dbMock.loadGuildBankRows.mockResolvedValue([]);
  dbMock.loadGuildBankRow.mockImplementation(async (guildId: number) => ({
    guildId,
    data: null,
    oversized: false,
  }));
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
    });
    expect(session.unflushedGuildBankOps.get(GUILD_ID)?.[0]?.op).toBe('open_bank');
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
    expect(books).toEqual([
      { guildId: GUILD_ID, data: { treasury: 102_000, inventory: [], purchasedSlots: 24 } },
    ]);
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

  it('a fence-miss (false) reconciles the live book back to DURABLE truth', async () => {
    // The displaced session's op mutated the live book, but its character
    // half rolled back: without the reconcile the sim stays AHEAD of durable
    // state and another officer's save would persist the book half alone (a
    // reproducible dupe). No other session is dirty here, so the book must be
    // evicted and reloaded from the DB row.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Fenced');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(102_000); // live, ahead
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: durable,
      oversized: false,
    });
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(session);
    // Live state returned to durable truth; the doomed session's mark cleared.
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(false);
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
    // No evict-and-reload (that would destroy B's unflushed op)...
    expect(dbMock.loadGuildBankRow).not.toHaveBeenCalled();
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
    const [savedCharId, , , books] = call;
    expect(savedCharId).toBe(2);
    expect(books).toEqual([
      { guildId: GUILD_ID, data: { treasury: 101_000, inventory: [], purchasedSlots: 24 } },
    ]);
  });

  it('a mid-leave session still counts as dirty for the reconcile scan', async () => {
    // leave() removes a session from clients BEFORE its flush commits; the
    // reconcile scan must still see its marks (sessionsByCharacterId), or a
    // fence-out would evict-and-reload durable truth out from under the
    // mid-leave flush and the later commit would land a stale-shadowed book.
    const server = new GameServer();
    const a = joinServer(server, 1, 'FencedA').session;
    const b = joinServer(server, 2, 'MidLeaveB').session;
    officerSetup(server, a);
    moveToBanker(server, b.pid);
    server.sim.setPlayerGuildMembership(b.pid, { guildId: GUILD_ID, rank: 'officer' });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    bMeta.copper = 50_000;
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    // Simulate B mid-leave: out of clients, flush not yet committed.
    priv(server).clients.delete(b.pid);
    a.leaseNonce = 'stale-nonce';
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(a);
    // The revert arm ran (B's mark visible): no reload, B's op intact.
    expect(dbMock.loadGuildBankRow).not.toHaveBeenCalled();
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(101_000);
  });

  it('a fence-miss with an oversized/malformed durable row leaves the book unloaded', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'FencedBad');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: null,
      oversized: true,
    });
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    // Inert (absent) is the fail-safe state: never an ahead book, never an
    // empty book loaded over the preserved oversized row.
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
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
    expect(call[6]).toEqual([
      { guildId: GUILD_ID, data: { treasury: 102_000, inventory: [], purchasedSlots: 24 } },
    ]);
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
    const [, , state, books] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as unknown as [
      number,
      number,
      { inventory: { itemId: string }[] },
      { guildId: number; data: { inventory: { itemId: string }[] } }[],
    ];
    const inBags = state.inventory.some((s) => s.itemId === 'wolf_fang');
    const inBook = books[0]?.data.inventory.some((s) => s.itemId === 'wolf_fang') ?? false;
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
  it('pins the cap and falls back to evict-and-reload once the surgical revert is lost', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: reading a private static pin
    expect((GameServer as any).GUILD_BANK_UNFLUSHED_OP_CAP).toBe(500);
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
    // Fill A's log to the cap, then one more op overflows it: the log empties
    // and the surgical revert is marked lost for that guild.
    const synthetic = Array.from({ length: 500 }, () => ({
      op: 'deposit_gold' as const,
      itemId: null,
      count: null,
      instance: null,
      copperDelta: 1,
    }));
    a.unflushedGuildBankOps.set(GUILD_ID, [...synthetic]);
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    expect(a.unflushedGuildBankOps.get(GUILD_ID) ?? []).toEqual([]);
    expect(a.revertLostGuildBanks.has(GUILD_ID)).toBe(true);
    // A fences out while B is dirty: with the revert lost, the reconcile must
    // NOT skip (that resurrects the dupe) and must NOT trust a partial log;
    // it falls back to evict-and-reload from durable truth.
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: durable,
      oversized: false,
    });
    a.leaseNonce = 'stale-nonce';
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(a);
    expect(dbMock.loadGuildBankRow).toHaveBeenCalledTimes(1);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
    expect(a.revertLostGuildBanks.has(GUILD_ID)).toBe(false);
  });
});

describe('collectGuildBankSaves (the null-serialize skip, unit)', () => {
  it('skips null serializations and keeps real books', () => {
    const books = new Map<number, GuildBankState>([
      [7, { treasury: 5, inventory: [], purchasedSlots: 0 }],
    ]);
    expect(collectGuildBankSaves((gid) => books.get(gid) ?? null, [7, 8])).toEqual([
      { guildId: 7, data: { treasury: 5, inventory: [], purchasedSlots: 0 } },
    ]);
  });

  it('emits saves in ascending guild-id order (the global row-lock order)', () => {
    // Two escrow transactions carrying overlapping book sets must lock
    // guild_banks rows in one global order or they can deadlock.
    const book = { treasury: 1, inventory: [], purchasedSlots: 0 };
    const saves = collectGuildBankSaves(() => book, [9, 3, 7]);
    expect(saves.map((s) => s.guildId)).toEqual([3, 7, 9]);
  });
});

describe('the reconcile read retry (one failed logout must not disable a bank)', () => {
  it('retries a transient loadGuildBankRow failure and reloads on a later attempt', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Retry');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    dbMock.loadGuildBankRow
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ guildId: GUILD_ID, data: durable, oversized: false });
    session.leaseNonce = 'stale-nonce';
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    expect(dbMock.loadGuildBankRow).toHaveBeenCalledTimes(2);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
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
    const [, , , books] = dbMock.saveCharacterAndGuildBankState.mock.calls[0] as never[];
    expect(books).toEqual([
      { guildId: GUILD_ID, data: { treasury: 0, inventory: [], purchasedSlots: 0 } },
    ]);
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

  it('an exhausted leave flush reconciles the books it could never commit', async () => {
    // The leave save retries then gives up; the session tears down, so its
    // live-book mutations can never converge to durable truth and the guard
    // loses sight of them. The give-up arm reconciles: with no other dirty
    // session, evict and reload the durable row.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'GoneWrong');
    officerSetup(server, session);
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 40_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(60_000);
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: durable,
      oversized: false,
    });
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
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: durable,
      oversized: false,
    });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(session);
    // Fence-out first, then one reconcile for the one carried guild; the book
    // reloaded cleanly, so no book_unloaded.
    expect(rec.kinds).toEqual(['save_fenced_out', 'reconcile']);
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
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

  it('counts book_unloaded when the reconcile reload finds an oversized row', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'FencedBad');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dbMock.loadGuildBankRow.mockResolvedValueOnce({
      guildId: GUILD_ID,
      data: null,
      oversized: true,
    });
    const rec = recordingIncidents();
    setGameMetricsCounters(rec.sink);
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(session);
    errSpy.mockRestore();
    expect(rec.kinds).toEqual(['save_fenced_out', 'reconcile', 'book_unloaded']);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false); // inert, the fail-safe
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
