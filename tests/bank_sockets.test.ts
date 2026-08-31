// Bank bag sockets (Bank Storage phase 06): the gold-only socket tier above
// the untouched twelve-rung slot ladder (src/sim/bank_sockets.ts + the
// BankState socket fields and bankPools split in src/sim/bank.ts).
//
// Pins, in order: the price/count literals, the two-pool socket arithmetic and
// the published ceilings (176 general / 96 materials, state.md), the sanitize
// tolerance arms, the full unlock/socket/unsocket refusal matrix (every
// refusal moves nothing and charges nothing), the two-pool deposit semantics
// through the REAL bankDeposit gate, persistence round trips, determinism,
// the socket deed meters, item conservation across an op sweep with failure
// paths, and the compounded WORST-ORDERING over-capacity bound (the phase 05
// ceiling lesson: interleaved fill-swap-fill beats swaps-first, every probe
// reads the POST-swap row, and the honest bound is pinned as a literal).
//
// Harness idiom copied from tests/bank.test.ts (trimmed banker world, live
// banker proximity moves, literal-number pins, never constant-vs-constant
// self-comparisons).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import {
  BANK_BAG_SOCKETS,
  BANK_SOCKET_PRICES,
  type BankState,
  bankPools,
  sanitizeBankState,
} from '../src/sim/bank';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';

// The three Gilded Strongbox bursars (banker NPCs), one per town hub.
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;

const BANK_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};

// The socket price ladder as LITERALS (never compared to the exported constant,
// which would be a zero-protection self-comparison): 100g/200g/350g/500g.
const SOCKET_PRICES = [1000000, 2000000, 3500000, 5000000];
const SOCKET_TOTAL = 11500000; // 1150g

// Shipped bag fixtures: the joint-largest general bag (16 slots) and the top
// materials-only satchel (24), plus small rungs for the mixed arms.
const GENERAL_16 = 'wayfarers_backpack';
const SATCHEL_24 = 'loombound_reagent_satchel';
const GENERAL_6 = 'linen_pouch';
const SATCHEL_8 = 'burlap_reagent_pouch';

// A non-material stackable (general pool only) and an honest material.
const BREAD = 'baked_bread';
const ORE = 'copper_ore';

function bankerEntity(sim: Sim, templateId: string = BANKERS[0]): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === templateId) return e;
  }
  throw new Error(`banker ${templateId} is not spawned in the world`);
}

function moveToBanker(sim: Sim, pid = sim.playerId): Entity {
  const banker = bankerEntity(sim);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return banker;
}

function moveFarFromBankers(sim: Sim, pid = sim.playerId): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { x: 500, y: p.pos.y, z: 500 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

const makeSim = (seed = 42) => {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    world: BANK_TEST_WORLD,
  });
  moveToBanker(sim);
  return sim;
};
const meta = (sim: Sim, pid = sim.playerId) => sim.meta(pid)!;

const hasErr = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'error' && e.text === text);
const hasLog = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'log' && e.text === text);

const clone = <T>(v: T): T => structuredClone(v);

// A full stack of `id` as a bank slot (full so a later deposit gets no top-up
// room and must claim a fresh slot, keeping every capacity probe honest).
const fullStack = (id: string): InvSlot => ({ itemId: id, count: stackSizeOf(ITEMS[id]) });

// Total units of every item the player can see, across ALL containers that can
// hold one: carried inventory, carried bag sockets, bank inventory, bank bag
// sockets. The conservation covenant asserts this map is invariant across
// every socket/unsocket/swap, success or failure.
function holdings(sim: Sim, pid = sim.playerId): Map<string, number> {
  const m = meta(sim, pid);
  const totals = new Map<string, number>();
  const add = (id: string, n: number) => totals.set(id, (totals.get(id) ?? 0) + n);
  for (const s of m.inventory) add(s.itemId, s.count);
  for (const s of m.bank.inventory) add(s.itemId, s.count);
  for (const b of m.bags) if (b) add(b, 1);
  for (const b of m.bank.socketBags) if (b) add(b, 1);
  return totals;
}

// Give the player a carried copy of `id` and return its slot index.
function carry(sim: Sim, id: string, count = 1, pid = sim.playerId): number {
  sim.addItem(id, count, pid);
  const idx = meta(sim, pid).inventory.findIndex((s) => s.itemId === id);
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx;
}

// ---------------------------------------------------------------------------
describe('socket constants and pool math', () => {
  it('socket count and unlock prices are the pinned literals', () => {
    expect(BANK_BAG_SOCKETS).toBe(4);
    expect([...BANK_SOCKET_PRICES]).toEqual(SOCKET_PRICES);
    expect(BANK_SOCKET_PRICES.length).toBe(4);
    // The relational coupling, explicit: a price table shorter than the
    // socket count would make bankUnlockSocket index undefined (and
    // nextSocketCost drop off the wire as an undefined key). Both constants
    // are pinned to literals above; this line pins that they move TOGETHER.
    expect(BANK_SOCKET_PRICES.length).toBe(BANK_BAG_SOCKETS);
    expect(SOCKET_PRICES.reduce((a, b) => a + b, 0)).toBe(SOCKET_TOTAL);
  });

  it('the fixture bags carry the shipped slot counts and kinds', () => {
    // The published ceilings below hang off these two records; a content
    // re-tune must consciously move this pin.
    expect(ITEMS[GENERAL_16]).toMatchObject({ kind: 'bag', bagSlots: 16 });
    expect(ITEMS[GENERAL_16].materialsOnly).toBeUndefined();
    expect(ITEMS[SATCHEL_24]).toMatchObject({ kind: 'bag', bagSlots: 24, materialsOnly: true });
    expect(ITEMS[GENERAL_6]).toMatchObject({ kind: 'bag', bagSlots: 6 });
    expect(ITEMS[SATCHEL_8]).toMatchObject({ kind: 'bag', bagSlots: 8, materialsOnly: true });
    // The superlatives are DERIVED, not asserted (the hand-picked-argmax
    // trap): ship a bigger bag and the published ceilings (176/96) and the
    // 272 bound rot silently while their tests stay green, so this pin must
    // red first.
    let maxGeneral = 0;
    let maxSatchel = 0;
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'bag' || !def.bagSlots) continue;
      if (def.materialsOnly) maxSatchel = Math.max(maxSatchel, def.bagSlots);
      else maxGeneral = Math.max(maxGeneral, def.bagSlots);
    }
    expect(maxGeneral).toBe(16);
    expect(maxSatchel).toBe(24);
  });

  const bank = (over: Partial<BankState>): BankState => ({
    inventory: [],
    purchasedSlots: 0,
    bonusSlots: 0,
    unlockedSockets: 0,
    socketBags: [null, null, null, null],
    appliedStorageKeys: [],
    ...over,
  });

  it('bankPools: the ladder budget is the general base; sockets feed their pool by kind', () => {
    expect(bankPools(bank({}))).toEqual({ general: 24, materials: 0 });
    expect(
      bankPools(bank({ unlockedSockets: 1, socketBags: [GENERAL_16, null, null, null] })),
    ).toEqual({ general: 40, materials: 0 });
    expect(
      bankPools(bank({ unlockedSockets: 2, socketBags: [SATCHEL_24, SATCHEL_8, null, null] })),
    ).toEqual({ general: 24, materials: 32 });
    expect(
      bankPools(
        bank({
          purchasedSlots: 12,
          bonusSlots: 4,
          unlockedSockets: 4,
          socketBags: [GENERAL_16, SATCHEL_24, GENERAL_6, SATCHEL_8],
        }),
      ),
    ).toEqual({ general: 62, materials: 32 }); // 24+12+4+16+6 / 24+8
  });

  it('reaches the published ceilings: 176 general or 96 materials (state.md)', () => {
    const maxed = { purchasedSlots: 72, bonusSlots: 16, unlockedSockets: 4 };
    expect(
      bankPools(bank({ ...maxed, socketBags: [GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16] })),
    ).toEqual({ general: 176, materials: 0 });
    expect(
      bankPools(bank({ ...maxed, socketBags: [SATCHEL_24, SATCHEL_24, SATCHEL_24, SATCHEL_24] })),
    ).toEqual({ general: 112, materials: 96 });
  });
});

// ---------------------------------------------------------------------------
describe('sanitizeBankState socket tolerance', () => {
  const EMPTY_SOCKETS = { unlockedSockets: 0, socketBags: [null, null, null, null] };

  it('a pre-socket save (no socket fields) loads to zero sockets', () => {
    const loaded = sanitizeBankState({ inventory: [], purchasedSlots: 6, bonusSlots: 2 });
    expect(loaded.unlockedSockets).toBe(0);
    expect(loaded.socketBags).toEqual([null, null, null, null]);
    expect(loaded.purchasedSlots).toBe(6);
  });

  it('clamps a tampered unlock count into [0, 4] and floors fractions', () => {
    const at = (v: unknown) =>
      sanitizeBankState({ inventory: [], unlockedSockets: v }).unlockedSockets;
    expect(at(5)).toBe(4);
    expect(at(999)).toBe(4);
    expect(at(-3)).toBe(0);
    expect(at(2.9)).toBe(2);
    expect(at('junk')).toBe(0);
    expect(at(null)).toBe(0);
    // The full Number() coercion surface, pinned arm by arm: a truthy boolean
    // coerces to one socket, a numeric string parses, and both Infinity forms
    // land at the ceiling rather than NaN-ing to zero.
    expect(at(true)).toBe(1);
    expect(at(false)).toBe(0);
    expect(at('3')).toBe(3);
    expect(at(Number.POSITIVE_INFINITY)).toBe(4);
    expect(at('Infinity')).toBe(4);
    expect(at(Number.NaN)).toBe(0);
  });

  it('an unknown, non-bag, or non-string socket id loads as an empty socket', () => {
    const loaded = sanitizeBankState({
      inventory: [],
      unlockedSockets: 4,
      socketBags: ['no_such_item', 'worn_sword', 42, GENERAL_16],
    });
    expect(loaded.socketBags).toEqual([null, null, null, GENERAL_16]);
  });

  it('a materials-only satchel in a socket is valid, not tampering', () => {
    const loaded = sanitizeBankState({
      inventory: [],
      unlockedSockets: 2,
      socketBags: [SATCHEL_24, SATCHEL_8, null, null],
    });
    expect(loaded.socketBags).toEqual([SATCHEL_24, SATCHEL_8, null, null]);
  });

  it('a bag in a LOCKED socket is tamper-minted capacity and loads empty', () => {
    const loaded = sanitizeBankState({
      inventory: [],
      unlockedSockets: 1,
      socketBags: [GENERAL_16, GENERAL_16, null, null],
    });
    expect(loaded.socketBags).toEqual([GENERAL_16, null, null, null]);
  });

  it('an oversized socketBags array truncates to the four real sockets', () => {
    const loaded = sanitizeBankState({
      inventory: [],
      unlockedSockets: 4,
      socketBags: [GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16],
    });
    expect(loaded.socketBags).toEqual([GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16]);
    expect(loaded.socketBags.length).toBe(4);
  });

  it('a non-array socketBags loads as all-empty without touching the unlock count', () => {
    const loaded = sanitizeBankState({ inventory: [], unlockedSockets: 3, socketBags: 'junk' });
    expect(loaded.unlockedSockets).toBe(3);
    expect(loaded.socketBags).toEqual([null, null, null, null]);
  });

  it('every discarded socket entry lands in the per-load drop sink; clean loads add nothing', () => {
    // The ONE destructive load exception must be observable: an in-range
    // reject (unknown id) and a locked-socket strand each get a row; a
    // tampered oversized tail reports as one counted overflow row.
    const sink: string[] = [];
    sanitizeBankState(
      { inventory: [], unlockedSockets: 1, socketBags: ['no_such_item', GENERAL_16, null, null] },
      'Tester',
      sink,
    );
    expect(sink).toEqual(['bank.socket0.no_such_item', `bank.socket1.${GENERAL_16}`]);

    const oversized: string[] = [];
    sanitizeBankState(
      {
        inventory: [],
        unlockedSockets: 4,
        socketBags: [GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16, GENERAL_16, null, 42],
      },
      'Tester',
      oversized,
    );
    expect(oversized).toEqual(['bank.socket.overflow.2']);

    // The negative arm: a fully valid socket load pushes NOTHING.
    const clean: string[] = [];
    sanitizeBankState(
      { inventory: [], unlockedSockets: 2, socketBags: [GENERAL_16, SATCHEL_8, null, null] },
      'Tester',
      clean,
    );
    expect(clean).toEqual([]);

    // The caps are pinned too: a hostile long array reports at most 64
    // overflow entries (bounded scan, deliberate undercount past 68)...
    const hostile: string[] = [];
    sanitizeBankState(
      { inventory: [], unlockedSockets: 0, socketBags: Array(100).fill(BREAD) },
      'Tester',
      hostile,
    );
    expect(hostile).toEqual([
      `bank.socket0.${BREAD}`,
      `bank.socket1.${BREAD}`,
      `bank.socket2.${BREAD}`,
      `bank.socket3.${BREAD}`,
      'bank.socket.overflow.64',
    ]);
    // ...and a junk id truncates to 40 chars in its row.
    const trunc: string[] = [];
    sanitizeBankState(
      { inventory: [], unlockedSockets: 1, socketBags: ['x'.repeat(80), null, null, null] },
      'Tester',
      trunc,
    );
    expect(trunc).toEqual([`bank.socket0.${'x'.repeat(40)}`]);
  });

  it('non-object raw still yields the socket defaults', () => {
    expect(sanitizeBankState(undefined)).toMatchObject(EMPTY_SOCKETS);
    expect(sanitizeBankState(null)).toMatchObject(EMPTY_SOCKETS);
    expect(sanitizeBankState('garbage')).toMatchObject(EMPTY_SOCKETS);
  });
});

// ---------------------------------------------------------------------------
describe('bankUnlockSocket', () => {
  it('unlocks in order for exact copper: 100g, 200g, 350g, 500g', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_TOTAL;
    for (let i = 0; i < 4; i++) {
      const before = m.copper;
      sim.drainEvents();
      sim.bankUnlockSocket();
      expect(m.copper).toBe(before - SOCKET_PRICES[i]);
      expect(m.bank.unlockedSockets).toBe(i + 1);
      expect(hasLog(sim.drainEvents(), 'You unlock a bank bag socket.')).toBe(true);
    }
    expect(m.copper).toBe(0); // the whole ladder is exactly 1150g
  });

  it('refuses the fifth unlock at the ceiling, mutating nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_TOTAL + 5000000;
    for (let i = 0; i < 4; i++) sim.bankUnlockSocket();
    sim.drainEvents();
    sim.bankUnlockSocket();
    expect(hasErr(sim.drainEvents(), 'Your bank has no more bag sockets to unlock.')).toBe(true);
    expect(m.bank.unlockedSockets).toBe(4);
    expect(m.copper).toBe(5000000);
  });

  it('refuses when the player cannot afford the table price, mutating nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_PRICES[0] - 1;
    sim.drainEvents();
    sim.bankUnlockSocket();
    expect(hasErr(sim.drainEvents(), 'You cannot afford that bag socket.')).toBe(true);
    expect(m.bank.unlockedSockets).toBe(0);
    expect(m.copper).toBe(SOCKET_PRICES[0] - 1);
  });

  it('refuses away from a banker and while dead', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_TOTAL;
    moveFarFromBankers(sim);
    sim.drainEvents();
    sim.bankUnlockSocket();
    expect(hasErr(sim.drainEvents(), 'You are too far from the banker.')).toBe(true);
    expect(m.bank.unlockedSockets).toBe(0);
    expect(m.copper).toBe(SOCKET_TOTAL);

    moveToBanker(sim);
    sim.entities.get(sim.playerId)!.dead = true;
    sim.drainEvents();
    sim.bankUnlockSocket();
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.unlockedSockets).toBe(0);
    expect(m.copper).toBe(SOCKET_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// A sim with `n` sockets unlocked and the unlock copper already spent.
function simWithSockets(n: number, seed = 42): Sim {
  const sim = makeSim(seed);
  const m = meta(sim);
  m.copper = SOCKET_PRICES.slice(0, n).reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) sim.bankUnlockSocket();
  expect(m.bank.unlockedSockets).toBe(n);
  sim.drainEvents();
  return sim;
}

describe('bankSocketBag', () => {
  it('sockets a carried bag into the first empty unlocked socket and logs it', () => {
    const sim = simWithSockets(2);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(m.bank.socketBags).toEqual([GENERAL_6, null, null, null]);
    expect(m.inventory.some((s) => s.itemId === GENERAL_6)).toBe(false);
    expect(hasLog(sim.drainEvents(), 'Socketed Linen Pouch into your bank.')).toBe(true);
    expect(holdings(sim)).toEqual(before);
  });

  it('a materials-only satchel sockets like any bag and grows the materials pool', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, SATCHEL_8);
    sim.bankSocketBag(SATCHEL_8);
    expect(m.bank.socketBags[0]).toBe(SATCHEL_8);
    expect(bankPools(m.bank)).toEqual({ general: 24, materials: 8 });
  });

  it('an explicit target socket is honored; a locked or malformed one is a silent no-op', () => {
    const sim = simWithSockets(2);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6, 1);
    expect(m.bank.socketBags).toEqual([null, GENERAL_6, null, null]);

    carry(sim, SATCHEL_8);
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(SATCHEL_8, 2); // locked (only 2 unlocked)
    sim.bankSocketBag(SATCHEL_8, -1);
    sim.bankSocketBag(SATCHEL_8, 1.5);
    sim.bankSocketBag(SATCHEL_8, 99);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags).toEqual([null, GENERAL_6, null, null]);
    expect(holdings(sim)).toEqual(before);
  });

  it('socketing onto an occupied socket swaps, returning the old bag with no spare room needed', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6, 0);
    carry(sim, GENERAL_16);
    // Fill every remaining carried slot so the swap has ZERO spare room: the
    // consumed new bag's slot is exactly where the old bag returns.
    while (m.inventory.length < 16) sim.addItem(BREAD, stackSizeOf(ITEMS[BREAD]));
    const before = holdings(sim);
    const carriedLen = m.inventory.length;
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_16, 0);
    const evs = sim.drainEvents();
    expect(evs.filter((e) => e.type === 'error')).toEqual([]);
    expect(hasLog(evs, "Socketed Wayfarer's Backpack into your bank.")).toBe(true);
    expect(m.bank.socketBags[0]).toBe(GENERAL_16);
    expect(m.inventory.filter((s) => s.itemId === GENERAL_6).length).toBe(1);
    expect(m.inventory.length).toBe(carriedLen);
    expect(holdings(sim)).toEqual(before);
  });

  it('refuses with no open unlocked socket (zero unlocked, and all occupied)', () => {
    const zero = simWithSockets(0);
    carry(zero, GENERAL_6);
    zero.drainEvents();
    zero.bankSocketBag(GENERAL_6);
    expect(hasErr(zero.drainEvents(), 'You have no open bank bag socket.')).toBe(true);
    expect(meta(zero).bank.socketBags).toEqual([null, null, null, null]);

    const full = simWithSockets(1);
    carry(full, GENERAL_6);
    full.bankSocketBag(GENERAL_6);
    carry(full, SATCHEL_8);
    full.drainEvents();
    full.bankSocketBag(SATCHEL_8); // no explicit target: socket 0 is taken
    expect(hasErr(full.drainEvents(), 'You have no open bank bag socket.')).toBe(true);
    expect(meta(full).bank.socketBags).toEqual([GENERAL_6, null, null, null]);
  });

  it('refuses away from a banker and while dead, mutating nothing', () => {
    // The unlock command's gate test does not cover this command: the two
    // item movers carry their own dead/proximity gates (bank_sockets.ts) and
    // a deletion of either survived the original 39-test matrix.
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    const before = holdings(sim);
    moveFarFromBankers(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(hasErr(sim.drainEvents(), 'You are too far from the banker.')).toBe(true);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(holdings(sim)).toEqual(before);

    moveToBanker(sim);
    sim.entities.get(sim.playerId)!.dead = true;
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(holdings(sim)).toEqual(before);
  });

  it('swapping a bag onto its own id conserves holdings and leaves the socket unchanged', () => {
    // The classic dupe-or-void corner for swap logic: consume the carried
    // copy, read the old occupant AFTER, return it. Same id must net to a
    // conserving no-op, never a duplicate and never a void.
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    carry(sim, GENERAL_6);
    const before = holdings(sim);
    const carriedLen = m.inventory.length;
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6, 0);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags).toEqual([GENERAL_6, null, null, null]);
    expect(m.inventory.filter((s) => s.itemId === GENERAL_6).length).toBe(1);
    expect(m.inventory.length).toBe(carriedLen);
    expect(holdings(sim)).toEqual(before);
  });

  it('a legacy overstacked source slot frees no room: the returned bag lands one past budget', () => {
    // The equipBag doc's tolerated imprecision, pinned on the bank arm:
    // consuming one unit off an overstacked slot (count > 1) frees no slot,
    // so the swapped-out bag appends a 17th slot past the 16 budget. Over
    // budget blocks new adds; nothing is destroyed.
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    m.inventory.length = 0;
    while (m.inventory.length < 15) m.inventory.push(fullStack(BREAD));
    m.inventory.push({ itemId: GENERAL_16, count: 2 });
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_16, 0);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags[0]).toBe(GENERAL_16);
    expect(m.inventory.length).toBe(17);
    expect(m.inventory.filter((s) => s.itemId === GENERAL_6).length).toBe(1);
    expect(m.inventory.find((s) => s.itemId === GENERAL_16)?.count).toBe(1);
    expect(holdings(sim)).toEqual(before);
  });

  it('refuses a bag the player does not carry, and silently ignores a non-bag id', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(hasErr(sim.drainEvents(), "You don't have that item.")).toBe(true);

    carry(sim, BREAD, 1);
    sim.drainEvents();
    sim.bankSocketBag(BREAD);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
  });

  it('refuses a payload-bearing copy BEFORE consuming it (the equipBag #2837 peek)', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    // The newest copy carries a crafted marker; the id-only walk peeks it.
    m.inventory.push({ itemId: GENERAL_6, count: 1, craftedRecipeId: 'tailoring_linen_pouch' });
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(
      hasErr(sim.drainEvents(), 'That bag cannot be socketed while it carries a special property.'),
    ).toBe(true);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(holdings(sim)).toEqual(before);

    // An instance payload refuses the same way.
    m.inventory.pop();
    m.inventory.push({ itemId: GENERAL_6, count: 1, instance: { signer: 'Ana' } });
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(
      hasErr(sim.drainEvents(), 'That bag cannot be socketed while it carries a special property.'),
    ).toBe(true);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
  });

  it('the id-only walk consumes the PLAIN newest copy and leaves an older instanced copy intact', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    // The arm the refusal test above cannot reach. It proves a MARKED newest
    // copy is refused; it never proves that an UNMARKED newest copy takes
    // itself rather than the marked copy beneath it, which is the direction a
    // peek/consume divergence would show up in (bankSocketBag peeks with
    // newestMatchingSlot and consumes through ctx.removeItem).
    // Shape: [pouch(instanced, OLDER), bread, pouch(clean, NEWEST)].
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: GENERAL_6, count: 1, instance: { signer: 'Ana' } },
      fullStack(BREAD),
      { itemId: GENERAL_6, count: 1 },
    );
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags[0]).toBe(GENERAL_6);
    // POSITIONAL, never a bare count: both pouch slots carry the same item id
    // and the same count, so a length or total-units assertion cannot say WHICH
    // of the two survived.
    expect(m.inventory.map((s) => s.itemId)).toEqual([GENERAL_6, BREAD]);
    expect(m.inventory[0].count).toBe(1);
    expect(m.inventory[0].instance).toEqual({ signer: 'Ana' });
    expect(holdings(sim)).toEqual(before);
  });

  it('a corrupt non-positive carried count cannot steer the consume onto an instanced copy', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    // THE DIVERGENCE THIS GUARDS, and it was measured before it was fixed.
    // Sim.removeItem takes Math.min(s.count, 1) per slot, so a count-0 slot
    // yields nothing, is spliced, and the walk CONTINUES to the next match,
    // while newestMatchingSlot stops at it. Peeking one slot and consuming
    // another destroyed the instanced copy: pre-fix, this call emitted no
    // error, socketed the bag and left the inventory EMPTY.
    // Reachable because the carried load path clamps counts only UPWARD.
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: GENERAL_6, count: 1, instance: { signer: 'Ana' } },
      { itemId: GENERAL_6, count: 0 },
    );
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(hasErr(sim.drainEvents(), "You don't have that item.")).toBe(true);
    // Nothing socketed (no bag minted out of the empty slot) and nothing lost.
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(m.inventory[0].instance).toEqual({ signer: 'Ana' });
    expect(m.inventory[0].count).toBe(1);
    expect(holdings(sim)).toEqual(before);

    // A NEGATIVE count is the amplified case: removeItem's remaining budget
    // GROWS by the negative take, so the whole instanced stack went, not one
    // unit of it.
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: GENERAL_6, count: 3, instance: { signer: 'Ana' } },
      { itemId: GENERAL_6, count: -2 },
    );
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6);
    expect(hasErr(sim.drainEvents(), "You don't have that item.")).toBe(true);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(m.inventory[0].count).toBe(3);
    expect(m.inventory[0].instance).toEqual({ signer: 'Ana' });
  });

  it('the named-slot arm consumes exactly the named copy (and can dodge a payload copy)', () => {
    const sim = simWithSockets(2);
    const m = meta(sim);
    // Shape: [pouch(clean), bread, pouch(marked)]. The id-only walk would peek
    // the marked newest copy and refuse; naming slot 0 sockets the clean one.
    m.inventory.length = 0;
    m.inventory.push({ itemId: GENERAL_6, count: 1 }, fullStack(BREAD), {
      itemId: GENERAL_6,
      count: 1,
      craftedRecipeId: 'tailoring_linen_pouch',
    });
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6, 0, { slotIndex: 0 });
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags[0]).toBe(GENERAL_6);
    // The clean copy at index 0 was consumed; the marked copy survives.
    expect(m.inventory.map((s) => s.itemId)).toEqual([BREAD, GENERAL_6]);
    expect(m.inventory[1].craftedRecipeId).toBe('tailoring_linen_pouch');

    // A named slot holding the WRONG item is an invalid selection: refuse.
    sim.drainEvents();
    sim.bankSocketBag(GENERAL_6, 1, { slotIndex: 0 });
    expect(hasErr(sim.drainEvents(), "You don't have that item.")).toBe(true);
    expect(m.bank.socketBags[1]).toBe(null);
  });
});

// ---------------------------------------------------------------------------
describe('bankUnsocketBag', () => {
  it('round-trips: unsocket returns the bag to the carried inventory', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    const evs = sim.drainEvents();
    expect(evs.filter((e) => e.type === 'error')).toEqual([]);
    expect(hasLog(evs, 'Unsocketed Linen Pouch from your bank.')).toBe(true);
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(m.inventory.filter((s) => s.itemId === GENERAL_6).length).toBe(1);
    expect(holdings(sim)).toEqual(before);
  });

  it('refuses cleanly when the bag itself cannot fit in the bags; nothing is dropped', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    while (m.inventory.length < 16) sim.addItem(BREAD, stackSizeOf(ITEMS[BREAD]));
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    expect(hasErr(sim.drainEvents(), 'Your bags are full.')).toBe(true);
    expect(m.bank.socketBags[0]).toBe(GENERAL_6);
    expect(holdings(sim)).toEqual(before);
  });

  it('refuses away from a banker and while dead, leaving the socket intact', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    const before = holdings(sim);
    moveFarFromBankers(sim);
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    expect(hasErr(sim.drainEvents(), 'You are too far from the banker.')).toBe(true);
    expect(m.bank.socketBags[0]).toBe(GENERAL_6);
    expect(holdings(sim)).toEqual(before);

    moveToBanker(sim);
    sim.entities.get(sim.playerId)!.dead = true;
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.socketBags[0]).toBe(GENERAL_6);
    expect(holdings(sim)).toEqual(before);
  });

  it('an empty or malformed socket is a silent no-op', () => {
    const sim = simWithSockets(2);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6, 1);
    const before = holdings(sim);
    sim.drainEvents();
    sim.bankUnsocketBag(0); // empty (unlocked)
    sim.bankUnsocketBag(-1);
    sim.bankUnsocketBag(2.5);
    sim.bankUnsocketBag(99);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    // Decisive against an over-eager body, not just a silent one: the
    // occupied socket is untouched and nothing moved anywhere.
    expect(m.bank.socketBags).toEqual([null, GENERAL_6, null, null]);
    expect(holdings(sim)).toEqual(before);
  });

  it('GENERAL pool: unsocketing over capacity keeps every item and blocks deposits', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, GENERAL_16);
    sim.bankSocketBag(GENERAL_16);
    // Fill the whole 40-slot general budget (24 base + 16 socketed).
    for (let i = 0; i < 40; i++) m.bank.inventory.push(fullStack(BREAD));
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    // 40 banked stacks now sit over the 24-slot budget. Tolerated, never trimmed.
    expect(m.bank.inventory.length).toBe(40);
    expect(bankPools(m.bank)).toEqual({ general: 24, materials: 0 });
    // New deposits are blocked while over budget...
    const breadIdx = carry(sim, BREAD, 1);
    sim.drainEvents();
    sim.bankDeposit(breadIdx, 1);
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory.length).toBe(40);
    // ...and withdrawing still works (space can be freed).
    sim.drainEvents();
    sim.bankWithdraw(0, 1);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
  });

  it('MATERIALS pool: unsocketing the satchel strands the ore as tolerated general overflow', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, SATCHEL_24);
    sim.bankSocketBag(SATCHEL_24);
    // Fill both pools: 24 bread (general) + 24 ore (materials).
    for (let i = 0; i < 24; i++) m.bank.inventory.push(fullStack(BREAD));
    for (let i = 0; i < 24; i++) m.bank.inventory.push(fullStack(ORE));
    sim.drainEvents();
    sim.bankUnsocketBag(0);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.inventory.length).toBe(48);
    expect(bankPools(m.bank)).toEqual({ general: 24, materials: 0 });
    // Both deposit classes are blocked: the 48 slots sit over the 24 budget.
    const oreIdx = carry(sim, ORE, 1);
    sim.drainEvents();
    sim.bankDeposit(oreIdx, 1);
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory.length).toBe(48);
  });
});

// ---------------------------------------------------------------------------
describe('two-pool deposits through the real gate', () => {
  it('partial merge room with zero free slots keeps the pool-honest materials line', () => {
    // An instanced multi-unit stack whose byte-equal bank stack has room for
    // ONE unit while the general pool has zero free slots: that is pool
    // exhaustion (noFitCause 'space'), and with materials headroom free the
    // truthful refusal for a non-material stays the materials line, exactly
    // like its fungible sibling below (the two-pool meter shows those free
    // materials slots on screen).
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, SATCHEL_8);
    sim.bankSocketBag(SATCHEL_8);
    const stack = stackSizeOf(ITEMS[BREAD]);
    // General pool: 23 full plain stacks plus one byte-equal instanced stack
    // one unit under cap = 24 slots, general full, one unit of merge room.
    for (let i = 0; i < 23; i++) m.bank.inventory.push(fullStack(BREAD));
    m.bank.inventory.push({ itemId: BREAD, count: stack - 1, instance: { signer: 'Ana' } });
    const idx = carry(sim, BREAD, 1);
    m.inventory[idx] = { itemId: BREAD, count: 3, instance: { signer: 'Ana' } };
    sim.drainEvents();
    sim.bankDeposit(idx);
    expect(hasErr(sim.drainEvents(), 'Only materials fit in the space left in your bank.')).toBe(
      true,
    );
    expect(m.bank.inventory.length).toBe(24);
  });

  it('a true granularity refusal gets its own line, never "full" and never the materials line', () => {
    // The reachable 'instanced_units' shape at the deposit gate: a
    // hand-shaped multi-unit charges stack (every sim-built charges slot is
    // count 1) against a general pool with ONE free slot. One unit would
    // land; three cannot, and both pool lines would lie (slots are free, and
    // materials space is irrelevant to the refusal).
    const sim = simWithSockets(1);
    const m = meta(sim);
    for (let i = 0; i < 23; i++) m.bank.inventory.push(fullStack(BREAD));
    const idx = carry(sim, BREAD, 1);
    m.inventory[idx] = { itemId: BREAD, count: 3, instance: { charges: { heal: 2 } } };
    sim.drainEvents();
    sim.bankDeposit(idx);
    expect(
      hasErr(sim.drainEvents(), 'That stack cannot be split to fit the space left in your bank.'),
    ).toBe(true);
    expect(m.bank.inventory.length).toBe(23);
  });

  it('a non-material is refused while only materials headroom is free; a material lands', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, SATCHEL_8);
    sim.bankSocketBag(SATCHEL_8);
    for (let i = 0; i < 24; i++) m.bank.inventory.push(fullStack(BREAD)); // general full
    const breadIdx = carry(sim, BREAD, 1);
    sim.drainEvents();
    sim.bankDeposit(breadIdx, 1);
    // The pool-honest refusal (PR #3670): the two-pool meter shows free room,
    // so the line says what kind of room it is instead of claiming "full".
    expect(hasErr(sim.drainEvents(), 'Only materials fit in the space left in your bank.')).toBe(
      true,
    );
    expect(m.bank.inventory.length).toBe(24);

    const oreIdx = carry(sim, ORE, 5);
    sim.drainEvents();
    sim.bankDeposit(oreIdx, 5);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.inventory.length).toBe(25);
  });

  it('materials spill into free general room once the materials pool is full', () => {
    const sim = simWithSockets(1);
    const m = meta(sim);
    carry(sim, SATCHEL_8);
    sim.bankSocketBag(SATCHEL_8);
    for (let i = 0; i < 8; i++) m.bank.inventory.push(fullStack(ORE)); // materials full
    const oreIdx = carry(sim, ORE, 5);
    sim.drainEvents();
    sim.bankDeposit(oreIdx, 5);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.inventory.length).toBe(9);
    const info = sim.bankInfoFor(sim.playerId)!;
    expect(info.materialsUsed).toBe(8);
    expect(info.generalUsed).toBe(1); // the spilled ninth ore stack
  });
});

// ---------------------------------------------------------------------------
describe('BankInfo socket readouts', () => {
  it('reports sockets, prices, pools, and occupancy; capacity is both pools summed', () => {
    const sim = simWithSockets(2);
    const m = meta(sim);
    carry(sim, GENERAL_16);
    sim.bankSocketBag(GENERAL_16);
    carry(sim, SATCHEL_24);
    sim.bankSocketBag(SATCHEL_24);
    m.bank.inventory.push(fullStack(BREAD), fullStack(ORE), fullStack(ORE));
    const info = sim.bankInfoFor(sim.playerId)!;
    expect(info.socketsUnlocked).toBe(2);
    expect(info.socketBags).toEqual([GENERAL_16, SATCHEL_24, null, null]);
    expect(info.nextSocketCost).toBe(3500000);
    expect(info.generalCapacity).toBe(40);
    expect(info.materialsCapacity).toBe(24);
    expect(info.capacity).toBe(64);
    expect(info.generalUsed).toBe(1);
    expect(info.materialsUsed).toBe(2);
  });

  it('the pool split always sums to capacity (the wire invariant the meter geometry leans on)', () => {
    // src/world_api/bank.ts documents generalCapacity + materialsCapacity ==
    // capacity as prose; the phase 08 meter divides each pool by capacity for
    // its segment shares. True by construction today (bankInfoOf sums the
    // pools), so this arm exists for phase 09: a tunable that moves capacity
    // off the pool sum must red HERE, not silently desynchronize the footer
    // numbers from the segments.
    const sim = simWithSockets(2);
    const m = meta(sim);
    const sumHolds = (state: string): void => {
      const info = sim.bankInfoFor(sim.playerId)!;
      expect(info.generalCapacity + info.materialsCapacity, state).toBe(info.capacity);
    };
    sumHolds('fresh bank, sockets empty');
    carry(sim, GENERAL_16);
    sim.bankSocketBag(GENERAL_16);
    carry(sim, SATCHEL_24);
    sim.bankSocketBag(SATCHEL_24);
    sumHolds('both pools non-zero');
    m.copper += 100_000_000;
    sim.bankBuySlots();
    sumHolds('after a purchased expansion');
    for (let i = 0; i < 8; i++) m.bank.inventory.push(fullStack(ORE));
    sim.bankUnsocketBag(1);
    sumHolds('stranded materials re-accounted, capacity shrunk');
  });

  it('nextSocketCost walks the ladder and nulls once all four are unlocked', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_TOTAL;
    expect(sim.bankInfoFor(sim.playerId)!.nextSocketCost).toBe(1000000);
    sim.bankUnlockSocket();
    expect(sim.bankInfoFor(sim.playerId)!.nextSocketCost).toBe(2000000);
    sim.bankUnlockSocket();
    sim.bankUnlockSocket();
    sim.bankUnlockSocket();
    expect(sim.bankInfoFor(sim.playerId)!.nextSocketCost).toBe(null);
  });

  it('socketBags is a boundary clone, never a live sim reference', () => {
    const sim = simWithSockets(1);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    const info = sim.bankInfoFor(sim.playerId)!;
    info.socketBags[0] = 'tampered';
    expect(meta(sim).bank.socketBags[0]).toBe(GENERAL_6);
  });
});

// ---------------------------------------------------------------------------
describe('persistence', () => {
  it('round-trips socket state through serialize + addPlayer', () => {
    const sim = simWithSockets(2, 7);
    const m = meta(sim);
    carry(sim, GENERAL_16);
    sim.bankSocketBag(GENERAL_16);
    m.bank.inventory.push(fullStack(ORE));
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.bank!.unlockedSockets).toBe(2);
    expect(state.bank!.socketBags).toEqual([GENERAL_16, null, null, null]);
    // Key ORDER, not just key set: the byte-equality claim covers the JSONB
    // text, and JSON.stringify follows insertion order.
    expect(Object.keys(state.bank!)).toEqual([
      'inventory',
      'purchasedSlots',
      'bonusSlots',
      'unlockedSockets',
      'socketBags',
    ]);

    const sim2 = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      world: BANK_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Return', { state: clone(state) as never });
    const m2 = meta(sim2, pid);
    expect(m2.bank.unlockedSockets).toBe(2);
    expect(m2.bank.socketBags).toEqual([GENERAL_16, null, null, null]);
    expect(m2.bank.inventory).toEqual(m.bank.inventory);
    expect(bankPools(m2.bank)).toEqual({ general: 40, materials: 0 });
    // A second round trip is byte-stable.
    expect(sim2.serializeCharacter(pid)!.bank).toEqual(state.bank);
  });

  it('a zero-socket character serializes with the socket keys ABSENT', () => {
    // The load-bearing byte-equality claim (SavedBankState): the omission is
    // pinned with `in`, not toEqual, so an always-write regression cannot
    // hide behind a matcher that tolerates the extra keys.
    const sim = makeSim();
    const bank = sim.serializeCharacter(sim.playerId)!.bank!;
    expect('unlockedSockets' in bank).toBe(false);
    expect('socketBags' in bank).toBe(false);
    // The whole key list IN ORDER: byte-equality with a pre-socket save means
    // the serialized object's JSON text is identical, not merely key-set-equal.
    expect(Object.keys(bank)).toEqual(['inventory', 'purchasedSlots', 'bonusSlots']);
  });

  it('a pre-socket save loads and RE-serializes with the socket keys still absent', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)! as { bank?: Record<string, unknown> };
    // Simulate a save written before sockets existed: only the legacy keys.
    state.bank = {
      inventory: [fullStack(BREAD)],
      purchasedSlots: 6,
      bonusSlots: 0,
    };
    const sim2 = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: BANK_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Legacy', { state: clone(state) as never });
    expect(meta(sim2, pid).bank.unlockedSockets).toBe(0);
    const rebank = sim2.serializeCharacter(pid)!.bank!;
    expect('unlockedSockets' in rebank).toBe(false);
    expect('socketBags' in rebank).toBe(false);
    expect(rebank.inventory).toEqual([fullStack(BREAD)]);
  });

  it('no shipped writer ever decrements unlockedSockets (the omission predicate tripwire)', () => {
    // The serialize predicate's socketBags disjunct is belt-and-braces, NOT a
    // rescue: if a decrement ever landed, sanitize would drop a bag stranded
    // in a now-locked socket on the next load. Pin the invariant that keeps
    // that path unreachable: the only mutation of unlockedSockets in shipped
    // code is the single += 1 in bankUnlockSocket.
    //
    // The matcher takes the BRACKET form as well as the dotted one, because
    // `bank['unlockedSockets'] = 0` is the same write and a dotted-only scan
    // said "unreachable" while missing it. Its teeth are pinned below: a
    // scanner with no positive control is a sweep that cannot fail.
    const WRITER =
      /(\.unlockedSockets|\['unlockedSockets'\]|\["unlockedSockets"\])\s*(-=|\+=|=(?!=)|--|\+\+)/;
    // POSITIVE CONTROL: the scanner must flag every shape it claims to cover,
    // and must not flag a read. Without this the whole sweep could be a regex
    // that matches nothing and still reports the one expected writer.
    for (const planted of [
      'meta.bank.unlockedSockets -= 1;',
      'meta.bank.unlockedSockets = 0;',
      "meta.bank['unlockedSockets'] = 0;",
      'meta.bank["unlockedSockets"] += 1;',
    ]) {
      expect(WRITER.test(planted), `scanner missed ${planted}`).toBe(true);
    }
    for (const read of [
      'const n = meta.bank.unlockedSockets;',
      'if (meta.bank.unlockedSockets === 4) return;',
    ]) {
      expect(WRITER.test(read), `scanner flagged a read: ${read}`).toBe(false);
    }
    const root = fileURLToPath(new URL('..', import.meta.url));
    const writers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.ts')) {
          for (const line of readFileSync(p, 'utf8').split('\n')) {
            if (WRITER.test(line)) {
              writers.push(`${relative(root, p)}: ${line.trim()}`);
            }
          }
        }
      }
    };
    for (const d of ['src', 'server', 'headless']) walk(join(root, d));
    expect(writers).toEqual(['src/sim/bank_sockets.ts: meta.bank.unlockedSockets += 1;']);
  });
});

// ---------------------------------------------------------------------------
describe('determinism', () => {
  it('the same seed and command script produce identical bank state and copper', () => {
    const script = (sim: Sim) => {
      const m = meta(sim);
      m.copper = SOCKET_TOTAL;
      sim.bankUnlockSocket();
      sim.bankUnlockSocket();
      carry(sim, GENERAL_16);
      sim.bankSocketBag(GENERAL_16);
      carry(sim, SATCHEL_8);
      sim.bankSocketBag(SATCHEL_8, 1);
      const oreIdx = carry(sim, ORE, 12);
      sim.bankDeposit(oreIdx, 12);
      sim.bankUnsocketBag(0);
      for (let i = 0; i < 10; i++) sim.tick();
      return { bank: clone(m.bank), copper: m.copper, inv: clone(m.inventory) };
    };
    const a = script(makeSim(1234));
    const b = script(makeSim(1234));
    // Work-happened anchor first: two identical all-refused runs would also
    // compare equal, so pin the end state the script must actually reach.
    expect(a.bank.socketBags).toEqual([null, SATCHEL_8, null, null]);
    expect(a.copper).toBe(8500000); // 1150g minus the first two unlocks
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
describe('socket deeds', () => {
  it('the first unlock earns Strongbox Outfitter; all four earn Four Bags Deep', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = SOCKET_TOTAL;
    sim.bankUnlockSocket();
    sim.tick();
    expect(m.deedsEarned.has('soc_strongbox_outfitter')).toBe(true);
    expect(m.deedsEarned.has('soc_four_bags_deep')).toBe(false);
    sim.bankUnlockSocket();
    sim.bankUnlockSocket();
    sim.tick();
    expect(m.deedsEarned.has('soc_four_bags_deep')).toBe(false); // three is not four
    sim.bankUnlockSocket();
    sim.tick();
    expect(m.deedsEarned.has('soc_four_bags_deep')).toBe(true);
  });

  it('each socket command credits banker business (the npc visit mark)', () => {
    // The three bank_sockets.ts call sites feed the same distinct-banker
    // ledger the ladder commands do; a player whose ONLY banker business is
    // socket work must still earn the visit credit.
    const sim = simWithSockets(1);
    const m = meta(sim);
    expect(m.deedStats.visited.has(`npc:${BANKERS[0]}`)).toBe(true); // unlock credited
    m.deedStats.visited.delete(`npc:${BANKERS[0]}`);
    carry(sim, GENERAL_6);
    sim.bankSocketBag(GENERAL_6);
    expect(m.deedStats.visited.has(`npc:${BANKERS[0]}`)).toBe(true); // socket credited
    m.deedStats.visited.delete(`npc:${BANKERS[0]}`);
    sim.bankUnsocketBag(0);
    expect(m.deedStats.visited.has(`npc:${BANKERS[0]}`)).toBe(true); // unsocket credited
  });

  it('a loaded save with sockets already unlocked earns both deeds at join', () => {
    // The bankPurchasedSlots precedent (soc_gilded_strongbox): a meter deed
    // reads persisted state, so the join-time full evaluation grants it on
    // load. An offline save owner stamping the count is the same ownership
    // model as stamping purchasedSlots; the clamp bounds it at the ceiling.
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)! as { bank?: Record<string, unknown> };
    state.bank = {
      inventory: [],
      purchasedSlots: 0,
      bonusSlots: 0,
      unlockedSockets: 4,
      socketBags: [null, null, null, null],
    };
    const sim2 = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: BANK_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Mover', { state: clone(state) as never });
    const m2 = meta(sim2, pid);
    expect(m2.bank.unlockedSockets).toBe(4);
    expect(m2.deedsEarned.has('soc_strongbox_outfitter')).toBe(true);
    expect(m2.deedsEarned.has('soc_four_bags_deep')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the compounded worst-ordering over-capacity bound (the ceiling lesson)', () => {
  // The bank ships NO bank-side shrink guard (unsocket over capacity is the
  // covenant's explicit tolerance, and a swap guard would be theater when
  // unsocket-then-socket reaches the same state legally). The honest bound
  // must therefore come from the WORST ORDERING, and swaps-first is NOT it:
  // filling 208 at the all-satchel config then emptying the sockets strands
  // 96 over. INTERLEAVING beats it: fill the all-general config to 176, then
  // swap one general bag to a satchel at a time and fill the 24 fresh
  // materials slots each round (the general pool sits over budget the whole
  // time, but bag_pools grants free materials headroom to materials anyway,
  // by its own documented over-capacity clause). Occupancy tops out at
  //   maxGeneralBudgetEver + maxMaterialsBudgetEver = 176 + 96 = 272
  // because every deposit needs headroom in SOME pool at its moment, and
  // emptying all four sockets then strands 272 - 112 = 160 over the ladder
  // budget. This test REACHES 272 and pins it (a bound test that never
  // reaches its cap is constant-true), reads the POST-swap row before every
  // probe (the phase 05 audit gap), and proves conservation at the end.
  it('reaches 272 occupancy, never a slot more, and strands 160 over after emptying sockets', () => {
    const sim = simWithSockets(4);
    const m = meta(sim);
    m.bank.purchasedSlots = 72; // full ladder
    m.bank.bonusSlots = 16; // full entitlement
    const BREAD_STACK = stackSizeOf(ITEMS[BREAD]);
    const ORE_STACK = stackSizeOf(ITEMS[ORE]);

    // Stage A: all-general config, fill general to its 176 ceiling.
    for (let s = 0; s < 4; s++) {
      carry(sim, GENERAL_16);
      sim.bankSocketBag(GENERAL_16, s);
    }
    expect(bankPools(m.bank)).toEqual({ general: 176, materials: 0 });
    for (let i = 0; i < 176; i++) m.bank.inventory.push(fullStack(BREAD));
    // The 177th general slot does not exist: the REAL gate refuses.
    let breadIdx = carry(sim, BREAD, 1);
    sim.drainEvents();
    sim.bankDeposit(breadIdx, 1);
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory.length).toBe(176);
    m.inventory.splice(breadIdx, 1); // drop the probe crumb from the bags

    // Stage B: swap each general bag for a 24-slot satchel, filling the fresh
    // materials headroom EVERY round. Every probe reads the POST-swap row.
    for (let s = 0; s < 4; s++) {
      carry(sim, SATCHEL_24);
      sim.drainEvents();
      sim.bankSocketBag(SATCHEL_24, s); // swap: the general bag returns carried
      expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
      // POST-swAP row: the readout reflects the shrunk general and grown
      // materials budgets immediately, while occupancy carries over.
      const info = sim.bankInfoFor(sim.playerId)!;
      expect(info.generalCapacity).toBe(176 - 16 * (s + 1));
      expect(info.materialsCapacity).toBe(24 * (s + 1));
      expect(info.generalUsed).toBe(176); // over budget from round 0, tolerated
      expect(info.materialsUsed).toBe(24 * s);
      // A non-material deposit is refused against the POST-swap general pool;
      // the fresh materials headroom is visible, so the pool-honest line rides.
      breadIdx = carry(sim, BREAD, 1);
      sim.drainEvents();
      sim.bankDeposit(breadIdx, 1);
      expect(hasErr(sim.drainEvents(), 'Only materials fit in the space left in your bank.')).toBe(
        true,
      );
      m.inventory.splice(
        m.inventory.findIndex((x) => x.itemId === BREAD),
        1,
      );
      // The fresh 24 materials slots fill through the REAL gate...
      for (let i = 0; i < 24; i++) {
        const oreIdx = carry(sim, ORE, ORE_STACK);
        sim.drainEvents();
        sim.bankDeposit(oreIdx, ORE_STACK);
        expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
      }
      // ...and the 25th is refused against the POST-fill row.
      const oreIdx = carry(sim, ORE, 1);
      sim.drainEvents();
      sim.bankDeposit(oreIdx, 1);
      expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
      m.inventory.splice(
        m.inventory.findIndex((x) => x.itemId === ORE),
        1,
      );
      expect(m.bank.inventory.length).toBe(176 + 24 * (s + 1));
      // The returned general bag leaves the bags so the next round has room.
      const bagIdx = m.inventory.findIndex((x) => x.itemId === GENERAL_16);
      m.inventory.splice(bagIdx, 1);
    }
    // The supremum, REACHED: 176 general + 96 materials.
    expect(m.bank.inventory.length).toBe(272);
    expect(m.bank.inventory.filter((x) => x.itemId === BREAD).length).toBe(176);
    expect(m.bank.inventory.filter((x) => x.itemId === ORE).length).toBe(96);

    // Stage C: empty every socket (allowed, non-destructive), stranding the
    // full 160-slot over-carry against the 112 ladder budget.
    const bankedBefore = clone(m.bank.inventory);
    for (let s = 0; s < 4; s++) {
      sim.drainEvents();
      sim.bankUnsocketBag(s);
      expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
      // Keep carried room for the next returning satchel.
      const idx = m.inventory.findIndex((x) => x.itemId === SATCHEL_24);
      expect(idx).toBeGreaterThanOrEqual(0);
      m.inventory.splice(idx, 1);
    }
    expect(m.bank.socketBags).toEqual([null, null, null, null]);
    expect(bankPools(m.bank)).toEqual({ general: 112, materials: 0 });
    expect(m.bank.inventory.length).toBe(272); // every item kept
    expect(m.bank.inventory).toEqual(bankedBefore); // byte-identical, nothing reordered
    expect(272 - 112).toBe(160); // the honest over-carry bound, written out

    // Over budget, BOTH deposit classes stay blocked...
    for (const [id, count] of [
      [BREAD, 1],
      [ORE, 1],
    ] as const) {
      const idx = carry(sim, id, count);
      sim.drainEvents();
      sim.bankDeposit(idx, count);
      expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
      m.inventory.splice(
        m.inventory.findIndex((x) => x.itemId === id),
        1,
      );
    }
    expect(m.bank.inventory.length).toBe(272);
    // ...while withdrawing still frees space.
    sim.drainEvents();
    sim.bankWithdraw(0, BREAD_STACK);
    expect(sim.drainEvents().filter((e) => e.type === 'error')).toEqual([]);
    expect(m.bank.inventory.length).toBe(271);
  });
});

// ---------------------------------------------------------------------------
describe('conservation across the socket op sweep', () => {
  it('every socket op, success or refusal, conserves total holdings', () => {
    const sim = simWithSockets(2, 99);
    const m = meta(sim);
    carry(sim, GENERAL_6);
    carry(sim, SATCHEL_8);
    carry(sim, GENERAL_16);
    sim.addItem(ORE, 15);
    const before = holdings(sim);
    const copperBefore = m.copper;

    // Each op carries its EXPECTED socket state: conservation alone is
    // satisfied by a module that does nothing, so the snapshot is what makes
    // the sweep decisive that every op acted or refused exactly as labeled.
    const ops: [() => void, (string | null)[]][] = [
      // success: first empty socket
      [() => sim.bankSocketBag(GENERAL_6), [GENERAL_6, null, null, null]],
      // success: next empty socket
      [() => sim.bankSocketBag(SATCHEL_8), [GENERAL_6, SATCHEL_8, null, null]],
      // success: swap the satchel out of socket 1
      [() => sim.bankSocketBag(GENERAL_16, 1), [GENERAL_6, GENERAL_16, null, null]],
      // refused BEFORE the locked-socket arm: the swap above consumed the only
      // carried GENERAL_16, so this refuses at the carry check ("You don't
      // have that item."); the locked arm itself is pinned in the
      // explicit-target test above.
      [() => sim.bankSocketBag(GENERAL_16, 3), [GENERAL_6, GENERAL_16, null, null]],
      // silent no-op: not a bag id (the kind gate, before any consume)
      [() => sim.bankSocketBag('no_such_bag'), [GENERAL_6, GENERAL_16, null, null]],
      // refused: both unlocked sockets taken, none open
      [() => sim.bankSocketBag(SATCHEL_8), [GENERAL_6, GENERAL_16, null, null]],
      // success: the pouch returns to the bags
      [() => sim.bankUnsocketBag(0), [null, GENERAL_16, null, null]],
      // no-op: already empty
      [() => sim.bankUnsocketBag(0), [null, GENERAL_16, null, null]],
      // no-op: locked (and empty, the sanitize invariant)
      [() => sim.bankUnsocketBag(3), [null, GENERAL_16, null, null]],
    ];
    for (const [op, expectedSockets] of ops) {
      op();
      expect(m.bank.socketBags).toEqual(expectedSockets);
      expect(holdings(sim)).toEqual(before);
    }
    // Socket ops never touch copper (only bankUnlockSocket charges).
    expect(m.copper).toBe(copperBefore);
  });
});
