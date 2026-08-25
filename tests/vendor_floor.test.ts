// Phase 11n (Masterwrought): the vendor floor. Vendor consumable magnitudes
// were nerfed so every vendor/crafted pair meets its rung's required margin on
// the 10/15/20 ladder, the both-sourced exemptions of ruling qr-11n-NINE are
// pinned (one item with two sources, where a magnitude nerf would hit the
// crafted arm too), and the five vendor stock rows the phase pulled (the four
// Eastbrook gear rows on smith_haldren, elixir_of_the_bear on
// alchemist_verane) stay pulled while every id keeps its def, price, and
// recipe. All expectations are literals, never derived from the live tables.

import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ZONE2_MOBS } from '../src/sim/content/zone2';
import { ITEMS, NPCS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

type MagnitudeAxis = 'potionHp' | 'potionMana' | 'foodHp' | 'drinkMana';

function liveMagnitude(itemId: string, axis: MagnitudeAxis): number | undefined {
  const def = ITEMS[itemId] as ItemDef | undefined;
  return def?.[axis];
}

const RECIPE_RESULT_IDS: ReadonlySet<string> = new Set(ALL_RECIPES.map((r) => r.resultItemId));

// The one shared vendor-stock scanning pipeline (arms 3 and 4 both ride it):
// the sorted set of unique item ids stocked by ANY vendor that satisfy `keep`.
// The parameter is NPCS-shaped so the positive control below can drive it with
// a synthetic fixture instead of the real tables.
interface VendorStockTable {
  [npcId: string]: { vendorItems?: string[] };
}

function vendorStockedIdsBy(npcs: VendorStockTable, keep: (itemId: string) => boolean): string[] {
  const found = new Set<string>();
  for (const npc of Object.values(npcs)) {
    for (const itemId of npc.vendorItems ?? []) {
      if (keep(itemId)) found.add(itemId);
    }
  }
  return [...found].sort();
}

// Every vendor/crafted pair bound by the 10/15/20 margin ladder, with the
// POST-11n magnitudes as literals. `rung` is the per-axis margin class, ordered
// bottom to top within each axis (potions: minor/lesser/standard; food: the
// magnitude tercile over the six crafted tiers that pair with vendor food, 90
// to 980; the apex 1392 food tier faces no vendor competitor and is outside
// the pairing range).
interface VendorPair {
  axis: MagnitudeAxis;
  rung: string;
  vendorId: string;
  vendorValue: number;
  craftedId: string;
  craftedValue: number;
  marginPct: number;
}

const PAIRS: VendorPair[] = [
  {
    axis: 'potionMana',
    rung: 'minor',
    vendorId: 'minor_mana_potion',
    vendorValue: 145,
    craftedId: 'silverleaf_mana_draught',
    craftedValue: 160,
    marginPct: 10,
  },
  {
    axis: 'potionMana',
    rung: 'lesser',
    vendorId: 'lesser_mana_potion',
    vendorValue: 226,
    craftedId: 'goldleaf_mana_draught',
    craftedValue: 260,
    marginPct: 15,
  },
  {
    axis: 'potionMana',
    rung: 'standard',
    vendorId: 'mana_potion',
    vendorValue: 354,
    craftedId: 'sunpetal_mana_draught',
    craftedValue: 425,
    marginPct: 20,
  },
  {
    axis: 'potionHp',
    rung: 'standard',
    vendorId: 'healing_potion',
    vendorValue: 279,
    craftedId: 'sunpetal_healing_draught',
    craftedValue: 335,
    marginPct: 20,
  },
  {
    axis: 'foodHp',
    rung: 'bottom',
    vendorId: 'baked_bread',
    vendorValue: 61,
    craftedId: 'pan_seared_perch',
    craftedValue: 90,
    marginPct: 10,
  },
  {
    axis: 'foodHp',
    rung: 'bottom',
    vendorId: 'brightwood_venison',
    vendorValue: 81,
    craftedId: 'pan_seared_perch',
    craftedValue: 90,
    marginPct: 10,
  },
  {
    axis: 'foodHp',
    rung: 'bottom',
    vendorId: 'roasted_boar',
    vendorValue: 106,
    craftedId: 'hunters_game_skewer',
    craftedValue: 117,
    marginPct: 10,
  },
  {
    axis: 'foodHp',
    rung: 'bottom',
    vendorId: 'fenbridge_rye',
    vendorValue: 220,
    craftedId: 'fenbridge_rice_bowl',
    craftedValue: 243,
    marginPct: 10,
  },
  {
    axis: 'foodHp',
    rung: 'middle',
    vendorId: 'smoked_eel',
    vendorValue: 375,
    craftedId: 'frostgill_chowder',
    craftedValue: 432,
    marginPct: 15,
  },
  {
    axis: 'foodHp',
    rung: 'middle',
    vendorId: 'trail_hardtack',
    vendorValue: 480,
    craftedId: 'silvered_carp_supper',
    craftedValue: 552,
    marginPct: 15,
  },
  {
    axis: 'foodHp',
    rung: 'top',
    vendorId: 'roast_mountain_goat',
    vendorValue: 816,
    craftedId: 'marlows_grand_roast',
    craftedValue: 980,
    marginPct: 20,
  },
];

function achievedMarginPct(row: VendorPair): number {
  const vendor = liveMagnitude(row.vendorId, row.axis);
  const crafted = liveMagnitude(row.craftedId, row.axis);
  expect(vendor, `${row.vendorId} has a live ${row.axis} value`).toBeTypeOf('number');
  expect(crafted, `${row.craftedId} has a live ${row.axis} value`).toBeTypeOf('number');
  return ((crafted as number) / (vendor as number) - 1) * 100;
}

describe('the ladder: every vendor/crafted pair meets its rung margin', () => {
  it.each(PAIRS)(
    '$vendorId vs $craftedId holds the $rung rung at $marginPct percent on $axis',
    (row) => {
      const vendor = liveMagnitude(row.vendorId, row.axis);
      const crafted = liveMagnitude(row.craftedId, row.axis);
      expect(vendor, `${row.vendorId} ${row.axis}`).toBe(row.vendorValue);
      expect(crafted, `${row.craftedId} ${row.axis}`).toBe(row.craftedValue);
      const achieved = achievedMarginPct(row);
      expect(
        (crafted as number) >= (vendor as number) * (1 + row.marginPct / 100),
        `${row.craftedId} (${crafted}) must beat ${row.vendorId} (${vendor}) by at least ` +
          `${row.marginPct} percent; achieved ${achieved.toFixed(1)} percent`,
      ).toBe(true);
    },
  );
});

describe('the margin widens as the rungs climb', () => {
  // Per-axis rung order, bottom to top. The potionHp axis has ONE bound rung
  // (standard): its minor and lesser rungs are the both-sourced exemptions
  // minor_healing_potion and lesser_healing_potion (ruling qr-11n-NINE), so
  // they appear in no PAIRS row and this axis contributes a single point.
  const AXIS_LADDERS: { axis: MagnitudeAxis; rungs: string[] }[] = [
    { axis: 'potionMana', rungs: ['minor', 'lesser', 'standard'] },
    { axis: 'potionHp', rungs: ['standard'] },
    { axis: 'foodHp', rungs: ['bottom', 'middle', 'top'] },
  ];

  it.each(AXIS_LADDERS)(
    '$axis: required and achieved margins are non-decreasing bottom to top',
    ({ axis, rungs }) => {
      let prevRequired = Number.NEGATIVE_INFINITY;
      let prevAchieved = Number.NEGATIVE_INFINITY;
      let prevRung = '(none)';
      for (const rung of rungs) {
        const rows = PAIRS.filter((r) => r.axis === axis && r.rung === rung);
        expect(rows.length, `${axis} ${rung}: at least one bound pair exists`).toBeGreaterThan(0);
        const required = Math.min(...rows.map((r) => r.marginPct));
        // Food rungs hold several pairs; the class is judged by its WORST
        // (minimum) achieved margin so one generous pair cannot carry a
        // failing sibling past the rung below.
        const achieved = Math.min(...rows.map((r) => achievedMarginPct(r)));
        expect(
          required >= prevRequired,
          `${axis}: required margin at ${rung} (${required}) is under ${prevRung} (${prevRequired})`,
        ).toBe(true);
        expect(
          achieved >= prevAchieved,
          `${axis}: achieved margin at ${rung} (${achieved.toFixed(1)}) is under ` +
            `${prevRung} (${prevAchieved.toFixed(1)})`,
        ).toBe(true);
        prevRequired = Math.max(...rows.map((r) => r.marginPct));
        prevAchieved = achieved;
        prevRung = rung;
      }
    },
  );
});

describe('the both-sourced nine (ruling qr-11n-NINE)', () => {
  it('the live vendor-stocked AND crafted intersection is exactly the four kept exemptions', () => {
    const both = vendorStockedIdsBy(NPCS, (itemId) => RECIPE_RESULT_IDS.has(itemId));
    expect(both).toEqual([
      'lesser_healing_potion',
      'linen_pouch',
      'minor_healing_potion',
      'tough_jerky',
    ]);
  });

  type NineClassification = 'exempt, stock kept' | 'exempt, stock pulled' | 'stock pulled';
  const HISTORICAL_NINE: { id: string; classification: NineClassification }[] = [
    // Consumable sold AND crafted: a magnitude nerf would hit the crafted arm.
    { id: 'minor_healing_potion', classification: 'exempt, stock kept' },
    // Same exemption one rung up: the lesser healing rung is both-sourced.
    { id: 'lesser_healing_potion', classification: 'exempt, stock kept' },
    // Vendor food that is also the cooking floor recipe result: exempt.
    { id: 'tough_jerky', classification: 'exempt, stock kept' },
    // A bag, not a consumable: no magnitude exists to nerf, stock kept.
    { id: 'linen_pouch', classification: 'exempt, stock kept' },
    // Buff payload shared with the crafted arm, so the magnitude is exempt;
    // the phase pulled its alchemist_verane stock row instead.
    { id: 'elixir_of_the_bear', classification: 'exempt, stock pulled' },
    // Crafted gear the vendor undercut: the smith_haldren row was pulled.
    { id: 'eastbrook_arming_sword', classification: 'stock pulled' },
    // Crafted gear the vendor undercut: the smith_haldren row was pulled.
    { id: 'eastbrook_chain_vest', classification: 'stock pulled' },
    // Crafted gear the vendor undercut: the smith_haldren row was pulled.
    { id: 'eastbrook_wool_trousers', classification: 'stock pulled' },
    // Crafted gear the vendor undercut: the smith_haldren row was pulled.
    { id: 'tanned_leather_jerkin', classification: 'stock pulled' },
  ];

  it.each(HISTORICAL_NINE)(
    '$id: still an ALL_RECIPES result, vendor stock matches "$classification"',
    ({ id, classification }) => {
      expect(RECIPE_RESULT_IDS.has(id), `${id} is still an ALL_RECIPES result`).toBe(true);
      const stocked = vendorStockedIdsBy(NPCS, (itemId) => itemId === id).length > 0;
      expect(stocked, `${id} vendor-stocked`).toBe(classification === 'exempt, stock kept');
    },
  );

  it('the exempt consumable magnitudes kept their pre-phase values', () => {
    expect(liveMagnitude('minor_healing_potion', 'potionHp'), 'minor_healing_potion potionHp').toBe(
      110,
    );
    expect(
      liveMagnitude('lesser_healing_potion', 'potionHp'),
      'lesser_healing_potion potionHp',
    ).toBe(190);
    expect(liveMagnitude('tough_jerky', 'foodHp'), 'tough_jerky foodHp').toBe(61);
  });

  it('elixir_of_the_bear keeps its exempt buff payload', () => {
    const def = ITEMS.elixir_of_the_bear as ItemDef | undefined;
    expect(def?.elixir, 'elixir_of_the_bear elixir payload').toBeDefined();
    expect(def?.elixir?.kind, 'elixir_of_the_bear elixir kind').toBe('buff_sta');
    expect(def?.elixir?.value, 'elixir_of_the_bear elixir value').toBe(12);
    expect(def?.elixir?.duration, 'elixir_of_the_bear elixir duration').toBe(900);
  });

  it('linen_pouch is a bag with no consumable magnitude', () => {
    const def = ITEMS.linen_pouch as ItemDef | undefined;
    expect(def?.kind, 'linen_pouch kind').toBe('bag');
    expect(liveMagnitude('linen_pouch', 'potionHp'), 'linen_pouch potionHp').toBeUndefined();
    expect(liveMagnitude('linen_pouch', 'potionMana'), 'linen_pouch potionMana').toBeUndefined();
    expect(liveMagnitude('linen_pouch', 'foodHp'), 'linen_pouch foodHp').toBeUndefined();
    expect(liveMagnitude('linen_pouch', 'drinkMana'), 'linen_pouch drinkMana').toBeUndefined();
  });
});

describe('no crafted counterpart: the vendor drink line', () => {
  // Positive control for the shared vendorStockedIdsBy pipeline (arms 3 and 4
  // both ride it): a synthetic NPCS-shaped and ITEMS-shaped fixture proves the
  // scanner really visits stock rows, applies the predicate, dedupes, and
  // sorts. Without this, a dead filter would leave the expect-empty and
  // expect-equal sweeps below green over nothing.
  it('positive control: the stock scanner finds exactly the synthetic match', () => {
    const fakeItems: Record<string, { fizzy?: boolean }> = {
      synthetic_ale: { fizzy: true },
      synthetic_sword: {},
    };
    const fakeNpcs: VendorStockTable = {
      // Stocks both synthetic items; only the predicate match may survive.
      synthetic_barkeep: { vendorItems: ['synthetic_ale', 'synthetic_sword'] },
      // Duplicate stock row for the same id: the scanner returns unique ids.
      synthetic_brewer: { vendorItems: ['synthetic_ale'] },
      // No vendorItems at all: the optional-arm path must not throw.
      synthetic_questgiver: {},
    };
    expect(vendorStockedIdsBy(fakeNpcs, (itemId) => fakeItems[itemId]?.fizzy === true)).toEqual([
      'synthetic_ale',
    ]);
    expect(vendorStockedIdsBy(fakeNpcs, (itemId) => itemId in fakeItems)).toEqual([
      'synthetic_ale',
      'synthetic_sword',
    ]);
  });

  it('zero crafted drinkMana items exist (the premise of this arm)', () => {
    const craftedDrinks = [...RECIPE_RESULT_IDS]
      .filter((itemId) => liveMagnitude(itemId, 'drinkMana') !== undefined)
      .sort();
    expect(craftedDrinks).toEqual([]);
  });

  it('the vendor-stocked drinkMana set is exactly the five drinks', () => {
    const stockedDrinks = vendorStockedIdsBy(
      NPCS,
      (itemId) => liveMagnitude(itemId, 'drinkMana') !== undefined,
    );
    expect(stockedDrinks).toEqual([
      'glacier_melt',
      'marsh_mint_tea',
      'meltwater_flask',
      'silvermist_cordial',
      'spring_water',
    ]);
  });

  const VENDOR_DRINKS = [
    { id: 'spring_water', drinkMana: 76 },
    { id: 'marsh_mint_tea', drinkMana: 288 },
    { id: 'silvermist_cordial', drinkMana: 436 },
    { id: 'meltwater_flask', drinkMana: 672 },
    { id: 'glacier_melt', drinkMana: 900 },
  ];

  it.each(VENDOR_DRINKS)('$id keeps its never-nerfed drinkMana of $drinkMana', (row) => {
    expect(liveMagnitude(row.id, 'drinkMana'), `${row.id} drinkMana`).toBe(row.drinkMana);
  });
});

describe('stock rows: the phase 11n pulls', () => {
  it('alchemist_verane stocks exactly the post-pull list', () => {
    expect(NPCS.alchemist_verane?.vendorItems).toEqual([
      'minor_healing_potion',
      'minor_mana_potion',
      'lesser_healing_potion',
      'lesser_mana_potion',
      'glass_vial',
    ]);
  });

  it('smith_haldren stocks exactly the post-pull list', () => {
    expect(NPCS.smith_haldren?.vendorItems).toEqual([
      'eastbrook_greatsword',
      'bronzework_mace',
      'vale_carving_knife',
      'hickory_shortstaff',
      'eastbrook_buckler',
      'valespun_robe',
      'hobnail_boots',
    ]);
  });

  // Every pulled id keeps its item def, its price, and a recipe producing it:
  // the pull removed the STOCK ROW only, never the item or the crafted source.
  const PULLED_KEEPS = [
    { id: 'eastbrook_arming_sword', buyValue: 1400 },
    { id: 'eastbrook_chain_vest', buyValue: 1800 },
    { id: 'eastbrook_wool_trousers', buyValue: 1100 },
    { id: 'tanned_leather_jerkin', buyValue: 1600 },
    { id: 'elixir_of_the_bear', buyValue: 100 },
  ];

  it.each(PULLED_KEEPS)('$id keeps its def, buyValue $buyValue, and its recipe', (row) => {
    const def = ITEMS[row.id] as ItemDef | undefined;
    expect(def, `${row.id} still has an ITEMS def`).toBeDefined();
    expect(def?.buyValue, `${row.id} buyValue`).toBe(row.buyValue);
    expect(RECIPE_RESULT_IDS.has(row.id), `${row.id} still has a producing recipe`).toBe(true);
  });

  it('elixir_of_the_bear keeps its Mirefen drop: fen_troll at chance 0.008', () => {
    const rows = (ZONE2_MOBS.fen_troll?.loot ?? []).filter(
      (entry) => entry.itemId === 'elixir_of_the_bear',
    );
    expect(rows.length, 'fen_troll carries exactly one elixir_of_the_bear loot row').toBe(1);
    expect(rows[0]?.chance, 'fen_troll elixir_of_the_bear drop chance').toBe(0.008);
  });

  it('no other vendor lost a row: the total stock row count holds the post-pull ratchet', () => {
    // Conscious ratchet, counted on the live tree: 224 (npc, itemId) vendor
    // stock rows before phase 11n, minus the five rows the phase pulled (four
    // gear rows on smith_haldren, elixir_of_the_bear on alchemist_verane).
    // A future deliberate stock change updates this literal in the same diff.
    let rowCount = 0;
    for (const npc of Object.values(NPCS)) rowCount += (npc.vendorItems ?? []).length;
    expect(rowCount).toBe(219);
  });
});
