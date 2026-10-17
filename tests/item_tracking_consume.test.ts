// The END of a tracked copy (docs/design/item-tracking.md "Lineage"): every
// action that destroys an epic or legendary copy writes its final `consume`
// ledger row (the server-only itemTracked event), and a craft that turns a
// tracked reagent into a tracked output mints the output as a `derive` row
// naming the spent copy, which in turn names the output. Each case drives the
// real Sim command (sunder, salvage, discard, vendor sale + buyback expiry,
// pattern learn, craft), never a hand-emitted event.
import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import { RIFT_ESSENCE_ITEM_ID } from '../src/sim/content/rift/items';
import { ITEMS, STATIONS } from '../src/sim/data';
import { isItemGuid } from '../src/sim/item_provenance';
import { isTrackedItem } from '../src/sim/item_tracking';
import { craftItem, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { SUNDERED_ESSENCE_ITEM_ID } from '../src/sim/professions/masterwrought_materials';
import { SALVAGE_MATERIAL_BY_QUALITY } from '../src/sim/professions/salvage_materials';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { completeEnchantFamilyCast } from './helpers/enchant_family_cast';

type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

const RAID_EPIC = 'crownforged_dreadhelm'; // raid-won epic armor: sunderable, salvageable
const BOOTS = 'oiled_boots'; // plain armor, the buyback filler
const OLD_ROD = 'tidewrought_fishing_rod'; // epic tool, the clockreel reagent
const NEW_ROD = 'clockreel_fishing_rod'; // epic tool, the clockreel output
const ROD_RECIPE = 'recipe_clockreel_fishing_rod';
const ROD_PATTERN = 'pattern_clockreel_fishing_rod';

function makeSim(seed = 42): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => 1_700_000_000_000,
  });
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  const p = sim.entities.get(pid);
  if (!meta || !p) throw new Error('player missing');
  return { p, meta, pid };
}

function trackedEvents(sim: Sim): ItemTrackedEvent[] {
  return sim.drainEvents().filter((e): e is ItemTrackedEvent => e.type === 'itemTracked');
}

function consumeRows(events: ItemTrackedEvent[]): ItemTrackedEvent[] {
  return events.filter((e) => e.kind === 'consume');
}

function slotsOf(meta: PlayerMeta, itemId: string): InvSlot[] {
  return meta.inventory.filter((s) => s.itemId === itemId);
}

/** The one tracked copy of `itemId` in the bags, with its guid. */
function guidOf(meta: PlayerMeta, itemId: string): string {
  const slots = slotsOf(meta, itemId);
  expect(slots).toHaveLength(1);
  const guid = slots[0].instance?.guid;
  if (!isItemGuid(guid)) throw new Error(`${itemId} carries no guid`);
  return guid;
}

function indexOf(meta: PlayerMeta, itemId: string): number {
  return meta.inventory.findIndex((s) => s.itemId === itemId);
}

describe('fixtures are tracked', () => {
  it('every copy this suite destroys is an epic one-per-slot def', () => {
    for (const id of [RAID_EPIC, OLD_ROD, NEW_ROD, ROD_PATTERN]) {
      expect(isTrackedItem(ITEMS[id]), id).toBe(true);
    }
    expect(isTrackedItem(ITEMS[BOOTS])).toBe(false);
  });
});

describe('sundering', () => {
  it('writes one consume row naming Sundered Essence', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.drainEvents();
    sim.extractEssence(RAID_EPIC, pid, indexOf(meta, RAID_EPIC));
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBeGreaterThan(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: RAID_EPIC,
      quality: 'epic',
      source: 'sunder',
      detail: SUNDERED_ESSENCE_ITEM_ID,
      pid,
    });
  });

  it('a refused sunder (copy moved mid-cast) writes nothing', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 3, pid);
    sim.addItem(RAID_EPIC, 1, pid);
    sim.extractEssence(RAID_EPIC, pid, 1);
    sim.removeItem('linen_scrap', 3, pid); // splice: index 1 no longer holds the pinned copy
    sim.drainEvents();
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(1);
    expect(consumeRows(trackedEvents(sim))).toHaveLength(0);
  });
});

describe('salvage', () => {
  it('a named-slot salvage writes one consume row naming the epic material', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.drainEvents();
    sim.salvageItem(RAID_EPIC, pid, indexOf(meta, RAID_EPIC));
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: RAID_EPIC,
      source: 'salvage',
      detail: SALVAGE_MATERIAL_BY_QUALITY.epic,
    });
  });

  it('the id-only salvage (the legacy prefer-plain walk) writes it too', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.drainEvents();
    sim.salvageItem(RAID_EPIC, pid);
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows.map((r) => [r.guid, r.source])).toEqual([[guid, 'salvage']]);
  });

  it('a Rift band salvaged into Rift Essence names the essence', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    sim.setPlayerLevel(20);
    meta.inventory = [];
    const gear = createRiftGearInstance('rift-consume', 'S', 'warrior', pid);
    sim.addItemInstance(gear.itemId, gear.instance, pid);
    const guid = guidOf(meta, gear.itemId);
    sim.drainEvents();
    sim.salvageItem(gear.itemId, pid, indexOf(meta, gear.itemId));
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID, pid)).toBeGreaterThan(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: gear.itemId,
      source: 'salvage',
      detail: RIFT_ESSENCE_ITEM_ID,
    });
  });
});

describe('discard', () => {
  it('destroying a named copy writes its consume row', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.drainEvents();
    sim.discardItem(RAID_EPIC, 1, pid, indexOf(meta, RAID_EPIC));
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, itemId: RAID_EPIC, source: 'discard' });
    expect(rows[0].detail).toBeUndefined();
  });

  it('a bulk id-only discard writes one row per destroyed copy', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 2, pid);
    const guids = slotsOf(meta, RAID_EPIC).map((s) => s.instance?.guid);
    expect(new Set(guids).size).toBe(2);
    sim.drainEvents();
    sim.discardItem(RAID_EPIC, 2, pid);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows.map((r) => r.guid).sort()).toEqual([...guids].sort());
    expect(rows.every((r) => r.source === 'discard')).toBe(true);
  });
});

describe('vendor sale: the copy ends when it falls off the buyback list', () => {
  function vendorEntity(sim: Sim): Entity {
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.vendorItems.length > 0) return e;
    }
    throw new Error('no vendor npc');
  }

  function vendorSetup(): { sim: Sim; pid: number; meta: PlayerMeta } {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Seller');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player');
    const vendor = vendorEntity(sim);
    p.pos = { ...vendor.pos };
    p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 100_000;
    meta.inventory = [];
    sim.drainEvents();
    return { sim, pid, meta };
  }

  it('the sale itself writes nothing, and buying it back keeps the same guid', () => {
    const { sim, pid, meta } = vendorSetup();
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.drainEvents();
    sim.sellItem(RAID_EPIC, 1, pid);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    expect(meta.vendorBuyback[0]?.instance?.guid).toBe(guid);
    expect(consumeRows(trackedEvents(sim))).toHaveLength(0);
    sim.buyBackItem(RAID_EPIC, pid);
    expect(guidOf(meta, RAID_EPIC)).toBe(guid);
    expect(consumeRows(trackedEvents(sim))).toHaveLength(0);
  });

  it('the eviction past the buyback limit writes the consume row', () => {
    const { sim, pid, meta } = vendorSetup();
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    sim.sellItem(RAID_EPIC, 1, pid);
    // Distinct signed fillers never merge into one row, so each pushes the
    // epic one row further down the list.
    const limit = 12;
    for (let i = 0; i < limit - 1; i++) {
      sim.addItemInstance(BOOTS, { signer: `Filler${i}` }, pid);
      sim.sellItem(BOOTS, 1, pid);
    }
    expect(meta.vendorBuyback).toHaveLength(limit);
    expect(meta.vendorBuyback.at(-1)?.instance?.guid).toBe(guid);
    expect(consumeRows(trackedEvents(sim))).toHaveLength(0);
    sim.addItemInstance(BOOTS, { signer: 'Last' }, pid);
    sim.sellItem(BOOTS, 1, pid);
    expect(meta.vendorBuyback).toHaveLength(limit);
    expect(meta.vendorBuyback.some((row) => row.itemId === RAID_EPIC)).toBe(false);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: RAID_EPIC,
      source: 'vendor',
      detail: 'buybackExpired',
    });
  });
});

describe('learning a pattern', () => {
  function learner(): { sim: Sim; pid: number; meta: PlayerMeta } {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    meta.craftSkills.engineering = 125;
    meta.knownRecipes.delete(ROD_RECIPE);
    return { sim, pid, meta };
  }

  it('a named-slot learn writes the consume row naming the recipe', () => {
    const { sim, pid, meta } = learner();
    sim.addItem(ROD_PATTERN, 1, pid);
    const guid = guidOf(meta, ROD_PATTERN);
    sim.drainEvents();
    sim.useItem(ROD_PATTERN, pid, indexOf(meta, ROD_PATTERN));
    expect(meta.knownRecipes.has(ROD_RECIPE)).toBe(true);
    expect(sim.countItem(ROD_PATTERN, pid)).toBe(0);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: ROD_PATTERN,
      source: 'pattern',
      detail: ROD_RECIPE,
    });
  });

  it('the id-only learn writes it too', () => {
    const { sim, pid, meta } = learner();
    sim.addItem(ROD_PATTERN, 1, pid);
    const guid = guidOf(meta, ROD_PATTERN);
    sim.drainEvents();
    sim.useItem(ROD_PATTERN, pid);
    expect(meta.knownRecipes.has(ROD_RECIPE)).toBe(true);
    const rows = consumeRows(trackedEvents(sim));
    expect(rows.map((r) => [r.guid, r.source, r.detail])).toEqual([[guid, 'pattern', ROD_RECIPE]]);
  });

  it('a refused learn (already known) spends nothing and writes nothing', () => {
    const { sim, pid, meta } = learner();
    meta.knownRecipes.add(ROD_RECIPE);
    sim.addItem(ROD_PATTERN, 1, pid);
    sim.drainEvents();
    sim.useItem(ROD_PATTERN, pid, indexOf(meta, ROD_PATTERN));
    expect(sim.countItem(ROD_PATTERN, pid)).toBe(1);
    expect(consumeRows(trackedEvents(sim))).toHaveLength(0);
  });
});

describe('crafting: a tracked reagent and the tracked copy made from it', () => {
  function placeAtStation(sim: Sim, pid: number, recipeId: string): void {
    const stationType = recipeById(recipeId)?.stationType;
    if (!stationType) throw new Error(`${recipeId} is not station-bound`);
    const station = stationsOfType(STATIONS, stationType)[0];
    const entity = sim.entities.get(pid);
    if (!entity) throw new Error('missing entity');
    entity.pos.x = station.pos.x;
    entity.pos.z = station.pos.z;
    entity.prevPos = { ...entity.pos };
  }

  function rodCrafter(): { sim: Sim; pid: number; meta: PlayerMeta; p: Entity } {
    const sim = makeSim();
    const { meta, pid, p } = playerOf(sim);
    meta.inventory = [];
    meta.craftSkills.engineering = 125;
    meta.knownRecipes.add(ROD_RECIPE);
    const recipe = recipeById(ROD_RECIPE);
    if (!recipe) throw new Error('missing rod recipe');
    for (const r of recipe.reagents) sim.addItem(r.itemId, r.count, pid);
    placeAtStation(sim, pid, ROD_RECIPE);
    return { sim, pid, meta, p };
  }

  it('the instanced epic rod still crafts: the cast admits, completes, and swaps the rods', () => {
    const { sim, pid, meta, p } = rodCrafter();
    expect(slotsOf(meta, OLD_ROD)[0].instance?.guid).toBeDefined();
    expect(craftItem(sim.ctx, ROD_RECIPE, false, pid).casting).toBe(true);
    p.castingAbility = null;
    p.castRemaining = 0;
    sim.ctx.completeCraftCast(p, meta);
    expect(meta.lastCraftResult?.ok).toBe(true);
    expect(sim.countItem(OLD_ROD, pid)).toBe(0);
    expect(sim.countItem(NEW_ROD, pid)).toBe(1);
  });

  it('mints the output as a derive of the spent rod, and the spent rod consumes naming it', () => {
    const { sim, pid, meta, p } = rodCrafter();
    const parent = guidOf(meta, OLD_ROD);
    sim.drainEvents();
    craftItem(sim.ctx, ROD_RECIPE, false, pid);
    p.castingAbility = null;
    p.castRemaining = 0;
    sim.ctx.completeCraftCast(p, meta);
    const child = guidOf(meta, NEW_ROD);
    expect(child).not.toBe(parent);
    expect(slotsOf(meta, NEW_ROD)[0].instance?.provenance?.derivedFrom).toBe(parent);
    const events = trackedEvents(sim);
    const derive = events.filter((e) => e.kind === 'derive');
    expect(derive).toHaveLength(1);
    expect(derive[0]).toMatchObject({
      guid: child,
      itemId: NEW_ROD,
      relatedGuid: parent,
      source: `craft:${ROD_RECIPE}`,
    });
    const consume = consumeRows(events);
    expect(consume).toHaveLength(1);
    expect(consume[0]).toMatchObject({
      guid: parent,
      itemId: OLD_ROD,
      source: `craft:${ROD_RECIPE}`,
      detail: NEW_ROD,
      relatedGuid: child,
    });
    // No plain mint row for the output: the derive IS its first row.
    expect(events.some((e) => e.kind === 'mint')).toBe(false);
  });

  it('an untracked output leaves only the consume row, with no related guid', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(OLD_ROD, 1, pid);
    const parent = guidOf(meta, OLD_ROD);
    const recipe: ProfessionRecipeRecord = {
      id: 'recipe_test_rod_scrap',
      professionId: 'engineering',
      resultItemId: 'linen_scrap',
      resultCount: 1,
      reagents: [{ itemId: OLD_ROD, count: 1 }],
      skillReq: 0,
      itemLevelBudget: 1,
      level: 1,
      acquisition: ['trainer'],
    } as ProfessionRecipeRecord;
    meta.knownRecipes.add(recipe.id);
    sim.drainEvents();
    const result = resolveCraftForRecipe(sim.ctx, pid, recipe);
    expect(result.ok).toBe(true);
    expect(sim.countItem(OLD_ROD, pid)).toBe(0);
    const events = trackedEvents(sim);
    expect(events.filter((e) => e.kind === 'derive')).toHaveLength(0);
    const consume = consumeRows(events);
    expect(consume).toHaveLength(1);
    expect(consume[0]).toMatchObject({
      guid: parent,
      source: 'craft:recipe_test_rod_scrap',
      detail: 'linen_scrap',
    });
    expect(consume[0].relatedGuid).toBeUndefined();
  });

  it('the lineage rows draw no rng: a tracked-reagent craft and a plain-reagent craft agree', () => {
    // Same seed, same craft; world b's rod is a plain pre-tracking copy, so
    // it spends no tracked copy and writes no consume row. The shared stream
    // after the craft (the masterwork draw included) must match.
    const a = rodCrafter();
    const b = rodCrafter();
    const plain = slotsOf(b.meta, OLD_ROD)[0];
    plain.instance = undefined;
    for (const w of [a, b]) {
      w.sim.drainEvents();
      craftItem(w.sim.ctx, ROD_RECIPE, false, w.pid);
      w.p.castingAbility = null;
      w.p.castRemaining = 0;
      w.sim.ctx.completeCraftCast(w.p, w.meta);
      expect(w.meta.lastCraftResult?.ok).toBe(true);
    }
    expect(consumeRows(trackedEvents(a.sim))).toHaveLength(1);
    const plainRows = trackedEvents(b.sim);
    expect(consumeRows(plainRows)).toHaveLength(0);
    expect(plainRows.map((e) => e.kind)).toEqual(['mint']);
    expect(a.sim.ctx.rng.next()).toBe(b.sim.ctx.rng.next());
  });
});

describe('the consume helpers draw no rng', () => {
  it('a sunder with tracking rows leaves the shared stream where an untracked one does', () => {
    function sunderedRng(tracked: boolean): number {
      const sim = makeSim();
      const { meta, pid } = playerOf(sim);
      meta.inventory = [];
      sim.addItem(RAID_EPIC, 1, pid);
      if (!tracked) {
        const slot = slotsOf(meta, RAID_EPIC)[0];
        slot.instance = undefined;
      }
      sim.extractEssence(RAID_EPIC, pid, indexOf(meta, RAID_EPIC));
      completeEnchantFamilyCast(sim);
      const rows = consumeRows(trackedEvents(sim));
      expect(rows).toHaveLength(tracked ? 1 : 0);
      return sim.ctx.rng.next();
    }
    expect(sunderedRng(true)).toBe(sunderedRng(false));
  });
});
