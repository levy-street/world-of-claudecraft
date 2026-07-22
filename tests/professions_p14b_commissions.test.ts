// Professions 2.0 Phase 14b: Commissions and the Maker's Bond (#2207).
//
// The commission opt-in at craft time (crafting.ts + commission.ts), the
// bind-on-first-trade arc it rides (the Phase 13 primitive: trade.ts stamps
// boundTo on arrival, tradeSetOffer refuses bound copies with ONE English
// deny), the master unbind service (resolveUnbind deny order, the single
// charge, the field-clear-only mutation), the face-to-face-by-construction
// pins (mail/market fungible-only escrow vs commissioned equipment), payload
// persistence, and the live-GameServer wire arc including the
// HEAVY_SELF_EVENTS inv re-diff. Harness modeled on
// tests/professions_p13_qa_coverage.test.ts / professions_p13_qa_arc.test.ts /
// professions_p13_bound_surfaces.test.ts.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  isCommissionEligible,
  isCommissionEligibleKind,
  resolveUnbind,
  UNBIND_FEE_BY_QUALITY_TIER,
  unbindFeeFor,
  unbindItem as unbindItemMod,
} from '../src/sim/professions/commission';
import { craftItem as craftItemMod, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { isAtAnyStation } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import * as tradeMod from '../src/sim/social/trade';
import type { InvSlot, ItemDef, ItemInstancePayload, SimEvent } from '../src/sim/types';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword'; // weapon, common quality
const VESTMENTS_RECIPE = 'recipe_eastbrook_ritual_vestments';
const VESTMENTS = 'eastbrook_ritual_vestments'; // armor
const POTION_RECIPE = 'recipe_minor_healing_potion';
const POTION = 'minor_healing_potion'; // potion kind: commission-INELIGIBLE
const BOUND_DENY = 'That item is bound and cannot be traded.';

function recipeOf(id: string): ProfessionRecipeRecord {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`missing recipe ${id}`);
  return recipe;
}

function grantReagents(sim: Sim, recipeId: string, pid: number, crafts = 1): void {
  const recipe = recipeOf(recipeId);
  for (const reagent of recipe.reagents) {
    sim.addItem(reagent.itemId, reagent.count * crafts, pid);
  }
}

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function makeTradeSim(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, noPlayer: true });
  const a = sim.addPlayer('warrior', 'Ayla');
  const b = sim.addPlayer('warrior', 'Borin');
  const ea = sim.ctx.entities.get(a)!;
  const eb = sim.ctx.entities.get(b)!;
  eb.pos.x = ea.pos.x + 2;
  eb.pos.z = ea.pos.z;
  return { sim, a, b };
}

function slotsOf(sim: Sim, pid: number, itemId: string): InvSlot[] {
  return sim.ctx.resolve(pid)!.meta.inventory.filter((s) => s.itemId === itemId);
}

function standAtStation(sim: Sim, pid: number, stationIdx = 0): void {
  const e = sim.ctx.entities.get(pid)!;
  e.pos.x = STATIONS[stationIdx].pos.x;
  e.pos.z = STATIONS[stationIdx].pos.z;
}

function standInWilds(sim: Sim, pid: number): void {
  const e = sim.ctx.entities.get(pid)!;
  e.pos.x = 99999;
  e.pos.z = 99999;
  expect(isAtAnyStation(e.pos)).toBe(false);
}

function setCopper(sim: Sim, pid: number, c: number): void {
  sim.players.get(pid)!.copper = c;
}

function copperOf(sim: Sim, pid: number): number {
  return sim.players.get(pid)!.copper;
}

function countDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number } {
  let draws = 0;
  sim.ctx.rng.setObserver(() => {
    draws += 1;
  });
  try {
    return { result: fn(), draws };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function unbindEvents(events: SimEvent[]) {
  return events.filter((e) => e.type === 'unbindResult') as Array<{
    type: 'unbindResult';
    ok: boolean;
    itemId: string;
    reason?: string;
    fee: number;
    pid?: number;
  }>;
}

/** Trade `itemId` x1 from a to b through the REAL trade module (the Phase 3
 *  two-phase confirm), returning the error texts the run emitted. */
function runTrade(sim: Sim, a: number, b: number, itemId: string): string[] {
  tradeMod.tradeRequest(sim.ctx, b, a);
  tradeMod.tradeAccept(sim.ctx, b);
  sim.drainEvents();
  tradeMod.tradeSetOffer(sim.ctx, [{ itemId, count: 1 }], 0, a);
  tradeMod.tradeConfirm(sim.ctx, a);
  tradeMod.tradeConfirm(sim.ctx, b);
  return errorTexts(sim.drainEvents());
}

// ---------------------------------------------------------------------------
// 1. Eligibility: the ruled-in equipment kinds, and nothing else.
// ---------------------------------------------------------------------------
describe('commission eligibility (the 2026-07-20 equipment-only ruling)', () => {
  it('weapon, armor, and held_offhand kinds are eligible; every other kind is not', () => {
    expect(isCommissionEligibleKind('weapon')).toBe(true);
    expect(isCommissionEligibleKind('armor')).toBe(true);
    expect(isCommissionEligibleKind('held_offhand')).toBe(true);
    for (const kind of ['junk', 'potion', 'food', 'elixir', 'tool', 'bag', 'quest']) {
      expect(isCommissionEligibleKind(kind as ItemDef['kind']), kind).toBe(false);
    }
    expect(isCommissionEligible(undefined)).toBe(false);
    expect(isCommissionEligible(ITEMS[SWORD])).toBe(true);
    expect(isCommissionEligible(ITEMS[POTION])).toBe(false);
    // The Phase 13 reagents stay OUT of the service by kind.
    expect(isCommissionEligible(ITEMS.resonant_steel)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Craft-time opt-in minting.
// ---------------------------------------------------------------------------
describe('commission opt-in at craft time', () => {
  it('a commissioned sub-rare craft forces the instance path with bindOnTrade and NO signer', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantReagents(sim, SWORD_RECIPE, pid);
    const result = craftItemMod(sim.ctx, SWORD_RECIPE, true, pid);
    expect(result.ok).toBe(true);
    expect(result.commission).toBe(true);
    const slots = slotsOf(sim, pid, SWORD);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance).toEqual({ bindOnTrade: true });
  });

  it('a non-commission craft of the same recipe is byte-identical to today: a plain fungible grant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantReagents(sim, SWORD_RECIPE, pid);
    const result = craftItemMod(sim.ctx, SWORD_RECIPE, false, pid);
    expect(result.ok).toBe(true);
    expect(result.commission).toBeUndefined();
    const slots = slotsOf(sim, pid, SWORD);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance).toBeUndefined();
  });

  it('the flag is silently ignored for an ineligible output kind (a tampered potion never arms)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantReagents(sim, POTION_RECIPE, pid);
    const result = craftItemMod(sim.ctx, POTION_RECIPE, true, pid);
    expect(result.ok).toBe(true);
    expect(result.commission).toBeUndefined();
    const slots = slotsOf(sim, pid, POTION);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance).toBeUndefined();
  });

  it('the commission flag never adds an rng draw: exactly ONE output-side draw either way', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantReagents(sim, SWORD_RECIPE, pid, 2);
    sim.drainEvents();
    const plain = countDraws(sim, () => craftItemMod(sim.ctx, SWORD_RECIPE, false, pid));
    const commissioned = countDraws(sim, () => craftItemMod(sim.ctx, SWORD_RECIPE, true, pid));
    expect(plain.result.ok).toBe(true);
    expect(commissioned.result.ok).toBe(true);
    expect(plain.draws).toBe(1);
    expect(commissioned.draws).toBe(1);
  });

  it('a commissioned masterwork proc composes: signer + rolled.masterwork + bindOnTrade on one payload', () => {
    const sim = makeSim(20);
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('tailoring');
    const meta = sim.players.get(pid)!;
    meta.craftSkills.tailoring = 200;
    grantReagents(sim, VESTMENTS_RECIPE, pid);
    sim.drainEvents();
    // Force the single output-side proc draw to hit: procRoll 0 beats any
    // positive procChance (tiersAboveRecipe > 0 at skill 200), so the
    // masterwork branch runs deterministically without seed hunting.
    const rng = sim.ctx.rng as unknown as { next(): number };
    const origNext = rng.next.bind(rng);
    rng.next = () => 0;
    try {
      const result = craftItemMod(sim.ctx, VESTMENTS_RECIPE, true, pid);
      expect(result.ok).toBe(true);
      expect(result.masterwork).toBe(true);
      expect(result.commission).toBe(true);
    } finally {
      rng.next = origNext;
    }
    const slots = slotsOf(sim, pid, VESTMENTS);
    expect(slots).toHaveLength(1);
    const payload = slots[0].instance!;
    expect(payload.bindOnTrade).toBe(true);
    expect(payload.signer).toBe(meta.name);
    expect(payload.rolled?.masterwork).toBe(true);
    expect(payload.rolled?.stats).toBeTruthy();
  });

  it('a commissioned masterwork MULTI-COPY output arms the remainder too (synthetic recipe)', () => {
    const recipe = {
      id: 'qa_recipe_p14b_mw_pair',
      professionId: 'tailoring',
      resultItemId: VESTMENTS,
      resultCount: 2,
      reagents: [{ itemId: 'linen_scrap', count: 1 }],
      skillReq: 0,
      level: 1,
      itemLevelBudget: 1,
    } as unknown as ProfessionRecipeRecord;
    const sim = makeSim(21);
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('tailoring');
    const meta = sim.players.get(pid)!;
    meta.craftSkills.tailoring = 200;
    sim.addItem('linen_scrap', 1, pid);
    const rng = sim.ctx.rng as unknown as { next(): number };
    const origNext = rng.next.bind(rng);
    rng.next = () => 0;
    try {
      const result = resolveCraftForRecipe(sim.ctx, pid, recipe, true);
      expect(result.ok).toBe(true);
      expect(result.masterwork).toBe(true);
      expect(result.commission).toBe(true);
    } finally {
      rng.next = origNext;
    }
    const slots = slotsOf(sim, pid, VESTMENTS);
    const lead = slots.filter((s) => s.instance?.rolled?.masterwork);
    const remainder = slots.filter((s) => !s.instance?.rolled?.masterwork);
    expect(lead).toHaveLength(1);
    expect(lead[0].instance?.bindOnTrade).toBe(true);
    expect(lead[0].instance?.signer).toBe(meta.name);
    expect(remainder).toHaveLength(1);
    expect(remainder[0].instance).toEqual({ bindOnTrade: true });
    expect(slots.reduce((n, s) => n + s.count, 0)).toBe(2);
  });

  it('a commissioned resultCount > 1 output arms EVERY copy (synthetic multi-copy equipment recipe)', () => {
    const QA_ITEM = 'qa_p14b_paired_daggers';
    (ITEMS as Record<string, ItemDef>)[QA_ITEM] = {
      id: QA_ITEM,
      name: 'QA Paired Dagger',
      kind: 'weapon',
      slot: 'mainhand',
      quality: 'common',
      weapon: { min: 1, max: 2, speed: 2 },
      sellValue: 1,
    } as unknown as ItemDef;
    const recipe = {
      id: 'qa_recipe_p14b_paired',
      professionId: recipeOf(SWORD_RECIPE).professionId,
      resultItemId: QA_ITEM,
      resultCount: 2,
      reagents: [{ itemId: 'linen_scrap', count: 1 }],
      skillReq: 0,
      level: 1,
      itemLevelBudget: 1,
    } as unknown as ProfessionRecipeRecord;
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('linen_scrap', 1, pid);
    const result = resolveCraftForRecipe(sim.ctx, pid, recipe, true);
    expect(result.ok).toBe(true);
    expect(result.commission).toBe(true);
    const slots = slotsOf(sim, pid, QA_ITEM);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    let copies = 0;
    for (const slot of slots) {
      expect(slot.instance).toEqual({ bindOnTrade: true });
      copies += slot.count;
    }
    expect(copies).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. The bind-on-first-trade arc (the Phase 13 primitive, second consumer).
// ---------------------------------------------------------------------------
describe('bind on first trade, refuse on the second, re-bind after unbind', () => {
  it('the first trade stamps boundTo = the receiving pid; the arm survives alongside it', () => {
    const { sim, a, b } = makeTradeSim();
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true }, a);
    const errors = runTrade(sim, a, b, SWORD);
    expect(errors).toEqual([]);
    expect(slotsOf(sim, a, SWORD)).toHaveLength(0);
    const received = slotsOf(sim, b, SWORD);
    expect(received).toHaveLength(1);
    expect(received[0].instance?.boundTo).toBe(b);
    expect(received[0].instance?.bindOnTrade).toBe(true);
  });

  it('the second trade is refused with the ONE localized deny; the piece never moves', () => {
    const { sim, a, b } = makeTradeSim(43);
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: b }, b);
    const errors = runTrade(sim, b, a, SWORD);
    expect(errors).toContain(BOUND_DENY);
    expect(slotsOf(sim, a, SWORD)).toHaveLength(0);
    expect(slotsOf(sim, b, SWORD)).toHaveLength(1);
  });

  it('a NON-commission instance (a plain signed craft) trades onward freely, payload intact', () => {
    const { sim, a, b } = makeTradeSim(44);
    sim.ctx.addItemInstance(SWORD, { signer: 'Ayla' }, a);
    expect(runTrade(sim, a, b, SWORD)).toEqual([]);
    expect(runTrade(sim, b, a, SWORD)).toEqual([]);
    const back = slotsOf(sim, a, SWORD);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual({ signer: 'Ayla' });
  });

  it('unbind restores tradeability and the next trade RE-binds to the new recipient', () => {
    const { sim, a, b } = makeTradeSim(45);
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: b }, b);
    standAtStation(sim, b);
    setCopper(sim, b, 5000);
    const eb = sim.ctx.entities.get(a)!;
    // Keep the pair adjacent for the follow-up trade: move A to B's station.
    const stationed = sim.ctx.entities.get(b)!;
    eb.pos.x = stationed.pos.x + 2;
    eb.pos.z = stationed.pos.z;

    const result = unbindItemMod(sim.ctx, SWORD, b);
    expect(result.ok).toBe(true);
    expect(result.fee).toBe(2500); // common clamps to the uncommon rung
    expect(copperOf(sim, b)).toBe(2500);
    const freed = slotsOf(sim, b, SWORD);
    expect(freed).toHaveLength(1);
    expect(freed[0].instance?.boundTo).toBeUndefined();
    expect(freed[0].instance?.bindOnTrade).toBe(true);

    const errors = runTrade(sim, b, a, SWORD);
    expect(errors).toEqual([]);
    const rebound = slotsOf(sim, a, SWORD);
    expect(rebound).toHaveLength(1);
    expect(rebound[0].instance?.boundTo).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// 4. The unbind fee ladder (2500 / 10000 / 40000, clamp both ends, DEF quality).
// ---------------------------------------------------------------------------
describe('unbind fee ladder (the resolved tier-scaled ruling)', () => {
  const QUALITIES: Array<[string, number]> = [
    ['poor', 2500],
    ['common', 2500],
    ['uncommon', 2500],
    ['rare', 10000],
    ['epic', 40000],
    ['legendary', 40000], // clamp-to-last above epic
  ];
  it('maps DEF quality onto exactly 2500/10000/40000 copper with both clamps', () => {
    expect([...UNBIND_FEE_BY_QUALITY_TIER]).toEqual([2500, 10000, 40000]);
    for (const [quality, fee] of QUALITIES) {
      const def = {
        id: `qa_p14b_${quality}`,
        name: 'QA',
        kind: 'weapon',
        slot: 'mainhand',
        quality: quality === 'poor' ? 'poor' : quality,
        sellValue: 1,
      } as unknown as ItemDef;
      expect(unbindFeeFor(def), quality).toBe(fee);
    }
    const noQuality = { id: 'qa_p14b_nq', name: 'QA', kind: 'weapon' } as unknown as ItemDef;
    expect(unbindFeeFor(noQuality)).toBe(2500);
  });

  it('a legacy rolled.quality payload never moves the fee: DEF quality only', () => {
    // unbindFeeFor takes only the def, so this is structural: the resolver
    // never reads the payload for pricing. Pin the signature-level fact by
    // resolving a bound legacy-rolled copy and checking the def-priced fee.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      SWORD,
      { bindOnTrade: true, boundTo: pid, rolled: { quality: 'epic' } },
      pid,
    );
    standAtStation(sim, pid);
    setCopper(sim, pid, 50000);
    const r = sim.ctx.resolve(pid)!;
    const result = resolveUnbind(r.meta, r.e.pos, SWORD);
    expect(result.ok).toBe(true);
    expect(result.fee).toBe(2500); // the common-def sword, not the epic payload
  });
});

// ---------------------------------------------------------------------------
// 5. The unbind deny order (replay-safe, the resolveTrain doctrine).
// ---------------------------------------------------------------------------
describe('unbind service deny order and mutation', () => {
  it('an unknown item id is the silent deny arm: no reason, fee 0', () => {
    const sim = makeSim();
    const result = unbindItemMod(sim.ctx, 'qa_p14b_no_such_item', sim.playerId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.fee).toBe(0);
  });

  it('a bound copy of an INELIGIBLE kind (a Phase 13 reagent) denies unbind_not_eligible', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance('resonant_steel', { bindOnTrade: true, boundTo: pid }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 50000);
    const result = unbindItemMod(sim.ctx, 'resonant_steel', pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_not_eligible');
    expect(copperOf(sim, pid)).toBe(50000);
    expect(slotsOf(sim, pid, 'resonant_steel')[0].instance?.boundTo).toBe(pid);
  });

  it('an armed-but-UNBOUND copy has nothing to clear: unbind_not_bound, resolved before any charge', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 50000);
    const result = unbindItemMod(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_not_bound');
    expect(copperOf(sim, pid)).toBe(50000);
  });

  it('away from every static station: unbind_out_of_range, no charge, no clear', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    standInWilds(sim, pid);
    setCopper(sim, pid, 50000);
    const result = unbindItemMod(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_out_of_range');
    expect(copperOf(sim, pid)).toBe(50000);
    expect(slotsOf(sim, pid, SWORD)[0].instance?.boundTo).toBe(pid);
  });

  it('fee unaffordable: unbind_cannot_afford carries the fee, charges nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 2499);
    const result = unbindItemMod(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_cannot_afford');
    expect(result.fee).toBe(2500);
    expect(copperOf(sim, pid)).toBe(2499);
  });

  it('deny ORDER: not_bound beats cannot_afford when both conditions fail at once', () => {
    // An armed-but-unbound copy AND an empty purse at a station: the resolver
    // must report not_bound (the no-op arm resolves before the charge arm, so
    // a broke player is told the true reason and a replay can never reach the
    // affordability check first).
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 0);
    const result = unbindItemMod(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_not_bound');
  });

  it('success charges the fee EXACTLY once; the duplicate command re-resolves not_bound (replay safety)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 10000);
    const first = unbindItemMod(sim.ctx, SWORD, pid);
    expect(first.ok).toBe(true);
    expect(first.fee).toBe(2500);
    expect(copperOf(sim, pid)).toBe(7500);
    const second = unbindItemMod(sim.ctx, SWORD, pid);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('unbind_not_bound');
    expect(copperOf(sim, pid)).toBe(7500);
  });

  it('unbind clears boundTo ONLY: signer, masterwork, enchant, charges, and the arm all survive', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const payload: ItemInstancePayload = {
      signer: 'Aldric',
      rolled: { masterwork: true, stats: { str: 3 } },
      enchant: 'enchant_weapon_runed_edge',
      charges: { fireball: 2 },
      bindOnTrade: true,
      boundTo: pid,
    };
    sim.ctx.addItemInstance(SWORD, payload, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 10000);
    expect(unbindItemMod(sim.ctx, SWORD, pid).ok).toBe(true);
    const after = slotsOf(sim, pid, SWORD);
    expect(after).toHaveLength(1);
    expect(after[0].instance).toEqual({
      signer: 'Aldric',
      rolled: { masterwork: true, stats: { str: 3 } },
      enchant: 'enchant_weapon_runed_edge',
      charges: { fireball: 2 },
      bindOnTrade: true,
    });
  });

  it('a bound stack of byte-equal copies SPLITS: one copy freed for one fee, the rest stay bound', () => {
    const QA_ITEM = 'qa_p14b_stacked_focus';
    (ITEMS as Record<string, ItemDef>)[QA_ITEM] = {
      id: QA_ITEM,
      name: 'QA Stacked Focus',
      kind: 'held_offhand',
      slot: 'offhand',
      quality: 'rare',
      stackSize: 5,
      sellValue: 1,
    } as unknown as ItemDef;
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(QA_ITEM, { bindOnTrade: true, boundTo: pid }, pid);
    sim.ctx.addItemInstance(QA_ITEM, { bindOnTrade: true, boundTo: pid }, pid);
    expect(slotsOf(sim, pid, QA_ITEM)).toHaveLength(1); // merged, count 2
    standAtStation(sim, pid);
    setCopper(sim, pid, 50000);
    const result = unbindItemMod(sim.ctx, QA_ITEM, pid);
    expect(result.ok).toBe(true);
    expect(result.fee).toBe(10000); // rare rung
    expect(copperOf(sim, pid)).toBe(40000);
    const slots = slotsOf(sim, pid, QA_ITEM);
    const bound = slots.filter((s) => s.instance?.boundTo !== undefined);
    const free = slots.filter((s) => s.instance?.boundTo === undefined);
    expect(bound).toHaveLength(1);
    expect(bound[0].count).toBe(1);
    expect(free).toHaveLength(1);
    expect(free[0].count).toBe(1);
    expect(free[0].instance?.bindOnTrade).toBe(true);
  });

  it('the whole unbind path draws NO rng', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 10000);
    const { result, draws } = countDraws(sim, () => unbindItemMod(sim.ctx, SWORD, pid));
    expect(result.ok).toBe(true);
    expect(draws).toBe(0);
  });

  it('the Sim facade emits the personal text-free unbindResult event on success and deny', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    standAtStation(sim, pid);
    setCopper(sim, pid, 10000);
    sim.drainEvents();
    sim.unbindItem(SWORD, pid);
    sim.unbindItem(SWORD, pid); // replay: not_bound
    const events = unbindEvents(sim.drainEvents());
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ ok: true, itemId: SWORD, fee: 2500, pid });
    expect(events[0].reason).toBeUndefined();
    expect(events[1]).toMatchObject({
      ok: false,
      itemId: SWORD,
      reason: 'unbind_not_bound',
      pid,
    });
    // Text-free: no error toast rides beside the event (single-surface rule).
    expect(errorTexts(sim.drainEvents())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Persistence: the armed and bound payloads ride the save round trip.
// ---------------------------------------------------------------------------
describe('persistence: commission payloads survive save/load', () => {
  it('bindOnTrade + boundTo on equipment round-trip through serializeCharacter/addPlayer', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid, signer: 'Aldric' }, pid);
    sim.ctx.addItemInstance(VESTMENTS, { bindOnTrade: true }, pid);
    const state = sim.serializeCharacter(pid)!;
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const sword = sim2.meta(pid2)!.inventory.find((s) => s.itemId === SWORD);
    expect(sword?.instance).toEqual({ bindOnTrade: true, boundTo: pid, signer: 'Aldric' });
    const vest = sim2.meta(pid2)!.inventory.find((s) => s.itemId === VESTMENTS);
    expect(vest?.instance).toEqual({ bindOnTrade: true });
  });
});

// ---------------------------------------------------------------------------
// 7. Face-to-face by construction: mail and market refuse commissioned copies.
// ---------------------------------------------------------------------------
describe('mail/market: a commissioned equipment instance never mails or lists', () => {
  it('mailSend refuses armed AND bound sword copies (fungible-only escrow), payload intact', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const sender = sim.addPlayer('warrior', 'Sender');
    sim.addPlayer('mage', 'Rex');
    const box = sim.entities.get(sim.postOffice.mailboxIds[0])!;
    const se = sim.ctx.entities.get(sender)!;
    se.pos.x = box.pos.x;
    se.pos.z = box.pos.z;
    setCopper(sim, sender, 10000);
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true }, sender);
    sim.ctx.addItemInstance(VESTMENTS, { bindOnTrade: true, boundTo: sender }, sender);
    sim.drainEvents();
    sim.mailSend('Rex', 'gift', 'take it', 0, [{ itemId: SWORD, count: 1 }], sender);
    sim.mailSend('Rex', 'gift', 'take it', 0, [{ itemId: VESTMENTS, count: 1 }], sender);
    const codes = sim
      .drainEvents()
      .filter((e) => e.type === 'mailResult')
      .map((e) => (e as unknown as { code: string }).code);
    expect(codes).toEqual(['notEnoughItems', 'notEnoughItems']);
    expect(slotsOf(sim, sender, SWORD)[0].instance?.bindOnTrade).toBe(true);
    expect(slotsOf(sim, sender, VESTMENTS)[0].instance?.boundTo).toBe(sender);
    expect(copperOf(sim, sender)).toBe(10000);
  });

  it('marketList refuses armed AND bound copies with no escrow', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Lister');
    let merchant: { pos: { x: number; z: number } } | null = null;
    for (const e of sim.entities.values()) {
      if (e.templateId === 'the_merchant') merchant = e;
    }
    const pe = sim.ctx.entities.get(pid)!;
    pe.pos.x = merchant!.pos.x;
    pe.pos.z = merchant!.pos.z;
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true }, pid);
    sim.ctx.addItemInstance(VESTMENTS, { bindOnTrade: true, boundTo: pid }, pid);
    sim.drainEvents();
    const before = sim.marketListings.length;
    sim.marketList(SWORD, 1, 100, pid);
    sim.marketList(VESTMENTS, 1, 100, pid);
    const errors = errorTexts(sim.drainEvents());
    expect(errors.filter((t) => t === 'You do not have that many to sell.')).toHaveLength(2);
    expect(sim.marketListings.length).toBe(before);
    expect(slotsOf(sim, pid, SWORD)).toHaveLength(1);
    expect(slotsOf(sim, pid, VESTMENTS)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Determinism: same seed + same commands = identical outcome.
// ---------------------------------------------------------------------------
describe('determinism: the commission arc replays byte-identically', () => {
  it('two same-seed sims running the same craft/unbind sequence agree on inventory and copper', () => {
    const run = () => {
      const sim = makeSim(1234);
      const pid = sim.playerId;
      grantReagents(sim, SWORD_RECIPE, pid);
      craftItemMod(sim.ctx, SWORD_RECIPE, true, pid);
      const slot = slotsOf(sim, pid, SWORD)[0];
      slot.instance!.boundTo = pid; // stand in for the trade stamp
      standAtStation(sim, pid);
      setCopper(sim, pid, 10000);
      sim.unbindItem(SWORD, pid);
      for (let i = 0; i < 40; i++) sim.tick();
      return JSON.stringify({
        inv: sim.ctx.resolve(pid)!.meta.inventory,
        copper: copperOf(sim, pid),
      });
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// 9. The wire: ClientWorld send shapes (byte-identical when not commissioned).
// ---------------------------------------------------------------------------
describe('ClientWorld command send shapes', () => {
  function clientWithCapture(): { client: ClientWorld; sent: Record<string, unknown>[] } {
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    (client as unknown as { spectating: null }).spectating = null;
    const sent: Record<string, unknown>[] = [];
    (client as unknown as { rawCmd(p: Record<string, unknown>): void }).rawCmd = (p) =>
      sent.push(p);
    return { client, sent };
  }

  it('craftItem without commission sends the exact pre-phase message (no commission key)', () => {
    const { client, sent } = clientWithCapture();
    client.craftItem(SWORD_RECIPE);
    client.craftItem(SWORD_RECIPE, false);
    expect(sent).toEqual([
      { cmd: 'craft_item', recipe: SWORD_RECIPE },
      { cmd: 'craft_item', recipe: SWORD_RECIPE },
    ]);
  });

  it('craftItem with commission sends the boolean flag; unbindItem sends unbind_item', () => {
    const { client, sent } = clientWithCapture();
    client.craftItem(SWORD_RECIPE, true);
    client.unbindItem(SWORD);
    expect(sent).toEqual([
      { cmd: 'craft_item', recipe: SWORD_RECIPE, commission: true },
      { cmd: 'unbind_item', item: SWORD },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 10. Live GameServer arc: the whole story over the real wire, both hosts.
// ---------------------------------------------------------------------------
describe('live GameServer: commission craft, bound trade refusal, unbind over the wire', () => {
  type WireMsg = { t: string; list?: SimEvent[]; self?: Record<string, unknown> };

  function fakeWs(): { sent: WireMsg[]; ws: unknown } {
    const sent: WireMsg[] = [];
    return {
      sent,
      ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
    };
  }

  function joinServer(
    server: GameServer,
    fc: ReturnType<typeof fakeWs>,
    id: number,
    name: string,
  ): ClientSession {
    const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    return session;
  }

  function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
    const entity = server.sim.entities.get(pid)!;
    entity.pos.x = pos.x;
    entity.pos.z = pos.z;
    entity.prevPos = { ...entity.pos };
  }

  function routeTick(server: GameServer): void {
    (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
  }

  function broadcast(server: GameServer): void {
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
  }

  function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
    server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
  }

  function eventsFor(sent: WireMsg[], type: string, fromIdx = 0): SimEvent[] {
    return sent
      .slice(fromIdx)
      .filter((m) => m.t === 'events')
      .flatMap((m) => m.list ?? [])
      .filter((ev) => (ev as { type: string }).type === type);
  }

  function serverSlots(server: GameServer, pid: number, itemId: string): InvSlot[] {
    return server.sim.players.get(pid)!.inventory.filter((s: InvSlot) => s.itemId === itemId);
  }

  it('runs the full arc: craft(commission) -> trade stamps -> re-trade denied -> unbind -> re-trade re-binds', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const sa = joinServer(server, fa, 801, 'Crafter');
    const sb = joinServer(server, fb, 802, 'Client');
    placeAt(server, sa.pid, { x: 0, z: 150 });
    placeAt(server, sb.pid, { x: 2, z: 150 });

    // 1. Craft with the commission flag over the wire (a field recipe).
    for (const reagent of recipeOf(SWORD_RECIPE).reagents) {
      server.sim.addItem(reagent.itemId, reagent.count, sa.pid);
    }
    cmd(server, sa, { cmd: 'craft_item', recipe: SWORD_RECIPE, commission: true });
    routeTick(server);
    const crafted = serverSlots(server, sa.pid, SWORD);
    expect(crafted).toHaveLength(1);
    expect(crafted[0].instance).toEqual({ bindOnTrade: true });

    // 2. First trade over the wire: the arrival stamps boundTo = recipient.
    cmd(server, sa, { cmd: 'trade_req', id: sb.pid });
    cmd(server, sb, { cmd: 'trade_accept' });
    routeTick(server);
    cmd(server, sa, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }], copper: 0 });
    cmd(server, sa, { cmd: 'trade_confirm' });
    cmd(server, sb, { cmd: 'trade_confirm' });
    routeTick(server);
    expect(serverSlots(server, sa.pid, SWORD)).toHaveLength(0);
    const held = serverSlots(server, sb.pid, SWORD);
    expect(held).toHaveLength(1);
    expect(held[0].instance?.boundTo).toBe(sb.pid);

    // 3. Trading it onward is refused with the localized deny on B's wire.
    const denyFrom = fb.sent.length;
    cmd(server, sb, { cmd: 'trade_req', id: sa.pid });
    cmd(server, sa, { cmd: 'trade_accept' });
    routeTick(server);
    cmd(server, sb, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }], copper: 0 });
    routeTick(server);
    const denies = eventsFor(fb.sent, 'error', denyFrom).map((ev) => (ev as { text: string }).text);
    expect(denies).toContain(BOUND_DENY);
    cmd(server, sb, { cmd: 'trade_cancel' });
    routeTick(server);
    expect(serverSlots(server, sb.pid, SWORD)).toHaveLength(1);

    // 4. Flush the heavy self mirror BEFORE the unbind, so the step-5 pin is
    // decisive: the step-2 trade's loot event left selfHeavyDirty set, and a
    // broadcast both clears it and establishes a lastSent inv that still
    // shows boundTo. The immediate second broadcast is the negative control:
    // it must NOT re-send inv (dirty flushed, stagger not due), proving the
    // only thing that can re-diff inv in step 5 is the unbindResult event's
    // HEAVY_SELF_EVENTS membership.
    server.sim.players.get(sb.pid)!.copper = 10000;
    placeAt(server, sb.pid, STATIONS[0].pos);
    broadcast(server);
    const lastInvFrom = (fromIdx: number) => {
      for (let i = fb.sent.length - 1; i >= fromIdx; i--) {
        const m = fb.sent[i];
        if (m.t === 'snap' && m.self && 'inv' in m.self) return m.self.inv as InvSlot[];
      }
      return null;
    };
    const flushed = lastInvFrom(0);
    expect(flushed).not.toBeNull();
    expect(flushed!.find((s) => s.itemId === SWORD)?.instance?.boundTo).toBe(sb.pid);
    const controlFrom = fb.sent.length;
    broadcast(server);
    expect(lastInvFrom(controlFrom), 'negative control: no dirty, no inv re-send').toBeNull();

    // Unbind over the wire at the station master's station.
    const unbindFrom = fb.sent.length;
    cmd(server, sb, { cmd: 'unbind_item', item: SWORD });
    routeTick(server);
    const results = eventsFor(fb.sent, 'unbindResult', unbindFrom) as unknown as Array<{
      ok: boolean;
      fee: number;
      pid: number;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].fee).toBe(2500);
    expect(server.sim.players.get(sb.pid)!.copper).toBe(7500);
    const freed = serverSlots(server, sb.pid, SWORD);
    expect(freed[0].instance?.boundTo).toBeUndefined();
    expect(freed[0].instance?.bindOnTrade).toBe(true);

    // 5. The in-place clear re-diffs the heavy self inv mirror on the NEXT
    // snapshot BECAUSE unbindResult is a HEAVY_SELF_EVENTS member: with the
    // dirty flag flushed and the stagger idle (the negative control above),
    // removing 'unbindResult' from the set leaves this snapshot inv-less and
    // this pin red. The wire copy of the slot loses boundTo without any loot
    // event.
    const afterUnbindFrom = fb.sent.length;
    broadcast(server);
    const lastInv = lastInvFrom(afterUnbindFrom);
    expect(lastInv, 'unbindResult re-diffed the heavy inv mirror').not.toBeNull();
    const wireSlot = lastInv!.find((s) => s.itemId === SWORD);
    expect(wireSlot?.instance?.bindOnTrade).toBe(true);
    expect(wireSlot?.instance?.boundTo).toBeUndefined();

    // 6. The freed piece trades back and RE-binds to the crafter.
    placeAt(server, sb.pid, { x: 2, z: 150 });
    cmd(server, sb, { cmd: 'trade_req', id: sa.pid });
    cmd(server, sa, { cmd: 'trade_accept' });
    routeTick(server);
    cmd(server, sb, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }], copper: 0 });
    cmd(server, sb, { cmd: 'trade_confirm' });
    cmd(server, sa, { cmd: 'trade_confirm' });
    routeTick(server);
    const back = serverSlots(server, sa.pid, SWORD);
    expect(back).toHaveLength(1);
    expect(back[0].instance?.boundTo).toBe(sa.pid);
  });

  it('denies over the wire: an out-of-range unbind charges nothing and reports the reason', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 803, 'Roamer');
    placeAt(server, st.pid, { x: 99999, z: 99999 });
    server.sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: st.pid }, st.pid);
    server.sim.players.get(st.pid)!.copper = 10000;
    const from = fc.sent.length;
    cmd(server, st, { cmd: 'unbind_item', item: SWORD });
    routeTick(server);
    const results = eventsFor(fc.sent, 'unbindResult', from) as unknown as Array<{
      ok: boolean;
      reason?: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe('unbind_out_of_range');
    expect(server.sim.players.get(st.pid)!.copper).toBe(10000);
  });
});
