// Guild Bank Phase 3, the wiring half: the boot load into a REAL Sim (empty
// book on no row, oversized skip, the parsed-object pin), the round trip, the
// dispatch observer (ledger row + dirty mark on success, neither on refusal),
// the escrow save arm of GameServer.saveCharacter (null-serialize skip,
// fence-miss keeps the dirty mark), the guild_create fee gate, and the
// create/disband transport hooks. Drives the REAL GameServer + Sim with the db
// layer mocked (the guild_stamp_fence idiom).
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { type ClientSession, GameServer } from '../server/game';
import { collectGuildBankSaves, loadGuildBanksIntoSim } from '../server/guild_bank_state';
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

// A fully authorized officer at a banker with a loaded book and copper.
function officerSetup(server: GameServer, session: ClientSession, treasury = 100_000): void {
  moveToBanker(server, session.pid);
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
  server.sim.loadGuildBank(GUILD_ID, { treasury, inventory: [], purchasedSlots: 0 });
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
      purchasedSlots: 6,
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
      { guildId: GUILD_ID, data: { treasury: 102_000, inventory: [], purchasedSlots: 0 } },
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
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 0 };
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
      { guildId: GUILD_ID, data: { treasury: 101_000, inventory: [], purchasedSlots: 0 } },
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
      { guildId: GUILD_ID, data: { treasury: 102_000, inventory: [], purchasedSlots: 0 } },
    ]);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
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
      text: 'You need 10 gold to found a guild.',
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
    expect(meta.copper).toBe(50_000);
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
    expect(meta.copper).toBe(50_000);
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
      expect(meta.copper).toBe(50_000);
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
    const durable = { treasury: 100_000, inventory: [], purchasedSlots: 0 };
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
