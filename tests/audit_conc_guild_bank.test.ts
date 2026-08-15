// PERMANENT REGRESSION PINS (concurrency / persistence / crash / lifecycle
// slice), promoted from the hostile audit that found them.
//
// These drive the REAL GameServer + Sim against a FAKE DURABLE STORE that runs
// the REAL escrow merge (server/guild_bank_state mergeGuildBankRow), so the
// durable book row here is whatever a previous escrow save actually wrote.
// That is the only way to see whether a fenced-out session's ops can still
// reach durable state through ANOTHER officer's save, which is the dupe the
// escrow root fix removes at the root: a session's payload is its OWN delta
// log, so it can only ever persist its own work.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const durable = {
  chars: new Map<number, { copper: number; inventory: { itemId: string; count: number }[] }>(),
  books: new Map<number, unknown>(),
};

const dbMock = vi.hoisted(() => ({
  saveCharacterState: vi.fn(),
  saveCharacterAndGuildBankState: vi.fn(),
  saveCharacterAndMarketState: vi.fn(),
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
  releaseCharacterLease: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import {
  GuildBankEscrowRefused,
  type GuildBankSave,
  type GuildBankWriteResult,
  mergeGuildBankRow,
} from '../server/guild_bank_state';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const GUILD_ID = 913;
const STALE = 'stale-nonce';
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];

type CharState = { copper: number; inventory: { itemId: string; count: number }[] };

// The fake durable store: a lease-fenced write that actually records, and a
// book read served from what was recorded.
function installDurableStore(): void {
  // The book half is a READ-MODIFY-WRITE through the real merge, exactly as
  // server/db.ts writeGuildBankRow does it inside the fenced transaction.
  const commit = (
    charId: number,
    state: CharState,
    books: readonly GuildBankSave[] | undefined,
    results: GuildBankWriteResult[] | undefined,
  ) => {
    // A refused book half aborts the whole transaction, character row
    // included, exactly as server/db.ts does it.
    const written: GuildBankWriteResult[] = [];
    const pending: [number, unknown][] = [];
    for (const b of books ?? []) {
      const merged = mergeGuildBankRow(durable.books.get(b.guildId) ?? null, b.deltas);
      if (merged.data !== null) pending.push([b.guildId, JSON.parse(JSON.stringify(merged.data))]);
      written.push({ guildId: b.guildId, ...merged.result });
    }
    results?.push(...written);
    if (written.some((r) => !r.written)) throw new GuildBankEscrowRefused(written);
    for (const [guildId, data] of pending) durable.books.set(guildId, data);
    durable.chars.set(charId, JSON.parse(JSON.stringify(state)));
  };
  dbMock.saveCharacterState.mockImplementation(
    async (charId: number, _level: number, state: CharState, nonce?: string) => {
      if (nonce === STALE) return false;
      commit(charId, state, [], undefined);
      return true;
    },
  );
  dbMock.saveCharacterAndGuildBankState.mockImplementation(
    async (
      charId: number,
      _level: number,
      state: CharState,
      books: readonly GuildBankSave[],
      nonce?: string,
      results?: GuildBankWriteResult[],
    ) => {
      if (nonce === STALE) return false; // fence miss: the WHOLE txn rolls back
      commit(charId, state, books, results);
      return true;
    },
  );
  dbMock.saveCharacterAndMarketState.mockImplementation(
    async (
      charId: number,
      _level: number,
      state: CharState,
      _market: unknown,
      _mail: unknown,
      nonce?: string,
      books?: readonly GuildBankSave[],
      results?: GuildBankWriteResult[],
    ) => {
      if (nonce === STALE) return false;
      commit(charId, state, books, results);
      return true;
    },
  );
}

/** Seed the live book AND the durable row together, exactly as the boot load
 *  leaves them (the live book is loaded FROM the row). */
function seedBook(server: GameServer, book: Record<string, unknown>): void {
  server.sim.loadGuildBank(GUILD_ID, JSON.parse(JSON.stringify(book)));
  durable.books.set(GUILD_ID, JSON.parse(JSON.stringify(book)));
}

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

const sentBy = new Map<number, unknown[]>();

function joinServer(server: GameServer, characterId: number, name: string): ClientSession {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  sentBy.set(characterId, fc.sent);
  session.blockListLoaded = true;
  // The join-time social snapshot resolves against the EMPTY mocked social DB
  // and would re-stamp membership null the first time this test awaits. Bump
  // the stamp fence so that stale in-flight read is discarded (the real
  // guildStampSeq behavior), leaving the officer stamps below authoritative.
  session.guildStampSeq++;
  return session;
}

// biome-ignore lint/suspicious/noExplicitAny: the audit spans private seams
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

function officer(
  server: GameServer,
  session: ClientSession,
  rank: 'leader' | 'officer' = 'officer',
  copper = 500_000,
): void {
  moveToBanker(server, session.pid);
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank });
  const meta = server.sim.players.get(session.pid);
  if (!meta) throw new Error('missing meta');
  meta.copper = copper;
}

const dispatch = (server: GameServer, session: ClientSession, msg: Record<string, unknown>) =>
  priv(server).dispatchMessage(session, { t: 'cmd', ...msg }, JSON.stringify(msg), 0);

const bookOf = (server: GameServer) => server.sim.guildBanks.get(GUILD_ID);

// The join-time social snapshot resolves against the EMPTY mocked social DB
// and re-stamps membership null the first time a test awaits (correct server
// behavior, not what is under audit here). Re-apply the officer stamp after
// any await, exactly as tests/guild_bank_persistence.test.ts does.
function restamp(
  server: GameServer,
  session: ClientSession,
  rank: 'leader' | 'officer' = 'officer',
): void {
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank });
}

beforeEach(() => {
  durable.chars.clear();
  durable.books.clear();
  for (const m of Object.values(dbMock)) (m as { mockClear?: () => void }).mockClear?.();
  installDurableStore();
});

// ---------------------------------------------------------------------------
// A/B: two officers, one book, one of them fenced out (self-takeover).
// ---------------------------------------------------------------------------
describe('a fenced-out op vs a book another officer already flushed', () => {
  it("conserves copper: another officer's save can never carry this session's op", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'OfficerA');
    const b = joinServer(server, 2, 'OfficerB');
    officer(server, a);
    officer(server, b);
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });

    // Baseline durable state for both characters (500_000 copper each).
    await priv(server).saveCharacter(a);
    await priv(server).saveCharacter(b);
    expect(durable.chars.get(1)?.copper).toBe(500_000);
    expect(durable.chars.get(2)?.copper).toBe(500_000);

    restamp(server, a);
    restamp(server, b);

    // 1. A deposits 2_000 into the shared treasury. A's character half is NOT
    //    durable yet (no save since), A holds the dirty mark + unflushed log.
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(bookOf(server)?.treasury).toBe(2_000);

    // 2. Officer B does ANY guild bank op and saves. B's escrow save persists
    //    the WHOLE live book, which already contains A's un-durable deposit.
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    await priv(server).saveCharacter(b);
    restamp(server, a);
    restamp(server, b);
    // B's commit carries B's 1_000 and NOTHING of A's: the payload is B's own
    // delta log, replayed onto durable truth under the row lock. Before the
    // escrow root fix this row read 3_000, which is exactly how A's op became
    // durable while A's purse charge did not.
    expect(durable.books.get(GUILD_ID)).toEqual({
      treasury: 1_000,
      inventory: [],
      purchasedSlots: 24,
    });
    expect(b.dirtyGuildBanks.size).toBe(0); // B's mark released on commit

    // 3. A self-takeover rotates A's lease nonce: A's escrow save fences out
    //    and its character half rolls back. This is the reconcile trigger the
    //    design documents as the closed arm.
    a.leaseNonce = STALE;
    await priv(server).saveCharacter(a);

    // The undo is surgical and synchronous: A's 2_000 leaves the LIVE book,
    // B's 1_000 stays. No evict, no reload, nothing to re-read.
    expect(bookOf(server)?.treasury).toBe(1_000);

    // Conservation across DURABLE state (what a restart or A's relog reads):
    // A's row kept the 2_000 its save rolled back, and the book never got it.
    const total =
      (durable.chars.get(1)?.copper ?? 0) +
      (durable.chars.get(2)?.copper ?? 0) +
      ((durable.books.get(GUILD_ID) as { treasury: number }).treasury ?? 0);
    expect(total).toBe(1_000_000);
  });

  it('conserves an item: the same shape with a stack instead of copper', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'OfficerA');
    const b = joinServer(server, 2, 'OfficerB');
    officer(server, a);
    officer(server, b);
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    server.sim.addItem('wolf_fang', 4); // lands on the primary player (A)
    await priv(server).saveCharacter(a);
    const durableBagCount = (durable.chars.get(1)?.inventory ?? []).find(
      (s) => s.itemId === 'wolf_fang',
    )?.count;
    expect(durableBagCount).toBe(4);

    restamp(server, a);
    restamp(server, b);
    const aMeta = server.sim.players.get(a.pid);
    if (!aMeta) throw new Error('missing meta');
    const idx = aMeta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: idx, count: 4 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1 });
    await priv(server).saveCharacter(b); // flushes the book WITH A's stack
    restamp(server, a);

    a.leaseNonce = STALE;
    await priv(server).saveCharacter(a);

    // A's deposit is gone from the LIVE book (undone) and was never in B's
    // payload, so it is in neither durable half but A's own bags.
    expect(bookOf(server)?.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);
    const rowInv = (durable.books.get(GUILD_ID) as { inventory: { itemId: string }[] }).inventory;
    const inDurableBook = rowInv.some((s) => s.itemId === 'wolf_fang');
    const inDurableBags = (durable.chars.get(1)?.inventory ?? []).some(
      (s) => s.itemId === 'wolf_fang',
    );
    // Exactly one of the two durable halves may hold the stack.
    expect([inDurableBook, inDurableBags]).not.toEqual([true, true]);
  });

  it("an undo landing INSIDE another save's write window cannot be shadowed", async () => {
    // The deepest of the three findings. The undo runs in the dead session's
    // continuation, which resumes as soon as its own thunk settles, i.e.
    // strictly inside the next save's in-flight window. While a save's payload
    // was the shared live book, that save committed the PRE-undo snapshot and
    // released its own mark, so live and durable disagreed with nothing left
    // to converge them, and a restart promoted the skew into a permanent dupe.
    // With the payload reduced to the saving session's own deltas, WHERE the
    // undo lands in the timeline cannot matter.
    const server = new GameServer();
    const a = joinServer(server, 1, 'DeadA');
    const b = joinServer(server, 2, 'LiveB');
    officer(server, a);
    officer(server, b);
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    await priv(server).saveCharacter(a);
    await priv(server).saveCharacter(b);
    restamp(server, a);
    restamp(server, b);

    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    expect(bookOf(server)?.treasury).toBe(3_000);

    const realCommit = dbMock.saveCharacterAndGuildBankState.getMockImplementation();
    if (!realCommit) throw new Error('missing impl');
    dbMock.saveCharacterAndGuildBankState.mockImplementationOnce(
      async (...args: Parameters<typeof realCommit>) => {
        // B's payload is already captured; A's session dies mid-flight.
        priv(server).revertOwnGuildBookOps(a, [GUILD_ID]);
        return realCommit(...args);
      },
    );
    await priv(server).saveCharacter(b);

    // The undo ran on the LIVE book...
    expect(bookOf(server)?.treasury).toBe(1_000);
    // ...and B's commit agrees, because B only ever persisted B's own delta.
    expect(durable.books.get(GUILD_ID)).toEqual({
      treasury: 1_000,
      inventory: [],
      purchasedSlots: 24,
    });
    expect(b.dirtyGuildBanks.size).toBe(0);
    expect(a.dirtyGuildBanks.size).toBe(0);

    const total =
      (durable.chars.get(1)?.copper ?? 0) +
      (durable.chars.get(2)?.copper ?? 0) +
      ((durable.books.get(GUILD_ID) as { treasury: number }).treasury ?? 0);
    expect(total).toBe(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// B: the revertLost (overflowed log) fallback destroys / duplicates the OTHER
// session's unflushed ops.
// ---------------------------------------------------------------------------
describe('an overflowing op log while another session holds unflushed ops', () => {
  it("conserves an item: the cap COMPACTS the log, so B's withdrawal is never restored", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'OverflowA');
    const b = joinServer(server, 2, 'WithdrawB');
    officer(server, a);
    officer(server, b);
    // Durable truth: the book holds the stack.
    const durableBook = {
      treasury: 100_000,
      inventory: [{ itemId: 'wolf_fang', count: 4 }],
      purchasedSlots: 24,
    };
    seedBook(server, durableBook);

    // B withdraws the stack into their bags. B is dirty; B's character half is
    // NOT durable yet.
    dispatch(server, b, { cmd: 'guild_bank_withdraw', slot: 0, count: 4 });
    expect(bookOf(server)?.inventory.length).toBe(0);
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    expect(bMeta.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(true);

    // A's unflushed log overflows the cap (a DB outage plus sustained ops).
    // The cap COMPACTS it rather than dropping it, so A keeps a faithful undo
    // list and there is no fallback arm to reload the book from.
    a.unflushedGuildBankOps.set(
      GUILD_ID,
      Array.from({ length: 500 }, () => ({
        op: 'deposit_gold' as const,
        itemId: null,
        count: null,
        instance: null,
        // Filler that only fills the CAP: it stands for ops this fixture never
        // ran against the live book, and the undo is honest now, so a non-zero
        // delta here would subtract copper the book never gained.
        copperDelta: 0,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
      })),
    );
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    expect((a.unflushedGuildBankOps.get(GUILD_ID) ?? []).length).toBeLessThan(500);

    // A fences out while B is dirty: only A's own ops are undone.
    a.leaseNonce = STALE;
    await priv(server).saveCharacter(a);
    restamp(server, b);
    expect(bookOf(server)?.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);

    // B's escrow save now commits both halves in one transaction.
    await priv(server).saveCharacter(b);
    const rowInv = (durable.books.get(GUILD_ID) as { inventory: { itemId: string }[] }).inventory;
    const inBook = rowInv.some((s) => s.itemId === 'wolf_fang');
    const inBags = (durable.chars.get(2)?.inventory ?? []).some((s) => s.itemId === 'wolf_fang');
    expect([inBook, inBags]).not.toEqual([true, true]);
  });

  it("conserves copper: the same overflow never erases B's unflushed deposit", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'OverflowA');
    const b = joinServer(server, 2, 'DepositB');
    officer(server, a);
    officer(server, b);
    const durableBook = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    seedBook(server, durableBook);

    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    const bMeta = server.sim.players.get(b.pid);
    if (!bMeta) throw new Error('missing meta');
    expect(bMeta.copper).toBe(450_000); // charged, not yet durable

    a.unflushedGuildBankOps.set(
      GUILD_ID,
      Array.from({ length: 500 }, () => ({
        op: 'deposit_gold' as const,
        itemId: null,
        count: null,
        instance: null,
        // Filler that only fills the CAP: it stands for ops this fixture never
        // ran against the live book, and the undo is honest now, so a non-zero
        // delta here would subtract copper the book never gained.
        copperDelta: 0,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
      })),
    );
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 500 });
    a.leaseNonce = STALE;
    await priv(server).saveCharacter(a);
    restamp(server, b);

    // B's 50_000 survives in the live book, and B's own save persists it.
    expect(bookOf(server)?.treasury).toBe(150_000);
    await priv(server).saveCharacter(b);
    const total =
      (durable.chars.get(2)?.copper ?? 0) +
      ((durable.books.get(GUILD_ID) as { treasury: number }).treasury ?? 0);
    // B started with 500_000 copper and the book with 100_000: nothing legitimate
    // left the pair, so the two durable halves must still sum to 600_000.
    expect(total).toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// D: guild lifecycle races.
// ---------------------------------------------------------------------------
describe('the guild-delete window (guard to DELETE)', () => {
  it('refuses every op that lands between the empty-bank guard and the guilds DELETE', async () => {
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    const b = joinServer(server, 2, 'OfficerB');
    officer(server, leader, 'leader');
    officer(server, b, 'officer');
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    server.sim.addItem('wolf_fang', 4); // on the primary player (the leader)

    const tx = priv(server).socialTransport();

    // SocialService.guildDisband step 1: the guard read, which also OPENS the
    // guild-delete window (synchronous).
    expect(tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });

    // Step 2/3 are `await db.guildMembers()` and `await db.deleteGuild()`.
    // Any WS frame arriving in that window is dispatched immediately
    // (handleMessage is not tick-gated), and the actor is still stamped. With
    // the window held, every one of those ops is refused before the sim runs.
    const bMeta = server.sim.players.get(b.pid);
    const lMeta = server.sim.players.get(leader.pid);
    if (!bMeta || !lMeta) throw new Error('missing meta');
    const idx = lMeta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, leader, { cmd: 'guild_bank_deposit', slot: idx, count: 4 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    expect(bMeta.copper).toBe(500_000); // never charged
    expect(lMeta.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(true); // still in bags
    expect(bookOf(server)?.treasury).toBe(0);
    expect(b.dirtyGuildBanks.size).toBe(0);

    // Step 4: the DELETE committed; the post-commit hooks run, then the window
    // closes.
    tx.onGuildDisbanded(GUILD_ID);
    tx.onGuildMembershipChanged(1, null);
    tx.onGuildMembershipChanged(2, null);
    tx.endGuildBankDelete(GUILD_ID);

    // The book (and its guild_banks row, via ON DELETE CASCADE) is gone, and
    // nothing of value went with it.
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false);
    expect(b.unflushedGuildBankOps.size).toBe(0);

    await priv(server).saveCharacter(b);
    await priv(server).saveCharacter(leader);
    // Conservation: the bank (and its row) no longer exists, so the copper and
    // the stack are still with their owners.
    expect(durable.chars.get(2)?.copper).toBe(500_000);
    expect((durable.chars.get(1)?.inventory ?? []).some((s) => s.itemId === 'wolf_fang')).toBe(
      true,
    );
  });

  it('is re-entrant-safe: a second delete cannot take a window someone else holds', () => {
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    officer(server, leader, 'leader');
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const tx = priv(server).socialTransport();
    expect(tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    // A concurrent /gdisband + last-member /gquit would otherwise each think
    // they own the window, and the first to finish would open the gap under
    // the second.
    expect(tx.beginGuildBankDelete(GUILD_ID)).toBeNull();
    tx.endGuildBankDelete(GUILD_ID);
    expect(tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
  });

  it('closes the window on the REFUSAL arm, so a stocked bank stays usable', async () => {
    // A refused disband must not leave the guild's bank refusing ops until the
    // realm restarts.
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    officer(server, leader, 'leader');
    seedBook(server, { treasury: 50_000, inventory: [], purchasedSlots: 24 });
    const social = priv(server).social;
    social.db.guildMembership = async () => ({
      guildId: GUILD_ID,
      guildName: 'Iron Vanguard',
      rank: 'leader',
    });
    await social.guildDisband({ characterId: 1, accountId: 1, name: 'Leader' });
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(true); // refused, nothing deleted
    restamp(server, leader, 'leader');
    dispatch(server, leader, { cmd: 'guild_bank_withdraw_gold', amount: 50_000 });
    expect(bookOf(server)?.treasury).toBe(0); // the bank still works
  });

  it('END TO END: the real /gdisband refuses an op dispatched inside its await gap', async () => {
    // The manual reproductions above stage the window by hand; this one drives
    // the REAL SocialService.guildDisband and lands the op inside the genuine
    // `await db.guildMembers()` gap, which is where a WS frame actually
    // arrives (handleMessage is not tick-gated).
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    const b = joinServer(server, 2, 'OfficerB');
    officer(server, leader, 'leader');
    officer(server, b, 'officer');
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const social = priv(server).social;
    social.db.guildMembership = async () => ({
      guildId: GUILD_ID,
      guildName: 'Iron Vanguard',
      rank: 'leader',
    });
    const bSent = sentBy.get(2) ?? [];
    let landedInGap = false;
    social.db.guildMembers = async () => {
      restamp(server, b);
      dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
      landedInGap = true;
      return [{ id: 1, name: 'Leader', rank: 'leader' }];
    };
    social.db.deleteGuild = async () => {};
    await social.guildDisband({ characterId: 1, accountId: 1, name: 'Leader' });

    expect(landedInGap).toBe(true); // vacuity guard: the op really was dispatched
    // Refused: the copper stayed in B's purse instead of being cascaded away.
    expect(server.sim.players.get(b.pid)?.copper).toBe(500_000);
    // ...and B was TOLD, rather than watching a deposit do nothing at all.
    // English on the wire, re-localized by the client matcher.
    expect(
      bSent.flatMap((m) => ((m as { list?: unknown[] }).list ?? []) as never[]),
    ).toContainEqual({ type: 'error', text: 'The guild bank is closing. Try again in a moment.' });
    expect(b.dirtyGuildBanks.size).toBe(0);
    expect(server.sim.guildBanks.has(GUILD_ID)).toBe(false); // the disband committed
    await priv(server).saveCharacter(b);
    expect(durable.chars.get(2)?.copper).toBe(500_000);
  });

  it('releases the window when the DELETE THROWS, so a failed disband is not a dead bank', async () => {
    // The window spans two awaited DB steps. If either throws and the window
    // is not released, that guild's bank refuses every op until the realm
    // restarts, which is a worse outcome than the failed disband.
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    officer(server, leader, 'leader');
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const social = priv(server).social;
    social.db.guildMembership = async () => ({
      guildId: GUILD_ID,
      guildName: 'Iron Vanguard',
      rank: 'leader',
    });
    social.db.guildMembers = async () => {
      throw new Error('db down');
    };
    await expect(
      social.guildDisband({ characterId: 1, accountId: 1, name: 'Leader' }),
    ).rejects.toThrow('db down');
    // The window is closed again, so the bank works.
    restamp(server, leader, 'leader');
    dispatch(server, leader, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    expect(bookOf(server)?.treasury).toBe(1_000);
    // ...and a later disband can still take the window.
    dispatch(server, leader, { cmd: 'guild_bank_withdraw_gold', amount: 1_000 });
    const tx = priv(server).socialTransport();
    expect(tx.beginGuildBankDelete(GUILD_ID)).toBeNull(); // fails closed: mark unflushed
    await priv(server).saveCharacter(leader);
    expect(tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
  });

  it('the window does NOT swallow the dirty-mark guard: an unflushed book still fails closed', async () => {
    // Two independent reasons to refuse a delete, and the window must not mask
    // either: an unflushed mark means the live book proves nothing about the
    // durable row the cascade would destroy.
    const server = new GameServer();
    const leader = joinServer(server, 1, 'Leader');
    officer(server, leader, 'leader');
    seedBook(server, { treasury: 5_000, inventory: [], purchasedSlots: 24 });
    const tx = priv(server).socialTransport();
    dispatch(server, leader, { cmd: 'guild_bank_withdraw_gold', amount: 5_000 });
    expect(server.sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    expect(tx.beginGuildBankDelete(GUILD_ID)).toBeNull(); // unflushed: fail closed
    // A refused begin took NO window, so the bank keeps working.
    restamp(server, leader, 'leader');
    dispatch(server, leader, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(bookOf(server)?.treasury).toBe(2_000);
  });

  it('same window on the last-member /gquit path (guard, then removeGuildMember, then DELETE)', async () => {
    const server = new GameServer();
    const solo = joinServer(server, 1, 'SoloLeader');
    officer(server, solo, 'leader');
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });

    const tx = priv(server).socialTransport();
    // The last-member arm of /gquit runs the SAME guard, so it takes the same
    // window: the DELETE is two awaits away there too.
    expect(tx.beginGuildBankDelete(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    // `await db.removeGuildMember(actor)` is in flight; the stamp is still live.
    dispatch(server, solo, { cmd: 'guild_bank_deposit_gold', amount: 90_000 });
    expect(bookOf(server)?.treasury).toBe(0); // refused, not banked
    tx.onGuildMembershipChanged(1, null);
    tx.onGuildDisbanded(GUILD_ID);
    tx.endGuildBankDelete(GUILD_ID);

    await priv(server).saveCharacter(solo);
    expect(durable.chars.get(1)?.copper).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// Control: the same shapes WITHOUT the taint vector must stay conservative.
// ---------------------------------------------------------------------------
describe('AUDIT controls (these must PASS)', () => {
  it('a fence-out with no other officer flush reconciles cleanly', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'Lonely');
    officer(server, a);
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    await priv(server).saveCharacter(a);
    restamp(server, a);
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    expect(bookOf(server)?.treasury).toBe(2_000);
    a.leaseNonce = STALE;
    await priv(server).saveCharacter(a);
    expect(bookOf(server)?.treasury).toBe(0);
    expect(durable.chars.get(1)?.copper).toBe(500_000);
  });

  it('two officers with both halves flushed conserve exactly', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'A');
    const b = joinServer(server, 2, 'B');
    officer(server, a);
    officer(server, b);
    seedBook(server, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 2_000 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    await priv(server).saveCharacter(a);
    await priv(server).saveCharacter(b);
    const total =
      (durable.chars.get(1)?.copper ?? 0) +
      (durable.chars.get(2)?.copper ?? 0) +
      ((durable.books.get(GUILD_ID) as { treasury: number }).treasury ?? 0);
    expect(total).toBe(1_000_000);
  });

  it('the sim boot-load of a serialized book is a faithful round trip', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    sim.loadGuildBank(GUILD_ID, { treasury: 7, inventory: [], purchasedSlots: 24 });
    expect(sim.serializeGuildBank(GUILD_ID)).toEqual({
      treasury: 7,
      inventory: [],
      purchasedSlots: 24,
    });
  });
});
