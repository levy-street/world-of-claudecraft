// Vendor stocking against the locked ruling (docs/design/professions.md): no
// NPC ever STOCKS a gathered or monster material. The five node yields that
// used to ride the station masters' counters (thorium_ore, ashwood_log,
// elderwood_log, goldleaf_herb, sunpetal_herb) are delisted; arcanite_bar is
// refined rather than gathered (no node yields it) and stays.
//
// The ruling is about the vendorItems ROW, not the price field: every delisted
// material keeps its buyValue, which is the basis reagentUnitValue reads in
// tests/recipe_economy.test.ts. That split is pinned below in both directions.
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { ZONE1_NPCS } from '../src/sim/content/zone1';
import { ZONE2_NPCS } from '../src/sim/content/zone2';
import { ZONE3_NPCS } from '../src/sim/content/zone3';
import { ITEMS, NPCS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';

/** The five node yields delisted from every counter, spelled out as literals. */
const DELISTED = ['ashwood_log', 'elderwood_log', 'goldleaf_herb', 'sunpetal_herb', 'thorium_ore'];

/** The one premium reagent a counter may still carry: refined, never gathered. */
const REFINED_PREMIUM_REAGENT = 'arcanite_bar';

/**
 * Monster materials and specimens (the mob-drop half of the ruling) plus every
 * id a cast can land. DERIVED from live content, never a hand-kept literal: a
 * literal list here silently stops covering whatever content adds next, which
 * is exactly how `wolf_fang` and `glimmerfin_koi` sat unguarded.
 */
function liveMonsterMaterials(): string[] {
  return [
    ...new Set([
      ...Object.values(HARVEST_COMPONENT_ITEMS),
      ...Object.values(HARVEST_COMPONENT_SPECIMENS),
    ]),
  ].sort();
}

function liveFishingCatches(): string[] {
  const ids = new Set<string>();
  for (const byZone of FISHING_TABLES_BY_BAND) {
    for (const table of Object.values(byZone)) {
      // A null itemId is the empty-hook row, not an item.
      for (const entry of table) if (entry.itemId !== null) ids.add(entry.itemId);
    }
  }
  return [...ids].sort();
}

/**
 * Every id ANY counter anywhere stocks (copper NPCs, the heroic
 * quartermaster's Marks counter, the delve shops), mapped to its sellers.
 * The union is the point: NPCS.heroic_quartermaster carries `vendorItems:
 * undefined` and keeps its real stock in HEROIC_VENDOR_STOCK, and the delve
 * counters keep theirs in DELVE_SHOPS, so an NPCS-only read was blind to
 * both (the exact hole the phase-7 tool guard closed). Every fine grade and
 * every material carries a live buyValue, so ONE stock row on ANY of the
 * three tables sells it; the ruling is about the row, whatever the currency.
 */
function stockedAnywhere(): Map<string, string[]> {
  const stocked = new Map<string, string[]>();
  const add = (itemId: string, seller: string) => {
    const sellers = stocked.get(itemId);
    if (sellers) sellers.push(seller);
    else stocked.set(itemId, [seller]);
  };
  for (const [npcId, npc] of Object.entries(NPCS)) {
    for (const itemId of npc.vendorItems ?? []) add(itemId, `npc:${npcId}`);
  }
  for (const offer of HEROIC_VENDOR_STOCK) add(offer.itemId, 'heroic_quartermaster');
  for (const [delveId, entries] of Object.entries(DELVE_SHOPS)) {
    for (const entry of entries) add(entry.itemId, `delve:${delveId}`);
  }
  return stocked;
}

/** Per-table teeth for every sweep below: each of the three tables is
 *  non-empty AND the union really folded it (a broken iteration, a renamed
 *  field, or an emptied table all fail here rather than reading as a pass). */
function assertAllThreeTablesFolded(stocked: Map<string, string[]>): void {
  const sellers = [...stocked.values()].flat();
  expect(sellers.filter((s) => s.startsWith('npc:')).length).toBeGreaterThan(20);
  expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
  expect(Object.values(DELVE_SHOPS).flat().length).toBeGreaterThan(0);
  expect(stocked.get(HEROIC_VENDOR_STOCK[0].itemId)).toContain('heroic_quartermaster');
  const [firstDelveId, firstEntries] = Object.entries(DELVE_SHOPS)[0];
  expect(stocked.get(firstEntries[0].itemId)).toContain(`delve:${firstDelveId}`);
}

/** The live node yields, derived from the content table so the list cannot rot. */
function liveNodeYields(): string[] {
  const yields = new Set<string>();
  for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
    for (const row of Object.values(byZone)) yields.add(row.itemId);
  }
  return [...yields].sort();
}

function stockOf(npcs: Record<string, { vendorItems?: readonly string[] }>, id: string): string[] {
  const npc = npcs[id];
  if (!npc?.vendorItems) throw new Error(`${id} has no vendor stock`);
  return [...npc.vendorItems];
}

describe('the no-NPC-stocks-a-gathered-material ruling', () => {
  it('no counter anywhere stocks any live node yield', () => {
    const stocked = stockedAnywhere();
    const yields = liveNodeYields();
    // Non-vacuity: the scan must have a real corpus on both sides, or a broken
    // table read would pass this by finding nothing to check.
    expect(yields.length).toBe(9);
    assertAllThreeTablesFolded(stocked);
    for (const itemId of yields) {
      expect(stocked.get(itemId) ?? [], `${itemId} is stocked by a counter`).toEqual([]);
    }
  });

  it('the scan is live: arcanite_bar, refined and never gathered, IS still stocked', () => {
    // The counterexample that makes the sweep above decisive. Without it a
    // stockedAnywhere() that silently returned an empty map would read as a pass.
    const stocked = stockedAnywhere();
    expect(stocked.get(REFINED_PREMIUM_REAGENT) ?? []).not.toEqual([]);
    expect(liveNodeYields()).not.toContain(REFINED_PREMIUM_REAGENT);
  });

  it('no counter stocks a monster material, a specimen, or anything a cast lands', () => {
    const stocked = stockedAnywhere();
    const monster = liveMonsterMaterials();
    const catches = liveFishingCatches();
    assertAllThreeTablesFolded(stocked);
    // Non-vacuity, and a live-corpus floor rather than an exact count: these are
    // derived from content that is expected to GROW, and a pin that has to be
    // edited on every addition is a pin that gets edited without thought.
    expect(monster.length).toBeGreaterThanOrEqual(10);
    expect(catches.length).toBeGreaterThanOrEqual(9);
    // The two families the derivation must actually reach, named so a table
    // rename that empties one of them cannot pass as "nothing to check".
    expect(monster).toContain('wolf_fang');
    expect(monster).toContain('pristine_hide');
    expect(catches).toContain('glimmerfin_koi');
    for (const itemId of [...monster, ...catches]) {
      // An id with no ItemDef would make its own row vacuously pass.
      expect(ITEMS[itemId], `${itemId} has no ItemDef`).toBeDefined();
      expect(stocked.get(itemId) ?? [], `${itemId} is stocked by a counter`).toEqual([]);
    }
  });

  it('every delisted material KEEPS its buyValue (the economy basis, never the stock row)', () => {
    for (const itemId of DELISTED) {
      const def = ITEMS[itemId];
      expect(def, itemId).toBeDefined();
      expect(typeof def.buyValue, `${itemId} buyValue type`).toBe('number');
      expect(def.buyValue as number, `${itemId} buyValue`).toBeGreaterThan(0);
      // The 4x trade-goods markup the economy model rests on.
      expect(def.buyValue, `${itemId} buyValue is 4x sellValue`).toBe(def.sellValue * 4);
    }
  });
});

describe('master vendor stocking after the delist', () => {
  it('tinker_gizzel keeps its tier-1 tools and the refined reagent, and nothing gathered', () => {
    // Re-minted when Eastbrook stopped over-stocking: the toolworks master used
    // to carry logging tiers 1 to 3 and herbalism tiers 2 and 3, which made the
    // starting town the one place selling the top of two ladders. Eastbrook is
    // all tier-1 ground, so those rungs moved to the hubs whose own nodes use
    // them. What this arm has always been for is unchanged and still holds:
    // the counter carries arcanite_bar, the one premium reagent that is
    // refined rather than gathered, and no node yield at all.
    const stock = stockOf(ZONE1_NPCS, 'tinker_gizzel');
    expect(stock).toEqual(['handaxe', 'simple_fishing_pole', 'arcanite_bar']);
  });

  it('the forge, loom, and tannery masters carry no premium reagent at all', () => {
    for (const [npcs, id] of [
      [ZONE1_NPCS, 'forgemistress_darva'],
      [ZONE1_NPCS, 'weaver_ottilie'],
      [ZONE2_NPCS, 'tanner_hesk'],
    ] as const) {
      const stock = stockOf(npcs, id);
      for (const reagent of [...DELISTED, REFINED_PREMIUM_REAGENT]) {
        expect(stock, `${id} must not stock ${reagent}`).not.toContain(reagent);
      }
      // Their vendor-only staple stays: the delist took reagents off the
      // counter, it did not empty it.
      expect(stock.length, id).toBeGreaterThan(0);
    }
    expect(stockOf(ZONE1_NPCS, 'forgemistress_darva')).toContain('smithing_flux');
    expect(stockOf(ZONE1_NPCS, 'weaver_ottilie')).toContain('spool_of_thread');
    expect(stockOf(ZONE2_NPCS, 'tanner_hesk')).toContain('tanning_agent');
  });

  it('the kitchens and apothecary masters carry no premium reagents', () => {
    for (const [npcs, id] of [
      [ZONE1_NPCS, 'cook_marlow'],
      [ZONE3_NPCS, 'alchemist_verane'],
    ] as const) {
      const stock = stockOf(npcs, id);
      for (const reagent of [...DELISTED, REFINED_PREMIUM_REAGENT]) {
        expect(stock, `${id} must not stock ${reagent}`).not.toContain(reagent);
      }
    }
  });

  it('quartermaster_bree keeps arcanite_bar alone of the six', () => {
    const stock = stockOf(ZONE3_NPCS, 'quartermaster_bree');
    expect(stock).toContain(REFINED_PREMIUM_REAGENT);
    for (const reagent of DELISTED) {
      expect(stock, `bree must not stock ${reagent}`).not.toContain(reagent);
    }
  });

  it('every stocked id resolves to a real item', () => {
    for (const id of [
      'tinker_gizzel',
      'forgemistress_darva',
      'weaver_ottilie',
      'cook_marlow',
    ] as const) {
      for (const itemId of stockOf(ZONE1_NPCS, id)) {
        expect(ITEMS[itemId], `${id} stocks unknown item ${itemId}`).toBeDefined();
      }
    }
    for (const itemId of stockOf(ZONE2_NPCS, 'tanner_hesk')) {
      expect(ITEMS[itemId], `tanner_hesk stocks unknown item ${itemId}`).toBeDefined();
    }
    for (const itemId of stockOf(ZONE3_NPCS, 'alchemist_verane')) {
      expect(ITEMS[itemId], `alchemist_verane stocks unknown item ${itemId}`).toBeDefined();
    }
  });
});
