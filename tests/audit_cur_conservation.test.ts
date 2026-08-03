// PERMANENT currency-conservation + audit-truth pins for the guild bank,
// promoted from the hostile audit that found the escrow dupes. Drives the REAL
// GameServer + Sim against a DURABLE-STORE db mock that runs the REAL escrow
// merge, because the whole question is what is DURABLE after a torn escrow,
// not what the live sim holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Book = { treasury: number; inventory: unknown[]; purchasedSlots: number };
type CharRow = { level: number; state: { copper?: number; inventory?: unknown[] } };

const dbMock = vi.hoisted(() => {
  // The in-memory DURABLE store: guild books + character blobs. The book half
  // is a READ-MODIFY-WRITE through the REAL escrow merge (wired below, since
  // vi.hoisted runs before the imports), exactly as server/db.ts does it
  // inside the fenced transaction.
  const durableBooks = new Map<number, unknown>();
  const durableChars = new Map<number, unknown>();
  let fenceFor: number | null = null; // characterId whose next save is fenced out
  const merge = {
    // biome-ignore lint/suspicious/noExplicitAny: bound to the real merge below
    fn: null as null | ((durable: unknown, deltas: any) => { data: unknown; result: any }),
    // biome-ignore lint/suspicious/noExplicitAny: bound to the real error below
    refused: null as null | (new (results: any[]) => Error),
  };
  const writeBooks = (
    // biome-ignore lint/suspicious/noExplicitAny: the delta payload shape
    books: { guildId: number; deltas: any }[] | undefined,
    // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
    results?: any[],
  ) => {
    // A refused book half aborts the whole transaction, character row
    // included, exactly as server/db.ts does it.
    // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
    const written: any[] = [];
    const pending: [number, unknown][] = [];
    for (const b of books ?? []) {
      if (!merge.fn) throw new Error('merge not wired');
      const merged = merge.fn(durableBooks.get(b.guildId) ?? null, b.deltas);
      if (merged.data !== null) pending.push([b.guildId, JSON.parse(JSON.stringify(merged.data))]);
      written.push({ guildId: b.guildId, ...merged.result });
    }
    results?.push(...written);
    if (written.some((r) => !r.written)) {
      if (!merge.refused) throw new Error('refusal not wired');
      throw new merge.refused(written);
    }
    for (const [guildId, data] of pending) durableBooks.set(guildId, data);
  };
  return {
    durableBooks,
    durableChars,
    merge,
    setFence: (id: number | null) => {
      fenceFor = id;
    },
    saveCharacterState: vi.fn(async (characterId: number, _level: number, state: unknown) => {
      if (fenceFor === characterId) return false;
      durableChars.set(characterId, JSON.parse(JSON.stringify(state)));
      return true;
    }),
    saveCharacterAndGuildBankState: vi.fn(
      async (
        characterId: number,
        _level: number,
        state: unknown,
        // biome-ignore lint/suspicious/noExplicitAny: the delta payload shape
        books: { guildId: number; deltas: any }[],
        _nonce?: string,
        // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
        results?: any[],
      ) => {
        if (fenceFor === characterId) return false; // lease fence: NOTHING lands
        writeBooks(books, results);
        durableChars.set(characterId, JSON.parse(JSON.stringify(state)));
        return true;
      },
    ),
    saveCharacterAndMarketState: vi.fn(async () => true),
    insertBankLedgerRow: vi.fn(async () => {}),
    loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
  };
});

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

import { auditBank, type BankLedgerAuditRow } from '../scripts/bank_audit.mjs';
import { bankLedgerIdle } from '../server/bank_ledger';
import { type ClientSession, GameServer } from '../server/game';
import { GuildBankEscrowRefused, mergeGuildBankRow } from '../server/guild_bank_state';
import { RIFT_GEAR_ITEM_IDS } from '../src/sim/content/rift/items';
import {
  GUILD_BANK_TREASURY_CAP,
  type GuildBankOpDelta,
  guildBankPipeRefusal,
  guildBankRungsBought,
} from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Wire the fake durable table to the REAL escrow merge (see dbMock.merge).
dbMock.merge.fn = (durable, deltas) => mergeGuildBankRow(durable, deltas);
dbMock.merge.refused = GuildBankEscrowRefused;

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

function joinServer(server: GameServer, characterId: number, name: string): ClientSession {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

// biome-ignore lint/suspicious/noExplicitAny: the probes span private seams
const priv = (server: GameServer): any => server as any;

function moveToBanker(server: GameServer, pid: number): void {
  let banker: Entity | null = null;
  for (const e of server.sim.entities.values()) {
    if (e.kind === 'npc' && BANKERS.includes(e.templateId ?? '')) banker = e;
  }
  if (!banker) throw new Error('no banker NPC spawned');
  const p = server.sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  server.sim.rebucket(p);
}

function officer(server: GameServer, session: ClientSession, copper: number): void {
  moveToBanker(server, session.pid);
  stamp(server, session);
  const meta = server.sim.players.get(session.pid);
  if (!meta) throw new Error('missing meta');
  meta.copper = copper;
}

// The session-only membership stamp. join()'s async initSocial resolves on a
// later microtask against the mocked (empty) social DB and stamps null, so any
// probe that awaits must RE-stamp before its next op. Test-harness hygiene, not
// product behavior.
function stamp(server: GameServer, session: ClientSession): void {
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
}

// Let join()'s async social init finish clobbering the stamps before a probe
// installs its own.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const dispatch = (server: GameServer, session: ClientSession, msg: Record<string, unknown>) =>
  priv(server).dispatchMessage(session, { t: 'cmd', ...msg }, JSON.stringify(msg), 0);

const purse = (server: GameServer, session: ClientSession): number =>
  server.sim.players.get(session.pid)?.copper ?? -1;

const durablePurse = (characterId: number): number =>
  (dbMock.durableChars.get(characterId) as CharRow['state'] | undefined)?.copper ?? -1;

// The bank_ledger rows the fire-and-forget observer actually wrote, in the
// snake_case shape scripts/bank_audit.mjs consumes.
function capturedLedgerRows(): BankLedgerAuditRow[] {
  return dbMock.insertBankLedgerRow.mock.calls.map((call, i) => {
    const r = (call as unknown[])[0] as Record<string, unknown>;
    return {
      id: i + 1,
      realm: r.realm,
      character_id: r.characterId,
      op: r.op,
      item_id: r.itemId,
      count: r.count,
      instance: r.instance,
      copper_delta: r.copperDelta,
      purchased_slots_after: r.purchasedSlotsAfter,
      container: r.container,
      container_id: r.containerId,
    } as BankLedgerAuditRow;
  });
}

beforeEach(() => {
  dbMock.durableBooks.clear();
  dbMock.durableChars.clear();
  dbMock.setFence(null);
  dbMock.saveCharacterState.mockClear();
  dbMock.saveCharacterAndGuildBankState.mockClear();
  dbMock.saveCharacterAndMarketState.mockClear();
  dbMock.insertBankLedgerRow.mockClear();
  dbMock.loadGuildBankRows.mockClear();
});

// ---------------------------------------------------------------------------
// F/I: the cross-officer escrow skew, taken past the point state.md says the
// "reliable dupe" arms are closed.
// ---------------------------------------------------------------------------
describe("another officer's save can no longer launder an unflushed deposit into durable truth", () => {
  it("conserves copper: A's un-durable deposit is in nobody else's payload", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'MintA');
    const b = joinServer(server, 2, 'MintB');
    await settle();
    // A newborn (opened) guild bank: birth-complete, treasury 0.
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    officer(server, a, 500_000);
    officer(server, b, 50_000);
    // Both characters start durable at their join purse.
    await priv(server).saveCharacter(a);
    await priv(server).saveCharacter(b);
    stamp(server, a);
    stamp(server, b);
    const startTotal = durablePurse(1) + durablePurse(2) + 0;
    expect(startTotal).toBe(550_000); // vacuity guard: the durable read works

    // 1) A deposits 200_000 into the treasury. Live only: A's character half
    //    is NOT durable yet (the mark just schedules the next escrow save).
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 200_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(200_000);
    expect(a.dirtyGuildBanks.has(GUILD_ID)).toBe(true);

    // 2) The alt officer B touches the same book and lets ITS autosave land.
    //    B's escrow commit persists B's OWN delta and nothing else, so A's
    //    200_000 never becomes durable. (This row read 201_000 before the
    //    escrow root fix, which is exactly how the dupe was minted.)
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    await priv(server).saveCharacter(b);
    expect((dbMock.durableBooks.get(GUILD_ID) as Book).treasury).toBe(1_000);
    expect(b.dirtyGuildBanks.size).toBe(0); // B is clean again

    // 3) A reconnects: the displaced session's lease-fenced save lands nothing
    //    and its own ops are undone from the live book. There is nothing for a
    //    reload to restore, and no reload arm left to run.
    dbMock.setFence(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(a);
    warn.mockRestore();

    // A's character half never persisted, so its durable purse still holds the
    // 200_000 it "deposited" and the treasury never did.
    const endTotal =
      durablePurse(1) + durablePurse(2) + (dbMock.durableBooks.get(GUILD_ID) as Book).treasury;
    expect(durablePurse(1)).toBe(500_000);
    expect((dbMock.durableBooks.get(GUILD_ID) as Book).treasury).toBe(1_000);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(1_000);
    // CONSERVATION: total durable copper is unchanged.
    expect(endTotal - startTotal).toBe(0);
  });

  it("leaves the fenced ops' ledger rows behind, which the auditor DOES flag", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'MintA');
    const b = joinServer(server, 2, 'MintB');
    await settle();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    officer(server, a, 500_000);
    officer(server, b, 50_000);

    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 200_000 });
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(201_000); // vacuity guard
    await priv(server).saveCharacter(b);
    dbMock.setFence(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(a);
    warn.mockRestore();
    await bankLedgerIdle();

    const rows = capturedLedgerRows();
    const book = dbMock.durableBooks.get(GUILD_ID) as Book;
    const findings = auditBank({
      ledgerRows: rows,
      characters: [
        { id: 1, realm: 'Claudemoon', state: { bank: null } },
        { id: 2, realm: 'Claudemoon', state: { bank: null } },
      ],
      guildBanks: [{ guild_id: GUILD_ID, realm: 'Claudemoon', data: book }],
    });
    // Nothing was minted. The ledger rows of the fenced (undone) ops remain by
    // design (docs/guild-bank/state.md, the evidence trail), so a LIVE realm's
    // replay disagrees with the book: that is the documented operator caveat
    // in scripts/bank_audit.mjs (audit a quiesced realm), not a dupe.
    expect(findings.map((f: { kind: string }) => f.kind)).toEqual(['treasury_mismatch']);
  });
});

// ---------------------------------------------------------------------------
// CONSUME-THEN-FENCE, the shape that used to be a full cross-account item dupe
// and a repeatable copper printer. Officer A deposits without flushing,
// officer B consumes it, B's save commits its character half, then A gets
// itself fenced (an ordinary re-login) so nothing will ever make A's deposit
// durable. B kept the value; A's stake came back.
//
// It is now impossible by construction: B's save cannot commit its character
// half, because the book half it is paired with cannot be replayed onto
// durable truth, so the whole transaction rolls back. B retries while A is
// still around to make the deposit durable, and once A is gone B's live state
// is abandoned wholesale: its own book ops come off the live book, it is
// quarantined so it can never persist, and it reloads from a durable row that
// never saw the withdrawal.
// ---------------------------------------------------------------------------
describe('consume-then-fence can no longer duplicate across two accounts', () => {
  it("refuses the consumer's save and rolls it back rather than minting", async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'DupeA');
    const b = joinServer(server, 2, 'DupeB');
    await settle();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    officer(server, a, 10_000);
    officer(server, b, 10_000);
    server.sim.addItem('wolf_fang', 4, a.pid);
    await priv(server).saveCharacter(a); // A's durable bags now hold 4 fangs
    await priv(server).saveCharacter(b);
    stamp(server, a);
    stamp(server, b);
    expect(countFangs(dbMock.durableChars.get(1))).toBe(4);

    // A deposits the fangs (live only), B withdraws them.
    const aMeta = server.sim.players.get(a.pid);
    if (!aMeta) throw new Error('missing meta');
    const idx = aMeta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: idx, count: 4 });
    dispatch(server, b, { cmd: 'guild_bank_withdraw', slot: 0, count: 4 });
    expect(countFangs({ inventory: server.sim.players.get(b.pid)?.inventory })).toBe(4);

    // A fences itself out (an ordinary re-login), so A's deposit will never be
    // durable and B's withdrawal can never be replayed.
    dbMock.setFence(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await priv(server).saveCharacter(a);
    // B's save is REFUSED: no character half, no book half, nothing durable.
    await priv(server).saveCharacter(b);
    warn.mockRestore();
    err.mockRestore();

    // B is quarantined and can never persist its live state...
    expect(b.escrowQuarantined).toBe(true);
    await priv(server).saveCharacter(b);
    // ...so the four fangs exist in exactly ONE durable place: A's bags, where
    // they were before any of this. Eight fangs where four existed is what the
    // old carry-and-record behaviour produced here.
    expect(countFangs(dbMock.durableChars.get(1))).toBe(4);
    expect(countFangs(dbMock.durableChars.get(2))).toBe(0);
    const durableBookFangs = countFangs({
      inventory: (dbMock.durableBooks.get(GUILD_ID) as Book).inventory,
    });
    expect(durableBookFangs).toBe(0);
    // And the incident is on the record, once.
    await bankLedgerIdle();
    const anomalies = capturedLedgerRows().filter(
      (r) => (r as unknown as { op: string }).op === 'escrow_deficit',
    );
    expect(anomalies).toHaveLength(1);
    expect((anomalies[0] as unknown as { count: number }).count).toBe(-4);
  });

  it('REPEATING it gains nothing: every attempt rolls the consumer back', async () => {
    // The exploit's value came from repeatability. Each round now costs the
    // attacker their alt's whole unsaved session and yields nothing durable.
    for (const round of [1, 2, 3]) {
      dbMock.durableBooks.clear();
      dbMock.durableChars.clear();
      dbMock.setFence(null);
      const server = new GameServer();
      const a = joinServer(server, 1, `RoundA${round}`);
      const b = joinServer(server, 2, `RoundB${round}`);
      await settle();
      server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
      dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
      officer(server, a, 500_000);
      officer(server, b, 500_000);
      await priv(server).saveCharacter(a);
      await priv(server).saveCharacter(b);
      stamp(server, a);
      stamp(server, b);
      const start = durablePurse(1) + durablePurse(2);
      dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 400_000 });
      dispatch(server, b, { cmd: 'guild_bank_withdraw_gold', amount: 400_000 });
      dbMock.setFence(1);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      await priv(server).saveCharacter(a);
      await priv(server).saveCharacter(b);
      warn.mockRestore();
      err.mockRestore();
      const end =
        durablePurse(1) + durablePurse(2) + (dbMock.durableBooks.get(GUILD_ID) as Book).treasury;
      expect(`round ${round}: ${end - start}`).toBe(`round ${round}: 0`);
    }
  });
});

function countFangs(state: unknown): number {
  const inv = (state as { inventory?: { itemId: string; count: number }[] } | undefined)?.inventory;
  let n = 0;
  for (const s of inv ?? []) if (s.itemId === 'wolf_fang') n += s.count;
  return n;
}

// ---------------------------------------------------------------------------
// F: the currency boundaries. These are expected to hold; they are here as
// decisive negatives so nobody re-runs them.
// ---------------------------------------------------------------------------
describe('F: treasury cap and purse overflow boundaries', () => {
  function soloOfficer(treasury: number, copper: number) {
    const server = new GameServer();
    const s = joinServer(server, 1, 'Edge');
    server.sim.loadGuildBank(GUILD_ID, { treasury, inventory: [], purchasedSlots: 24 });
    officer(server, s, copper);
    return { server, s };
  }

  it('accepts a deposit landing EXACTLY on the cap and refuses one copper past it', () => {
    const { server, s } = soloOfficer(GUILD_BANK_TREASURY_CAP - 5_000, 10_000);
    dispatch(server, s, { cmd: 'guild_bank_deposit_gold', amount: 5_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(GUILD_BANK_TREASURY_CAP);
    expect(purse(server, s)).toBe(5_000);
    // One past: refused, and NOTHING mutates (no truncation, no purse debit).
    dispatch(server, s, { cmd: 'guild_bank_deposit_gold', amount: 1 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(GUILD_BANK_TREASURY_CAP);
    expect(purse(server, s)).toBe(5_000);
  });

  it('refuses (never clamps) a withdraw that would overflow the purse past MAX_SAFE_INTEGER', () => {
    const { server, s } = soloOfficer(1_000_000, Number.MAX_SAFE_INTEGER - 999_999);
    dispatch(server, s, { cmd: 'guild_bank_withdraw_gold', amount: 1_000_000 });
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(1_000_000);
    expect(purse(server, s)).toBe(Number.MAX_SAFE_INTEGER - 999_999);
    // Exactly the headroom is allowed.
    dispatch(server, s, { cmd: 'guild_bank_withdraw_gold', amount: 999_999 });
    expect(purse(server, s)).toBe(Number.MAX_SAFE_INTEGER);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(1);
  });

  it('never lets treasury wealth pay for rung 0, nor the purse pay for rungs 1+', () => {
    // Rung 0 with an enormous treasury and an empty purse: refused.
    const { server, s } = soloOfficer(GUILD_BANK_TREASURY_CAP, 0);
    server.sim.guildBanks.get(GUILD_ID)!.purchasedSlots = 0;
    dispatch(server, s, { cmd: 'guild_bank_buy_slots' });
    expect(server.sim.guildBanks.get(GUILD_ID)?.purchasedSlots).toBe(0);
    expect(server.sim.guildBanks.get(GUILD_ID)?.treasury).toBe(GUILD_BANK_TREASURY_CAP);
    // Rung 1 with an enormous purse and an empty treasury: refused.
    const second = soloOfficer(0, Number.MAX_SAFE_INTEGER - 1);
    dispatch(second.server, second.s, { cmd: 'guild_bank_buy_slots' });
    expect(second.server.sim.guildBanks.get(GUILD_ID)?.purchasedSlots).toBe(24);
    expect(purse(second.server, second.s)).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  it('walks the whole ladder: every position valid, every charge on the right pocket', () => {
    const server = new GameServer();
    const s = joinServer(server, 1, 'Ladder');
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 0 });
    officer(server, s, 90_000);
    const positions: number[] = [];
    const purses: number[] = [];
    const treasuries: number[] = [];
    for (let i = 0; i < 8; i++) {
      // Keep the treasury funded from outside the purse so the two pockets
      // stay independently observable.
      server.sim.guildBanks.get(GUILD_ID)!.treasury += 2_000_000;
      dispatch(server, s, { cmd: 'guild_bank_buy_slots' });
      const b = server.sim.guildBanks.get(GUILD_ID)!;
      positions.push(b.purchasedSlots);
      purses.push(purse(server, s));
      treasuries.push(b.treasury);
    }
    // 8 attempts: rung 0..6 succeed, the 8th is refused at the ladder's end.
    expect(positions).toEqual([24, 30, 36, 42, 48, 54, 60, 60]);
    expect(purses[0]).toBe(0); // rung 0 emptied the PURSE
    expect(purses.every((p) => p === 0)).toBe(true); // and no later rung touched it
    // Rung 0 took nothing from the treasury; rungs 1..6 took the table price.
    const spent = treasuries.map((t, i) => 2_000_000 * (i + 1) - t);
    expect(spent).toEqual([0, 25_000, 75_000, 175_000, 425_000, 925_000, 1_925_000, 1_925_000]);
    expect(guildBankRungsBought(60)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// I: revert-path ledger truth.
// ---------------------------------------------------------------------------
describe('I: the revert path writes no compensating ledger rows', () => {
  it('a surgical revert leaves the ledger claiming ops that no longer exist', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'RevA');
    const b = joinServer(server, 2, 'RevB');
    await settle();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    officer(server, a, 100_000);
    officer(server, b, 100_000);
    dispatch(server, b, { cmd: 'guild_bank_deposit_gold', amount: 1_000 }); // B stays dirty
    dispatch(server, a, { cmd: 'guild_bank_deposit_gold', amount: 50_000 });
    dbMock.setFence(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(a); // surgical revert of A's op
    warn.mockRestore();
    await priv(server).saveCharacter(b);
    await bankLedgerIdle();
    const rows = capturedLedgerRows();
    // Two deposit_gold rows were written; only one op survives in the book.
    expect(rows.filter((r) => (r as { op: string }).op === 'deposit_gold')).toHaveLength(2);
    expect((dbMock.durableBooks.get(GUILD_ID) as Book).treasury).toBe(1_000);
    const findings = auditBank({
      ledgerRows: rows,
      characters: [],
      guildBanks: [
        { guild_id: GUILD_ID, realm: 'Claudemoon', data: dbMock.durableBooks.get(GUILD_ID) },
      ],
    });
    // This one the audit DOES catch (treasury_mismatch) -- documented as the
    // "evidence trail". Pinned so the contrast with the silent arms is explicit.
    expect(findings.map((f: { kind: string }) => f.kind)).toEqual(['treasury_mismatch']);
  });
});

// ---------------------------------------------------------------------------
// I/J: the overflow (revertLost) evict-and-reload arm runs even while ANOTHER
// session holds unflushed ops, and it reloads the book OVER them.
// ---------------------------------------------------------------------------
describe('an overflowing op log never restores a live withdraw', () => {
  it('leaves the withdrawn copy where the withdrawer put it', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'HolderA');
    const c = joinServer(server, 3, 'OverflowC');
    await settle();
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    dbMock.durableBooks.set(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    officer(server, a, 10_000);
    officer(server, c, 10_000);
    server.sim.addItem('wolf_fang', 4, a.pid);

    // Birth-complete history: A deposits 4 and the book commits.
    const aMeta = server.sim.players.get(a.pid);
    if (!aMeta) throw new Error('missing meta');
    dispatch(server, a, { cmd: 'guild_bank_deposit', slot: findFang(server, a), count: 4 });
    await priv(server).saveCharacter(a);
    stamp(server, a);
    stamp(server, c);
    expect((dbMock.durableBooks.get(GUILD_ID) as Book).inventory).toHaveLength(1);

    // A withdraws them again: live only (A dirty, unflushed).
    dispatch(server, a, { cmd: 'guild_bank_withdraw', slot: 0, count: 4 });
    expect(countFangs({ inventory: aMeta.inventory })).toBe(4);
    expect(server.sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([]);

    // C dirties the same book and its unflushed log overflows the cap
    // (GUILD_BANK_UNFLUSHED_OP_CAP = 500 ops), which COMPACTS it rather than
    // dropping it, so C keeps a faithful undo list.
    dispatch(server, c, { cmd: 'guild_bank_deposit_gold', amount: 1 });
    c.unflushedGuildBankOps.set(GUILD_ID, [
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
      ...(c.unflushedGuildBankOps.get(GUILD_ID) ?? []),
    ]);
    dispatch(server, c, { cmd: 'guild_bank_deposit_gold', amount: 1 });
    expect((c.unflushedGuildBankOps.get(GUILD_ID) ?? []).length).toBeLessThan(500);

    // C fences out. Only C's OWN ops are undone; A's withdrawal stands.
    dbMock.setFence(3);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await priv(server).saveCharacter(c);
    warn.mockRestore();
    stamp(server, a);
    expect(countFangs({ inventory: server.sim.guildBanks.get(GUILD_ID)?.inventory })).toBe(0);
    expect(countFangs({ inventory: aMeta.inventory })).toBe(4);

    // A's own save now commits both halves of the duplicate.
    await priv(server).saveCharacter(a);
    const durableTotal =
      countFangs(dbMock.durableChars.get(1)) +
      countFangs({ inventory: (dbMock.durableBooks.get(GUILD_ID) as Book).inventory });
    expect(durableTotal).toBe(4);
  });
});

function findFang(server: GameServer, session: ClientSession): number {
  const meta = server.sim.players.get(session.pid);
  if (!meta) throw new Error('missing meta');
  return meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
}

// ---------------------------------------------------------------------------
// J: the anonymous-pipe policy against the item families other pipes refuse.
// ---------------------------------------------------------------------------
describe('J: cross-feature item policy parity', () => {
  it('refuses every Rift-gear id trade.ts excludes by name (noMarketList must cover them)', () => {
    for (const itemId of RIFT_GEAR_ITEM_IDS) {
      expect(guildBankPipeRefusal({ itemId, count: 1 })).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// F: revertGuildBankDeltas' unconditional treasury refund.
// ---------------------------------------------------------------------------
describe('F: revert of buy_slots refunds the treasury even when the slots stay', () => {
  it('mints the rung price into the treasury when the slot undo is skipped', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: false });
    // A book sitting at the OPENED base with a pending expansion delta: the
    // slot undo (24 - 6 = 18, not a ladder position) is skipped, but the
    // treasury refund is unconditional.
    sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const delta: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -25_000,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    sim.revertGuildBankDeltas(GUILD_ID, [delta]);
    const book = sim.guildBanks.get(GUILD_ID);
    expect(book?.purchasedSlots).toBe(24); // slots kept
    expect(book?.treasury).toBe(0); // and the copper NOT re-created
  });
});
