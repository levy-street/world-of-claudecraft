// Bank system: the pooled, guild-bank-ready character bank
// (src/sim/bank.ts + the Sim delegates bankDeposit/bankWithdraw/bankBuySlots).
// This pins the deposit/withdraw/buy rule matrix (every refusal moves nothing and
// charges nothing), the container-agnostic moveBetweenContainers seam, item+copper
// conservation across seeded op sweeps, determinism, and persistence/back-compat.
//
// The suite drives the REAL Sim through the public delegates; only the container
// primitive is exercised directly. Copper deltas and capacities are pinned to LITERAL
// numbers so a table/formula regression flips an assertion.
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import {
  BANK_BASE_SLOTS,
  BANK_EXPANSION_PRICES,
  BANK_EXPANSION_SLOTS,
  BANK_MAX_BONUS_SLOTS,
  type BankState,
  bankCapacity,
  clampBonusSlots,
  moveBetweenContainers,
  sanitizeBankState,
} from '../src/sim/bank';
import { ITEMS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemInstancePayload, SimEvent } from '../src/sim/types';

// The full 12-tier ladder, pinned as literals (never compared to the exported
// constant, which would be a zero-protection self-comparison).
const PRICES = [500, 1000, 2500, 5000, 10000, 20000, 40000, 80000, 150000, 300000, 600000, 1200000];
const LADDER_TOTAL = 2409000; // 500 + 1000 + ... + 1200000
const CAPS = [30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96]; // 24 + 6*(tier+1)

// The three Gilded Strongbox bursars (banker NPCs), one per town hub.
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;

// Resolve a banker's LIVE entity by templateId: content coords run through
// findSafePos/groundPos at spawn, so the runtime position can differ from the
// authored one. Every proximity move reads the live pos, never the content coord.
function bankerEntity(sim: Sim, templateId: string = BANKERS[0]): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === templateId) return e;
  }
  throw new Error(`banker ${templateId} is not spawned in the world`);
}

// Stand a player on top of a banker (well within BANKER_RANGE = INTERACT_RANGE + 2)
// and rebucket so the interact proximity scan sees them. Returns the banker entity.
function moveToBanker(sim: Sim, pid = sim.playerId, templateId: string = BANKERS[0]): Entity {
  const banker = bankerEntity(sim, templateId);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return banker;
}

// Place a player far from every banker (2D distance only; nearBanker ignores y).
// {500, 500} is hundreds of yards from all three town hubs.
function moveFarFromBankers(sim: Sim, pid = sim.playerId): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { x: 500, y: p.pos.y, z: 500 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

// A fresh world whose default player already stands at a banker. The pooled-bank
// command suite drives the bank commands without placing the player, and the proximity
// gate refuses them unless a banker is in reach, so the shared setup moves to one.
// The command-suite assertions never read position, so the move is invisible to them; the
// far-refusal cases below move away explicitly.
const makeSim = (seed = 42) => {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
  moveToBanker(sim);
  return sim;
};
const meta = (sim: Sim, pid = sim.playerId) => sim.meta(pid)!;

// A multiplayer world (no default player) for the banker interaction
// tests, mirroring the tests/mail.test.ts makeWorld idiom.
const makeBankWorld = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });

// Distinct gear ids (stackSize 1) for filling containers with non-mergeable entries.
const GEAR_IDS = Object.values(ITEMS)
  .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
  .map((d) => d.id);
const gearSlots = (n: number): InvSlot[] => {
  if (GEAR_IDS.length < n) throw new Error(`only ${GEAR_IDS.length} distinct gear ids, need ${n}`);
  return GEAR_IDS.slice(0, n).map((id) => ({ itemId: id, count: 1 }));
};

// Push a non-fungible instanced slot straight onto the player's bags (the simplest
// deterministic route; autoEquip is off so gear ids stay in the inventory list).
function pushInstanced(
  sim: Sim,
  itemId: string,
  instance: ItemInstancePayload,
  pid = sim.playerId,
) {
  meta(sim, pid).inventory.push({ itemId, count: 1, instance });
}

// Fill every free bag slot with distinct 1-per-slot gear so the next add has no home.
function fillBags(sim: Sim, pid = sim.playerId): void {
  const m = meta(sim, pid);
  const cap = bagCapacity(m.bags);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(GEAR_IDS[i % GEAR_IDS.length], 1, pid);
    i++;
  }
}

const hasErr = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'error' && e.text === text);
const hasLog = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'log' && e.text === text);

const clone = <T>(v: T): T => structuredClone(v);

// ---------------------------------------------------------------------------
describe('bank constants and capacity math', () => {
  it('base slots, expansion step, and the price ladder are the pinned literals', () => {
    expect(BANK_BASE_SLOTS).toBe(24);
    expect(BANK_EXPANSION_SLOTS).toBe(6);
    expect([...BANK_EXPANSION_PRICES]).toEqual(PRICES);
    expect(BANK_EXPANSION_PRICES.length).toBe(12);
  });

  it('bankCapacity = base + purchasedSlots + bonusSlots', () => {
    expect(bankCapacity({ inventory: [], purchasedSlots: 0, bonusSlots: 0 })).toBe(24);
    expect(bankCapacity({ inventory: [], purchasedSlots: 6, bonusSlots: 0 })).toBe(30);
    expect(bankCapacity({ inventory: [], purchasedSlots: 72, bonusSlots: 0 })).toBe(96);
    expect(bankCapacity({ inventory: [], purchasedSlots: 0, bonusSlots: 4 })).toBe(28);
    expect(bankCapacity({ inventory: [], purchasedSlots: 12, bonusSlots: 5 })).toBe(41);
  });
});

// ---------------------------------------------------------------------------
describe('deposit rules', () => {
  it('refuses a quest-kind item and moves/charges nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('boar_hide', 1); // kind: 'quest'
    const bagBefore = clone(m.inventory);
    const bankBefore = clone(m.bank.inventory);
    const copperBefore = m.copper;
    const idx = m.inventory.findIndex((s) => s.itemId === 'boar_hide');
    sim.drainEvents();
    sim.bankDeposit(idx);
    expect(hasErr(sim.drainEvents(), 'You cannot store quest items in the bank.')).toBe(true);
    expect(m.inventory).toEqual(bagBefore);
    expect(m.bank.inventory).toEqual(bankBefore);
    expect(m.copper).toBe(copperBefore);
  });

  it('deposits a whole stack (count undefined), splicing the source slot', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('wolf_fang', 5);
    const idx = m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.bankDeposit(idx);
    expect(m.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
  });

  it('deposits a partial count and decrements the source stack', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('wolf_fang', 10);
    const idx = m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.bankDeposit(idx, 4);
    expect(m.inventory.find((s) => s.itemId === 'wolf_fang')!.count).toBe(6);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
  });

  it('merges a further deposit of the same item into the existing bank stack', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('wolf_fang', 8);
    sim.bankDeposit(
      m.inventory.findIndex((s) => s.itemId === 'wolf_fang'),
      5,
    );
    sim.bankDeposit(
      m.inventory.findIndex((s) => s.itemId === 'wolf_fang'),
      3,
    );
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 8 }]);
  });

  it('deposits an instanced slot as its own entry, never merging with a plain stack', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('wolf_fang', 5);
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'wolf_fang')); // plain x5 in bank
    pushInstanced(sim, 'wolf_fang', { signer: 'Ana' });
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'wolf_fang' && s.instance));
    expect(m.bank.inventory).toHaveLength(2);
    expect(m.bank.inventory.filter((s) => s.instance).length).toBe(1);
    expect(m.bank.inventory.find((s) => !s.instance)).toEqual({ itemId: 'wolf_fang', count: 5 });
    // withdraw the instanced one; the payload survives
    sim.bankWithdraw(m.bank.inventory.findIndex((s) => s.instance));
    expect(m.inventory.find((s) => s.itemId === 'wolf_fang' && s.instance)!.instance).toEqual({
      signer: 'Ana',
    });
  });

  it('refuses a deposit at capacity and refuses a partial-fit deposit entirely (all-or-nothing)', () => {
    const sim = makeSim();
    const m = meta(sim);
    // Bank full at base capacity with a partial wolf_fang stack (room for 2) plus 23 gear.
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 18 }, ...gearSlots(23)];
    expect(bankCapacity(m.bank)).toBe(24);
    expect(m.bank.inventory).toHaveLength(24);
    sim.addItem('wolf_fang', 5); // 2 would fit the partial stack, 3 need a new (unavailable) slot
    const idx = m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    const bankBefore = clone(m.bank.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankDeposit(idx); // whole stack of 5
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory).toEqual(bankBefore); // nothing moved, not even the 2 that fit
    expect(m.inventory.find((s) => s.itemId === 'wolf_fang')!.count).toBe(5);
    expect(m.copper).toBe(copperBefore);
  });

  it('refuses a 25th DISTINCT item into a base (24-slot) bank', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = gearSlots(24);
    expect(bankCapacity(m.bank)).toBe(24);
    sim.addItem('wolf_fang', 1);
    const bagBefore = clone(m.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'wolf_fang'));
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory).toHaveLength(24);
    expect(m.inventory).toEqual(bagBefore); // the refused item stays in the bags
    expect(m.copper).toBe(copperBefore);
  });

  it('treats out-of-range / non-positive / over-count deposits as SILENT no-ops', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('wolf_fang', 5);
    const idx = m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    const bagBefore = clone(m.inventory);
    const bankBefore = clone(m.bank.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankDeposit(-1);
    sim.bankDeposit(999);
    sim.bankDeposit(idx, 0);
    sim.bankDeposit(idx, 6); // count > stack (5)
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagBefore);
    expect(m.bank.inventory).toEqual(bankBefore);
    expect(m.copper).toBe(copperBefore);
  });

  it('un-credits an active collect objective when its counted item is deposited', () => {
    // Every content collect item is quest-kind today (and deposit denies those), so
    // the deposit -> onInventoryChangedForQuests wiring is defensive for future
    // content; pin it with a synthetic collect quest over a plain fungible.
    const sim = makeSim();
    const m = meta(sim);
    QUESTS.__bank_uncredit = {
      ...QUESTS.q_widows,
      id: '__bank_uncredit',
      objectives: [{ type: 'collect', itemId: 'wolf_fang', count: 5, label: 'Wolf Fang' }],
    };
    try {
      m.questLog.set('__bank_uncredit', {
        questId: '__bank_uncredit',
        counts: [0],
        state: 'active',
      });
      sim.addItem('wolf_fang', 5); // the add-side recompute credits and readies it
      expect(m.questLog.get('__bank_uncredit')).toMatchObject({ counts: [5], state: 'ready' });
      sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'wolf_fang'));
      expect(sim.countItem('wolf_fang')).toBe(0);
      expect(m.questLog.get('__bank_uncredit')).toMatchObject({ counts: [0], state: 'active' });
    } finally {
      delete QUESTS.__bank_uncredit;
    }
  });
});

// ---------------------------------------------------------------------------
describe('withdraw rules', () => {
  it('withdraws a whole stack back into the bags', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 7 }];
    sim.bankWithdraw(0);
    expect(m.bank.inventory).toEqual([]);
    expect(sim.countItem('wolf_fang')).toBe(7);
  });

  it('withdraws a partial count, decrementing the bank stack', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 7 }];
    sim.bankWithdraw(0, 3);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    expect(sim.countItem('wolf_fang')).toBe(3);
  });

  it('refuses a withdraw when the bags are full, using the existing bags-full error', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 3 }];
    fillBags(sim);
    const bagBefore = clone(m.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankWithdraw(0);
    expect(hasErr(sim.drainEvents(), 'Your bags are full.')).toBe(true);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    expect(m.inventory).toEqual(bagBefore); // nothing duplicated into the full bags
    expect(m.copper).toBe(copperBefore);
  });

  it('treats malformed withdraw inputs as SILENT no-ops', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 5 }];
    const bankBefore = clone(m.bank.inventory);
    const bagBefore = clone(m.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankWithdraw(-1);
    sim.bankWithdraw(999);
    sim.bankWithdraw(0, 0);
    sim.bankWithdraw(0, 6); // count > stack (5)
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.bank.inventory).toEqual(bankBefore);
    expect(m.inventory).toEqual(bagBefore);
    expect(m.copper).toBe(copperBefore);
  });

  it('re-credits an active collect objective when its quest item is withdrawn', () => {
    // A quest item can only reach the bank via a legacy/tampered save (deposit denies
    // quest-kind); withdrawing it back into bags must re-run the quest-inventory
    // recompute. This pins the withdraw -> onInventoryChangedForQuests wiring.
    const sim = makeSim();
    const m = meta(sim);
    m.questLog.set('q_widows', { questId: 'q_widows', counts: [10, 0], state: 'active' });
    m.bank.inventory = [{ itemId: 'widow_venom_sac', count: 6 }];
    expect(m.questLog.get('q_widows')).toMatchObject({ counts: [10, 0], state: 'active' });
    sim.bankWithdraw(0);
    expect(sim.countItem('widow_venom_sac')).toBe(6);
    expect(m.questLog.get('q_widows')).toMatchObject({ counts: [10, 6], state: 'ready' });
  });
});

// ---------------------------------------------------------------------------
describe('buy expansion slots', () => {
  it('walks all twelve tiers, charging the exact table price and growing capacity by 6', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = LADDER_TOTAL;
    let copper = LADDER_TOTAL;
    for (let tier = 0; tier < 12; tier++) {
      sim.drainEvents();
      sim.bankBuySlots();
      expect(hasLog(sim.drainEvents(), 'You purchase additional bank slots.')).toBe(true);
      copper -= PRICES[tier];
      expect(m.copper).toBe(copper);
      expect(m.bank.purchasedSlots).toBe((tier + 1) * 6);
      expect(bankCapacity(m.bank)).toBe(CAPS[tier]);
    }
    expect(m.copper).toBe(0);
  });

  it('refuses a thirteenth purchase after all twelve expansions', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = LADDER_TOTAL;
    for (let tier = 0; tier < 12; tier++) sim.bankBuySlots();
    expect(m.bank.purchasedSlots).toBe(72);
    sim.drainEvents();
    sim.bankBuySlots();
    expect(hasErr(sim.drainEvents(), 'Your bank cannot be expanded further.')).toBe(true);
    expect(m.copper).toBe(0);
    expect(m.bank.purchasedSlots).toBe(72);
  });

  it('refuses a purchase the player cannot afford and charges nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 499; // one short of the first tier (500)
    sim.drainEvents();
    sim.bankBuySlots();
    expect(hasErr(sim.drainEvents(), 'You cannot afford that bank expansion.')).toBe(true);
    expect(m.copper).toBe(499);
    expect(m.bank.purchasedSlots).toBe(0);
  });

  it('charges exactly the next-tier price, never a partial charge', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 500; // exactly the first tier
    sim.bankBuySlots();
    expect(m.copper).toBe(0);
    expect(m.bank.purchasedSlots).toBe(6);
    // second tier costs 1000: with 0 copper it must refuse and leave the tier at 6.
    sim.drainEvents();
    sim.bankBuySlots();
    expect(hasErr(sim.drainEvents(), 'You cannot afford that bank expansion.')).toBe(true);
    expect(m.bank.purchasedSlots).toBe(6);
  });
});

// ---------------------------------------------------------------------------
describe('bonusSlots (the entitlement-registry seam, respected by the sim)', () => {
  it('a directly-set bonusSlots raises capacity and admits more deposits', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.bonusSlots = 4;
    expect(bankCapacity(m.bank)).toBe(28);
    // 27 entries is ABOVE the 24-slot base: the next deposit only fits if the
    // deposit path really honors bonusSlots (a base-capacity bank would refuse).
    m.bank.inventory = gearSlots(27);
    sim.addItem('wolf_fang', 1);
    sim.drainEvents();
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'wolf_fang'));
    expect(sim.drainEvents()).toHaveLength(0); // admitted, no refusal
    expect(m.bank.inventory).toHaveLength(28);
    expect(m.bank.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(true);
    // 28 entries fills the bonus-expanded bank exactly, so the 29th is refused.
    sim.addItem('linen_scrap', 1);
    sim.drainEvents();
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'linen_scrap'));
    expect(hasErr(sim.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m.bank.inventory).toHaveLength(28);
  });
});

// ---------------------------------------------------------------------------
describe('moveBetweenContainers (container-agnostic guild-bank seam)', () => {
  it('moves a whole stack into an empty destination and splices the source', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    const dst: InvSlot[] = [];
    expect(moveBetweenContainers(src, 0, undefined, dst, 10)).toEqual({ moved: 5 });
    expect(src).toEqual([]);
    expect(dst).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
  });

  it('merges into an existing destination stack', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 3 }];
    const dst: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    expect(moveBetweenContainers(src, 0, undefined, dst, 10)).toEqual({ moved: 3 });
    expect(src).toEqual([]);
    expect(dst).toEqual([{ itemId: 'wolf_fang', count: 8 }]);
  });

  it('tops up an existing stack to its size then splits the remainder into a new slot', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 18 }]; // stackSize 20
    const dst: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    expect(moveBetweenContainers(src, 0, undefined, dst, 10)).toEqual({ moved: 18 });
    expect(src).toEqual([]);
    expect(dst).toEqual([
      { itemId: 'wolf_fang', count: 20 },
      { itemId: 'wolf_fang', count: 3 },
    ]);
  });

  it('moves an instanced slot whole and never merges it with a plain stack', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 1, instance: { signer: 'Ana' } }];
    const dst: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    expect(moveBetweenContainers(src, 0, 1, dst, 10)).toEqual({ moved: 1 });
    expect(src).toEqual([]);
    expect(dst).toHaveLength(2);
    expect(dst[1]).toEqual({ itemId: 'wolf_fang', count: 1, instance: { signer: 'Ana' } });
  });

  it('refuses a distinct-item move into a full destination (no_fit) and mutates nothing', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    const dst: InvSlot[] = [{ itemId: 'linen_scrap', count: 1 }];
    const srcSnap = clone(src);
    const dstSnap = clone(dst);
    expect(moveBetweenContainers(src, 0, undefined, dst, 1)).toEqual({
      moved: 0,
      refusal: 'no_fit',
    });
    expect(src).toEqual(srcSnap);
    expect(dst).toEqual(dstSnap);
  });

  it('refuses a partial-fit move all-or-nothing (no_fit) and mutates nothing', () => {
    const src: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }]; // 2 fit the stack, 3 need a new slot
    const dst: InvSlot[] = [{ itemId: 'wolf_fang', count: 18 }];
    const srcSnap = clone(src);
    const dstSnap = clone(dst);
    expect(moveBetweenContainers(src, 0, undefined, dst, 1)).toEqual({
      moved: 0,
      refusal: 'no_fit',
    });
    expect(src).toEqual(srcSnap);
    expect(dst).toEqual(dstSnap);
  });

  it('returns an invalid refusal for a bad index or non-positive / over-count, mutating nothing', () => {
    const base: InvSlot[] = [{ itemId: 'wolf_fang', count: 5 }];
    for (const [i, c] of [
      [-1, undefined],
      [9, undefined],
      [0, 0],
      [0, -2],
      [0, 6], // count > stack (5)
    ] as const) {
      const src = clone(base);
      const dst: InvSlot[] = [];
      expect(moveBetweenContainers(src, i, c, dst, 10)).toEqual({ moved: 0, refusal: 'invalid' });
      expect(src).toEqual(base);
      expect(dst).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test-side deterministic PRNG (sim-side randomness must go through Rng; test-side
// scripting randomness is fine, and this keeps the op sequence reproducible per seed).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Multiset keyed so an instanced slot is tracked distinctly from a plain stack of the
// same item id: a wrongly-merged or duplicated instance changes this map.
function totalMultiset(bags: InvSlot[], bank: InvSlot[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of [...bags, ...bank]) {
    const key = s.instance ? `${s.itemId}#${s.instance.signer ?? '?'}` : s.itemId;
    m.set(key, (m.get(key) ?? 0) + s.count);
  }
  return m;
}
function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
const bankUnits = (bank: InvSlot[]) => bank.reduce((n, s) => n + s.count, 0);

describe('conservation seed sweeps', () => {
  it('conserves the item multiset and copper across 50 seeded op sequences', () => {
    let sawDeposit = false;
    let sawWithdraw = false;
    let sawPurchase = false;
    let sawCapRefusal = false;
    let sawQuestDeny = false;
    let sawBagsFullRefusal = false;
    let sawCannotAfford = false;

    for (let seed = 1; seed <= 50; seed++) {
      const sim = makeSim(seed);
      const m = meta(sim);
      sim.addItem('wolf_fang', 12);
      sim.addItem('linen_scrap', 7);
      sim.addItem('baked_bread', 5);
      sim.addItem('boar_hide', 1); // quest-kind: never bankable
      pushInstanced(sim, 'worn_sword', { signer: `S${seed}` });
      // Pre-fill the bank to one below base capacity so the sweep meets the full-bank wall.
      m.bank.inventory = gearSlots(23);
      // Every 5th seed starts with FULL bags (withdraws refuse bags-full) and every
      // 7th seed starts too poor for even the first tier (purchases refuse), so the
      // sweep provably exercises BOTH remaining refusal paths under conservation.
      if (seed % 5 === 0) fillBags(sim);
      m.copper = seed % 7 === 0 ? 300 : LADDER_TOTAL;

      const startTotal = totalMultiset(m.inventory, m.bank.inventory);
      const startCopper = m.copper;
      let spent = 0;
      const rnd = mulberry32(seed);

      for (let op = 0; op < 60; op++) {
        const before = bankUnits(m.bank.inventory);
        const roll = rnd();
        sim.drainEvents();
        if (roll < 0.45) {
          const idx = Math.floor(rnd() * (m.inventory.length + 2)) - 1; // may be out of range
          const count = rnd() < 0.5 ? undefined : Math.floor(rnd() * 6); // may be 0 / over-count
          sim.bankDeposit(idx, count);
        } else if (roll < 0.85) {
          const idx = Math.floor(rnd() * (m.bank.inventory.length + 2)) - 1;
          const count = rnd() < 0.5 ? undefined : Math.floor(rnd() * 6);
          sim.bankWithdraw(idx, count);
        } else {
          const tier = m.bank.purchasedSlots / 6;
          sim.bankBuySlots();
          if (m.bank.purchasedSlots > tier * 6) {
            spent += PRICES[tier];
            sawPurchase = true;
          }
        }
        const ev = sim.drainEvents();
        if (hasErr(ev, 'Your bank is full.')) sawCapRefusal = true;
        if (hasErr(ev, 'You cannot store quest items in the bank.')) sawQuestDeny = true;
        if (hasErr(ev, 'Your bags are full.')) sawBagsFullRefusal = true;
        if (hasErr(ev, 'You cannot afford that bank expansion.')) sawCannotAfford = true;
        const after = bankUnits(m.bank.inventory);
        if (after > before) sawDeposit = true;
        if (after < before) sawWithdraw = true;

        // Invariants after EVERY op.
        expect(
          mapsEqual(totalMultiset(m.inventory, m.bank.inventory), startTotal),
          `seed ${seed} op ${op}: item multiset drifted`,
        ).toBe(true);
        expect(m.copper, `seed ${seed} op ${op}: copper drifted`).toBe(startCopper - spent);
      }
    }

    // Non-vacuity: the sweep actually exercised each behavior at least once.
    expect(sawDeposit, 'no successful deposit occurred').toBe(true);
    expect(sawWithdraw, 'no successful withdraw occurred').toBe(true);
    expect(sawPurchase, 'no successful purchase occurred').toBe(true);
    expect(sawCapRefusal, 'no capacity refusal occurred').toBe(true);
    expect(sawQuestDeny, 'no quest-item denial occurred').toBe(true);
    expect(sawBagsFullRefusal, 'no bags-full withdraw refusal occurred').toBe(true);
    expect(sawCannotAfford, 'no cannot-afford purchase refusal occurred').toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('determinism', () => {
  it('the same fixed bank-op script over 300 ticks yields identical state + events', () => {
    function run() {
      const sim = new Sim({ seed: 123, playerClass: 'warrior', autoEquip: false });
      moveToBanker(sim); // proximity gate: the scripted bank ops need a banker in reach
      const m = sim.meta(sim.playerId)!;
      m.copper = LADDER_TOTAL;
      const texts: string[] = [];
      const wolfIdx = () => m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
      const linenIdx = () => m.inventory.findIndex((s) => s.itemId === 'linen_scrap');
      for (let tick = 0; tick < 300; tick++) {
        if (tick === 5) sim.addItem('wolf_fang', 10);
        if (tick === 10) sim.bankDeposit(wolfIdx(), 4);
        if (tick === 20) sim.bankBuySlots();
        if (tick === 40) sim.addItem('linen_scrap', 6);
        if (tick === 45) sim.bankDeposit(linenIdx());
        if (tick === 60) sim.bankWithdraw(0, 2);
        if (tick === 80) sim.bankBuySlots();
        if (tick === 120) sim.bankBuySlots();
        for (const e of sim.tick()) texts.push(`${e.type}:${'text' in e ? (e.text ?? '') : ''}`);
      }
      return { state: sim.serializeCharacter(sim.playerId)!, events: texts };
    }
    const a = run();
    // Non-vacuity: the scripted bank ops really executed in the run being compared
    // (a regression that silently no-ops every op would still deep-equal run()).
    expect(a.state.bank!.purchasedSlots).toBe(18); // three 6-slot purchases
    expect(a.state.bank!.inventory.length).toBeGreaterThan(0);
    expect(a.events).toContain('log:You purchase additional bank slots.');
    expect(a).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
describe('persistence and back-compat', () => {
  it('round-trips a populated bank deep-equal through serialize -> load -> serialize', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [
      { itemId: 'wolf_fang', count: 12 },
      { itemId: 'linen_scrap', count: 4 },
      {
        itemId: 'worn_sword',
        count: 1,
        instance: { signer: 'Cyd', charges: { z: 2 }, rolled: { stats: { agi: 3 } }, boundTo: 9 },
      },
    ];
    m.bank.purchasedSlots = 12;
    m.bank.bonusSlots = 5; // persisted (decision 1): must survive the round-trip
    m.copper = 4242;

    const s1 = sim.serializeCharacter(sim.playerId)!;
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: s1 });
    const s2 = sim2.serializeCharacter(pid2)!;
    // The Book of Deeds legitimately enriches a save across a load: joining
    // seeds the discovery ledger from held items (the hand-stuffed bank rows
    // above bypassed the addItem hub) and back-credits state predicates (12
    // purchased slots earns the first-expansion deed). Everything else must
    // round-trip byte-equal.
    const { deeds: _d1, deedStats: _ds1, renown: _r1, ...bankRest1 } = s1;
    const { deeds: _d2, deedStats: _ds2, renown: _r2, ...bankRest2 } = s2;
    expect(bankRest2).toEqual(bankRest1);
    expect(s2.bank).toEqual({
      inventory: m.bank.inventory,
      purchasedSlots: 12,
      bonusSlots: 5,
    });
  });

  it('does not alias the instanced payload across a serialize -> load boundary', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.inventory = [
      { itemId: 'worn_sword', count: 1, instance: { signer: 'Cyd', charges: { z: 2 } } },
    ];
    const s1 = sim.serializeCharacter(sim.playerId)!;
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: s1 });
    const m2 = meta(sim2, pid2);
    // Mutate the SOURCE sim's banked payload; the loaded copy must be untouched.
    m.bank.inventory[0].instance!.charges!.z = 999;
    m.bank.inventory[0].instance!.signer = 'Zzz';
    expect(m2.bank.inventory[0].instance).toEqual({ signer: 'Cyd', charges: { z: 2 } });
  });

  it('deposit -> withdraw preserves the full instanced payload without aliasing the original', () => {
    const sim = makeSim();
    const m = meta(sim);
    const payload: ItemInstancePayload = {
      signer: 'Bru',
      charges: { zap: 3 },
      rolled: { quality: 'rare', stats: { str: 7 } },
      boundTo: 7,
    };
    pushInstanced(sim, 'worn_sword', payload);
    sim.bankDeposit(m.inventory.findIndex((s) => s.itemId === 'worn_sword' && s.instance));
    const banked = m.bank.inventory.find((s) => s.instance)!;
    expect(banked.instance).toEqual({
      signer: 'Bru',
      charges: { zap: 3 },
      rolled: { quality: 'rare', stats: { str: 7 } },
      boundTo: 7,
    });
    // Mutating the ORIGINAL test-side object must not touch the banked (deep-cloned) copy.
    payload.signer = 'Zzz';
    payload.charges!.zap = 999;
    payload.rolled!.stats!.str = 999;
    expect(banked.instance!.signer).toBe('Bru');
    expect(banked.instance!.charges!.zap).toBe(3);
    expect(banked.instance!.rolled!.stats!.str).toBe(7);
    // The return trip: withdraw the banked slot and the FULL payload survives.
    sim.bankWithdraw(m.bank.inventory.findIndex((s) => s.instance));
    expect(m.bank.inventory.some((s) => s.instance)).toBe(false);
    const returned = m.inventory.find((s) => s.itemId === 'worn_sword' && s.instance)!;
    expect(returned.instance).toEqual({
      signer: 'Bru',
      charges: { zap: 3 },
      rolled: { quality: 'rare', stats: { str: 7 } },
      boundTo: 7,
    });
  });

  it('loads a legacy save with no bank field, defaulting to an empty bank', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete legacy.bank;
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    let pid = -1;
    expect(() => {
      pid = sim2.addPlayer('warrior', 'Legacy', { state: legacy as never });
    }).not.toThrow();
    const m2 = meta(sim2, pid);
    expect(m2.bank).toEqual({ inventory: [], purchasedSlots: 0, bonusSlots: 0 });
    expect(() => sim2.serializeCharacter(pid)).not.toThrow();
    expect(sim2.serializeCharacter(pid)!.bank).toEqual({
      inventory: [],
      purchasedSlots: 0,
      bonusSlots: 0,
    });
  });

  it('tolerates an over-capacity bank on load: all entries kept, deposit refused, withdraw works', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)! as { bank?: unknown };
    state.bank = { inventory: gearSlots(30), purchasedSlots: 0, bonusSlots: 0 };
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Hoarder', { state: state as never });
    const m2 = meta(sim2, pid);
    moveToBanker(sim2, pid); // proximity gate: the deposit/withdraw below need a banker in reach
    expect(m2.bank.inventory).toHaveLength(30); // nothing dropped
    expect(bankCapacity(m2.bank)).toBe(24);
    // a new deposit is refused (over capacity) and moves/charges nothing
    sim2.addItem('wolf_fang', 1, pid);
    const bagBefore = clone(m2.inventory);
    const bankBefore = clone(m2.bank.inventory);
    const copperBefore = m2.copper;
    sim2.drainEvents();
    sim2.bankDeposit(
      m2.inventory.findIndex((s) => s.itemId === 'wolf_fang'),
      1,
      pid,
    );
    expect(hasErr(sim2.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m2.bank.inventory).toEqual(bankBefore);
    expect(m2.inventory).toEqual(bagBefore);
    expect(m2.copper).toBe(copperBefore);
    // ...but a withdraw still works, draining back toward capacity
    sim2.bankWithdraw(0, 1, pid);
    expect(m2.bank.inventory).toHaveLength(29);
  });

  it('sanitizes a tampered bank through the real addPlayer load path', () => {
    // The tamper matrix below is unit-tested against sanitizeBankState directly;
    // this drives ONE tampered save through addPlayer so the load-boundary wiring
    // (sim.ts: meta.bank = sanitizeBankState(s.bank)) is itself load-bearing.
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)! as { bank?: unknown };
    state.bank = {
      inventory: [
        { itemId: 'worn_sword', count: 5, instance: { signer: 'Ana' } }, // forced to 1
        { itemId: 'wolf_fang', count: -3 }, // clamped to 1
        { itemId: 42, count: 1 }, // junk entry: dropped
      ],
      purchasedSlots: 7, // floored to the 6-grid
      bonusSlots: -2, // clamped to 0
    };
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Tampered', { state: state as never });
    expect(meta(sim2, pid).bank).toEqual({
      inventory: [
        { itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } },
        { itemId: 'wolf_fang', count: 1 },
      ],
      purchasedSlots: 6,
      bonusSlots: 0,
    });
  });
});

// ---------------------------------------------------------------------------
describe('sanitizeBankState', () => {
  const EMPTY: BankState = { inventory: [], purchasedSlots: 0, bonusSlots: 0 };

  it('defaults a missing or non-object raw to an empty bank', () => {
    expect(sanitizeBankState(undefined)).toEqual(EMPTY);
    expect(sanitizeBankState(null)).toEqual(EMPTY);
    expect(sanitizeBankState('garbage')).toEqual(EMPTY);
    expect(sanitizeBankState(42)).toEqual(EMPTY);
  });

  it('coerces a non-array inventory to empty', () => {
    expect(
      sanitizeBankState({ inventory: 'nope', purchasedSlots: 0, bonusSlots: 0 }).inventory,
    ).toEqual([]);
  });

  it('keeps only object entries with a non-empty string itemId (unknown ids kept, dormant)', () => {
    const raw = {
      inventory: [
        { itemId: 'wolf_fang', count: 3 },
        { itemId: 42, count: 1 },
        { itemId: '', count: 1 },
        null,
        'x',
        { itemId: 'unknown_id_xyz', count: 3 },
      ],
      purchasedSlots: 0,
      bonusSlots: 0,
    };
    expect(sanitizeBankState(raw).inventory).toEqual([
      { itemId: 'wolf_fang', count: 3 },
      { itemId: 'unknown_id_xyz', count: 3 },
    ]);
  });

  it('clamps count to Math.max(1, floor) and forces instanced entries to count 1', () => {
    const raw = {
      inventory: [
        { itemId: 'wolf_fang', count: -5 },
        { itemId: 'wolf_fang', count: 2.9 },
        { itemId: 'worn_sword', count: 5, instance: { signer: 'Ana' } },
      ],
      purchasedSlots: 0,
      bonusSlots: 0,
    };
    const out = sanitizeBankState(raw).inventory;
    expect(out[0].count).toBe(1);
    expect(out[1].count).toBe(2);
    expect(out[2]).toEqual({ itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } });
  });

  it('floors purchasedSlots to a multiple of 6 within [0, 72]', () => {
    const ps = (n: number) =>
      sanitizeBankState({ inventory: [], purchasedSlots: n, bonusSlots: 0 }).purchasedSlots;
    expect(ps(7)).toBe(6);
    expect(ps(9999)).toBe(72);
    expect(ps(-3)).toBe(0);
    expect(ps(5)).toBe(0);
    expect(ps(6)).toBe(6);
    expect(ps(72)).toBe(72);
  });

  it('clamps bonusSlots into [0, BANK_MAX_BONUS_SLOTS] (the entitlement-registry ceiling)', () => {
    const bs = (n: number) =>
      sanitizeBankState({ inventory: [], purchasedSlots: 0, bonusSlots: n }).bonusSlots;
    expect(bs(-4)).toBe(0);
    expect(bs(5)).toBe(5);
    expect(bs(16)).toBe(16); // the ceiling itself is admitted...
    expect(bs(17)).toBe(16); // ...and anything past it clamps (tampered-save capacity mint)
    expect(bs(9999)).toBe(16);
    expect(bs(7.9)).toBe(7); // floored, like purchasedSlots
    expect(BANK_MAX_BONUS_SLOTS).toBe(16); // 2 email + 2 discord + 2 wallet + 10 referral
  });
});

// ---------------------------------------------------------------------------
// The three Gilded Strongbox bursars (banker NPCs), the interact ->
// bank-window cue they emit, and the proximity gate every bank command now
// enforces. Standing in reach of any bursar is what unlocks the bank.
describe('banker NPCs in the world', () => {
  it('registers exactly the three Gilded Strongbox bursars as bankers', () => {
    const sim = makeBankWorld();
    expect(sim.bankerIds).toHaveLength(3);
    const templateIds = sim.bankerIds.map((id) => sim.entities.get(id)?.templateId).sort();
    expect(templateIds).toEqual(['bursar_aldous_crane', 'bursar_fernando', 'bursar_petra_vell']);
    for (const id of sim.bankerIds) {
      expect(sim.entities.get(id)?.kind).toBe('npc');
    }
  });
});

describe('interacting with a banker opens the bank', () => {
  const bankEvents = (evs: SimEvent[]) => evs.filter((e) => e.type === 'bank');

  for (const templateId of BANKERS) {
    it(`a targeted interact at ${templateId} emits exactly one bank event for the caller`, () => {
      const sim = makeBankWorld();
      const pid = sim.addPlayer('warrior', 'Vaulter');
      const banker = moveToBanker(sim, pid, templateId);
      const p = sim.entities.get(pid)!;
      p.targetId = banker.id;
      sim.drainEvents();
      sim.interact(pid);
      const evs = bankEvents(sim.drainEvents());
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ type: 'bank', pid });
    });

    it(`an untargeted proximity interact at ${templateId} emits exactly one bank event`, () => {
      const sim = makeBankWorld();
      const pid = sim.addPlayer('warrior', 'Vaulter');
      moveToBanker(sim, pid, templateId);
      const p = sim.entities.get(pid)!;
      p.targetId = null; // force the proximity-scan arm, not the targeted arm
      sim.drainEvents();
      sim.interact(pid);
      const evs = bankEvents(sim.drainEvents());
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ type: 'bank', pid });
    });
  }

  it('carries the interacting player, not a bystander standing at the same banker', () => {
    const sim = makeBankWorld();
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('warrior', 'Second');
    const banker = moveToBanker(sim, second, 'bursar_fernando');
    moveToBanker(sim, first, 'bursar_fernando'); // the bystander also stands at the banker
    const p = sim.entities.get(second)!;
    p.targetId = banker.id;
    sim.drainEvents();
    sim.interact(second); // interact as the second-added player
    const evs = bankEvents(sim.drainEvents());
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: 'bank', pid: second });
  });

  it('interacting away from every banker emits no bank event', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Wanderer');
    moveFarFromBankers(sim, pid);
    const p = sim.entities.get(pid)!;
    p.targetId = null;
    sim.drainEvents();
    sim.interact(pid);
    expect(bankEvents(sim.drainEvents())).toHaveLength(0);
  });

  it('a targeted interact at a banker from out of range emits no bank event', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Wanderer');
    const banker = bankerEntity(sim);
    moveFarFromBankers(sim, pid);
    const p = sim.entities.get(pid)!;
    p.targetId = banker.id; // target held from afar: the range check must block the emit
    sim.drainEvents();
    sim.interact(pid);
    expect(bankEvents(sim.drainEvents())).toHaveLength(0);
  });

  // The banker intercept must PRECEDE quest talk in both arms: a banker interact
  // opens the bank and never falls through to talkToNpc. The seam late-binds
  // talkToNpc (a reassigned sim.talkToNpc is honored, the W4 contract), so a spy
  // proves the intercept returned before the quest-talk dispatch.
  it('a banker interact never falls through to quest talk (either arm)', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Vaulter');
    const banker = moveToBanker(sim, pid, 'bursar_fernando');
    let talked = 0;
    (sim as unknown as { talkToNpc: () => void }).talkToNpc = () => {
      talked += 1;
    };
    const p = sim.entities.get(pid)!;

    p.targetId = banker.id;
    sim.drainEvents();
    sim.interact(pid);
    expect(bankEvents(sim.drainEvents())).toHaveLength(1);

    p.targetId = null; // now the proximity-scan arm
    sim.interact(pid);
    expect(bankEvents(sim.drainEvents())).toHaveLength(1);
    expect(talked).toBe(0);
  });
});

describe('bank commands require a nearby banker', () => {
  const TOO_FAR = 'You are too far from the banker.';

  it('deposit is refused far from a banker (moves/charges nothing), then succeeds in reach', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Depositor');
    const m = sim.meta(pid)!;
    sim.addItem('wolf_fang', 5, pid);
    const idx = () => m.inventory.findIndex((s) => s.itemId === 'wolf_fang');

    moveFarFromBankers(sim, pid);
    const bagBefore = clone(m.inventory);
    const bankBefore = clone(m.bank.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankDeposit(idx(), undefined, pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.inventory).toEqual(bagBefore); // nothing left the bags
    expect(m.bank.inventory).toEqual(bankBefore); // nothing entered the bank
    expect(m.copper).toBe(copperBefore);

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.bankDeposit(idx(), undefined, pid);
    expect(m.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
  });

  it('withdraw is refused far from a banker (moves/charges nothing), then succeeds in reach', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Withdrawer');
    const m = sim.meta(pid)!;
    m.bank.inventory = [{ itemId: 'wolf_fang', count: 7 }];

    moveFarFromBankers(sim, pid);
    const bankBefore = clone(m.bank.inventory);
    const bagBefore = clone(m.inventory);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.bankWithdraw(0, undefined, pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.bank.inventory).toEqual(bankBefore); // nothing left the bank
    expect(m.inventory).toEqual(bagBefore); // nothing entered the bags
    expect(m.copper).toBe(copperBefore);

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.bankWithdraw(0, undefined, pid);
    expect(m.bank.inventory).toEqual([]);
    expect(sim.countItem('wolf_fang', pid)).toBe(7);
  });

  it('buying slots is refused far from a banker (charges nothing), then succeeds in reach', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const m = sim.meta(pid)!;
    m.copper = 500; // exactly the first tier price

    moveFarFromBankers(sim, pid);
    sim.drainEvents();
    sim.bankBuySlots(pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.copper).toBe(500); // not charged
    expect(m.bank.purchasedSlots).toBe(0); // no slots granted

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.drainEvents();
    sim.bankBuySlots(pid);
    expect(hasLog(sim.drainEvents(), 'You purchase additional bank slots.')).toBe(true);
    expect(m.copper).toBe(0);
    expect(m.bank.purchasedSlots).toBe(6);
  });

  // Near/far for at least one command (deposit) at ALL THREE hubs.
  for (const templateId of BANKERS) {
    it(`deposit is gated by proximity at ${templateId}`, () => {
      const sim = makeBankWorld();
      const pid = sim.addPlayer('warrior', 'Traveler');
      const m = sim.meta(pid)!;
      sim.addItem('wolf_fang', 3, pid);
      const idx = () => m.inventory.findIndex((s) => s.itemId === 'wolf_fang');

      moveFarFromBankers(sim, pid);
      const copperBefore = m.copper;
      sim.drainEvents();
      sim.bankDeposit(idx(), undefined, pid);
      expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
      expect(m.bank.inventory).toEqual([]);
      expect(sim.countItem('wolf_fang', pid)).toBe(3);
      expect(m.copper).toBe(copperBefore);

      moveToBanker(sim, pid, templateId);
      sim.bankDeposit(idx(), undefined, pid);
      expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    });
  }

  // The reach boundary itself, pinned with LITERAL distances (never derived from
  // BANKER_RANGE/INTERACT_RANGE, which would be a self-comparison): 7 yards is in
  // reach inclusive, just past it is refused.
  it('the reach boundary is 7 yards inclusive: 7.0 succeeds, 7.05 is refused', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Surveyor');
    const m = sim.meta(pid)!;
    sim.addItem('wolf_fang', 2, pid);
    const idx = () => m.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    const banker = bankerEntity(sim, 'bursar_fernando');
    const p = sim.entities.get(pid)!;
    const standAt = (dx: number) => {
      p.pos = { x: banker.pos.x + dx, y: p.pos.y, z: banker.pos.z };
      p.prevPos = { ...p.pos };
      sim.rebucket(p);
    };

    standAt(7.05); // just past the boundary: refused, nothing moves
    sim.drainEvents();
    sim.bankDeposit(idx(), undefined, pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.bank.inventory).toEqual([]);
    expect(sim.countItem('wolf_fang', pid)).toBe(2);

    standAt(7); // exactly on the boundary: allowed (dist2d <= 7, inclusive)
    sim.bankDeposit(idx(), undefined, pid);
    expect(m.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
  });
});

describe('bankInfoFor read boundary', () => {
  it('clones at the read boundary: mutating the returned BankInfo never touches sim state', () => {
    const sim = makeSim();
    const m = meta(sim);
    pushInstanced(sim, 'worn_sword', {
      signer: 'Cyd',
      charges: { z: 2 },
      rolled: { stats: { agi: 3 } },
    });
    sim.bankDeposit(m.inventory.findIndex((s) => s.instance));
    expect(m.bank.inventory).toHaveLength(1);

    const info = sim.bankInfoFor(sim.playerId);
    expect(info).not.toBeNull();
    const slot = info!.slots[0];
    // A shallow copy (slice/spread) would alias the live instance payload here.
    slot.instance!.charges!.z = 999;
    slot.instance!.rolled!.stats!.agi = 99;
    slot.instance!.signer = 'Zzz';
    slot.count = 40;
    info!.slots.push({ itemId: 'wolf_fang', count: 5 });
    expect(m.bank.inventory).toEqual([
      {
        itemId: 'worn_sword',
        count: 1,
        instance: { signer: 'Cyd', charges: { z: 2 }, rolled: { stats: { agi: 3 } } },
      },
    ]);
  });

  it('at the full 12-expansion ladder the read reports capacity 96 and a null cost', () => {
    const sim = makeSim();
    // 72 purchased slots = all 12 expansions bought (6 per tier); the ladder is done,
    // so the display price goes null (the "cannot be expanded further" arm).
    meta(sim).bank.purchasedSlots = 72;
    const info = sim.bankInfoFor(sim.playerId);
    expect(info).not.toBeNull();
    expect(info!.capacity).toBe(96); // 24 base + 72 purchased
    expect(info!.purchasedSlots).toBe(72);
    expect(info!.nextExpansionCost).toBeNull();
  });

  it('the IWorld bankInfo getter serves the local player through the same read', () => {
    const sim = makeSim();
    sim.addItem('wolf_fang', 3);
    sim.bankDeposit(meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang'));
    const info = sim.bankInfo;
    expect(info).not.toBeNull();
    expect(info!.capacity).toBe(24);
    expect(info!.purchasedSlots).toBe(0);
    expect(info!.bonusSlots).toBe(0);
    expect(info!.nextExpansionCost).toBe(500);
    expect(info!.slots).toEqual([{ itemId: 'wolf_fang', count: 3 }]);

    moveFarFromBankers(sim);
    expect(sim.bankInfo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The server-stamped bank bonus (addPlayer's bankBonus opt). The HOST
// recomputes the total + per-source breakdown from account facts at every join
// and stamps both; the sim only stores, clamps, and serves them. Offline worlds
// never pass the opt, so the save's own (clamped) value and an empty breakdown
// are the no-stamp arm.
describe('server-stamped bank bonus', () => {
  const SOURCES = [
    { id: 'email', slots: 2, maxSlots: 2 },
    { id: 'discord', slots: 0, maxSlots: 2 },
    { id: 'wallet', slots: 2, maxSlots: 2 },
    { id: 'referral', slots: 6, maxSlots: 10, count: 3, cap: 5 },
  ];

  it('clampBonusSlots pins the [0, 16] registry ceiling as literals', () => {
    expect(clampBonusSlots(-3)).toBe(0);
    expect(clampBonusSlots(0)).toBe(0);
    expect(clampBonusSlots(10.9)).toBe(10);
    expect(clampBonusSlots(16)).toBe(16);
    expect(clampBonusSlots(17)).toBe(16);
    expect(clampBonusSlots(Number.NaN)).toBe(0);
    expect(clampBonusSlots(Number.POSITIVE_INFINITY)).toBe(16);
    expect(clampBonusSlots('junk')).toBe(0);
  });

  it('stamps a brand-new (stateless) character: first-ever join already gets its bonus', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Fresh', {
      bankBonus: { bonusSlots: 10, sources: SOURCES },
    });
    const m = meta(sim, pid);
    expect(m.bank.bonusSlots).toBe(10);
    expect(bankCapacity(m.bank)).toBe(34); // 24 base + 10 stamped bonus
    expect(m.bankBonusSources).toEqual(SOURCES);
    // Cloned at the write boundary: the sim must never alias the host's array/rows.
    expect(m.bankBonusSources).not.toBe(SOURCES);
    expect(m.bankBonusSources[0]).not.toBe(SOURCES[0]);
  });

  it('the stamp overrides the persisted value in BOTH directions (recompute-at-join)', () => {
    const sim = makeSim();
    meta(sim).bank.bonusSlots = 6;
    const saved = sim.serializeCharacter(sim.playerId)!;

    const up = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const upPid = up.addPlayer('warrior', 'Linked', {
      state: saved,
      bankBonus: { bonusSlots: 16, sources: SOURCES },
    });
    expect(meta(up, upPid).bank.bonusSlots).toBe(16);

    const down = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const downPid = down.addPlayer('warrior', 'Unlinked', {
      state: saved,
      bankBonus: { bonusSlots: 2, sources: [] },
    });
    expect(meta(down, downPid).bank.bonusSlots).toBe(2); // unlinking lowered it at login
  });

  it('the stamp itself is clamped to the registry ceiling', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Greedy', {
      bankBonus: { bonusSlots: 40, sources: [] },
    });
    expect(meta(sim, pid).bank.bonusSlots).toBe(BANK_MAX_BONUS_SLOTS);
  });

  it('no stamp (the offline arm) keeps the sanitized save value and an empty breakdown', () => {
    const sim = makeSim();
    meta(sim).bank.bonusSlots = 5;
    const saved = sim.serializeCharacter(sim.playerId)!;
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Offline', { state: saved });
    expect(meta(sim2, pid2).bank.bonusSlots).toBe(5);
    expect(meta(sim2, pid2).bankBonusSources).toEqual([]);
  });

  it('a pre-bonusSlots save loads clean under the stamp path', () => {
    const sim = makeSim();
    const saved = sim.serializeCharacter(sim.playerId)!;
    delete (saved as { bank?: unknown }).bank; // a save from before the bank existed
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Ancient', {
      state: saved,
      bankBonus: { bonusSlots: 4, sources: SOURCES.slice(0, 2) },
    });
    const m2 = meta(sim2, pid2);
    expect(m2.bank.inventory).toEqual([]);
    expect(m2.bank.bonusSlots).toBe(4);
    expect(m2.bankBonusSources).toEqual(SOURCES.slice(0, 2));
  });

  it('a shrink below the used slot count goes over-capacity without losing items', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.bank.bonusSlots = 16; // capacity 40
    for (let i = 0; i < 30; i++) m.bank.inventory.push({ itemId: 'wolf_fang', count: 1 });
    const saved = sim.serializeCharacter(sim.playerId)!;

    // Rejoin after every account fact was unlinked: the stamp drops to 0, so the
    // 30 banked stacks now sit over the 24-slot capacity. Tolerated, never trimmed.
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Shrunk', {
      state: saved,
      bankBonus: { bonusSlots: 0, sources: [] },
    });
    const m2 = meta(sim2, pid2);
    expect(m2.bank.inventory).toHaveLength(30);
    expect(bankCapacity(m2.bank)).toBe(24);

    // New deposits refuse with the standard full line and move nothing...
    moveToBanker(sim2, pid2);
    sim2.addItem('linen_scrap', 1, pid2);
    const idx = m2.inventory.findIndex((s) => s.itemId === 'linen_scrap');
    sim2.bankDeposit(idx, undefined, pid2);
    expect(hasErr(sim2.drainEvents(), 'Your bank is full.')).toBe(true);
    expect(m2.bank.inventory).toHaveLength(30);
    expect(m2.inventory.some((s) => s.itemId === 'linen_scrap')).toBe(true);

    // ...while withdrawing out of the over-full bank still works.
    sim2.bankWithdraw(0, undefined, pid2);
    expect(m2.bank.inventory).toHaveLength(29);
  });

  it('bankInfoFor serves the stamped breakdown as boundary clones', () => {
    const sim = makeBankWorld();
    const pid = sim.addPlayer('warrior', 'Reader', {
      bankBonus: { bonusSlots: 10, sources: SOURCES },
    });
    moveToBanker(sim, pid);
    const info = sim.bankInfoFor(pid);
    expect(info).not.toBeNull();
    expect(info!.bonusSlots).toBe(10);
    expect(info!.bonusSources).toEqual(SOURCES);
    // Mutating the returned rows must never touch sim state (the read boundary).
    info!.bonusSources[0].slots = 99;
    info!.bonusSources.push({ id: 'fake', slots: 2, maxSlots: 2 });
    const m = meta(sim, pid);
    expect(m.bankBonusSources).toEqual(SOURCES);
  });
});
