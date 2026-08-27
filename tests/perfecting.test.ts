// Paired suite for src/sim/professions/perfecting.ts (Masterwrought phase
// 12): the attempt deny ladder (order, zero draws, zero consumption), the R2
// first-attempt bind, fail-forward (R1), the rank walk to Perfected, the R5
// budget-delta exactness (formula-derived against the item_level composition,
// plus the concrete shipped-apex literals), the lock-aware material gates,
// save/load round-trips through serializeCharacter/addPlayer, the phase 01
// Masterwrought-cap interlock, and the crafting.ts head-start arm over a real
// Sim.
import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { STATIONS } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS, QUESTS } from '../src/sim/data';
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

function bagRefOf(meta: PlayerMeta, itemId: string): { bag: number; itemId: string } {
  const bag = meta.inventory.findIndex((s) => s.itemId === itemId);
  expect(bag, `${itemId} is really in the bags`).toBeGreaterThanOrEqual(0);
  return { bag, itemId };
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

  it('every masterwrought def is stack-cap 1 (the in-place payload mutation premise)', () => {
    // The success path writes the slot's shared payload object in place
    // (perfecting.ts: "apex gear is stack-cap 1, so the named cell IS the
    // copy"). A stackable apex def would bind and advance EVERY unit in the
    // cell for one attempt's bill, so the premise is enforced here: a future
    // stackable masterwrought def fails loudly instead of minting free binds.
    const apex = Object.values(ITEMS).filter((d) => d.masterwrought === true);
    expect(apex.length, 'the roster is non-empty (the guard is not vacuous)').toBeGreaterThan(0);
    for (const def of apex) {
      expect(stackSizeOf(def), `${def.id} is stack-cap 1`).toBe(1);
    }
  });
});

describe('the deny ladder: order, zero draws, zero consumption', () => {
  it('a dead player is refused by the shared dead gate, consuming nothing', () => {
    const { sim, pid, meta, e } = perfecter(11);
    sim.addItem(APEX_NECK, 1, pid);
    e.dead = true;
    const before = materialCounts(sim, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(errorsOf(sim)).toContain("You can't do that while dead.");
    expect(draws).toBe(0);
    expect(materialCounts(sim, pid)).toEqual(before);
  });

  it('an invalid ref denies with the noItem line, on every malformed shape', () => {
    const { sim, pid } = perfecter(12);
    sim.drainEvents();
    // A STALE cell too: the index of a material stack named as the apex piece
    // (the shape a shift between click and command produces) resolves to
    // nothing through the index-plus-id pin, never to whatever sits there.
    const staleCell = sim.players.get(pid)!.inventory.findIndex((s) => s.itemId === EMBER);
    expect(staleCell).toBeGreaterThanOrEqual(0);
    for (const ref of [
      { bag: 999, itemId: APEX_NECK },
      { bag: -1, itemId: APEX_NECK },
      { bag: 1.5, itemId: APEX_NECK },
      { bag: staleCell, itemId: APEX_NECK },
      { slot: 'neck' as const },
    ]) {
      const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, ref));
      expect(draws, JSON.stringify(ref)).toBe(0);
      expect(errorsOf(sim), JSON.stringify(ref)).toEqual(["You don't have that item."]);
    }
    // Nothing was spent by the stale ref: the material stack it named is intact.
    expect(sim.players.get(pid)!.inventory[staleCell]?.itemId).toBe(EMBER);
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
    sim.perfectItemAs(pid, ref);
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
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, NON_APEX)));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['Only Masterwrought items can be perfected.']);
  });

  it('the skill gate answers BEFORE the perfected split (phase 13: one gate, both acts)', () => {
    // Until phase 13 the already-Perfected refusal answered ahead of skill;
    // the promotion replaced that arm and moved the ONE skill gate above the
    // split, so an unskilled owner of a Perfected copy hears the skill line,
    // never a promotion arm.
    const { sim, pid, meta } = perfecter(15);
    meta.craftSkills.jewelcrafting = 0; // the skill gate must answer, not the promotion ladder
    sim.addItemInstance(APEX_NECK, { perfected: true, boundTo: pid }, pid, 1);
    const before = materialCounts(sim, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual([
      'Perfecting that requires 125 skill in the craft that made it.',
    ]);
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
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(draws).toBe(0);
    const errs = errorsOf(sim);
    expect(errs).toEqual(['Perfecting that requires 125 skill in the craft that made it.']);
    // The number in the LIVE emit is chained to the constant: a retune of
    // PERFECTING_SKILL_REQ that leaves the sentence (and, through the EXACT
    // matcher, its 21 locale rows) saying the old number fails here.
    expect(errs[0]).toContain(String(PERFECTING_SKILL_REQ));
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
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
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
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(draws).toBe(0);
    expect(errorsOf(sim)).toEqual(['You lack the materials to perfect that item.']);
  });

  it('the positive control: a resolved attempt draws EXACTLY once', () => {
    const { sim, pid, meta } = perfecter(19);
    sim.addItem(APEX_NECK, 1, pid);
    sim.drainEvents();
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(draws, 'one draw per resolved attempt, the whole system').toBe(1);
    // ...and it really resolved: the bill was spent, whatever the outcome.
    expect(materialCounts(sim, pid)).toEqual([7, 7, 7]);
  });

  it('a resolved attempt bumps wireRev once; a denial leaves it untouched', () => {
    // The bump is the owner's heavy-mirror re-diff signal (the rift forge
    // ops' recipe); it is redundant with HEAVY_SELF_CMDS for this command
    // TODAY, so this pin is what keeps a future removal of either mechanism
    // a conscious choice rather than a silent loss of the last one.
    const { sim, pid, meta } = perfecter(26);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    const revBefore = meta.wireRev;
    sim.perfectItemAs(pid, { bag: 999, itemId: APEX_NECK });
    expect(meta.wireRev, 'a denial re-diffs nothing').toBe(revBefore);
    sim.perfectItemAs(pid, ref);
    // Exactly TWO: the quest-resync hook's own bump (quest_credit.ts) plus
    // the module's payload-mutation bump. Deleting either fails this.
    expect(meta.wireRev, 'a resolved attempt re-diffs the self mirrors').toBe(revBefore + 2);
  });

  it('the material consume re-syncs an active collect objective (the quest hook)', () => {
    // The bank suite's synthetic-collect idiom: no shipped quest counts an
    // attempt material, so pin the consume -> onInventoryChangedForQuests
    // wiring with a synthetic collect quest over the ember.
    const { sim, pid, meta } = perfecter(27);
    sim.addItem(APEX_NECK, 1, pid);
    QUESTS.__perfect_resync = {
      ...QUESTS.q_widows,
      id: '__perfect_resync',
      objectives: [{ type: 'collect', itemId: EMBER, count: 9, label: "Maker's Ember" }],
    };
    try {
      meta.questLog.set('__perfect_resync', {
        questId: '__perfect_resync',
        counts: [0],
        state: 'active',
      });
      sim.addItem(EMBER, 1, pid); // the add-side recompute credits 9 of 9
      expect(meta.questLog.get('__perfect_resync')?.counts).toEqual([9]);
      sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
      expect(
        meta.questLog.get('__perfect_resync')?.counts,
        'the spent ember un-credits through the consume hook',
      ).toEqual([8]);
    } finally {
      delete QUESTS.__perfect_resync;
    }
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
    sim.perfectItemAs(pid, ref);
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
    sim.perfectItemAs(pid, ref);
    sim.drainEvents();
    sim.perfectItemAs(pid, ref);
    expect(noticesOf(sim)).toEqual(['The perfecting attempt fails; the materials are spent.']);
  });

  it('a successful first attempt binds and advances to rank 1', () => {
    const { sim, pid, meta } = perfecter(23);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    const draws = forceRoll(sim, 0); // under the chance: the success arm
    sim.perfectItemAs(pid, ref);
    expect(draws()).toBe(1);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.boundTo).toBe(meta.entityId);
    expect(slot.instance?.perfecting).toBe(1);
    expect(noticesOf(sim)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'Perfecting: Wyrmfall Pendant advances to rank 1 of 4.',
    ]);
  });

  it('a roll of exactly PERFECTING_SUCCESS_CHANCE takes the fail arm (strict less-than)', () => {
    // The skill boundary is pinned on both sides above; this is the success
    // boundary's twin. roll < chance succeeds, so roll == chance fails: a
    // <= regression widens the real success rate and fails here.
    const { sim, pid, meta } = perfecter(25);
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    sim.drainEvents();
    const draws = forceRoll(sim, PERFECTING_SUCCESS_CHANCE);
    sim.perfectItemAs(pid, ref);
    expect(draws()).toBe(1);
    expect(meta.inventory[ref.bag].instance?.perfecting, 'no rank advanced').toBeUndefined();
    expect(noticesOf(sim)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'The perfecting attempt fails; the materials are spent.',
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
    sim.perfectItemAs(pid, ref);
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
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, ref);
    expect(draws(), 'one draw per attempt').toBe(PERFECTING_RANKS);
    const slot = meta.inventory[ref.bag];
    expect(slot.instance?.perfecting, 'the track field is deleted at the top').toBeUndefined();
    expect(slot.instance?.perfected).toBe(true);
    // The R5 bonus rides rolled.stats additively; rolled.masterwork is NEVER
    // set by this path. wyrmfall_pendant is int 8 / sta 6 with a +1 neck
    // delta, so largest-remainder puts the whole point on int.
    expect(slot.instance?.rolled?.stats).toEqual({ int: 1 });
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

    // A perfected copy routes further nameless attempts to the promotion
    // ladder (phase 13), which refuses for the missing name and spends
    // nothing; tests/orange_promotion.test.ts owns that ladder in full.
    sim.drainEvents();
    sim.perfectItemAs(pid, ref);
    expect(errorsOf(sim)).toEqual(['That work needs a name to become a legend.']);
    expect(materialCounts(sim, pid)).toEqual([4, 4, 4]);
  });

  it('a head-started copy (rank 1) needs only the remaining successes', () => {
    const { sim, pid, meta } = perfecter(32);
    sim.addItemInstance(APEX_NECK, { perfecting: PERFECTING_HEADSTART_RANK }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS - PERFECTING_HEADSTART_RANK; i++) {
      sim.perfectItemAs(pid, ref);
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
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, { slot: 'neck' });
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    expect(meta.equipmentInstance.neck?.rolled?.stats).toEqual({ int: 1 });
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
      promoted: false,
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
        ref: { bag: 999, itemId: APEX_NECK },
        inventory: meta.inventory,
        equipment: meta.equipment,
        equipmentInstances: meta.equipmentInstance,
        craftSkills: meta.craftSkills,
      }),
      'an unresolvable ref is null',
    ).toBeNull();
  });

  it('a Perfected copy reads perfected: true (the view arm a hardcoded false would break)', () => {
    // Every other view assertion in this file reads perfected over an
    // unfinished copy, so a literal `false` at the builder would have
    // survived the suite; this is the failing-direction twin.
    const { sim, pid, meta } = perfecter(43);
    sim.addItemInstance(APEX_NECK, { perfected: true, boundTo: meta.entityId }, pid, 1);
    const view = perfectingInfoFrom({
      ref: bagRefOf(meta, APEX_NECK),
      inventory: meta.inventory,
      equipment: meta.equipment,
      equipmentInstances: meta.equipmentInstance,
      craftSkills: meta.craftSkills,
    });
    expect(view?.perfected).toBe(true);
    expect(view?.rank, 'the deleted track field reads rank 0').toBe(0);
    expect(view?.bound).toBe(true);
  });

  it('a skill of PERFECTING_SKILL_REQ - 1 reads skillMet: false (the failing direction)', () => {
    const { sim, pid, meta } = perfecter(44);
    meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ - 1;
    sim.addItem(APEX_NECK, 1, pid);
    const view = perfectingInfoFrom({
      ref: bagRefOf(meta, APEX_NECK),
      inventory: meta.inventory,
      equipment: meta.equipment,
      equipmentInstances: meta.equipmentInstance,
      craftSkills: meta.craftSkills,
    });
    expect(view?.skillMet).toBe(false);
    expect(view?.skillReq).toBe(PERFECTING_SKILL_REQ);
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
    sim.perfectItemAs(pid, ref);
    sim.perfectItemAs(pid, ref);
    expect(meta.inventory[ref.bag].instance?.perfecting).toBe(2);
    const state = sim.serializeCharacter(pid);
    expect(state).toBeTruthy();

    const fresh = new Sim({ seed: 51, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    const loaded = loadedMeta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(loaded?.instance?.perfecting).toBe(2);
    // The bind value round-trips VERBATIM (drop-only load, presence-only
    // ownership): a load path that re-stamped it to the loading character's
    // id, or any other number, fails here.
    expect(loaded?.instance?.boundTo).toBe(meta.entityId);
  });

  it('a Perfected WORN copy round-trips with its stats recalculated on load', () => {
    const { sim, pid, meta } = perfecter(52);
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, { slot: 'neck' });
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    const liveInt = (sim.entities.get(pid) as Entity).stats.int;
    const state = sim.serializeCharacter(pid);

    const fresh = new Sim({ seed: 52, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    expect(loadedMeta.equipmentInstance.neck?.perfected).toBe(true);
    expect(loadedMeta.equipmentInstance.neck?.rolled?.stats).toEqual({ int: 1 });
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
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, { slot: 'neck' });
    expect(meta.equipmentInstance.neck?.perfected).toBe(true);
    sim.drainEvents();
    sim.equipItem(APEX_RING2, pid);
    expect(errorsOf(sim)).toContain(CAP_ERROR);
    expect(meta.equipment.ring2, 'the third apex piece stays refused').toBeUndefined();
  });
});

describe('the crafting.ts head start (R1) over a real Sim', () => {
  /** An apex crafter at the recipe's station with the bill in hand; the
   *  archetype decides the ceiling term of the effect gate (a major reads
   *  Infinity, no archetype reads the rare ceiling). */
  const apexCrafter = (seed: number, activeArchetype: string | null) => {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.archetype.activeArchetype = activeArchetype;
    const recipe = recipeById(`recipe_${APEX_NECK}`);
    if (!recipe) throw new Error('the apex neck recipe exists');
    if (recipe.stationType) {
      const station = stationsOfType(STATIONS, recipe.stationType as StationType)[0];
      const e = sim.entities.get(pid) as Entity;
      e.pos.x = station.pos.x;
      e.pos.z = station.pos.z;
      e.prevPos = { ...e.pos };
    }
    meta.knownRecipes?.add(recipe.id);
    for (const g of recipe.reagents) sim.addItem(g.itemId, g.count, pid);
    return { sim, pid, meta, recipe };
  };

  it('a forced proc on an apex recipe mints masterwork:true + perfecting 1, one draw', () => {
    const { sim, pid, meta, recipe } = apexCrafter(7, 'jewelcrafting');
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
    expect(slot?.instance?.bindOnTrade, 'an uncommissioned craft arms no bond').toBeUndefined();
  });

  it('a forced MISS mints the plain signed copy: no rank, no masterwork flag, still one draw', () => {
    const { sim, pid, meta, recipe } = apexCrafter(8, 'jewelcrafting');
    // 0.999 sits above MASTERWORK_CHANCE_CAP (0.15), so no composition of the
    // chance terms can turn it into a hit.
    const draws = forceRoll(sim, 0.999);
    runCraft(sim, recipe.id, false, pid);
    const result = meta.lastCraftResult;
    expect(result?.ok).toBe(true);
    expect(result?.masterwork).toBeUndefined();
    expect(draws(), 'the miss still spends the one draw').toBe(1);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.signer).toBeTruthy();
    expect(slot?.instance?.perfecting).toBeUndefined();
    expect(slot?.instance?.rolled).toBeUndefined();
  });

  it('the ceiling term holds: a forced hit on a craft under the rare ceiling grants no head start', () => {
    // No archetype: archetypeCeilingFor answers the RARE ceiling (tier 2), and
    // the apex def's bumped tier is legendary (4), so the SAME gate that keeps
    // a dormant or hobby craft from bumping keeps it from a head start. The
    // draw still happens (the gate is on the effect); the copy lands plain.
    const { sim, pid, meta, recipe } = apexCrafter(9, null);
    const draws = forceRoll(sim, 0);
    runCraft(sim, recipe.id, false, pid);
    expect(meta.lastCraftResult?.ok).toBe(true);
    expect(meta.lastCraftResult?.masterwork).toBeUndefined();
    expect(draws()).toBe(1);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBeUndefined();
  });

  it("a commissioned head-start copy carries the Maker's Bond arm beside its rank", () => {
    const { sim, pid, meta, recipe } = apexCrafter(10, 'jewelcrafting');
    forceRoll(sim, 0);
    runCraft(sim, recipe.id, true, pid);
    expect(meta.lastCraftResult?.masterwork).toBe(true);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBe(PERFECTING_HEADSTART_RANK);
    expect(slot?.instance?.bindOnTrade).toBe(true);
    expect(slot?.instance?.boundTo, 'armed, not yet bound').toBeUndefined();
  });

  /** Force a SEQUENCE of draws (call N answers values[N], the last value
   *  repeating): the Jack arm draws twice per craft, so a single forced value
   *  cannot stage a normal-variance proc hit. */
  function forceRollSequence(sim: Sim, values: number[]): () => number {
    let draws = 0;
    (sim.rng as { next: () => number }).next = () => {
      const v = values[Math.min(draws, values.length - 1)];
      draws += 1;
      return v;
    };
    return () => draws;
  }

  it('a Jack of All Trades draws TWO on an apex craft; the ceiling denies the head start even on a hit', () => {
    // The Jack arm is the one arm where draws-per-successful-craft is 2 (the
    // variance roll, then the proc roll), so it is where a draw-order
    // regression would hide. Stage variance 'normal' (0.5) then a proc HIT
    // (0): the head start is STILL denied, by the same ceiling term that
    // denies the no-archetype crafter above (a Jack's breadth ceiling is the
    // rare tier, under the apex def's legendary bumped tier).
    const { sim, pid, meta, recipe } = apexCrafter(11, null);
    meta.archetype.isJackOfAllTrades = true;
    const draws = forceRollSequence(sim, [0.5, 0]);
    runCraft(sim, recipe.id, false, pid);
    expect(meta.lastCraftResult?.ok).toBe(true);
    expect(draws(), 'exactly two draws for a Jack, in order').toBe(2);
    expect(meta.lastCraftResult?.masterwork).toBeUndefined();
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBeUndefined();
  });

  it("a Jack 'worse' variance also draws two and mints the plain signed copy", () => {
    const { sim, pid, meta, recipe } = apexCrafter(12, null);
    meta.archetype.isJackOfAllTrades = true;
    const draws = forceRollSequence(sim, [0, 0]); // variance 'worse', proc hit
    runCraft(sim, recipe.id, false, pid);
    expect(meta.lastCraftResult?.ok).toBe(true);
    expect(draws()).toBe(2);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.signer).toBeTruthy();
    expect(slot?.instance?.perfecting).toBeUndefined();
    expect(slot?.instance?.rolled).toBeUndefined();
  });
});

describe('the R5 merge is ADDITIVE, the two-hand line is priced, and failure leaves the copy byte-identical', () => {
  it('merges the delta ON TOP of a rolled record the copy already carries', () => {
    // A copy enchanted before it is Perfected carries rolled.stats already;
    // the stamp must ADD the R5 delta to it, never overwrite (an overwrite
    // survived every earlier pin, the coverage audit's P5 probe). The pre-
    // existing record is an explicit marker enchant so the copy still reads
    // as enchanted afterwards (apex gear post-dates the marker; no apex copy
    // can be a bare-stats legacy enchant).
    const { sim, pid, meta } = perfecter(31);
    sim.addItemInstance(
      APEX_NECK,
      {
        signer: 'Crafter',
        enchant: 'enchant_chest_stamina',
        rolled: { stats: { sta: 4, int: 2 } },
      },
      pid,
      1,
    );
    const ref = bagRefOf(meta, APEX_NECK);
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, ref);
    const copy = meta.inventory[ref.bag];
    expect(copy.instance?.perfected).toBe(true);
    // The neck's R5 record is { int: 1 } (the shipped literal pinned above):
    // int climbs 2 -> 3, sta keeps its enchant value, nothing else appears.
    expect(copy.instance?.rolled?.stats).toEqual({ sta: 4, int: 3 });
    expect(copy.instance?.enchant).toBe('enchant_chest_stamina');
    expect(copy.instance?.rolled?.masterwork).toBeUndefined();
  });

  it('prices a two-hander through the two-hand mult, at a level where rounding makes it count', () => {
    // At source 24 the mainhand line is 21 -> 24 (+3) but the two-hand line
    // is round(21 x 1.3) = 27 -> round(24 x 1.3) = 31 (+4), so the mult is
    // decisive here (the shipped ridgebreaker at level 25 answers 2 either
    // way, which is why the roster pin alone could not see a dropped mult).
    const twoHand = {
      id: 'qa_p12_twohand_probe',
      name: 'Probe Greatsword',
      kind: 'weapon',
      hand: 'twohand',
      slot: 'mainhand',
      quality: 'epic',
      masterwrought: true,
      stats: { str: 10 },
      weapon: { min: 1, max: 2, speed: 3 },
    } as unknown as ItemDef;
    expect(perfectedBonusStats(twoHand, { level: 24 })).toEqual({ str: 4 });
    const oneHand = { ...twoHand, hand: 'mainhand' } as unknown as ItemDef;
    expect(perfectedBonusStats(oneHand, { level: 24 })).toEqual({ str: 3 });
  });

  it('a failed attempt leaves a mid-track copy BYTE-IDENTICAL and a worn one recalculated to the same stats', () => {
    const { sim, pid, meta, e } = perfecter(32);
    sim.setPlayerLevel(20);
    sim.addItemInstance(APEX_RING, { signer: 'Crafter', boundTo: pid, perfecting: 2 }, pid, 1);
    sim.equipItem(APEX_RING, pid);
    expect(meta.equipment.ring1).toBe(APEX_RING);
    const beforeInstance = JSON.stringify(meta.equipmentInstance.ring1);
    const beforeStats = { maxHp: e.maxHp, attackPower: e.attackPower };
    forceRoll(sim, 0.99);
    sim.perfectItemAs(pid, { slot: 'ring1' });
    expect(noticesOf(sim)).toContain('The perfecting attempt fails; the materials are spent.');
    expect(JSON.stringify(meta.equipmentInstance.ring1), 'the payload is untouched').toBe(
      beforeInstance,
    );
    expect({ maxHp: e.maxHp, attackPower: e.attackPower }).toEqual(beforeStats);
    expect(materialCounts(sim, pid)).toEqual([7, 7, 7]);
  });
});

describe('perfectedBonusStats null arms and the mixed shortfall', () => {
  it('answers null for a slotless def, a profile with no primary stat, and a non-positive delta', () => {
    const neck = ITEMS[APEX_NECK];
    const recipe = recipeById(`recipe_${APEX_NECK}`);
    if (!recipe) throw new Error('the apex neck recipe exists');
    expect(perfectedBonusStats(neck, recipe), 'the live pair really bakes').not.toBeNull();
    expect(perfectedBonusStats({ ...neck, slot: undefined } as ItemDef, recipe)).toBeNull();
    expect(perfectedBonusStats({ ...neck, stats: { armor: 40 } } as ItemDef, recipe)).toBeNull();
    // A recipe already at or past the Perfected source level has nothing to
    // climb to: the delta is zero or negative and no record is minted.
    expect(perfectedBonusStats(neck, { level: PERFECTED_SOURCE_LEVEL })).toBeNull();
    expect(perfectedBonusStats(neck, { level: PERFECTED_SOURCE_LEVEL + 3 })).toBeNull();
  });

  it('a MIXED shortfall (one material lock-only, another genuinely short) reads as missing, not locked', () => {
    const { sim, pid } = perfecter(30);
    const meta = sim.players.get(pid) as PlayerMeta;
    sim.addItem(APEX_NECK, 1, pid);
    const ember = meta.inventory.find((s) => s.itemId === EMBER);
    if (!ember) throw new Error('the fixture holds embers');
    ember.instance = { locked: true };
    sim.removeItem(ESSENCE, sim.countItem(ESSENCE, pid), pid);
    sim.drainEvents();
    const before = materialCounts(sim, pid);
    const draws = drawsDuring(sim, () => sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK)));
    expect(draws).toBe(0);
    // The locked line is reserved for the case where UNLOCKING alone would
    // satisfy the bill; with the essence genuinely gone it would mislead.
    expect(errorsOf(sim)).toEqual(['You lack the materials to perfect that item.']);
    expect(materialCounts(sim, pid)).toEqual(before);
  });
});
