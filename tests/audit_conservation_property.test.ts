// Guild Bank CONSERVATION, proved by property-based testing rather than by
// targeted attack. The claim under test:
//
//   Across purses, character bags, personal banks, guild bank books, and the
//   bank_ledger, TOTAL ITEMS (by item id, counting stack sizes) and TOTAL
//   COPPER are CONSERVED across any sequence of guild bank operations,
//   including sequences interrupted by saves, lease fences, and crashes.
//
// Copper is conserved MODULO the ladder sink: rung 0 burns 90_000 from the
// clicking officer's purse and rungs 1..6 burn the table price from the
// treasury. Nothing else receives that copper, so the closed-form accounting
// term is ladderBurn(purchasedSlots): the exact copper a book's current ladder
// position proves was burned. The conserved quantity is therefore
//
//   sum(purses) + sum(treasuries) + sum(ladderBurn(book.purchasedSlots))
//
// which must equal its starting value after ANY op sequence.
//
// The harness drives the REAL GameServer + Sim with a FAKE DURABLE DATABASE
// (server/db mocked with an in-memory store that honours the character-lease
// fence), so "durable state" is a first-class thing this file can read: a
// crash is modelled by discarding live state and totalling the store, and a
// lease fence-out is modelled by rolling the acting character back to its
// durable row exactly as a same-account takeover does.
//
// Every run is reproducible from a printed seed; failures are minimized to the
// shortest still-failing op sequence by delta debugging (shrinkSteps below).
//
// PERMANENT characterization suite. Most of it is a property that must simply
// hold; the blocks labelled P4-RESIDUE and P5 are CHARACTERIZATIONS of residues
// the design deliberately leaves open (docs/guild-bank/state.md), pinned with
// their exact witnesses and their exact sizes so a change to either is loud
// rather than silent. A few sweeps carry a generator restriction labelled
// "D5 MARKER": that is what keeps a sweep from re-deriving a pinned residue,
// and each one names the residue it marks. Restrictions that existed only to
// steer sweeps away from the OLD shared-book save window are gone: every sweep
// now runs both officers acting and both officers saving.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The fake durable database. Reads and writes an in-memory store instead of
// Postgres, so the harness can total DURABLE state and replay the ledger.
// The lease fence is modelled by the nonce: any nonce starting with 'stale'
// matches no row, exactly like a rotated lease (the guild_bank_persistence
// idiom, promoted here into the store itself so the write is skipped too).
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => {
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  const chars = new Map<number, Record<string, unknown>>();
  const bookRows = new Map<number, unknown>();
  const ledger: Record<string, unknown>[] = [];
  let ledgerId = 0;
  const fenced = (nonce: unknown): boolean =>
    typeof nonce === 'string' && nonce.startsWith('stale');
  // Wired to the REAL server/guild_bank_state mergeGuildBankRow after the
  // imports below (vi.hoisted runs before them). The escrow save's payload is
  // a session's own delta log and the row is rebuilt INSIDE the transaction,
  // so a store that just stashed the payload would model nothing.
  const merge = {
    // biome-ignore lint/suspicious/noExplicitAny: bound to the real merge below
    fn: null as null | ((durable: unknown, deltas: any) => { data: unknown; result: any }),
    // biome-ignore lint/suspicious/noExplicitAny: bound to the real error below
    refused: null as null | (new (results: any[]) => Error),
  };
  const writeBooks = (
    // biome-ignore lint/suspicious/noExplicitAny: the delta payload shape
    books: readonly { guildId: number; deltas: any }[] | undefined,
    // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
    results: any[] | undefined,
  ): void => {
    // A refused book half aborts the whole transaction, character row
    // included, exactly as server/db.ts does it.
    // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
    const written: any[] = [];
    const pending: [number, unknown][] = [];
    for (const b of books ?? []) {
      if (!merge.fn) throw new Error('merge not wired');
      const merged = merge.fn(bookRows.get(b.guildId) ?? null, b.deltas);
      if (merged.data !== null) pending.push([b.guildId, clone(merged.data)]);
      written.push({ guildId: b.guildId, ...merged.result });
    }
    results?.push(...written);
    if (written.some((r) => !r.written)) {
      if (!merge.refused) throw new Error('refusal not wired');
      throw new merge.refused(written);
    }
    for (const [guildId, data] of pending) bookRows.set(guildId, data);
  };
  return {
    clone,
    chars,
    bookRows,
    ledger,
    merge,
    reset(): void {
      chars.clear();
      bookRows.clear();
      ledger.length = 0;
      ledgerId = 0;
    },
    saveCharacterState: vi.fn(
      async (characterId: number, _level: number, state: unknown, nonce?: unknown) => {
        if (fenced(nonce)) return false;
        chars.set(characterId, clone(state) as Record<string, unknown>);
        return true;
      },
    ),
    saveCharacterAndGuildBankState: vi.fn(
      async (
        characterId: number,
        _level: number,
        state: unknown,
        // biome-ignore lint/suspicious/noExplicitAny: the delta payload shape
        books: { guildId: number; deltas: any }[],
        nonce?: unknown,
        // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
        results?: any[],
      ) => {
        if (fenced(nonce)) return false;
        writeBooks(books, results);
        chars.set(characterId, clone(state) as Record<string, unknown>);
        return true;
      },
    ),
    saveCharacterAndMarketState: vi.fn(
      async (
        characterId: number,
        _level: number,
        state: unknown,
        _market: unknown,
        _mail: unknown,
        nonce?: unknown,
        // biome-ignore lint/suspicious/noExplicitAny: the delta payload shape
        books?: { guildId: number; deltas: any }[],
        // biome-ignore lint/suspicious/noExplicitAny: the write-result shape
        results?: any[],
      ) => {
        if (fenced(nonce)) return false;
        writeBooks(books, results);
        chars.set(characterId, clone(state) as Record<string, unknown>);
        return true;
      },
    ),
    insertBankLedgerRow: vi.fn(async (row: Record<string, unknown>) => {
      ledgerId += 1;
      ledger.push({
        id: ledgerId,
        realm: row.realm,
        character_id: row.characterId,
        account_id: row.accountId,
        op: row.op,
        item_id: row.itemId,
        count: row.count,
        instance: row.instance ?? null,
        copper_delta: row.copperDelta,
        purchased_slots_after: row.purchasedSlotsAfter,
        container: row.container,
        container_id: row.containerId,
        // The COUNTERPARTY (payer/payee) side. Carried through here so the P3
        // audit reconciliation below checks the per-op balance identity on
        // rows the REAL server wrote, over every sequence the sweeps generate,
        // not only on the hand-built fixtures in tests/bank_audit.test.ts.
        counterparty_copper_delta: row.counterpartyCopperDelta,
        counterparty_count: row.counterpartyCount,
      });
    }),
    loadGuildBankRows: vi.fn(async () =>
      [...bookRows.entries()].map(([guildId, data]) => ({
        guildId,
        data: clone(data),
        oversized: false,
      })),
    ),
  };
});

// The five recorders above are called on EVERY step of EVERY generated
// sequence, and the sweeps below run thousands of sequences inside a single
// `it`. A vi.fn retains each call's arguments in `mock.calls` (and its
// resolved promise in `mock.results`), so every character save blob and guild
// bank delta payload the harness ever produced stayed reachable for the whole
// test file: the worker climbed past the ~4 GB CI heap limit and died with
// "Ineffective mark-compacts near heap limit", taking a whole shard with it.
// Nothing in this file asserts on the history, so it is bounded to one
// generated sequence (see runSteps) instead of one `it`.
const clearStoreHistory = (): void => {
  store.saveCharacterState.mockClear();
  store.saveCharacterAndGuildBankState.mockClear();
  store.saveCharacterAndMarketState.mockClear();
  store.insertBankLedgerRow.mockClear();
  store.loadGuildBankRows.mockClear();
};

// DURABLE guild membership for the escrow-carrier read: the carrier is chosen
// from socialDb.guildMembers now (a stale session stamp must not put an
// ex-member on the quarantine-and-kick path), so the harness answers that one
// statement from the live actor set. Kept in sync by stampAll below.
const guildMemberRows: { id: number; rank: string }[] = [];

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(async (text: string) =>
      text.includes('FROM guild_members gm JOIN characters c')
        ? { rows: guildMemberRows }
        : { rows: [] },
    ),
  },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  saveCharacterState: store.saveCharacterState,
  saveCharacterAndGuildBankState: store.saveCharacterAndGuildBankState,
  saveCharacterAndMarketState: store.saveCharacterAndMarketState,
  insertBankLedgerRow: store.insertBankLedgerRow,
  loadGuildBankRows: store.loadGuildBankRows,
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  releaseCharacterLease: vi.fn(async () => {}),
  // The rest of server/game.ts's db surface, stubbed inert: none of it moves
  // copper or items, but an undefined export throws into the join path.
  grantAccountWeaponSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadMarketState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveMailState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveRiftState: vi.fn(async () => {}),
  setAccountWeaponSkinLoadout: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
}));

import { auditBank, type BankLedgerAuditRow } from '../scripts/bank_audit.mjs';
import { bankLedgerIdle } from '../server/bank_ledger';
import { type ClientSession, GameServer } from '../server/game';
import { GuildBankEscrowRefused, mergeGuildBankRow } from '../server/guild_bank_state';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  GUILD_BANK_RUNG_PRICES,
  type GuildBankState,
  guildBankRungsBought,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import type { InvSlot, WorldContent } from '../src/sim/types';

// Wire the fake durable table to the REAL escrow merge (see store.merge).
store.merge.fn = (durable, deltas) => mergeGuildBankRow(durable, deltas);
store.merge.refused = GuildBankEscrowRefused;

// ---------------------------------------------------------------------------
// Seeded, reproducible randomness for the harness itself (NOT sim randomness:
// the sim's guild bank module draws no rng at all, and every op below is a
// deterministic function of its arguments). mulberry32; the seed is printed on
// every failure so a break replays exactly.
// ---------------------------------------------------------------------------
function rngFor(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The op alphabet + the injected events, as a portable step list. Slot picks
// are stored as raw [0,1) draws and resolved against live state at execution
// time, so a shrunk sequence stays meaningful after earlier steps are removed.
// ---------------------------------------------------------------------------
type ActorIndex = 0 | 1;

type Step =
  // ops
  | { k: 'deposit'; a: ActorIndex; pick: number; whole: boolean; cnt: number }
  | { k: 'withdraw'; a: ActorIndex; pick: number; whole: boolean; cnt: number }
  | { k: 'deposit_gold'; a: ActorIndex; amt: number }
  | { k: 'withdraw_gold'; a: ActorIndex; amt: number }
  | { k: 'buy'; a: ActorIndex } // rung 0 opens the bank (purse), rungs 1+ expand (treasury)
  // injected events
  | { k: 'autosave'; a: ActorIndex }
  | { k: 'saveall' } // the shutdown flush
  | { k: 'leaveflush'; a: ActorIndex }
  | { k: 'writerwait'; a: ActorIndex; inner: Step[] } // serial-writer wait, ops land mid-wait
  | { k: 'fence'; a: ActorIndex } // lease fence / self-takeover + reconcile/revert
  | { k: 'leaveflushfail'; a: ActorIndex } // leave flush exhausts its retries -> reconcile
  // The OPERATOR dormant-slot purge (server/game.ts adminPurgeGuildBankSlot).
  // It is an OP (it mutates a book through runGuildBankOp exactly like a player
  // withdraw, takes an unflushed delta, and reverts on a fence-out), but it
  // AWAITS its own escrow save, so it rides the async event lane rather than
  // the synchronous op lane. Before this it never met the concurrency or
  // fence-injection machinery at all, even though it mutates a book like any
  // other op.
  | { k: 'purge' };

const OP_KINDS: Step['k'][] = ['deposit', 'withdraw', 'deposit_gold', 'withdraw_gold', 'buy'];

const GOLD_AMOUNTS = [1, 250, 5_000, 25_000, 90_000, 400_000, 999_999_999];

function genOp(rnd: () => number, a: ActorIndex, allowed: Step['k'][] = OP_KINDS): Step {
  const k = allowed[Math.floor(rnd() * allowed.length)];
  switch (k) {
    case 'deposit':
      return { k, a, pick: rnd(), whole: rnd() < 0.5, cnt: 1 + Math.floor(rnd() * 6) };
    case 'withdraw':
      return { k, a, pick: rnd(), whole: rnd() < 0.5, cnt: 1 + Math.floor(rnd() * 6) };
    case 'deposit_gold':
      return { k, a, amt: GOLD_AMOUNTS[Math.floor(rnd() * GOLD_AMOUNTS.length)] };
    case 'withdraw_gold':
      return { k, a, amt: GOLD_AMOUNTS[Math.floor(rnd() * GOLD_AMOUNTS.length)] };
    default:
      return { k: 'buy', a };
  }
}

interface GenConfig {
  depth: number;
  /** Probability that a generated step is an injected event rather than an op. */
  eventRate: number;
  /** Event kinds this generator may emit. */
  events: Step['k'][];
  /** Which officers may act. Both, always, since the escrow root fix: the
   *  restriction that used to live here existed ONLY to steer sweeps away from
   *  the shared-book save window, and that window no longer exists. Kept as a
   *  knob for the explicit scenarios below. */
  opActors?: ActorIndex[];
  /** Which officer a FENCE may kill. Retained only so a scenario can be
   *  written deterministically; the sweeps no longer need it, because
   *  consume-then-fence is refused rather than carried. */
  fenceActor?: ActorIndex;
  /** Op kinds a given officer is restricted to. Used to keep the SECOND
   *  officer from consuming the fenced officer's un-durable value (withdrawing
   *  the copper or the copy) or advancing the ladder past the opened base:
   *  both are documented CLAMPED-RESIDUE arms of revertGuildBankDeltas, pinned
   *  separately below, and excluding them is what turns the surgical-revert
   *  property into an exact equality. */
  opKindsByActor?: Partial<Record<ActorIndex, Step['k'][]>>;
}

function genSteps(seed: number, cfg: GenConfig): Step[] {
  const rnd = rngFor(seed);
  const steps: Step[] = [];
  const opActors = cfg.opActors ?? [0, 1];
  const pickOpActor = (): ActorIndex => opActors[Math.floor(rnd() * opActors.length)];
  // Vary the depth with the seed so a sweep covers short and long sequences
  // rather than one fixed length.
  const depth = cfg.depth + (seed % 17);
  for (let i = 0; i < depth; i++) {
    if (cfg.events.length > 0 && rnd() < cfg.eventRate) {
      const ev = cfg.events[Math.floor(rnd() * cfg.events.length)];
      const a: ActorIndex = (ev === 'fence' ? cfg.fenceActor : undefined) ?? (rnd() < 0.5 ? 0 : 1);
      if (ev === 'writerwait') {
        const inner: Step[] = [];
        const n = 1 + Math.floor(rnd() * 2);
        for (let j = 0; j < n; j++) {
          const ia = pickOpActor();
          inner.push(genOp(rnd, ia, cfg.opKindsByActor?.[ia] ?? OP_KINDS));
        }
        steps.push({ k: 'writerwait', a, inner });
      } else if (ev === 'saveall' || ev === 'purge') {
        steps.push({ k: ev });
      } else {
        steps.push({ k: ev, a } as Step);
      }
      continue;
    }
    const a = pickOpActor();
    steps.push(genOp(rnd, a, cfg.opKindsByActor?.[a] ?? OP_KINDS));
  }
  return steps;
}

function fmtStep(s: Step): string {
  switch (s.k) {
    case 'deposit':
    case 'withdraw':
      return `${s.k}(a${s.a}, pick=${s.pick.toFixed(3)}, ${s.whole ? 'whole' : `cnt=${s.cnt}`})`;
    case 'deposit_gold':
    case 'withdraw_gold':
      return `${s.k}(a${s.a}, ${s.amt})`;
    case 'writerwait':
      return `writerwait(a${s.a}, mid-wait:[${s.inner.map(fmtStep).join(', ')}])`;
    case 'saveall':
      return 'saveall(shutdown flush)';
    case 'purge':
      return 'purge(operator dormant-slot purge)';
    default:
      return `${s.k}(a${(s as { a: ActorIndex }).a})`;
  }
}

const fmtSteps = (steps: Step[]): string => steps.map((s, i) => `  ${i}. ${fmtStep(s)}`).join('\n');

// ---------------------------------------------------------------------------
// The conservation oracle.
// ---------------------------------------------------------------------------
interface Totals {
  copper: number;
  /** By item id only (the stated invariant), summing stack counts. */
  items: Map<string, number>;
  /** By id + canonical instance payload + craft provenance (a strictly finer
   *  multiset: catches provenance laundering that the id-only sum hides). */
  fine: Map<string, number>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function emptyTotals(): Totals {
  return { copper: 0, items: new Map(), fine: new Map() };
}

function addSlots(t: Totals, slots: readonly InvSlot[] | undefined): void {
  for (const s of slots ?? []) {
    if (!s || typeof s !== 'object' || typeof s.itemId !== 'string') continue;
    const n = Number(s.count) || 0;
    t.items.set(s.itemId, (t.items.get(s.itemId) ?? 0) + n);
    const key = `${s.itemId}|${canonical(s.instance ?? null)}|${s.craftedRecipeId ?? ''}`;
    t.fine.set(key, (t.fine.get(key) ?? 0) + n);
  }
}

/** The copper a book's ladder position PROVES was burned: rung 0 from a purse,
 *  rungs 1+ from the treasury. This is the closed-form sink term that makes
 *  copper conservation an exact equality rather than an inequality. */
function ladderBurn(purchasedSlots: number): number {
  const rungs = guildBankRungsBought(purchasedSlots);
  let sum = 0;
  for (let i = 0; i < rungs; i++) sum += GUILD_BANK_RUNG_PRICES[i];
  return sum;
}

/** The DORMANT copies the book starts with: each carries a per-copy transfer
 *  lock, so the anonymous-pipe policy refuses it in BOTH directions and no
 *  player op can ever move it. They exist so the OPERATOR purge has something
 *  legal to remove; they are the reason that hatch exists in the first place
 *  (an item a later content update locks, stranded in a book forever).
 *
 *  Seeded into the book rather than into bags because a deposit would refuse
 *  them, which is the whole point. The birth-complete ledger row that explains
 *  their presence is written in makeWorld. */
const DORMANT_SEED: InvSlot[] = [
  { itemId: 'wolf_fang', count: 2, instance: { boundTo: 901 } },
  { itemId: 'wolf_fang', count: 1, instance: { boundTo: 902 } },
  { itemId: 'copper_ore', count: 3, instance: { boundTo: 903 } },
];

/** The copies a book's dormant seed proves were DESTROYED: seeded minus still
 *  present. A purge removes a copy from the world with no counterpart (that is
 *  what makes it a destructive operator tool), so conservation needs the same
 *  kind of closed-form sink term the ladder burn already supplies.
 *
 *  Derived from STATE rather than tallied as the harness watches purges go by,
 *  and that is load-bearing: a fenced-out escrow REVERTS a purge, putting the
 *  copy back, and a durable row can lag a live book by an unflushed one. A
 *  counter would drift on both; a difference against present state is exact in
 *  every view, at every instant, with no bookkeeping to keep in sync. */
function addPurgeBurn(t: Totals, book: GuildBankState | null | undefined): void {
  const inv = book?.inventory ?? [];
  for (const seed of DORMANT_SEED) {
    const key = `${seed.itemId}|${canonical(seed.instance ?? null)}|${seed.craftedRecipeId ?? ''}`;
    let present = 0;
    for (const slot of inv) {
      const slotKey = `${slot.itemId}|${canonical(slot.instance ?? null)}|${slot.craftedRecipeId ?? ''}`;
      if (slotKey === key) present += Number(slot.count) || 0;
    }
    const destroyed = seed.count - present;
    if (destroyed === 0) continue;
    t.items.set(seed.itemId, (t.items.get(seed.itemId) ?? 0) + destroyed);
    t.fine.set(key, (t.fine.get(key) ?? 0) + destroyed);
  }
}

function addBook(t: Totals, book: GuildBankState | null | undefined): void {
  if (!book) return;
  t.copper += Number(book.treasury) || 0;
  t.copper += ladderBurn(Number(book.purchasedSlots) || 0);
  addSlots(t, book.inventory);
  addPurgeBurn(t, book);
}

function totalsEqual(a: Totals, b: Totals): boolean {
  if (a.copper !== b.copper) return false;
  const keys = new Set([...a.items.keys(), ...b.items.keys()]);
  for (const k of keys) if ((a.items.get(k) ?? 0) !== (b.items.get(k) ?? 0)) return false;
  const fk = new Set([...a.fine.keys(), ...b.fine.keys()]);
  for (const k of fk) if ((a.fine.get(k) ?? 0) !== (b.fine.get(k) ?? 0)) return false;
  return true;
}

function diffTotals(expected: Totals, actual: Totals): string {
  const lines: string[] = [];
  if (expected.copper !== actual.copper) {
    const d = actual.copper - expected.copper;
    lines.push(
      `COPPER ${d > 0 ? 'MINTED' : 'DESTROYED'}: expected ${expected.copper}, got ${actual.copper} (delta ${d > 0 ? '+' : ''}${d})`,
    );
  }
  const keys = [...new Set([...expected.items.keys(), ...actual.items.keys()])].sort();
  for (const k of keys) {
    const e = expected.items.get(k) ?? 0;
    const a = actual.items.get(k) ?? 0;
    if (e !== a) {
      lines.push(
        `ITEM ${k} ${a > e ? 'MINTED' : 'DESTROYED'}: expected ${e}, got ${a} (delta ${a > e ? '+' : ''}${a - e})`,
      );
    }
  }
  const fk = [...new Set([...expected.fine.keys(), ...actual.fine.keys()])].sort();
  for (const k of fk) {
    const e = expected.fine.get(k) ?? 0;
    const a = actual.fine.get(k) ?? 0;
    if (e !== a) lines.push(`FINE ${k}: expected ${e}, got ${a} (delta ${a - e})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The world: a real GameServer, two officer sessions of one guild, both at a
// banker, with the guild's book UNOPENED so ladder rung 0 (open_bank) is
// reachable inside the op alphabet.
// ---------------------------------------------------------------------------
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];

// This suite never ticks the sim: every step is a synchronous guild-bank
// dispatch, a save, or a fence, so it only ever reaches bank/character/purse
// state through the three banker NPCs above. GameServer's Sim has no `world`
// option of its own (server/game.ts constructs `new Sim({...})`
// unconditionally, with no world field), so trimming its spawn roster goes
// through the same setActiveWorldContent seam every zones/colliders test uses
// in place of a Sim-constructor `world:` field. Zones/roads/props/services
// stay the full built-in world (terrain and collision geometry this file
// never touches); only the camp mobs, the ambient NPC roster, and ground loot
// are trimmed, since makeWorld() below builds a fresh GameServer for EVERY
// generated step sequence (thousands across the property sweeps below) and
// none of them ever reach for a camp, a non-banker NPC, or a ground object.
// Set once for the whole file (every test here wants the same trim), so there
// is never a point mid-run where this Sim's captured worldContent and the
// collider builder's getActiveWorldContent() read could disagree.
const AUDIT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(
    Object.entries(BUILTIN_WORLD.npcs).filter(([id]) => BANKERS.includes(id)),
  ),
  groundObjects: [],
};
setActiveWorldContent(AUDIT_TEST_WORLD);
afterAll(() => setActiveWorldContent(null));

const GUILD_ID = 4242;
// The acting operator behind an injected purge. An admin account, never one of
// the two officers: the ledger row books the OPERATOR'S account beside the
// carrier's character, which is the one row shape where the two differ.
const OPERATOR_ACCOUNT_ID = 9001;
const START_COPPER = 400_000;
// The treasury starts EMPTY on purpose: scripts/bank_audit.mjs treats a guild
// book as birth-complete (every copper in it must be replayable from ledger
// rows), so seeding a treasury out of thin air would make the replay disagree
// by construction. Every copper the treasury ever holds here arrives through a
// real deposit_gold op that wrote its own ledger row.
const START_TREASURY = 0;

interface Actor {
  session: ClientSession;
  pid: number;
  characterId: number;
  /** False once a fence-out (or a modelled leave) made this session's LIVE
   *  character state unpersistable: its truth is its durable row. */
  alive: boolean;
}

interface World {
  server: GameServer;
  actors: Actor[];
  clock: number;
  /** True once ANY session's escrow was rolled back. From that moment the LIVE
   *  snapshot is mid-repair: a session that consumed value the rolled-back one
   *  had not made durable is itself condemned (its every save is refused until
   *  it is rolled back too), and the oracle cannot tell that from live state
   *  alone. Runs that reach this are judged on DURABLE state after a quiesce,
   *  which is the claim that actually matters and which the repair converges
   *  to. Steps before it are still checked live, step by step. */
  rolledBack: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: the harness spans private seams (dispatch, saveCharacter, reconcile)
const priv = (server: GameServer): any => server as any;

function fakeWs(): unknown {
  return {
    readyState: 1,
    send: () => {},
    close: () => {},
    terminate: () => {},
  };
}

function moveToBanker(server: GameServer, pid: number): void {
  for (const e of server.sim.entities.values()) {
    if (e.kind === 'npc' && BANKERS.includes(e.templateId ?? '')) {
      const p = server.sim.entities.get(pid);
      if (!p) throw new Error(`missing player ${pid}`);
      p.pos = { ...e.pos };
      p.prevPos = { ...p.pos };
      server.sim.rebucket(p);
      return;
    }
  }
  throw new Error('no banker NPC spawned in the server world');
}

/** The starting carried inventory: two plain stackables, an unstackable
 *  weapon, a crafted-marked plain stack (provenance dimension), and a
 *  mergeable instanced stack (payload dimension). All five pass the
 *  anonymous-pipe policy, so every one of them can legally ride the bank. */
function seedInventory(server: GameServer, pid: number, tag: string): void {
  server.sim.addItem('wolf_fang', 12, pid, { silent: true });
  server.sim.addItem('copper_ore', 7, pid, { silent: true });
  server.sim.addItem('worn_sword', 1, pid, { silent: true });
  server.sim.addItem('copper_ore', 5, pid, { silent: true, craftedRecipeId: 'smelt_copper' });
  const meta = server.sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  meta.inventory.push({ itemId: 'wolf_fang', count: 3, instance: { signer: tag } });
  meta.copper = START_COPPER;
  // The personal bank participates in the conserved total but is never touched
  // by a guild bank op: seeding it proves nothing leaks across that boundary.
  meta.bank.inventory.push({ itemId: 'wolf_fang', count: 4 });
  meta.bank.inventory.push({ itemId: 'copper_ore', count: 2 });
}

async function makeWorld(): Promise<World> {
  store.reset();
  // Drop every mock's recorded call history along with the store: a sweep
  // builds hundreds of worlds inside ONE test, and vi.fn() retains each
  // call's full argument graph (every save's serialized character, every
  // ledger row). Nothing reads the histories, but across a 400-seed sweep
  // they pin gigabytes and OOM the vitest fork on CI runners (the shard-6
  // "Worker exited unexpectedly" failure). The per-test beforeEach clear
  // stays for the suites that assert against a fresh history.
  vi.clearAllMocks();
  const server = new GameServer();
  const actors: Actor[] = [];
  for (const characterId of [1, 2]) {
    const session = server.join(
      fakeWs() as never,
      characterId,
      characterId,
      `Officer${characterId}`,
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    moveToBanker(server, session.pid);
    seedInventory(server, session.pid, `S${characterId}`);
    actors.push({ session, pid: session.pid, characterId, alive: true });
  }
  server.sim.loadGuildBank(GUILD_ID, {
    treasury: START_TREASURY,
    inventory: DORMANT_SEED.map((s) => ({ ...s, instance: { ...s.instance } })),
    purchasedSlots: 0,
  });
  const w: World = { server, actors, clock: Date.now(), rolledBack: false };
  stampAll(w);
  // Establish the durable baseline: every character row and the book row start
  // exactly equal to live state, so DURABLE totals start at INITIAL too.
  store.bookRows.set(GUILD_ID, store.clone(server.sim.serializeGuildBank(GUILD_ID)));
  for (const a of actors) {
    store.chars.set(a.characterId, store.clone(server.sim.serializeCharacter(a.pid)) as never);
  }
  store.ledger.length = 0;
  // The guild book is BIRTH-COMPLETE to scripts/bank_audit.mjs: every copy in
  // it must be replayable from ledger rows. The dormant seed models copies
  // deposited before a content update locked them, so it gets the deposit rows
  // that deposit would have written. They deliberately carry NO counterparty
  // side: they are exactly the pre-feature rows the audit must SKIP rather than
  // read as balanced, so every run also exercises that path.
  // Written through the SAME writer the server uses, so they take ids from the
  // one counter and can never collide with (or sort ahead of) a real op's row.
  for (const seed of DORMANT_SEED) {
    await store.insertBankLedgerRow({
      realm: 'Claudemoon',
      characterId: actors[0].characterId,
      accountId: actors[0].characterId,
      op: 'deposit',
      itemId: seed.itemId,
      count: seed.count,
      instance: seed.instance ?? null,
      copperDelta: 0,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: GUILD_ID,
      counterpartyCopperDelta: null,
      counterpartyCount: null,
    });
  }
  return w;
}

/** The OPERATOR purge, as an injected event. Picks the first slot the
 *  anonymous-pipe policy actually refuses (the only kind the hatch will touch)
 *  and runs the REAL admin entry point, which mutates through runGuildBankOp
 *  and then AWAITS its own escrow save, so it meets the fence, the refusal, and
 *  the serial writer exactly like a player op does. A refusal (no dormant slot
 *  left, no carrier, a delete window, a save that did not survive) is a no-op
 *  by design and is tallied so the sweep can report which arms it reached. */
async function applyPurge(w: World): Promise<void> {
  // The purge is an injected event, so it does not pass through applyOp's
  // stamping; refresh both halves of membership here for the same reason.
  stampAll(w);
  const book = w.server.sim.guildBanks.get(GUILD_ID);
  if (!book) return;
  const index = book.inventory.findIndex(
    (slot) =>
      DORMANT_SEED.some(
        (seed) =>
          seed.itemId === slot.itemId &&
          canonical(seed.instance ?? null) === canonical(slot.instance ?? null),
      ) && (slot.count ?? 0) > 0,
  );
  if (index < 0) {
    coverage.bump(coverage.events, 'purge:nothing-dormant');
    return;
  }
  const itemId = book.inventory[index].itemId;
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let result: Awaited<ReturnType<GameServer['adminPurgeGuildBankSlot']>>;
  try {
    result = await w.server.adminPurgeGuildBankSlot(GUILD_ID, index, itemId, OPERATOR_ACCOUNT_ID);
  } finally {
    warnSpy.mockRestore();
    errSpy.mockRestore();
  }
  coverage.bump(coverage.events, result.ok ? 'purge:removed' : `purge:refused-${result.reason}`);
}

/** Keep the oracle's view of who can still persist honest.
 *
 *  Two ways a session stops being able to:
 *  - it was already ROLLED BACK (quarantined and kicked), so its truth is its
 *    durable row exactly like a fenced-out session's;
 *  - it is CONDEMNED: its unflushed guild-bank log can no longer be replayed
 *    onto the durable row, so every save it attempts from now on is refused
 *    and it will be rolled back the moment it tries. Reached by consuming
 *    value another officer never made durable, after that officer is gone.
 *    This is the server's own criterion, evaluated with the server's own
 *    merge, not a guess.
 *
 *  Either one puts the world mid-repair, and a mid-repair LIVE snapshot means
 *  nothing: the run is judged on durable state after the quiesce instead. */
function syncRepairState(w: World): void {
  for (const a of w.actors) {
    if (a.session.escrowQuarantined) {
      w.rolledBack = true;
      a.alive = false;
      continue;
    }
    if (!a.alive) continue;
    for (const guildId of a.session.dirtyGuildBanks.keys()) {
      const log = a.session.unflushedGuildBankOps.get(guildId) ?? [];
      if (log.length === 0) continue;
      if (!mergeGuildBankRow(store.bookRows.get(guildId) ?? null, log).result.written) {
        w.rolledBack = true;
      }
    }
  }
}

/** Re-apply the session-only membership stamp. The join-time social snapshot
 *  resolves asynchronously against the EMPTY mocked social DB and re-stamps
 *  membership null (correct server behaviour, not under test here), so any
 *  await in the harness can clear it; the stamp is host wiring with no
 *  conservation content, so re-applying it before every op is safe. */
function stampAll(w: World): void {
  guildMemberRows.length = 0;
  for (const a of w.actors) {
    if (!a.alive) continue;
    w.server.sim.setPlayerGuildMembership(a.pid, { guildId: GUILD_ID, rank: 'officer' });
    // The DURABLE half of the same fact, which is what the escrow carrier read
    // consults; a dead actor is left out so a purge cannot pick a gone session.
    guildMemberRows.push({ id: a.session.characterId, rank: 'officer' });
  }
}

const dispatch = (w: World, a: Actor, msg: Record<string, unknown>): void => {
  w.clock += 1000; // one op per second: never throttled by guild_bank_op_guard
  priv(w.server).dispatchMessage(a.session, { t: 'cmd', ...msg }, JSON.stringify(msg), w.clock);
};

/** Execute one OP (synchronous by construction: every guild bank command
 *  resolves inside the dispatch call). Returns false when the actor is gone. */
function applyOp(w: World, s: Step): boolean {
  if (s.k === 'saveall' || s.k === 'purge') return false;
  const a = w.actors[(s as { a: ActorIndex }).a];
  if (!a || !a.alive) return false;
  stampAll(w);
  const meta = w.server.sim.players.get(a.pid);
  if (!meta) return false;
  switch (s.k) {
    case 'deposit': {
      const n = meta.inventory.length;
      if (n === 0) return false;
      const slot = Math.min(n - 1, Math.floor(s.pick * n));
      dispatch(w, a, {
        cmd: 'guild_bank_deposit',
        slot,
        ...(s.whole ? {} : { count: s.cnt }),
      });
      return true;
    }
    case 'withdraw': {
      const book = w.server.sim.guildBanks.get(GUILD_ID);
      const n = book?.inventory.length ?? 0;
      if (n === 0) return false;
      const slot = Math.min(n - 1, Math.floor(s.pick * n));
      dispatch(w, a, {
        cmd: 'guild_bank_withdraw',
        slot,
        ...(s.whole ? {} : { count: s.cnt }),
      });
      return true;
    }
    case 'deposit_gold':
      dispatch(w, a, { cmd: 'guild_bank_deposit_gold', amount: s.amt });
      return true;
    case 'withdraw_gold':
      dispatch(w, a, { cmd: 'guild_bank_withdraw_gold', amount: s.amt });
      return true;
    case 'buy':
      dispatch(w, a, { cmd: 'guild_bank_buy_slots' });
      return true;
    default:
      return false;
  }
}

async function applyEvent(w: World, s: Step): Promise<void> {
  if (s.k === 'saveall') {
    await w.server.saveAll('shutdown');
    return;
  }
  if (s.k === 'purge') {
    await applyPurge(w);
    return;
  }
  const a = w.actors[(s as { a: ActorIndex }).a];
  if (!a || !a.alive) return;
  switch (s.k) {
    case 'autosave':
      await priv(w.server).saveCharacter(a.session);
      return;
    case 'leaveflush':
      // The leave path (withMarket): character + market + mail + books in one
      // fenced transaction. The session keeps playing here; only the WRITE
      // path is what this event injects.
      await priv(w.server).saveCharacterOnLeave(a.session);
      return;
    case 'writerwait': {
      // Occupy the shared market serial writer so the escrow save has a real
      // queue wait, then land ops DURING the wait: both escrow halves must be
      // captured at one instant inside the queued thunk.
      let release: (() => void) | undefined;
      const blocker = new Promise<void>((r) => {
        release = r;
      });
      void priv(w.server).enqueueMarketWrite(() => blocker);
      const save = priv(w.server).saveCharacter(a.session);
      for (const inner of s.inner) applyOp(w, inner);
      release?.();
      await save;
      return;
    }
    case 'leaveflushfail': {
      // Every leave-flush attempt fails, so this session tears down with its
      // book mutations permanently unflushable: the give-up arm must reconcile
      // exactly like a fence-out (server/game.ts saveCharacterOnLeave).
      const orig = store.saveCharacterAndMarketState.getMockImplementation();
      store.saveCharacterAndMarketState.mockImplementation(async () => {
        throw new Error('db down');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const dirty = a.session.dirtyGuildBanks.size;
      await priv(w.server).saveCharacterOnLeave(a.session);
      errSpy.mockRestore();
      if (orig) store.saveCharacterAndMarketState.mockImplementation(orig);
      // One arm only since the escrow root fix: there is no evict-and-reload
      // to fall into, so the give-up path always undoes this session's own ops.
      coverage.bump(
        coverage.events,
        dirty === 0 ? 'exhausted-leave:nothing-to-undo' : 'exhausted-leave:own-ops-undone',
      );
      a.alive = false;
      return;
    }
    case 'fence': {
      // Lease fence / self-takeover: the acting character's escrow write
      // matches no row, so its character half rolls back to the durable row
      // and revertOwnGuildBookOps must return the live book to
      // what the next durable commit will contain. `left` is pre-set only to
      // suppress the fire-and-forget kick (the harness models the death
      // itself, deterministically).
      a.session.left = true;
      a.session.leaseNonce = 'stale-nonce';
      const dirty = a.session.dirtyGuildBanks.size;
      const unflushed = [...a.session.unflushedGuildBankOps.values()].reduce(
        (n, log) => n + log.length,
        0,
      );
      await priv(w.server).saveCharacter(a.session);
      if (dirty === 0) coverage.bump(coverage.events, 'fence:nothing-to-undo');
      else {
        coverage.bump(coverage.events, 'fence:own-ops-undone');
        coverage.bump(coverage.events, 'fence:unflushed-ops-reverted', unflushed);
      }
      a.alive = false;
      return;
    }
    default:
      return;
  }
}

const EVENT_KINDS = new Set<Step['k']>([
  'autosave',
  'saveall',
  'leaveflush',
  'leaveflushfail',
  'writerwait',
  'fence',
  'purge',
]);
const isEvent = (s: Step): boolean => EVENT_KINDS.has(s.k);

// ---------------------------------------------------------------------------
// Snapshots of the two state views the oracle compares.
// ---------------------------------------------------------------------------

/** The EFFECTIVE total: live state for every session that can still persist,
 *  the DURABLE row for every session whose live state can never persist again
 *  (a fenced-out session's character half is rolled back by definition), plus
 *  the shared live books. This is the quantity a fence must not change. */
function effectiveTotals(w: World): Totals {
  const t = emptyTotals();
  for (const a of w.actors) {
    if (a.alive) {
      const meta = w.server.sim.players.get(a.pid);
      if (!meta) continue;
      t.copper += meta.copper;
      addSlots(t, meta.inventory);
      addSlots(t, meta.bank.inventory);
    } else {
      const row = store.chars.get(a.characterId) as
        | { copper?: number; inventory?: InvSlot[]; bank?: { inventory?: InvSlot[] } }
        | undefined;
      if (!row) continue;
      t.copper += Number(row.copper) || 0;
      addSlots(t, row.inventory);
      addSlots(t, row.bank?.inventory);
    }
  }
  for (const [, book] of w.server.sim.guildBanks) addBook(t, book);
  return t;
}

/** The DURABLE total: what a crash-and-restart would find on disk. */
function durableTotals(): Totals {
  const t = emptyTotals();
  for (const [, row] of store.chars) {
    const r = row as { copper?: number; inventory?: InvSlot[]; bank?: { inventory?: InvSlot[] } };
    t.copper += Number(r.copper) || 0;
    addSlots(t, r.inventory);
    addSlots(t, r.bank?.inventory);
  }
  for (const [, data] of store.bookRows) addBook(t, sanitizeGuildBankState(data));
  return t;
}

/** Per-container dump: exactly where the missing (or extra) value sits, so a
 *  reported violation names the torn half rather than only its size. */
function dumpState(w: World): string {
  const lines: string[] = [];
  w.actors.forEach((a, i) => {
    const meta = w.server.sim.players.get(a.pid);
    const row = store.chars.get(a.characterId) as
      | { copper?: number; inventory?: InvSlot[]; bank?: { inventory?: InvSlot[] } }
      | undefined;
    const count = (slots: readonly InvSlot[] | undefined) =>
      (slots ?? []).reduce((n, s) => n + (Number(s.count) || 0), 0);
    lines.push(
      `  actor${i} char${a.characterId} alive=${a.alive} ` +
        `LIVE copper=${meta?.copper} bagItems=${count(meta?.inventory)} bankItems=${count(meta?.bank.inventory)} | ` +
        `DURABLE copper=${row?.copper} bagItems=${count(row?.inventory)} bankItems=${count(row?.bank?.inventory)}`,
    );
  });
  const live = w.server.sim.guildBanks.get(GUILD_ID);
  const dur = sanitizeGuildBankState(store.bookRows.get(GUILD_ID));
  const bookItems = (b: GuildBankState | null | undefined) =>
    (b?.inventory ?? []).reduce((n, s) => n + (Number(s.count) || 0), 0);
  lines.push(
    `  book LIVE treasury=${live?.treasury} slots=${live?.purchasedSlots} items=${bookItems(live)} | ` +
      `DURABLE treasury=${dur.treasury} slots=${dur.purchasedSlots} items=${bookItems(dur)}`,
  );
  return lines.join('\n');
}

/** Flush every still-live session until nothing is dirty, so durable state
 *  converges to live state. Repeated passes rather than a fixed two: an op
 *  landing mid-save re-dirties the book by design, and a session whose escrow
 *  replay stalled on another officer's not-yet-durable work keeps its mark and
 *  retries on its next save (the transient escrow deficit). A real realm keeps
 *  autosaving every 30 s, so "keep saving until quiet" is what it does; the
 *  bound only stops a pathological case from spinning. */
async function quiesce(w: World): Promise<void> {
  for (let pass = 0; pass < 12; pass++) {
    let dirty = false;
    for (const a of w.actors) {
      if (!a.alive) continue;
      await priv(w.server).saveCharacter(a.session);
      if (a.session.dirtyGuildBanks.size > 0) dirty = true;
    }
    syncRepairState(w);
    if (!dirty && pass > 0) return;
  }
}

// ---------------------------------------------------------------------------
// The runner + the shrinker.
// ---------------------------------------------------------------------------
interface RunResult {
  ok: boolean;
  /** Human-readable description of the first violation observed. */
  detail: string;
  /** Ops that actually mutated something (ledger rows written). */
  ledgerRows: number;
  /** Coverage: which ops actually succeeded at least once. */
  opsSeen: Set<string>;
}

/** Global coverage tally, so the suite can REPORT precisely what it exercised
 *  (a passing property is only as strong as the state it actually reached). */
const coverage = {
  runs: 0,
  steps: 0,
  ops: new Map<string, number>(), // successful ops, by ledger op name
  events: new Map<string, number>(), // injected events actually applied
  guardDrops: 0,
  bump(map: Map<string, number>, key: string, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by);
  },
  render(): string {
    const fmt = (m: Map<string, number>) =>
      [...m.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
    return `runs=${this.runs} steps=${this.steps} | successful ops: ${fmt(this.ops)} | injected events: ${fmt(this.events)}`;
  },
};

type Check =
  | 'effective'
  | 'durable-after-quiesce'
  /** Same as above minus the ledger reconciliation: a sequence containing a
   *  fence-out leaves the reverted op's ledger rows behind BY DESIGN
   *  (docs/guild-bank/state.md, "Ledger rows for fenced-out (reverted) ops
   *  remain in bank_ledger by design"), so the audit script correctly flags a
   *  live realm there. Pinned separately below; conservation still must hold. */
  | 'durable-after-quiesce-no-ledger'
  | 'durable-crash';

async function runSteps(steps: Step[], check: Check): Promise<RunResult> {
  // Bound the mock call history to this one sequence: see clearStoreHistory.
  clearStoreHistory();
  const w = await makeWorld();
  const initial = effectiveTotals(w);
  const opsSeen = new Set<string>();
  let detail = '';

  const failEffective = (at: string): boolean => {
    // Once a rollback has happened the live snapshot is mid-repair; the run is
    // judged on durable state after the quiesce below instead.
    if (w.rolledBack) return false;
    const now = effectiveTotals(w);
    if (totalsEqual(initial, now)) return false;
    detail = `effective-total conservation broke ${at}\n${diffTotals(initial, now)}\nstate:\n${dumpState(w)}`;
    return true;
  };

  coverage.runs++;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    coverage.steps++;
    if (isEvent(s)) {
      const target = w.actors[(s as { a?: ActorIndex }).a ?? 0];
      if (s.k === 'saveall' || s.k === 'purge' || target?.alive) {
        coverage.bump(coverage.events, s.k);
      }
      await applyEvent(w, s);
    } else {
      applyOp(w, s);
    }
    syncRepairState(w);
    if (failEffective(`after step ${i} (${fmtStep(s)})`)) {
      await bankLedgerIdle();
      return { ok: false, detail, ledgerRows: store.ledger.length, opsSeen };
    }
  }
  // The ledger is fire-and-forget: drain the FIFO tail before reading it, or
  // the coverage read (and the audit replay below) sees an empty table.
  await bankLedgerIdle();
  for (const row of store.ledger) {
    opsSeen.add(String(row.op));
    coverage.bump(coverage.ops, String(row.op));
  }

  // A run that rolled a session back is judged on DURABLE state after a full
  // quiesce, whatever check it asked for: the repair converges there, and
  // there is no live snapshot in between that means anything.
  if (w.rolledBack && check !== 'durable-crash') {
    await quiesce(w);
    await bankLedgerIdle();
    const dur = durableTotals();
    if (!totalsEqual(initial, dur)) {
      return {
        ok: false,
        detail: `durable conservation broke after an escrow rollback\n${diffTotals(initial, dur)}\nstate:\n${dumpState(w)}`,
        ledgerRows: store.ledger.length,
        opsSeen,
      };
    }
    return { ok: true, detail: '', ledgerRows: store.ledger.length, opsSeen };
  }

  if (check === 'durable-crash') {
    // Crash: no quiesce. Whatever is on disk is all that survives.
    await bankLedgerIdle();
    const dur = durableTotals();
    if (!totalsEqual(initial, dur)) {
      return {
        ok: false,
        detail: `durable (crash) conservation broke\n${diffTotals(initial, dur)}\nstate:\n${dumpState(w)}`,
        ledgerRows: store.ledger.length,
        opsSeen,
      };
    }
    return { ok: true, detail: '', ledgerRows: store.ledger.length, opsSeen };
  }

  if (check === 'durable-after-quiesce' || check === 'durable-after-quiesce-no-ledger') {
    await quiesce(w);
    await bankLedgerIdle();
    if (failEffective('after the final quiesce')) {
      return { ok: false, detail, ledgerRows: store.ledger.length, opsSeen };
    }
    const dur = durableTotals();
    if (!totalsEqual(initial, dur)) {
      return {
        ok: false,
        detail: `durable-after-quiesce conservation broke\n${diffTotals(initial, dur)}\nstate:\n${dumpState(w)}`,
        ledgerRows: store.ledger.length,
        opsSeen,
      };
    }
    if (check === 'durable-after-quiesce-no-ledger') {
      return { ok: true, detail: '', ledgerRows: store.ledger.length, opsSeen };
    }
    // The ledger must independently agree with durable state: the reference
    // replayer (scripts/bank_audit.mjs) reconciles the guild container's item
    // multiset, treasury replay, and purchased-slot ladder against the book
    // row. open_bank and create_fee are purse-paid and already excluded from
    // the treasury replay by the script itself.
    const findings = auditBank({
      ledgerRows: store.ledger as unknown as BankLedgerAuditRow[],
      characters: [],
      guildBanks: [...store.bookRows.entries()].map(([guild_id, data]) => ({
        guild_id,
        realm: 'Claudemoon',
        data,
      })),
    });
    if (findings.length > 0) {
      return {
        ok: false,
        detail: `ledger replay disagrees with durable state:\n${findings
          .map((f) => `  [${f.kind}] ${f.detail}`)
          .join('\n')}`,
        ledgerRows: store.ledger.length,
        opsSeen,
      };
    }
  }
  await bankLedgerIdle();
  return { ok: true, detail: '', ledgerRows: store.ledger.length, opsSeen };
}

/** Delta-debug a failing step list down to the shortest still-failing one:
 *  repeated greedy single-step deletion passes (inner mid-wait ops included).
 *  Bounded so a pathological case cannot run away. */
async function shrinkSteps(steps: Step[], check: Check, budget = 220): Promise<Step[]> {
  let best = steps;
  let spent = 0;
  let improved = true;
  while (improved && spent < budget) {
    improved = false;
    for (let i = 0; i < best.length && spent < budget; i++) {
      const candidate = [...best.slice(0, i), ...best.slice(i + 1)];
      spent++;
      const r = await runSteps(candidate, check);
      if (!r.ok) {
        best = candidate;
        improved = true;
        break;
      }
    }
  }
  return best;
}

interface Failure {
  seed: number;
  detail: string;
  minimized: Step[];
}

async function sweep(
  seeds: number[],
  cfg: GenConfig,
  check: Check,
  opts: { shrink?: boolean } = {},
): Promise<{ failures: Failure[]; opsSeen: Set<string>; ledgerRows: number }> {
  const failures: Failure[] = [];
  const opsSeen = new Set<string>();
  let ledgerRows = 0;
  for (const seed of seeds) {
    const steps = genSteps(seed, cfg);
    const r = await runSteps(steps, check);
    for (const o of r.opsSeen) opsSeen.add(o);
    ledgerRows += r.ledgerRows;
    if (!r.ok) {
      const minimized = opts.shrink === false ? steps : await shrinkSteps(steps, check);
      // Report the MINIMIZED sequence's own violation, not the original run's:
      // shrinking accepts any still-failing candidate, which may fail for a
      // different (smaller) reason than the seed's full sequence did.
      const min = await runSteps(minimized, check);
      failures.push({ seed, detail: min.ok ? r.detail : min.detail, minimized });
      if (failures.length >= 3) break; // enough evidence; keep the run bounded
    }
  }
  return { failures, opsSeen, ledgerRows };
}

function reportFailures(label: string, failures: Failure[]): string {
  return failures
    .map(
      (f) =>
        `\n=== ${label} FAILED, seed ${f.seed} ===\n${f.detail}\nminimized sequence (${f.minimized.length} steps):\n${fmtSteps(f.minimized)}`,
    )
    .join('\n');
}

const seeds = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);

beforeEach(() => {
  store.reset();
  clearStoreHistory();
});

// ---------------------------------------------------------------------------
// P0: the oracle itself must be able to fail. A harness that cannot detect a
// planted violation proves nothing, so this mutation-checks the totals.
// ---------------------------------------------------------------------------
describe('the conservation oracle (mutation check: it can actually fail)', () => {
  it('detects minted copper, minted items, and a laundered craft marker', async () => {
    const w = await makeWorld();
    const base = effectiveTotals(w);
    expect(totalsEqual(base, effectiveTotals(w))).toBe(true);

    const book = w.server.sim.guildBanks.get(GUILD_ID);
    if (!book) throw new Error('missing book');
    book.treasury += 1;
    expect(totalsEqual(base, effectiveTotals(w))).toBe(false);
    book.treasury -= 1;

    book.inventory.push({ itemId: 'wolf_fang', count: 1 });
    expect(totalsEqual(base, effectiveTotals(w))).toBe(false);
    book.inventory.pop();

    // The ladder-burn term: a slot grant with no copper paid is minted capacity
    // AND destroyed copper, so the oracle catches a free rung too.
    book.purchasedSlots = 24;
    expect(totalsEqual(base, effectiveTotals(w))).toBe(false);
    book.purchasedSlots = 0;

    // Craft provenance is invisible to the id-only sum; the fine multiset sees it.
    const meta = w.server.sim.players.get(w.actors[0].pid);
    if (!meta) throw new Error('missing meta');
    const crafted = meta.inventory.find((s) => s.craftedRecipeId === 'smelt_copper');
    if (!crafted) throw new Error('missing crafted stack');
    delete crafted.craftedRecipeId;
    const laundered = effectiveTotals(w);
    expect(laundered.items.get('copper_ore')).toBe(base.items.get('copper_ore'));
    expect(totalsEqual(base, laundered)).toBe(false);

    expect(totalsEqual(base, base)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P1: LIVE conservation across pure op sequences (no injected events).
// ---------------------------------------------------------------------------
describe('P1 conservation across op sequences (no injected events)', () => {
  it('holds for every seed', async () => {
    const cfg: GenConfig = { depth: 40, eventRate: 0, events: [] };
    const list = seeds(600);
    const { failures, opsSeen } = await sweep(list, cfg, 'effective');
    expect(reportFailures('P1', failures)).toBe('');
    // Coverage floor: every op in the alphabet actually succeeded somewhere.
    expect([...opsSeen].sort()).toEqual(
      ['buy_slots', 'deposit', 'deposit_gold', 'open_bank', 'withdraw', 'withdraw_gold'].sort(),
    );
  }, 240_000);
});

// ---------------------------------------------------------------------------
// P2: LIVE conservation with save events interleaved. A save must be a pure
// observer of live state.
// ---------------------------------------------------------------------------
describe('P2 conservation with save events interleaved', () => {
  it('holds across autosave, serial-writer waits, leave flushes, and shutdown flushes', async () => {
    const cfg: GenConfig = {
      depth: 34,
      eventRate: 0.3,
      events: ['autosave', 'saveall', 'leaveflush', 'writerwait', 'purge'],
    };
    const { failures } = await sweep(seeds(400, 1000), cfg, 'effective');
    expect(reportFailures('P2', failures)).toBe('');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// P3: DURABLE conservation after a clean quiesce, plus the ledger replay.
// ---------------------------------------------------------------------------
describe('P3 durable conservation after a clean flush, ledger agreeing', () => {
  it('holds, and scripts/bank_audit.mjs reconciles the book against the ledger', async () => {
    const cfg: GenConfig = {
      depth: 30,
      eventRate: 0.25,
      events: ['autosave', 'saveall', 'writerwait', 'purge'],
    };
    const { failures } = await sweep(seeds(350, 2000), cfg, 'durable-after-quiesce');
    expect(reportFailures('P3', failures)).toBe('');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// P4: the lease fence / self-takeover arm. A fenced-out session's character
// half rolls back; reconcileUnflushableGuildBooks must return the shared live
// book to what the next durable commit contains, or the orphaned ops ride
// another officer's save (the dupe shape).
// ---------------------------------------------------------------------------
describe('P4 conservation across lease fences (self-takeover + own-ops undo)', () => {
  // BOTH officers act, BOTH save, and EITHER can be fenced. No generator
  // restrictions at all any more: the sweeps are free to produce the
  // consume-then-fence sequence (one officer withdraws value the other never
  // made durable, then that other officer is fenced), which is precisely the
  // shape that used to mint and is now refused rather than carried.
  it('holds when an officer fences out with unflushed ops, both officers active', async () => {
    const cfg: GenConfig = {
      depth: 26,
      eventRate: 0.28,
      events: ['autosave', 'fence', 'writerwait', 'leaveflush', 'purge'],
    };
    const { failures } = await sweep(seeds(300, 3000), cfg, 'effective');
    expect(reportFailures('P4-fence', failures)).toBe('');
  }, 240_000);

  it('holds through to durable state after the survivor flushes', async () => {
    const cfg: GenConfig = {
      depth: 24,
      eventRate: 0.3,
      events: ['autosave', 'fence', 'writerwait', 'purge'],
    };
    const { failures } = await sweep(seeds(300, 4000), cfg, 'durable-after-quiesce-no-ledger');
    expect(reportFailures('P4-durable', failures)).toBe('');
  }, 240_000);

  it('holds when the dying officer fences while the other officer is dirty', async () => {
    const cfg: GenConfig = {
      depth: 26,
      eventRate: 0.28,
      events: ['autosave', 'fence', 'writerwait', 'purge'],
    };
    const { failures } = await sweep(seeds(300, 6000), cfg, 'effective');
    expect(reportFailures('P4-other-dirty', failures)).toBe('');
  }, 240_000);

  it('leaves the ledger rows of a reverted op behind, as the accepted risk records', async () => {
    // docs/guild-bank/state.md: "Ledger rows for fenced-out (reverted) ops
    // remain in bank_ledger by design: the audit script may flag them against
    // the book". Pinned so the caveat stays true and visible: conservation is
    // intact, the AUDIT REPLAY is what disagrees.
    const steps: Step[] = [
      { k: 'deposit_gold', a: 0, amt: 5_000 },
      { k: 'fence', a: 0 },
    ];
    const conserved = await runSteps(steps, 'durable-after-quiesce-no-ledger');
    expect(conserved.detail).toBe('');
    const audited = await runSteps(steps, 'durable-after-quiesce');
    expect(audited.ok).toBe(false);
    expect(audited.detail).toContain('treasury_mismatch');
    expect(audited.detail).toContain('ledger treasury replay 5000');
    expect(audited.detail).toContain('guild book treasury 0');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// P4-CONSUMED: the two shapes that used to be ACCEPTED RESIDUES, both now
// closed. Each is one officer consuming value another officer never made
// durable, and each used to mint exactly what was consumed, because the
// inverse clamped rather than clawing back and the consumer's character half
// committed regardless.
//
// They are closed by refusing rather than carrying: a save whose book half
// cannot be replayed onto durable truth commits NOTHING, character row
// included. The consumer retries while the depositor is still around to make
// it durable, and once the depositor is gone the consumer's live state is
// abandoned wholesale (quarantined, disconnected, reloaded from a durable row
// that never saw the consumption). The witnesses below are the exact
// sequences that used to mint 250 copper and 90,000 of ladder value.
// ---------------------------------------------------------------------------
describe('P4-CONSUMED value another officer never made durable is no longer minted', () => {
  it('another officer consuming the un-durable copper: nothing is minted', async () => {
    const steps: Step[] = [
      { k: 'deposit_gold', a: 0, amt: 400_000 },
      { k: 'withdraw_gold', a: 1, amt: 250 }, // officer 1 consumes part of it
      { k: 'fence', a: 0 },
    ];
    const r = await runSteps(steps, 'effective');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);

  it('and it stays conserved all the way through to durable state', async () => {
    const steps: Step[] = [
      { k: 'deposit_gold', a: 0, amt: 400_000 },
      { k: 'withdraw_gold', a: 1, amt: 250 },
      { k: 'fence', a: 0 },
    ];
    const r = await runSteps(steps, 'durable-after-quiesce-no-ledger');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);

  it('another officer expanding past the base: the rung-0 grant is not kept for free', async () => {
    // The opener's 24 purse-paid slots used to survive when another officer's
    // expansion had pinned the ladder above them, because the inverse's
    // compare-and-swap could not undo them without destroying the paid rung.
    // The forward replay now refuses to grant a rung from a base that has not
    // reached it, so the expansion never becomes durable either and the whole
    // ladder unwinds together.
    const steps: Step[] = [
      { k: 'buy', a: 0 }, // officer 0 opens the bank from its own purse
      { k: 'deposit_gold', a: 1, amt: 90_000 }, // officer 1 funds the treasury
      { k: 'buy', a: 1 }, // ... and expands 24 -> 30, pinning the ladder
      { k: 'fence', a: 0 }, // officer 0 fences: the rung-0 undo cannot apply
    ];
    const r = await runSteps(steps, 'effective');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
    const durable = await runSteps(steps, 'durable-after-quiesce-no-ledger');
    expect(durable.detail).toBe('');
    expect(durable.ok).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// P4-CLOSED: the conservation break the recorded accepted risks did NOT cover,
// now closed at the root. docs/guild-bank/state.md used to state that the
// fence-out arm of the cross-officer escrow skew was CLOSED by the reconcile,
// leaving only a CRASH-windowed residue. That held only while durable truth
// was BEHIND the fenced-out op: once ANOTHER officer's escrow save had already
// carried the op into the durable book, the evict-and-reload arm reloaded a
// row that ALREADY CONTAINED it, so the value existed twice, in the durable
// book and in the fenced character's rolled-back durable row, with no crash
// involved. This file pinned that as a CHARACTERIZATION (r.ok === false) so it
// stayed green and a fix would flip it.
//
// It is flipped. Another officer's save can no longer carry this officer's op
// anywhere, because a save's payload is its own delta log, so there is nothing
// for a reload to restore and no reload arm left either. The old paired
// negative control (the same shape taking the surgical-revert arm) folded into
// this test: there is one arm now, so both shapes are the same assertion.
// ---------------------------------------------------------------------------
describe('P4-CLOSED an op another officer flushed can no longer be duplicated by a fence', () => {
  it('conserves treasury copper where it used to mint 25_000', async () => {
    const steps: Step[] = [
      { k: 'deposit_gold', a: 1, amt: 25_000 }, // officer B deposits; B's char half is NOT durable
      { k: 'buy', a: 0 }, // officer A dirties the same book (rung 0, purse-paid)
      { k: 'autosave', a: 0 }, // A's escrow carries only A's OWN deltas now
      { k: 'fence', a: 1 }, // B is taken over: B's char half rolls back
    ];
    const r = await runSteps(steps, 'effective');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
    // And the same shape for an ITEM, not just copper.
    const itemSteps: Step[] = [
      { k: 'buy', a: 0 }, // open the bank so item deposits are possible
      { k: 'autosave', a: 0 },
      { k: 'deposit', a: 1, pick: 0, whole: true, cnt: 1 }, // B deposits a stack
      { k: 'deposit_gold', a: 0, amt: 1 }, // A dirties the book
      { k: 'autosave', a: 0 }, // A's escrow no longer carries B's stack
      { k: 'fence', a: 1 }, // B rolls back: the stack is back in B's durable bags
    ];
    const ri = await runSteps(itemSteps, 'effective');
    expect(ri.detail).toBe('');
    expect(ri.ok).toBe(true);
  }, 60_000);

  it('conserves when the other officer stays dirty instead of flushing', async () => {
    const steps: Step[] = [
      { k: 'deposit_gold', a: 1, amt: 25_000 },
      { k: 'deposit_gold', a: 0, amt: 1_000 }, // A stays DIRTY (never saves)
      { k: 'fence', a: 1 },
    ];
    const r = await runSteps(steps, 'effective');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// P4-EXPLOIT: a generator that produces ONLY the money-printer shape, so the
// claim "it is closed" is measured rather than asserted.
//
// The shape: officer A deposits and does NOT flush; officer B consumes what A
// deposited; B's escrow save commits (or tries to); A then takes itself over
// (an ordinary re-login), which fences A and rolls A's deposit back. Under the
// carry-and-record behaviour this printed exactly what B consumed, on demand,
// repeatably, for copper and for items alike, because B's CHARACTER half
// committed while its book half did not. Every sequence below is that shape
// with the amounts, the item, the op order and the flush points varied.
// ---------------------------------------------------------------------------
function genExploitSteps(seed: number): Step[] {
  const rnd = rngFor(seed);
  const depositor: ActorIndex = rnd() < 0.5 ? 0 : 1;
  const consumer: ActorIndex = depositor === 0 ? 1 : 0;
  const items = rnd() < 0.5;
  const steps: Step[] = [];
  // The consumer often has to open the bank first for the item variant.
  if (items) {
    steps.push({ k: 'buy', a: consumer });
    steps.push({ k: 'autosave', a: consumer });
  }
  if (items) {
    steps.push({
      k: 'deposit',
      a: depositor,
      pick: rnd(),
      whole: rnd() < 0.5,
      cnt: 1 + Math.floor(rnd() * 5),
    });
    steps.push({
      k: 'withdraw',
      a: consumer,
      pick: rnd(),
      whole: rnd() < 0.5,
      cnt: 1 + Math.floor(rnd() * 5),
    });
  } else {
    const amt = GOLD_AMOUNTS[Math.floor(rnd() * (GOLD_AMOUNTS.length - 1))];
    steps.push({ k: 'deposit_gold', a: depositor, amt });
    steps.push({
      k: 'withdraw_gold',
      a: consumer,
      amt: rnd() < 0.5 ? amt : Math.max(1, Math.floor(amt / 2)),
    });
  }
  // The consumer's escrow save, sometimes before the fence and sometimes
  // after, and sometimes through the serial-writer wait.
  const saveFirst = rnd() < 0.5;
  const consumerSave: Step =
    rnd() < 0.3
      ? { k: 'writerwait', a: consumer, inner: [] }
      : rnd() < 0.5
        ? { k: 'autosave', a: consumer }
        : { k: 'leaveflush', a: consumer };
  if (saveFirst) steps.push(consumerSave);
  steps.push({ k: 'fence', a: depositor });
  steps.push(consumerSave);
  if (rnd() < 0.5) steps.push({ k: 'autosave', a: consumer });
  return steps;
}

describe('P4-EXPLOIT the two-account money printer, measured', () => {
  it('conserves on every generated instance of the shape', async () => {
    const failures: Failure[] = [];
    let ran = 0;
    for (const seed of seeds(300, 7000)) {
      const steps = genExploitSteps(seed);
      ran++;
      const r = await runSteps(steps, 'durable-after-quiesce-no-ledger');
      if (!r.ok) {
        failures.push({ seed, detail: r.detail, minimized: steps });
        if (failures.length >= 3) break;
      }
    }
    process.stderr.write(
      `\n[exploit sweep] ran=${ran} failures=${failures.length} (carry-and-record printed on this shape; refusing does not)\n`,
    );
    expect(reportFailures('P4-EXPLOIT', failures)).toBe('');
    expect(ran).toBe(300);
  }, 240_000);

  it('the LIVE view conserves across it too, at every step', async () => {
    const failures: Failure[] = [];
    for (const seed of seeds(200, 9000)) {
      const r = await runSteps(genExploitSteps(seed), 'effective');
      if (!r.ok) {
        failures.push({ seed, detail: r.detail, minimized: genExploitSteps(seed) });
        if (failures.length >= 3) break;
      }
    }
    expect(reportFailures('P4-EXPLOIT-live', failures)).toBe('');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// P5: the CRASH arm. No quiesce: whatever is on disk when the process dies is
// all that survives. A torn escrow shows up here as durable copper/items that
// do not sum to the starting total.
// ---------------------------------------------------------------------------
describe('P5 durable conservation across an unannounced crash', () => {
  // Whatever is on disk when the process dies must still sum to the starting
  // total, however many ops were unflushed. A torn escrow (an item in both the
  // durable bags and the durable book, or in neither) shows up immediately.
  it('holds at every crash point, however many ops were unflushed', async () => {
    const cfg: GenConfig = {
      depth: 26,
      eventRate: 0.3,
      events: ['autosave', 'saveall', 'writerwait', 'leaveflush'],
    };
    const { failures } = await sweep(seeds(300, 5000), cfg, 'durable-crash');
    expect(reportFailures('P5', failures)).toBe('');
  }, 240_000);

  it('does NOT tear in the window the accepted cross-officer skew used to name', async () => {
    // This is the witness docs/guild-bank/state.md used to record as the
    // accepted skew: officer B's save persisted the live book INCLUDING
    // officer A's not-yet-durable op, so a crash in that window tore A's
    // escrow and B kept the copper. B's save no longer carries A's op, and
    // B's own withdrawal of it cannot be replayed onto a durable book that
    // never received it, so B's save commits nothing at all: crash here and
    // neither half of the exchange exists.
    const steps: Step[] = [
      { k: 'deposit_gold', a: 1, amt: 90_000 }, // A's op, not yet durable for A
      { k: 'withdraw_gold', a: 0, amt: 90_000 }, // B takes it out of the treasury
      { k: 'autosave', a: 0 }, // B's escrow: REFUSED, both halves roll back
    ];
    const r = await runSteps(steps, 'durable-crash');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// P6: the EXHAUSTED LEAVE FLUSH arm of reconcileUnflushableGuildBooks. Kept out
// of the sweeps because each one burns the real 250/500/1000/2000 ms retry
// backoff; driven here as explicit scenarios instead.
// ---------------------------------------------------------------------------
describe('P6 conservation when a leave flush exhausts its retries', () => {
  it('conserves for a lone officer with unflushed gold and item ops', async () => {
    const steps: Step[] = [
      { k: 'buy', a: 0 }, // open the bank (purse-paid rung 0)
      { k: 'autosave', a: 0 }, // make that durable
      { k: 'deposit_gold', a: 0, amt: 40_000 },
      { k: 'deposit', a: 0, pick: 0, whole: true, cnt: 1 },
      { k: 'leaveflushfail', a: 0 }, // every attempt fails: reconcile or lose value
    ];
    const r = await runSteps(steps, 'effective');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);

  it('conserves through to durable state, and after the other officer flushes', async () => {
    const steps: Step[] = [
      { k: 'buy', a: 0 },
      { k: 'autosave', a: 0 },
      { k: 'withdraw_gold', a: 0, amt: 1 }, // refused (empty treasury): still a step
      { k: 'deposit_gold', a: 0, amt: 25_000 },
      { k: 'leaveflushfail', a: 0 },
    ];
    const r = await runSteps(steps, 'durable-after-quiesce-no-ledger');
    expect(r.detail).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The coverage readout. A passing property is only as strong as the state it
// actually reached, so the suite reports (and asserts a floor on) what the
// sweeps above really exercised: every op in the alphabet must have SUCCEEDED
// many times, and every injected event must have run.
// ---------------------------------------------------------------------------
describe('coverage of the property sweeps', () => {
  it('reports what was exercised and holds a floor under it', () => {
    process.stderr.write(`\n[conservation coverage] ${coverage.render()}\n`);
    for (const op of [
      'deposit',
      'withdraw',
      'deposit_gold',
      'withdraw_gold',
      'buy_slots',
      'open_bank',
    ]) {
      expect(`${op}:${(coverage.ops.get(op) ?? 0) > 40}`).toBe(`${op}:true`);
    }
    for (const ev of [
      'autosave',
      'saveall',
      'leaveflush',
      'writerwait',
      'fence',
      // The two evict-and-reload counters that used to sit here are REMOVED,
      // not satisfied: those arms no longer exist. What is left is the single
      // own-ops undo, on both the fence and the exhausted-leave path.
      'fence:own-ops-undone',
      'exhausted-leave:own-ops-undone',
      // The OPERATOR purge now rides the concurrency and fence-injection
      // sweeps like any other book mutation. Both arms must be reached: a
      // purge that actually removed a copy, and one refused because the seed
      // was exhausted. A sweep where every purge refused would prove nothing.
      'purge',
      'purge:removed',
      'purge:nothing-dormant',
    ]) {
      expect(`${ev}:${(coverage.events.get(ev) ?? 0) > 0}`).toBe(`${ev}:true`);
    }
  });
});
