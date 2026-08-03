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
  loadGuildBankRows: vi.fn(async () => []),
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
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
  dbMock.saveCharacterState.mockResolvedValue(true);
  dbMock.saveCharacterAndGuildBankState.mockResolvedValue(true);
  dbMock.saveCharacterAndMarketState.mockResolvedValue(true);
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
    expect(result).toEqual({ loaded: [7, 8], oversized: [], missing: [] });
    // Every loaded guild is verified live in the map (the acceptance line).
    expect(sim.guildBanks.has(7)).toBe(true);
    expect(sim.guildBanks.has(8)).toBe(true);
    expect(sim.guildBanks.get(7)).toEqual(book);
    expect(sim.guildBanks.get(8)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 0 });
  });

  it('SKIPS an oversized row entirely: no book, ops stay inert, nothing to overwrite it', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const result = loadGuildBanksIntoSim(sim, [{ guildId: 9, data: null, oversized: true }]);
    expect(result).toEqual({ loaded: [], oversized: [9], missing: [] });
    // NOT loaded as empty: an empty book would be persisted over the real row.
    expect(sim.guildBanks.has(9)).toBe(false);
    // And the null-serialize contract keeps every save skipping it.
    expect(sim.serializeGuildBank(9)).toBeNull();
  });

  it('hands loadGuildBank a PARSED object; a raw JSON string yields an empty book by design', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const book = { treasury: 555, inventory: [], purchasedSlots: 0 };
    loadGuildBanksIntoSim(sim, [
      { guildId: 7, data: book, oversized: false }, // parsed JSONB: the pg contract
      { guildId: 8, data: JSON.stringify(book), oversized: false }, // a string is NOT parsed
    ]);
    expect(sim.guildBanks.get(7)?.treasury).toBe(555);
    // Pinned: sanitizeGuildBankState takes objects only, so a string row loads
    // empty. The DB read must therefore always hand parsed JSONB (above).
    expect(sim.guildBanks.get(8)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 0 });
  });

  it('reports a guild whose id the load path refuses as missing', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const result = loadGuildBanksIntoSim(sim, [{ guildId: 0, data: null, oversized: false }]);
    expect(result.missing).toEqual([0]);
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

  it('a fence-miss (false) keeps the dirty mark: nothing persisted, nothing released', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Fenced');
    officerSetup(server, session);
    session.leaseNonce = 'stale-nonce';
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dbMock.saveCharacterAndGuildBankState.mockResolvedValueOnce(false);
    await priv(server).saveCharacter(session);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
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

  it('onGuildCreated seeds the LIVE empty book, charges once, writes create_fee, saves', async () => {
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Founder');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 150_000;
    priv(server).social.tx.onGuildCreated(1, GUILD_ID);
    // The seed: ops never lazily create a book, so without this the founder's
    // bank would be silent-inert until a realm restart.
    expect(server.sim.guildBanks.get(GUILD_ID)).toEqual({
      treasury: 0,
      inventory: [],
      purchasedSlots: 0,
    });
    // Create-then-charge: the fee left the purse exactly once.
    expect(meta.copper).toBe(50_000);
    expect(session.dirtyGuildBanks.has(GUILD_ID)).toBe(true);
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).toHaveBeenCalledTimes(1);
    expect((dbMock.insertBankLedgerRow.mock.calls[0] as unknown[])[0]).toMatchObject({
      op: 'create_fee',
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
  });

  it('onGuildCreated for an offline founder still seeds the book and charges nothing', async () => {
    const server = new GameServer();
    joinServer(server, 1, 'Bystander');
    priv(server).social.tx.onGuildCreated(999999, GUILD_ID);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true); // boot parity for the restart
    await bankLedgerIdle();
    expect(dbMock.insertBankLedgerRow).not.toHaveBeenCalled(); // free guild, never lost gold
  });

  it('onGuildDisbanded evicts the book from the live sim', () => {
    const server = new GameServer();
    joinServer(server, 1, 'Wind');
    server.sim.loadGuildBank(GUILD_ID, null);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true);
    priv(server).social.tx.onGuildDisbanded(GUILD_ID);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
  });

  it('guildBankHoldings on the transport reads the live book (null when unloaded)', () => {
    const server = new GameServer();
    joinServer(server, 1, 'Reader');
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toBeNull();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 42, inventory: [], purchasedSlots: 0 });
    expect(priv(server).social.tx.guildBankHoldings(GUILD_ID)).toEqual({ copper: 42, items: 0 });
  });
});
