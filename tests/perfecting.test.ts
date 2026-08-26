// Paired suite for src/sim/professions/perfecting.ts (Masterwrought phase
// 12): the attempt deny ladder (order, zero draws, zero consumption), the R2
// first-attempt bind, fail-forward (R1), the rank walk to Perfected, the R5
// budget-delta exactness (formula-derived against the item_level composition,
// plus the concrete shipped-apex literals), the lock-aware material gates,
// save/load round-trips through serializeCharacter/addPlayer, the phase 01
// Masterwrought-cap interlock, and the crafting.ts head-start arm over a real
// Sim.
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  PRIMARY_STATS,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  slotStatMultForItem,
  TWOHAND_STAT_MULT,
} from '../src/sim/item_budget';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import { expectedStatBudget } from '../src/sim/item_level';
import {
  craftForApexItem,
  PERFECTED_SOURCE_LEVEL,
  PERFECTING_ATTEMPT_COST,
  PERFECTING_HEADSTART_RANK,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
  PERFECTING_SUCCESS_CHANCE,
  perfectedBonusStats,
  perfectingInfoFrom,
} from '../src/sim/professions/perfecting';
import { type StationType, stationsOfType } from '../src/sim/professions/stations';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { CoreStats, Entity, ItemDef, SimEvent } from '../src/sim/types';
import { runCraft } from './helpers/enchant_family_cast';
import { EMPTY_TEST_WORLD } from './sim_shared';

const APEX_NECK = 'wyrmfall_pendant'; // apex jewelry, no class gate (jewelcrafting)
const APEX_RING = 'warhewn_signet';
const APEX_RING2 = 'prismglass_loop';
const NON_APEX = 'eastbrook_arming_sword'; // a plain common weapon
const EMBER = 'makers_ember';
const ESSENCE = 'sundered_essence';
const SETTING = 'prismglass_setting';
const CAP_ERROR = 'You can only equip two Masterwrought items.';

function world(seed = 5): { sim: Sim; pid: number; meta: PlayerMeta; e: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  return {
    sim,
    pid,
    meta: sim.players.get(pid) as PlayerMeta,
    e: sim.entities.get(pid) as Entity,
  };
}

/** A skill-125 jewelcrafter holding several of every attempt material, so no
 *  arm below can deny for want of skill or materials instead of the gate
 *  under test. */
function perfecter(seed = 5, materials = 8): ReturnType<typeof world> {
  const w = world(seed);
  w.meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  for (const c of PERFECTING_ATTEMPT_COST) w.sim.addItem(c.itemId, materials, w.pid);
  return w;
}

function bagRefOf(meta: PlayerMeta, itemId: string): { bag: number } {
  const bag = meta.inventory.findIndex((s) => s.itemId === itemId);
  expect(bag, `${itemId} is really in the bags`).toBeGreaterThanOrEqual(0);
  return { bag };
}

function errorsOf(sim: Sim): string[] {
  return (sim.drainEvents() as SimEvent[])
    .filter((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error')
    .map((ev) => ev.text);
}

function noticesOf(sim: Sim): string[] {
  return (sim.drainEvents() as SimEvent[])
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
    .map((ev) => ev.text);
}

function materialCounts(sim: Sim, pid: number): number[] {
  return PERFECTING_ATTEMPT_COST.map((c) => sim.countItem(c.itemId, pid));
}

/** Force every rng draw to `value` and count the draws (the professions_
 *  masterwork forced-roll idiom); nothing here ticks the sim, so the only
 *  draws counted are the action's own. */
function forceRoll(sim: Sim, value: number): () => number {
  let draws = 0;
  (sim.rng as { next: () => number }).next = () => {
    draws += 1;
    return value;
  };
  return () => draws;
}

/** Draw count over one action through the untouched live stream. */
function drawsDuring(sim: Sim, run: () => void): number {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws += 1;
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return draws;
}

describe('the attempt cost table and rank constants (locked tuning)', () => {
  it('pins the qr-12-CADENCE counts and the cost bill', () => {
    // Load-bearing tuning literals, pinned here so every behavioral case may
    // consume them through the module without going vacuous.
    expect(PERFECTING_RANKS).toBe(4);
    expect(PERFECTING_SUCCESS_CHANCE).toBe(0.8);
    expect(PERFECTING_HEADSTART_RANK).toBe(1);
    expect(PERFECTING_SKILL_REQ).toBe(125);
    expect(PERFECTED_SOURCE_LEVEL).toBe(28);
    expect(PERFECTING_ATTEMPT_COST).toEqual([
      { itemId: 'makers_ember', count: 1 },
      { itemId: 'sundered_essence', count: 1 },
      { itemId: 'prismglass_setting', count: 1 },
    ]);
  });

  it('craftForApexItem derives the craft from the merged recipe tables', () => {
    expect(craftForApexItem(APEX_NECK)).toBe('jewelcrafting');
    expect(craftForApexItem('briarstep_jerkin')).toBe('leatherworking');
    expect(craftForApexItem(NON_APEX), 'a non-apex id is off-track').toBeNull();
  });
});

describe('the deny ladder: order, zero draws, zero consumption', () => {
  it('a dead player is refused by the shared dead gate, consuming nothing', () => {
    const { sim, pid, meta, e } = perfecter(11);
    sim.addItem(APEX_NECK, 1, pid);
    e.dead = true;
    const before = materialCounts(sim, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(errorsOf(sim)).toContain("You can't do that while dead.");
    expect(draws).toBe(0);
    expect(materialCounts(sim, pid)).toEqual(before);
  });

  it('an invalid ref denies with the noItem line, on every malformed shape', () => {
    const { sim, pid } = perfecter(12);
    sim.drainEvents();
    for (const ref of [{ bag: 999 }, { bag: -1 }, { bag: 1.5 }, { slot: 'neck' as const }]) {
      const draws = drawsDuring(sim, () => sim.perfectItem(ref, pid));
      expect(draws, JSON.stringify(ref)).toBe(0);
      expect(errorsOf(sim), JSON.stringify(ref)).toEqual(["You don't have that item."]);
    }
  });

  it('ownership is presence-only: a FOREIGN boundTo value in the own bags still accepts', () => {
    // The Maker's Bond doctrine (trade.ts isTradeLocked, commission.ts
    // unbind): boundTo values are entity ids, which are not session-stable,
    // so the attempt checks POSSESSION only and never compares the value. A
    // bound copy in the player's own bags is theirs by construction.
    const { sim, pid, meta } = perfecter(13);
    sim.addItemInstance(APEX_NECK, { boundTo: 424242, perfecting: 1 }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    const draws = forceRoll(sim, 0);
    sim.perfectItem(ref, pid);
    expect(draws(), 'the attempt resolved').toBe(1);
    // ONE drain for both assertions (draining for errors would eat the logs).
    const events = sim.drainEvents() as SimEvent[];
    expect(events.filter((ev) => ev.type === 'error')).toEqual([]);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.perfecting, 'the rank advanced').toBe(2);
    // The stamp arm fires only on an ABSENT boundTo: the existing foreign
    // value is left untouched, and no bind notice re-emits.
    expect(slot.instance?.boundTo).toBe(424242);
    expect(
      events
        .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
        .map((ev) => ev.text),
    ).toEqual(['Perfecting: Wyrmfall Pendant advances to rank 2 of 4.']);
    expect(materialCounts(sim, pid)).toEqual([7, 7, 7]);
  });

  it('not-apex answers BEFORE already-Perfected (a stamped non-apex copy)', () => {
    const { sim, pid, meta } = perfecter(14);
    sim.addItemInstance(NON_APEX, { perfected: true }, pid, 1);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, NON_APEX), pid));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['Only Masterwrought items can be perfected.']);
  });

  it('already-Perfected answers BEFORE the skill gate', () => {
    const { sim, pid, meta } = perfecter(15);
    meta.craftSkills.jewelcrafting = 0; // the skill gate is armed and must not answer
    sim.addItemInstance(APEX_NECK, { perfected: true, boundTo: pid }, pid, 1);
    const before = materialCounts(sim, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['That item is already Perfected.']);
    expect(materialCounts(sim, pid)).toEqual(before);
  });

  it('the skill gate binds at exactly 125 and answers BEFORE the material gates', () => {
    const { sim, pid, meta } = perfecter(16);
    meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ - 1;
    // Materials are ALSO short, so a ladder that answered materials first
    // would say so here.
    sim.removeItem(EMBER, 8, pid);
    sim.addItem(APEX_NECK, 1, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual([
      'Perfecting that requires 125 skill in the craft that made it.',
    ]);
  });

  it('a lock-only shortfall denies with the DEDICATED locked line', () => {
    const { sim, pid, meta } = perfecter(17);
    sim.addItem(APEX_NECK, 1, pid);
    // Every material held raw, but the whole ember stack is locked (issue
    // 3042): raw meets the need, unlocked does not.
    const emberSlot = meta.inventory.find((s) => s.itemId === EMBER);
    expect(emberSlot).toBeTruthy();
    if (emberSlot) emberSlot.instance = { locked: true };
    const before = materialCounts(sim, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['A material needed for perfecting is locked.']);
    expect(materialCounts(sim, pid)).toEqual(before);
    // The locked copy itself was never spent.
    expect(emberSlot?.instance?.locked).toBe(true);
  });

  it('a genuine shortfall denies with the missing-materials line', () => {
    const { sim, pid, meta } = perfecter(18);
    sim.addItem(APEX_NECK, 1, pid);
    sim.removeItem(SETTING, 8, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['You lack the materials to perfect that item.']);
  });

  it('the positive control: a resolved attempt draws EXACTLY once', () => {
    const { sim, pid, meta } = perfecter(19);
    sim.addItem(APEX_NECK, 1, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItem(bagRefOf(meta, APEX_NECK), pid));
    expect(draws, 'one draw per resolved attempt, the whole system').toBe(1);
    // ...and it really resolved: the bill was spent, whatever the outcome.
    expect(materialCounts(sim, pid)).toEqual([7, 7, 7]);
  });
});

describe('R2: the piece binds on the FIRST attempt, success and failure alike', () => {
  it('a failed first attempt binds, spends the bill, and advances nothing', () => {
    const { sim, pid, meta } = perfecter(21);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    // Freely tradable until the walk begins: no boundTo on the fresh copy.
    expect(meta.inventory[ref.bag].instance?.boundTo).toBeUndefined();
    sim.drainEvents();
    const draws = forceRoll(sim, 0.99); // at/over the chance: the fail arm
    sim.perfectItem(ref, pid);
    expect(draws()).toBe(1);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.boundTo, 'bound the moment Perfecting begins').toBe(meta.entityId);
    expect(slot.instance?.perfecting, 'a failure advances nothing').toBeUndefined();
    expect(slot.instance?.perfected).toBeUndefined();
    expect(materialCounts(sim, pid), 'fail-forward: the bill is spent').toEqual([7, 7, 7]);
    expect(noticesOf(sim)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'The perfecting attempt fails; the materials are spent.',
    ]);
  });

  it('a second attempt never re-emits the bind notice', () => {
    const { sim, pid, meta } = perfecter(22);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    forceRoll(sim, 0.99);
    sim.perfectItem(ref, pid);
    sim.drainEvents();
    sim.perfectItem(ref, pid);
    expect(noticesOf(sim)).toEqual(['The perfecting attempt fails; the materials are spent.']);
  });

  it('a successful first attempt binds and advances to rank 1', () => {
    const { sim, pid, meta } = perfecter(23);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    const draws = forceRoll(sim, 0); // under the chance: the success arm
    sim.perfectItem(ref, pid);
    expect(draws()).toBe(1);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.boundTo).toBe(meta.entityId);
    expect(slot.instance?.perfecting).toBe(1);
    expect(noticesOf(sim)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'Perfecting: Wyrmfall Pendant advances to rank 1 of 4.',
    ]);
  });

  it('fail-forward on a mid-track copy: rank and payload survive the failure', () => {
    const { sim, pid, meta } = perfecter(24);
    // A mid-track copy already carrying its bind (the fixture stamps the
    // player's own entity id, though ownership is presence-only either way).
    sim.addItemInstance(APEX_NECK, { perfecting: 2, boundTo: meta.entityId }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    forceRoll(sim, 0.99);
    sim.perfectItem(ref, pid);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.perfecting, 'the piece is never harmed').toBe(2);
    expect(slot.instance?.perfected).toBeUndefined();
    expect(materialCounts(sim, pid)).toEqual([7, 7, 7]);
    expect(errorsOf(sim), 'a resolved failure is not a denial').toEqual([]);
  });
});

describe('the rank walk to Perfected', () => {
  it('four forced successes walk 0 to Perfected, delete the track field, and bake the R5 delta', () => {
    const { sim, pid, meta } = perfecter(31);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    const draws = forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItem(ref, pid);
    expect(draws(), 'one draw per attempt').toBe(PERFECTING_RANKS);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.perfecting, 'the track field is deleted at the top').toBeUndefined();
    expect(slot.instance?.perfected).toBe(true);
    // The R5 bonus rides rolled.stats additively; rolled.masterwork is NEVER
    // set by this path. wyrmfall_pendant is int 8 / sta 6 with a +1 neck
    // delta, so largest-remainder puts the whole point on int.
    expect(slot.instance?.rolled?.stats).toEqual({ int: 1, sta: 0 });
    expect(slot.instance?.rolled?.masterwork).toBeUndefined();
    expect(materialCounts(sim, pid)).toEqual([4, 4, 4]);
    expect(noticesOf(sim)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'Perfecting: Wyrmfall Pendant advances to rank 1 of 4.',
      'Perfecting: Wyrmfall Pendant advances to rank 2 of 4.',
      'Perfecting: Wyrmfall Pendant advances to rank 3 of 4.',
      'Perfecting: Wyrmfall Pendant advances to rank 4 of 4.',
      'Wyrmfall Pendant is now Perfected!',
    ]);

    // The perfected copy refuses further attempts, spending nothing.
    sim.drainEvents();
    sim.perfectItem(ref, pid);
    expect(errorsOf(sim)).toEqual(['That item is already Perfected.']);
    expect(materialCounts(sim, pid)).toEqual([4, 4, 4]);
  });

  it('a head-started copy (rank 1) needs only the remaining successes', () => {
    const { sim, pid, meta } = perfecter(32);
    sim.addItemInstance(APEX_NECK, { perfecting: PERFECTING_HEADSTART_RANK }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS - PERFECTING_HEADSTART_RANK; i++) {
      sim.perfectItem(ref, pid);
    }
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.perfected).toBe(true);
    expect(slot.instance?.perfecting).toBeUndefined();
  });

  it('the worn attempt path recalculates the wearer stats at the Perfected stamp', () => {
    const { sim, pid, meta, e } = perfecter(33);
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    expect(meta.equipment.neck).toBe(APEX_NECK);
    const intBefore = e.stats.int;
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItem({ slot: 'neck' }, pid);
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    expect(meta.equipmentInstance.neck?.rolled?.stats).toEqual({ int: 1, sta: 0 });
    expect(e.stats.int, 'the +1 int delta is live on the wearer').toBe(intBefore + 1);
  });
});

describe('R5: the Perfected bonus is exactly the source-28 budget delta', () => {
  // The expectation composes from the SHIPPED primitives (item_level.ts's
  // expectedStatBudget for the recipe.level side, the same quality/slot/
  // two-hand composition at source 28 for the other), never from the function
  // under test.
  function budgetAtSource(def: ItemDef, sourceLevel: number): number {
    const ilvl = Math.max(1, sourceLevel + (QUALITY_ILVL_BONUS[def.quality ?? 'common'] ?? 0));
    const base = primaryStatBudget(ilvl, def.quality, def.slot, slotStatMultForItem(def));
    return def.kind === 'weapon' && def.hand === 'twohand'
      ? Math.round(base * TWOHAND_STAT_MULT)
      : base;
  }
  const statSum = (stats: Partial<CoreStats> | null): number => {
    if (!stats) return 0;
    return PRIMARY_STATS.reduce((a, k) => a + (stats[k] ?? 0), 0);
  };

  // The concrete shipped-apex literals (recipe.level 25, epic: the ilvl 34
  // budget minus the ilvl 31 budget per slot). A new masterwrought item fails
  // the roster equality until its row is added deliberately.
  const EXPECTED_DELTA_BY_ID: Record<string, number> = {
    duskforged_warblade: 2, // mainhand
    ridgebreaker: 2, // two-hand mainhand
    duskforged_bulwark: 2, // held offhand (shield)
    wyrmfall_pendant: 1, // neck
    warhewn_signet: 1, // ring
    prismglass_loop: 1, // ring
    gyrelens_array: 2, // held offhand
    voidbound_grimoire: 2, // held offhand
    spiritweld_girdle: 2, // waist
    forgefold_legguards: 1, // legs
    wardspeaker_sabatons: 1, // feet
    briarstep_jerkin: 2, // chest
    fenbloom_breeches: 1, // legs
    barksong_handguards: 2, // gloves
    sunspun_vestments: 2, // chest
    sunspun_leggings: 1, // legs
    sunspun_handwraps: 2, // gloves
  };

  it('every shipped apex item bakes the formula delta, pinned per slot', () => {
    const apexIds = Object.values(ITEMS)
      .filter((d) => d.masterwrought === true)
      .map((d) => d.id)
      .sort();
    expect(apexIds, 'the shipped apex roster (add the literal for a new one)').toEqual(
      Object.keys(EXPECTED_DELTA_BY_ID).sort(),
    );
    for (const id of apexIds) {
      const def = ITEMS[id];
      const craftId = craftForApexItem(id);
      expect(craftId, `${id} resolves its craft`).not.toBeNull();
      const recipe = recipeById(`recipe_${id}`);
      expect(recipe, `${id} has its apex recipe`).toBeTruthy();
      if (!recipe) continue;
      const bonus = perfectedBonusStats(def, recipe);
      // Formula equality against the item_level composition: the low side IS
      // the shipped expectedStatBudget (apex source = recipe.level), the high
      // side the same composition at PERFECTED_SOURCE_LEVEL.
      expect(recipe.level).toBe(25);
      const shipped = expectedStatBudget(def);
      expect(shipped, `${id}: the shipped budget resolves`).toBeDefined();
      expect(budgetAtSource(def, recipe.level), `${id}: low side is the shipped budget`).toBe(
        shipped,
      );
      const formulaDelta = budgetAtSource(def, PERFECTED_SOURCE_LEVEL) - (shipped ?? 0);
      expect(statSum(bonus), `${id}: the bake sums to the formula delta`).toBe(formulaDelta);
      expect(statSum(bonus), `${id}: the pinned literal`).toBe(EXPECTED_DELTA_BY_ID[id]);
      // The bonus keeps the def's own stat identity: no stat outside the
      // def's primary profile ever appears.
      for (const stat of PRIMARY_STATS) {
        if ((def.stats?.[stat] ?? 0) <= 0) {
          expect(bonus?.[stat] ?? 0, `${id}: ${stat} is off-profile`).toBe(0);
        }
      }
    }
  });

  it('helmet and shoulder (no shipped apex piece yet) carry the +2 delta by slot', () => {
    // Synthetic epic defs at the apex recipe level: the per-slot delta the
    // contract records for the slots the shipped set does not cover.
    for (const slot of ['helmet', 'shoulder'] as const) {
      const def = {
        id: `test_apex_${slot}`,
        name: `Test Apex ${slot}`,
        kind: 'armor',
        slot,
        quality: 'epic',
        stats: { str: 10, sta: 5 },
        sellValue: 1,
        masterwrought: true,
      } as ItemDef;
      const bonus = perfectedBonusStats(def, { level: 25 });
      expect(statSum(bonus), slot).toBe(2);
      expect(statSum(bonus), slot).toBe(budgetAtSource(def, 28) - budgetAtSource(def, 25));
    }
  });
});

describe('perfectingInfoFrom: the shared both-hosts view', () => {
  it('reports rank, craft, skill, bind, and LOCK-AWARE material counts', () => {
    const { sim, pid, meta } = perfecter(41);
    sim.addItemInstance(APEX_NECK, { perfecting: 2, boundTo: meta.entityId }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    const emberSlot = meta.inventory.find((s) => s.itemId === EMBER);
    if (emberSlot) emberSlot.instance = { locked: true };
    const view = perfectingInfoFrom({
      ref,
      inventory: meta.inventory,
      equipment: meta.equipment,
      equipmentInstances: meta.equipmentInstance,
      craftSkills: meta.craftSkills,
    });
    expect(view).toEqual({
      itemId: APEX_NECK,
      rank: 2,
      ranks: PERFECTING_RANKS,
      perfected: false,
      craftId: 'jewelcrafting',
      skillReq: PERFECTING_SKILL_REQ,
      skillMet: true,
      bound: true,
      materials: [
        { itemId: EMBER, required: 1, have: 0 }, // the locked stack is not spendable
        { itemId: ESSENCE, required: 1, have: 8 },
        { itemId: SETTING, required: 1, have: 8 },
      ],
    });
    expect(
      perfectingInfoFrom({
        ref: { bag: 999 },
        inventory: meta.inventory,
        equipment: meta.equipment,
        equipmentInstances: meta.equipmentInstance,
        craftSkills: meta.craftSkills,
      }),
      'an unresolvable ref is null',
    ).toBeNull();
  });

  it('the Sim facade delegate answers through the same builder (worn arm)', () => {
    const { sim, pid, meta } = perfecter(42);
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    const view = sim.perfectingInfo({ slot: 'neck' }, pid);
    expect(view?.itemId).toBe(APEX_NECK);
    expect(view?.rank).toBe(0);
    expect(view?.perfected).toBe(false);
    expect(view?.skillMet).toBe(true);
    expect(meta.craftSkills.jewelcrafting).toBe(PERFECTING_SKILL_REQ);
  });
});

describe('persistence: round-trips, pre-phase saves, and the load bound', () => {
  it('a mid-track bagged copy round-trips through serializeCharacter/addPlayer', () => {
    const { sim, pid, meta } = perfecter(51);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    forceRoll(sim, 0);
    sim.perfectItem(ref, pid);
    sim.perfectItem(ref, pid);
    expect(meta.inventory[ref.bag].instance?.perfecting).toBe(2);
    const state = sim.serializeCharacter(pid);
    expect(state).toBeTruthy();

    const fresh = new Sim({ seed: 51, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    const loaded = loadedMeta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(loaded?.instance?.perfecting).toBe(2);
    expect(loaded?.instance?.boundTo).toBeDefined();
  });

  it('a Perfected WORN copy round-trips with its stats recalculated on load', () => {
    const { sim, pid, meta } = perfecter(52);
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItem({ slot: 'neck' }, pid);
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    const liveInt = (sim.entities.get(pid) as Entity).stats.int;
    const state = sim.serializeCharacter(pid);

    const fresh = new Sim({ seed: 52, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    expect(loadedMeta.equipmentInstance.neck?.perfected).toBe(true);
    expect(loadedMeta.equipmentInstance.neck?.rolled?.stats).toEqual({ int: 1, sta: 0 });
    expect(
      (fresh.entities.get(loadedPid) as Entity).stats.int,
      'the load recalc carries the Perfected bonus',
    ).toBe(liveInt);
  });

  it('a pre-phase save (no perfecting fields) loads clean', () => {
    const { sim, pid } = perfecter(53);
    sim.addItem(APEX_NECK, 1, pid);
    const state = sim.serializeCharacter(pid);
    const fresh = new Sim({ seed: 53, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    const loaded = loadedMeta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(loaded).toBeTruthy();
    expect(loaded?.instance?.perfecting).toBeUndefined();
    expect(loaded?.instance?.perfected).toBeUndefined();
  });

  it('the load bound keeps only legal values (drop-only, per field)', () => {
    // Legal mid-track ranks survive byte-identical.
    for (const rank of [1, 2, PERFECTING_RANKS - 1]) {
      const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({ perfecting: rank });
      expect(payload, `rank ${rank} survives`).toEqual({ perfecting: rank });
      expect(dropped).toEqual([]);
    }
    // Everything else drops ALONE (the payload around it survives).
    for (const bad of [0, PERFECTING_RANKS, 99, -1, 1.5, '2', true, null]) {
      const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
        perfecting: bad,
        signer: 'Aria',
      });
      expect(payload, `perfecting ${JSON.stringify(bad)} drops`).toEqual({ signer: 'Aria' });
      expect(dropped).toEqual(['perfecting']);
    }
    const kept = sanitizeItemInstancePayloadOnLoad({ perfected: true });
    expect(kept.payload).toEqual({ perfected: true });
    expect(kept.dropped).toEqual([]);
    for (const bad of [false, 1, 'true', null]) {
      const { payload, dropped } = sanitizeItemInstancePayloadOnLoad({
        perfected: bad,
        signer: 'Aria',
      });
      expect(payload, `perfected ${JSON.stringify(bad)} drops`).toEqual({ signer: 'Aria' });
      expect(dropped).toEqual(['perfected']);
    }
  });

  it('a hand-edited out-of-range rank is dropped on the real load path', () => {
    const { sim, pid } = perfecter(54);
    sim.addItem(APEX_NECK, 1, pid);
    const state = sim.serializeCharacter(pid);
    expect(state).toBeTruthy();
    if (!state) return;
    const row = state.inventory.find((s) => s.itemId === APEX_NECK);
    expect(row).toBeTruthy();
    if (row) row.instance = { perfecting: 99 } as never;
    const fresh = new Sim({ seed: 54, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    const loaded = loadedMeta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(loaded, 'the item itself survives').toBeTruthy();
    expect(loaded?.instance, 'the junk-only payload drops whole').toBeUndefined();
  });
});

describe('the phase 01 cap interlock: a Perfected piece still counts', () => {
  it('two worn apex pieces, one Perfected, still trip the Masterwrought cap', () => {
    const { sim, pid, meta } = perfecter(61);
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.addItem(APEX_RING, 1, pid);
    sim.addItem(APEX_RING2, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    sim.equipItem(APEX_RING, pid);
    expect(meta.equipment.neck).toBe(APEX_NECK);
    expect(meta.equipment.ring1).toBe(APEX_RING);
    // Perfect the worn neck outright (forced successes): the cap counts
    // def-level masterwrought, so the Perfected piece must still count.
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItem({ slot: 'neck' }, pid);
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    sim.drainEvents();
    sim.equipItem(APEX_RING2, pid);
    expect(errorsOf(sim)).toContain(CAP_ERROR);
    expect(meta.equipment.ring2, 'the third apex piece stays refused').toBeUndefined();
  });
});

describe('the crafting.ts head start (R1) over a real Sim', () => {
  it('a forced proc on an apex recipe mints masterwork:true + perfecting 1, one draw', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.archetype.activeArchetype = 'jewelcrafting';
    const recipe = recipeById(`recipe_${APEX_NECK}`);
    expect(recipe).toBeTruthy();
    if (!recipe) return;
    if (recipe.stationType) {
      const station = stationsOfType(STATIONS, recipe.stationType as StationType)[0];
      const e = sim.entities.get(pid) as Entity;
      e.pos.x = station.pos.x;
      e.pos.z = station.pos.z;
      e.prevPos = { ...e.pos };
    }
    meta.knownRecipes?.add(recipe.id);
    for (const g of recipe.reagents) sim.addItem(g.itemId, g.count, pid);
    // Force the single output-side proc draw to hit; the counter pins the
    // one-draw contract on the apex path (the head start gates the EFFECT,
    // never the draw).
    const draws = forceRoll(sim, 0);
    runCraft(sim, recipe.id, false, pid);
    const result = meta.lastCraftResult;
    expect(result?.ok).toBe(true);
    expect(result?.masterwork, 'the proc effect applied').toBe(true);
    expect(draws(), 'exactly one draw on the apex craft').toBe(1);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.signer).toBeTruthy();
    expect(slot?.instance?.perfecting).toBe(PERFECTING_HEADSTART_RANK);
    expect(slot?.instance?.rolled, 'no quality bump is baked').toBeUndefined();
    expect(slot?.instance?.perfected).toBeUndefined();
  });
});
