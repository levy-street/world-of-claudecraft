// Two-pool carried-capacity math (src/sim/bag_pools.ts): the socket-to-pool
// routing, the materials-first ALLOCATION RULE the module header pins, and the
// tolerated-over-capacity clamp.
//
// Driven with a SYNTHETIC material predicate (ids prefixed 'mat_') so every
// boundary here is exact and independent of the live taxonomy: a content edit
// that reclassifies one item must never move these numbers. The real gates over
// the real taxonomy are pinned separately, in tests/bags.test.ts.
import { describe, expect, it } from 'vitest';
import {
  freePoolSlots,
  generalOnlyPools,
  isMaterialsOnlyBag,
  type PoolCapacity,
  poolCapacityOf,
  poolOccupancyOf,
  totalPoolCapacity,
} from '../src/sim/bag_pools';
import { ALL_RECIPES, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { MARKET_HOUSE_STOCK } from '../src/sim/market';
import type { InvSlot, ItemDef } from '../src/sim/types';

/** The injected classifier under test. Prefix-keyed so a reader can count the
 *  materials in any fixture below by eye. */
const isMat = (itemId: string): boolean => itemId.startsWith('mat_');

/** `mats` material slots followed by `goods` non-material slots, every slot a
 *  distinct id (freePoolSlots counts SLOTS, never units, so the counts are 1). */
function load(mats: number, goods: number): InvSlot[] {
  return [
    ...Array.from({ length: mats }, (_, i) => ({ itemId: `mat_${i}`, count: 1 })),
    ...Array.from({ length: goods }, (_, i) => ({ itemId: `gear_${i}`, count: 1 })),
  ];
}

describe('poolCapacityOf: socket-to-pool routing over the shipped catalog', () => {
  it('base slots alone are the general pool; an empty socket row adds nothing', () => {
    expect(poolCapacityOf(16, [null, null, null, null])).toEqual({ general: 16, materials: 0 });
    expect(poolCapacityOf(0, [])).toEqual({ general: 0, materials: 0 });
    expect(poolCapacityOf(28, [])).toEqual({ general: 28, materials: 0 });
  });

  it('an unrestricted bag feeds GENERAL, a materialsOnly bag feeds MATERIALS', () => {
    // Real ids and real bagSlots: a hand-typed slot count here would pass while
    // the content table said something else.
    expect(ITEMS.linen_pouch.bagSlots).toBe(6);
    expect(ITEMS.travelers_knapsack.bagSlots).toBe(8);
    expect(poolCapacityOf(16, ['linen_pouch', 'travelers_knapsack', null, null])).toEqual({
      general: 30,
      materials: 0,
    });
    expect(ITEMS.burlap_reagent_pouch.bagSlots).toBe(8);
    expect(ITEMS.burlap_reagent_pouch.materialsOnly).toBe(true);
    expect(poolCapacityOf(16, ['burlap_reagent_pouch', null, null, null])).toEqual({
      general: 16,
      materials: 8,
    });
  });

  it('the crafted GENERAL bag ladder is pinned to its shipped slots and quality', () => {
    // Numbers the rest of the suite derives rather than pins. The two argmax
    // pins (dev_kit, pbe_boost) take the winning slot count from the catalog
    // itself and hold only the WINNER'S ID to a literal, so re-tuning
    // resonant_weave_bag upward ships green there; tests/ladder_crafting.test.ts
    // pins silkspun_satchel's 10 slots, and duskweave_bag's 12 are pinned
    // nowhere else at all. No arm anywhere holds any of the three to a quality.
    // Pinned here beside the routing they feed, since these slot counts are
    // exactly what the general pool has to gain.
    expect(ITEMS.silkspun_satchel?.bagSlots).toBe(10);
    expect(ITEMS.silkspun_satchel?.quality).toBe('uncommon');
    expect(isMaterialsOnlyBag(ITEMS.silkspun_satchel)).toBe(false);
    expect(ITEMS.duskweave_bag?.bagSlots).toBe(12);
    expect(ITEMS.duskweave_bag?.quality).toBe('rare');
    expect(isMaterialsOnlyBag(ITEMS.duskweave_bag)).toBe(false);
    expect(ITEMS.resonant_weave_bag?.bagSlots).toBe(16);
    expect(ITEMS.resonant_weave_bag?.quality).toBe('epic');
    expect(isMaterialsOnlyBag(ITEMS.resonant_weave_bag)).toBe(false);
    expect(poolCapacityOf(16, ['duskweave_bag', null, null, null])).toEqual({
      general: 28,
      materials: 0,
    });
  });

  it('routes EVERY shipped bag by its own materialsOnly flag, catalog-wide', () => {
    // Census over the live catalog rather than a fixed id list, so a bag added
    // later is covered the day it lands. Driven off each def's OWN flag, so an
    // inverted routing (or a bag whose slots vanish from both pools) fails here
    // whatever the catalog happens to hold.
    const bagDefs = Object.values(ITEMS).filter((d) => d.kind === 'bag');
    expect(bagDefs.length).toBeGreaterThan(0);
    // Both arms must actually be exercised, or this census could silently
    // degrade into a one-sided test as content changes.
    expect(bagDefs.some((d) => d.materialsOnly === true)).toBe(true);
    expect(bagDefs.some((d) => d.materialsOnly !== true)).toBe(true);
    for (const def of bagDefs) {
      const slots = def.bagSlots ?? 0;
      expect(isMaterialsOnlyBag(def), def.id).toBe(def.materialsOnly === true);
      expect(poolCapacityOf(0, [def.id]), def.id).toEqual(
        def.materialsOnly === true
          ? { general: 0, materials: slots }
          : { general: slots, materials: 0 },
      );
    }
  });

  it('null sockets are skipped and a non-bag or unknown id contributes zero', () => {
    expect(poolCapacityOf(16, [null, 'linen_pouch', null, null])).toEqual({
      general: 22,
      materials: 0,
    });
    // The tampered-save shape (a weapon or a dead id parked in a socket): both
    // arms of bagSlotsOf's non-bag guard, neither adds capacity.
    expect(poolCapacityOf(16, ['worn_sword', 'not_an_item', null, null])).toEqual({
      general: 16,
      materials: 0,
    });
  });
});

describe('isMaterialsOnlyBag: the def-level predicate', () => {
  const def = (over: Partial<ItemDef>): ItemDef =>
    ({
      id: 'fixture_bag',
      name: 'Fixture Bag',
      kind: 'bag',
      quality: 'common',
      bagSlots: 8,
      sellValue: 1,
      ...over,
    }) as ItemDef;

  it('is true only for a BAG def carrying materialsOnly true (both dimensions)', () => {
    expect(isMaterialsOnlyBag(def({ materialsOnly: true }))).toBe(true);
    // The flag dimension: absent and explicitly false are both unrestricted.
    expect(isMaterialsOnlyBag(def({}))).toBe(false);
    expect(isMaterialsOnlyBag(def({ materialsOnly: false }))).toBe(false);
    // The KIND dimension: a mis-authored non-bag carrying the flag never opens
    // a materials pool (poolCapacityOf would otherwise credit a chest piece).
    expect(isMaterialsOnlyBag(def({ kind: 'junk', materialsOnly: true }))).toBe(false);
    expect(isMaterialsOnlyBag(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bag-ness is authored as THREE separate signals (kind: 'bag', bagSlots,
// materialsOnly) that every consumer reads as one thing, and the ItemDef type
// enforces none of that: bagSlots and materialsOnly both sit on BaseItemDef, so
// a def carrying one signal without the others type-checks and ships inert or
// half-live. This census is the enforcement the type cannot give.
describe('bag-ness is coherent across the shipped catalog', () => {
  it('kind, bagSlots, and materialsOnly imply one another on EVERY def', () => {
    const defs = Object.values(ITEMS);
    for (const def of defs) {
      if (def.materialsOnly) {
        // isMaterialsOnlyBag guards on kind, so the flag on (say) a potion is
        // silently inert: the restriction its author intended never reaches
        // poolCapacityOf and the item goes on routing as ordinary cargo.
        expect(def.kind, `${def.id}: materialsOnly set on a non-bag def`).toBe('bag');
      }
      if (def.kind === 'bag') {
        // A zero-slot bag adds nothing to either pool, yet equipBag (which
        // gates on kind alone) still takes it into a socket and
        // bagSlotsLineKey still gives it a slot line, so it reads to the
        // player as a real bag that happens to hold nothing.
        expect(def.bagSlots ?? 0, `${def.id}: bag def with no bagSlots`).toBeGreaterThan(0);
      }
      if ((def.bagSlots ?? 0) > 0) {
        // Every read of bagSlots sits behind a kind === 'bag' guard
        // (bagSlotsOf, isMaterialsOnlyBag, bestKitBag, bestBoostBag), so slots
        // on a non-bag def are carried capacity that nothing ever credits.
        expect(def.kind, `${def.id}: bagSlots on a non-bag def`).toBe('bag');
      }
    }
    // Positive control: all three implications are vacuously true over a
    // catalog holding no bags at all, so pin that both flavours really ship.
    expect(defs.some((d) => d.kind === 'bag' && d.materialsOnly === true)).toBe(true);
    expect(defs.some((d) => d.kind === 'bag' && d.materialsOnly !== true)).toBe(true);
    // The third implication needs its own control: a catalog where bagSlots
    // never appeared would satisfy it while proving nothing.
    expect(defs.some((d) => (d.bagSlots ?? 0) > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The allocation rule, pinned as a literal boundary matrix rather than a
// re-derivation of the production formula: every expectation below is a
// hand-computed number for pools { general: 4, materials: 3 }, so an
// implementation that changed the packing order would have to move these.
const P: PoolCapacity = { general: 4, materials: 3 };

const MATRIX: {
  mats: number;
  goods: number;
  generalUsed: number;
  materialsUsed: number;
  goodsFree: number;
  matsFree: number;
  note: string;
}[] = [
  { mats: 0, goods: 0, generalUsed: 0, materialsUsed: 0, goodsFree: 4, matsFree: 7, note: 'empty' },
  {
    mats: 0,
    goods: 3,
    generalUsed: 3,
    materialsUsed: 0,
    goodsFree: 1,
    matsFree: 4,
    note: 'general one short of full',
  },
  {
    mats: 0,
    goods: 4,
    generalUsed: 4,
    materialsUsed: 0,
    goodsFree: 0,
    matsFree: 3,
    note: 'general EXACTLY full, materials empty',
  },
  {
    mats: 3,
    goods: 0,
    generalUsed: 0,
    materialsUsed: 3,
    goodsFree: 4,
    matsFree: 4,
    note: 'materials EXACTLY full, general empty',
  },
  {
    mats: 4,
    goods: 0,
    generalUsed: 1,
    materialsUsed: 3,
    goodsFree: 3,
    matsFree: 3,
    note: 'one material past the materials pool: the spill costs a general slot',
  },
  {
    mats: 5,
    goods: 0,
    generalUsed: 2,
    materialsUsed: 3,
    goodsFree: 2,
    matsFree: 2,
    note: 'two spilled',
  },
  {
    mats: 3,
    goods: 4,
    generalUsed: 4,
    materialsUsed: 3,
    goodsFree: 0,
    matsFree: 0,
    note: 'both pools EXACTLY full',
  },
  {
    mats: 7,
    goods: 0,
    generalUsed: 4,
    materialsUsed: 3,
    goodsFree: 0,
    matsFree: 0,
    note: 'materials alone fill the whole budget',
  },
  {
    mats: 5,
    goods: 1,
    generalUsed: 3,
    materialsUsed: 3,
    goodsFree: 1,
    matsFree: 1,
    note: 'the allocation-rule discriminator',
  },
];

describe('poolOccupancyOf and freePoolSlots: the boundary matrix', () => {
  it('reports the hand-computed occupancy for every fixture', () => {
    for (const c of MATRIX) {
      const label = `${c.mats} materials + ${c.goods} others (${c.note})`;
      expect(poolOccupancyOf(load(c.mats, c.goods), P, isMat), label).toEqual({
        generalUsed: c.generalUsed,
        materialsUsed: c.materialsUsed,
      });
    }
  });

  it('answers the hand-computed free-slot count for each kind at every boundary', () => {
    for (const c of MATRIX) {
      const label = `${c.mats} materials + ${c.goods} others (${c.note})`;
      const slots = load(c.mats, c.goods);
      expect(freePoolSlots(slots, P, 'gear_new', isMat), `non-material, ${label}`).toBe(
        c.goodsFree,
      );
      expect(freePoolSlots(slots, P, 'mat_new', isMat), `material, ${label}`).toBe(c.matsFree);
    }
  });

  it('a non-material is refused the moment GENERAL is exactly full, materials headroom or not', () => {
    // The pair that matters most: one short of full still admits, exactly full
    // refuses, and the three free materials slots do not rescue it.
    expect(freePoolSlots(load(0, 3), P, 'gear_new', isMat)).toBe(1);
    expect(freePoolSlots(load(0, 4), P, 'gear_new', isMat)).toBe(0);
    expect(freePoolSlots(load(0, 4), P, 'mat_new', isMat)).toBe(3);
  });

  it('a material takes MATERIALS headroom first and then whatever general has left', () => {
    // Empty bags: a material may reach the whole budget, a non-material only general.
    expect(freePoolSlots([], P, 'mat_new', isMat)).toBe(totalPoolCapacity(P));
    expect(freePoolSlots([], P, 'gear_new', isMat)).toBe(P.general);
    // Materials exactly full: the pool contributes nothing further and the
    // answer is general alone, which is where the next material spills.
    expect(freePoolSlots(load(3, 0), P, 'mat_new', isMat)).toBe(4);
    // One past: the spilled material has already consumed a general slot.
    expect(freePoolSlots(load(4, 0), P, 'mat_new', isMat)).toBe(3);
  });
});

describe('the ALLOCATION RULE: materials pack into the materials pool FIRST', () => {
  it('accepts a non-material that a general-first packing would have refused', () => {
    // pools { general: 4, materials: 3 } holding 5 materials and 1 non-material.
    // Materials-first: 3 materials sit in the materials pool, 2 spill, so
    // general holds 1 + 2 = 3 of its 4 and ONE slot is still open.
    // General-first would have put materials in general until it overflowed and
    // refused this pickup outright. The accept is the whole point of the rule:
    // a materials-only bag must never crowd out a pickup that fit without it.
    const slots = load(5, 1);
    expect(poolOccupancyOf(slots, P, isMat)).toEqual({ generalUsed: 3, materialsUsed: 3 });
    expect(freePoolSlots(slots, P, 'gear_new', isMat)).toBe(1);
  });

  it('refuses that same non-material one slot later: the accept sits ON the boundary', () => {
    // 5 materials + 2 non-materials is the very next state, and general is full.
    expect(freePoolSlots(load(5, 2), P, 'gear_new', isMat)).toBe(0);
  });

  it('packing is recomputed from the whole list, never sticky: order does not matter', () => {
    // The same multiset in the opposite order answers identically, so no slot
    // carries a remembered pool assignment (freeing a materials slot migrates a
    // spilled material back on the next check, by construction).
    const forward = load(5, 1);
    const reversed = [...forward].reverse();
    expect(poolOccupancyOf(reversed, P, isMat)).toEqual(poolOccupancyOf(forward, P, isMat));
    expect(freePoolSlots(reversed, P, 'gear_new', isMat)).toBe(1);
    expect(freePoolSlots(reversed, P, 'mat_new', isMat)).toBe(1);
  });

  it('a materials-only pool never crowds out general headroom: adding one is monotone', () => {
    // The rule stated as the promise it makes to the player: with the SAME
    // general budget, giving the container a materials pool can only ever leave
    // a non-material at least as much room as it had before.
    const noMaterialsPool: PoolCapacity = { general: 4, materials: 0 };
    const slots = load(5, 1);
    expect(freePoolSlots(slots, noMaterialsPool, 'gear_new', isMat)).toBe(0);
    expect(freePoolSlots(slots, P, 'gear_new', isMat)).toBe(1);
  });
});

describe('over-capacity is tolerated, clamped at zero, and never repaired', () => {
  it('a pool above its budget reports zero free and never a negative', () => {
    const shrunk: PoolCapacity = { general: 2, materials: 0 };
    expect(poolOccupancyOf(load(0, 6), shrunk, isMat)).toEqual({
      generalUsed: 6,
      materialsUsed: 0,
    });
    expect(freePoolSlots(load(0, 6), shrunk, 'gear_new', isMat)).toBe(0);
    expect(freePoolSlots(load(0, 6), shrunk, 'mat_new', isMat)).toBe(0);
  });

  it('the OTHER pool is unaffected by an overflowing one', () => {
    // General is 2 over budget; the materials pool still offers its full 3, so
    // an overflowing backpack does not lock a player out of gathering.
    const slots = load(0, 6);
    expect(freePoolSlots(slots, P, 'gear_new', isMat)).toBe(0);
    expect(freePoolSlots(slots, P, 'mat_new', isMat)).toBe(3);
  });

  it('materials free never goes negative, because the excess spills instead', () => {
    // 9 materials against a 3-slot materials pool: materialsUsed clamps at 3
    // and the other 6 land in general (which is itself 2 over its budget).
    expect(poolOccupancyOf(load(9, 0), P, isMat)).toEqual({ generalUsed: 6, materialsUsed: 3 });
    expect(freePoolSlots(load(9, 0), P, 'mat_new', isMat)).toBe(0);
  });

  it('never mutates, clamps, or repairs the slot list it was handed', () => {
    const slots = load(9, 4);
    const before = structuredClone(slots);
    freePoolSlots(slots, P, 'gear_new', isMat);
    freePoolSlots(slots, P, 'mat_new', isMat);
    poolOccupancyOf(slots, P, isMat);
    expect(slots).toEqual(before);
    expect(slots).toHaveLength(13); // still far above the 7-slot budget
  });
});

describe('totalPoolCapacity and generalOnlyPools', () => {
  it('totalPoolCapacity sums both pools and is NOT a fit answer', () => {
    expect(totalPoolCapacity({ general: 4, materials: 3 })).toBe(7);
    expect(totalPoolCapacity({ general: 16, materials: 0 })).toBe(16);
    expect(totalPoolCapacity({ general: 0, materials: 0 })).toBe(0);
    // The distinction the doc comment insists on: total headroom remains (3 of
    // 7 slots free) while a non-material is refused outright.
    const slots = load(0, 4);
    expect(totalPoolCapacity(P) - slots.length).toBe(3);
    expect(freePoolSlots(slots, P, 'gear_new', isMat)).toBe(0);
  });

  it('generalOnlyPools puts everything in general and leaves materials at zero', () => {
    expect(generalOnlyPools(24)).toEqual({ general: 24, materials: 0 });
    expect(generalOnlyPools(0)).toEqual({ general: 0, materials: 0 });
    expect(totalPoolCapacity(generalOnlyPools(24))).toBe(24);
    // With no materials pool the two kinds answer identically: the single-pool
    // model every caller of this helper is deliberately still on.
    const slots = load(1, 1);
    expect(freePoolSlots(slots, generalOnlyPools(4), 'mat_new', isMat)).toBe(2);
    expect(freePoolSlots(slots, generalOnlyPools(4), 'gear_new', isMat)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The materials arm of the routing, driven by the REAL shipped satchels rather
// than a fabricated def: the phase 05 catalog ships four materialsOnly bags
// across both content files, so the branch has honest content behind it.
const POUCH = 'burlap_reagent_pouch'; // 8 slots, common (items.ts)
const SATCHEL = 'necromancers_reagent_satchel'; // 20 slots, rare (items.ts)
const HAVERSACK = 'foragers_haversack'; // 12 slots, uncommon (profession_items.ts)
const LOOMBOUND = 'loombound_reagent_satchel'; // 24 slots, epic (profession_items.ts)

describe('poolCapacityOf: the shipped materialsOnly satchels feed the MATERIALS pool', () => {
  it('every shipped materials satchel is really flagged, with the slot counts pinned', () => {
    // The fixtures the arms below depend on, pinned against the content table so
    // a re-tune or a dropped flag fails here rather than quietly weakening them.
    expect(ITEMS[POUCH]?.materialsOnly).toBe(true);
    expect(ITEMS[POUCH]?.bagSlots).toBe(8);
    expect(ITEMS[SATCHEL]?.materialsOnly).toBe(true);
    expect(ITEMS[SATCHEL]?.bagSlots).toBe(20);
    expect(ITEMS[HAVERSACK]?.materialsOnly).toBe(true);
    expect(ITEMS[HAVERSACK]?.bagSlots).toBe(12);
    expect(ITEMS[LOOMBOUND]?.materialsOnly).toBe(true);
    expect(ITEMS[LOOMBOUND]?.bagSlots).toBe(24);
  });

  it('credits its bagSlots to materials and leaves general at the base budget', () => {
    expect(poolCapacityOf(16, [POUCH, null, null, null])).toEqual({
      general: 16,
      materials: 8,
    });
  });

  it('a MIXED socket row splits both ways in one pass', () => {
    expect(poolCapacityOf(16, ['linen_pouch', POUCH, HAVERSACK, 'travelers_knapsack'])).toEqual({
      general: 16 + 6 + 8,
      materials: 8 + 12,
    });
  });

  it('two materials satchels stack their pools, and the split drives the fit answer', () => {
    const pools = poolCapacityOf(16, [SATCHEL, LOOMBOUND, null, null]);
    expect(pools).toEqual({ general: 16, materials: 44 });
    expect(totalPoolCapacity(pools)).toBe(60);
    // A full general pool with the whole materials pool free: the split, not
    // the total, is what a non-material pickup is measured against.
    const slots = load(0, 16);
    expect(freePoolSlots(slots, pools, 'gear_new', isMat)).toBe(0);
    expect(freePoolSlots(slots, pools, 'mat_new', isMat)).toBe(44);
  });

  it('a full socket row of materials satchels leaves general at the bare backpack', () => {
    // The extreme the allocation rule has to stay sane under: 64 materials
    // slots and not one extra slot for anything else.
    const pools = poolCapacityOf(16, [POUCH, SATCHEL, HAVERSACK, LOOMBOUND]);
    expect(pools).toEqual({ general: 16, materials: 64 });
    expect(freePoolSlots(load(0, 16), pools, 'gear_new', isMat)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Acquisition census. Every arm above equips a bag by id and never asks how a
// player got one, so a content edit that deletes the last vendor row, loot row,
// or recipe for a bag orphans it while this whole file stays green. Walked over
// the MERGED aggregation points (MOBS already folds in the dungeon, delve, and
// per-zone mob tables), so a row that simply moves between content files still
// counts as reachable.
type BagChannel = 'loot' | 'market' | 'recipe' | 'vendor';
// Alphabetical, and the order every expected channel list below is written in:
// `found` is built by filtering this tuple, so the order is what toEqual sees.
const CHANNELS = ['loot', 'market', 'recipe', 'vendor'] as const;

/** Every item id obtainable through each channel, over the live content. */
function acquisitionIndex(): Record<BagChannel, Set<string>> {
  const loot = new Set<string>();
  for (const mob of Object.values(MOBS)) {
    for (const row of mob.loot) if (row.itemId) loot.add(row.itemId);
  }
  const vendor = new Set<string>();
  for (const npc of Object.values(NPCS)) {
    for (const id of npc.vendorItems ?? []) vendor.add(id);
  }
  const recipe = new Set<string>();
  for (const r of ALL_RECIPES) recipe.add(r.resultItemId);
  // The Merchant's house stock: reseeded every boot, never depleting, so a row
  // here is a standing route to the item in its own right.
  const market = new Set<string>();
  for (const row of MARKET_HOUSE_STOCK) market.add(row.itemId);
  return { loot, market, recipe, vendor };
}

/** The settled route to each phase 05 bag, as an EXACT channel set: one entry
 *  rung stocked at both the vendor and the market house, four crafted rungs on
 *  the tailoring ladder, and two drops. Deliberately exact rather than "at
 *  least one", so adding a second route to a bag is a deliberate edit here and
 *  not a silent re-pricing of the ladder. */
const PHASE05_BAG_CHANNELS: Record<string, BagChannel[]> = {
  burlap_reagent_pouch: ['market', 'vendor'],
  duskweave_bag: ['recipe'],
  foragers_haversack: ['recipe'],
  loombound_reagent_satchel: ['recipe'],
  necromancers_reagent_satchel: ['loot'],
  resonant_weave_bag: ['recipe'],
  wayfarers_backpack: ['loot'],
};

describe('acquisition census: every phase 05 bag stays reachable in play', () => {
  it('finds each bag through exactly its settled channel', () => {
    const index = acquisitionIndex();
    // Non-vacuity: a mis-walked (or empty) index would report every bag as
    // unreachable, which the per-id arms below would then read as "found
    // nothing anywhere" rather than as a real orphan.
    expect(index.loot.size).toBeGreaterThan(0);
    expect(index.market.size).toBeGreaterThan(0);
    expect(index.recipe.size).toBeGreaterThan(0);
    expect(index.vendor.size).toBeGreaterThan(0);
    // The roster is itself a pin: a row quietly dropped from the map above
    // would take its bag out of the census without failing anything.
    expect(Object.keys(PHASE05_BAG_CHANNELS)).toHaveLength(7);
    for (const [id, expected] of Object.entries(PHASE05_BAG_CHANNELS)) {
      expect(ITEMS[id]?.kind, `${id}: no longer a bag def`).toBe('bag');
      const found = CHANNELS.filter((c) => index[c].has(id));
      expect(found, `${id}: acquisition channels`).toEqual(expected);
    }
  });

  it('leaves NO bag in the catalog orphaned, phase 05 roster or legacy', () => {
    // The census this block's header promises, which the roster arm above does
    // not give: that map covers the seven phase 05 bags only, so any of the six
    // legacy bags could lose its last vendor, loot, or recipe row and stay
    // green. Driven off the catalog instead of a second id list, so a bag added
    // later is covered the day it lands.
    const index = acquisitionIndex();
    const bagDefs = Object.values(ITEMS).filter((d) => d.kind === 'bag');
    expect(bagDefs.length).toBeGreaterThan(Object.keys(PHASE05_BAG_CHANNELS).length);
    for (const def of bagDefs) {
      const found = CHANNELS.filter((c) => index[c].has(def.id));
      expect(
        found.length > 0 || def.id in PHASE05_BAG_CHANNELS,
        `${def.id}: no loot, market, recipe, or vendor row anywhere in the content`,
      ).toBe(true);
    }
  });
});
