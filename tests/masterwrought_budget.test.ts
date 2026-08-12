// The Masterwrought apex budget sweep (born in phase 08, grows with 09/10):
// EVERY apex item authored so far has a primary stat sum EQUAL to the
// formula budget, a pinned single-rating allocation at the band's 40, the
// masterwrought flag, and the R2/R12/R14 texture (tradable, standard epic
// disenchant, pure stats). The EXPECTED table is deliberately literal: a
// stat retune, rating swap, armor drift, or price change reds here even
// when the formula would still balance (the constant-self-comparison trap:
// deriving expectations from the same tables under test proves nothing).
// The two completeness arms force every future masterwrought def and every
// APEX_ARMOR_RECIPES row into this table, so phases 09/10 APPEND rows here
// in the same change that ships their items.
import { describe, expect, it } from 'vitest';
import { primaryStatBudget } from '../src/sim/item_budget';
import { itemLevel, primaryStatSum } from '../src/sim/item_level';
import { APEX_ARMOR_RECIPES } from '../src/sim/content/recipes';
import { DISENCHANT_MATERIAL_BY_QUALITY } from '../src/sim/professions/disenchant_reagents';
import { ITEMS } from '../src/sim/data';
import type { EquipSlot, ItemDef } from '../src/sim/types';

type RatingField = 'hitRating' | 'critRating' | 'hasteRating';
const RATING_FIELDS: readonly RatingField[] = ['hitRating', 'critRating', 'hasteRating'];

// Every key an apex ARMOR def is allowed to carry. R14's hard bind: pure
// stats plus one rating, no procs, effects, on-use, or set membership. A new
// field on an apex def (even a harmless-looking one) must be added here
// deliberately, which is exactly the review moment R14 wants.
const ALLOWED_ARMOR_KEYS = new Set([
  'id',
  'name',
  'kind',
  'armorType',
  'slot',
  'quality',
  'requiredLevel',
  'stats',
  'hitRating',
  'critRating',
  'hasteRating',
  'sellValue',
  'masterwrought',
]);

const APEX_ARMOR: Record<
  string,
  {
    craft: string;
    slot: EquipSlot;
    armorType: string;
    budget: number;
    stats: Record<string, number>;
    rating: [RatingField, number];
    armor: number;
    armorRef: string;
    sellValue: number;
  }
> = {
  spiritweld_girdle: {
    craft: 'armorcrafting',
    slot: 'waist',
    armorType: 'mail',
    budget: 15,
    stats: { int: 9, spi: 6 },
    rating: ['critRating', 40],
    armor: 224,
    armorRef: 'gravescale_girdle',
    sellValue: 300,
  },
  forgefold_legguards: {
    craft: 'armorcrafting',
    slot: 'legs',
    armorType: 'mail',
    budget: 20,
    stats: { str: 11, sta: 9 },
    rating: ['critRating', 40],
    armor: 315,
    armorRef: 'bloodmane_war_legguards',
    sellValue: 320,
  },
  wardspeaker_sabatons: {
    craft: 'armorcrafting',
    slot: 'feet',
    armorType: 'mail',
    budget: 14,
    stats: { int: 8, spi: 6 },
    rating: ['hasteRating', 40],
    armor: 212,
    armorRef: 'tideworn_warboots',
    sellValue: 280,
  },
  briarstep_jerkin: {
    craft: 'leatherworking',
    slot: 'chest',
    armorType: 'leather',
    budget: 22,
    stats: { agi: 13, sta: 9 },
    rating: ['critRating', 40],
    armor: 172,
    armorRef: 'basin_stalkers_tunic',
    sellValue: 175,
  },
  fenbloom_breeches: {
    craft: 'leatherworking',
    slot: 'legs',
    armorType: 'leather',
    budget: 20,
    stats: { int: 12, spi: 8 },
    rating: ['hasteRating', 40],
    armor: 132,
    armorRef: 'tidewoven_trousers',
    sellValue: 160,
  },
  barksong_handguards: {
    craft: 'leatherworking',
    slot: 'gloves',
    armorType: 'leather',
    budget: 15,
    stats: { int: 9, spi: 6 },
    rating: ['critRating', 40],
    armor: 104,
    armorRef: 'sanctum_prowlers_grips',
    sellValue: 140,
  },
  sunspun_vestments: {
    craft: 'tailoring',
    slot: 'chest',
    armorType: 'cloth',
    budget: 22,
    stats: { int: 12, spi: 10 },
    rating: ['hitRating', 40],
    armor: 90,
    armorRef: 'shroud_of_the_gravewyrm',
    sellValue: 200,
  },
  sunspun_leggings: {
    craft: 'tailoring',
    slot: 'legs',
    armorType: 'cloth',
    budget: 20,
    stats: { int: 12, spi: 8 },
    rating: ['hasteRating', 40],
    armor: 72,
    armorRef: 'lunar_choir_leggings',
    sellValue: 190,
  },
  sunspun_handwraps: {
    craft: 'tailoring',
    slot: 'gloves',
    armorType: 'cloth',
    budget: 15,
    stats: { int: 9, spi: 6 },
    rating: ['critRating', 40],
    armor: 52,
    armorRef: 'shadowpulse_handwraps',
    sellValue: 170,
  },
};

// The apex reagent bill per craft: exactly 3 of the profession's own
// intermediate (the phase 07 demand-math law: one piece = 3 catalyst-days),
// 2 Wyrmfall Cores, and the craft's gathered family, quantities recorded in
// the state.md phase 08 ledger.
const APEX_BILLS: Record<string, { itemId: string; count: number }[]> = {
  armorcrafting: [
    { itemId: 'forgefold_plating', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'thorium_ore', count: 4 },
    { itemId: 'iron_ore', count: 2 },
  ],
  leatherworking: [
    { itemId: 'wyrmhide_cording', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'rough_hide', count: 4 },
    { itemId: 'pristine_hide', count: 1 },
  ],
  tailoring: [
    { itemId: 'sunspun_bolt', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'spider_silk', count: 4 },
    { itemId: 'pristine_silk', count: 1 },
  ],
};

const STATION_BY_CRAFT: Record<string, string> = {
  armorcrafting: 'forge',
  leatherworking: 'tannery',
  tailoring: 'loom',
};

const APEX_BAG_ID = 'sunspun_haversack';

describe('masterwrought apex budget sweep', () => {
  it('the EXPECTED table covers exactly the flagged defs (phases 09/10 append here)', () => {
    const flagged = Object.values(ITEMS)
      .filter((def) => def.masterwrought)
      .map((def) => def.id)
      .sort();
    expect(flagged).toEqual(Object.keys(APEX_ARMOR).sort());
  });

  it('every apex recipe output is in the table, plus the unflagged bag', () => {
    const outputs = APEX_ARMOR_RECIPES.map((r) => r.resultItemId).sort();
    expect(outputs).toEqual([...Object.keys(APEX_ARMOR), APEX_BAG_ID].sort());
  });

  it.each(Object.entries(APEX_ARMOR))('%s: budget, rating, armor, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expect(def, `${id} must exist in the merged table`).toBeTruthy();

    // Identity and band.
    expect(def.kind).toBe('armor');
    expect(def.slot).toBe(row.slot);
    expect((def as { armorType?: string }).armorType).toBe(row.armorType);
    expect(def.quality).toBe('epic');
    expect(def.requiredLevel).toBe(20);
    expect(itemLevel(def)).toBe(31);
    expect(def.masterwrought).toBe(true);

    // Primary sum EQUALS the formula budget AND the literal (two independent
    // sources: the def literal here, the formula there; either moving reds).
    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(primaries).toEqual(row.stats);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(31, 'epic', row.slot));

    // Exactly ONE rating, at exactly the band's 40, the pinned field.
    const [field, value] = row.rating;
    expect(def[field]).toBe(value);
    for (const other of RATING_FIELDS) {
      if (other !== field) expect(def[other], `${id} ${other}`).toBeUndefined();
    }
    expect(value).toBe(40);
    expect(def.spellPower).toBeUndefined();
    expect(def.pvpOffenseRating).toBeUndefined();
    expect(def.pvpDefenseRating).toBeUndefined();

    // Armor is COPIED from the same-band same-slot reference, never invented.
    expect(armor).toBe(row.armor);
    expect(armor).toBe((ITEMS[row.armorRef].stats as Record<string, number>).armor);

    // R2 tradable texture: no binding or market bans of any kind.
    expect(def.soulbound).toBeUndefined();
    expect(def.noMarketList).toBeUndefined();
    expect(def.noDiscard).toBeUndefined();
    expect(def.noVendorSell).toBeUndefined();
    expect(def.sellValue).toBe(row.sellValue);

    // R14: pure stats. Whole-def key whitelist so ANY new field (a proc, an
    // effect, an on-use, a set) must be admitted here deliberately.
    for (const key of Object.keys(def)) {
      expect(ALLOWED_ARMOR_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // The recipe row: skill 100 rung, level 25 (ilvl 31 via the epic bonus),
    // drop acquisition per R8, the craft's station, and the exact bill.
    const recipe = APEX_ARMOR_RECIPES.find((r) => r.resultItemId === id);
    expect(recipe, `${id} recipe`).toBeTruthy();
    expect(recipe?.id).toBe(`recipe_${id}`);
    expect(recipe?.professionId).toBe(row.craft);
    expect(recipe?.skillReq).toBe(100);
    expect(recipe?.level).toBe(25);
    expect(recipe?.itemLevelBudget).toBe(25);
    expect(recipe?.resultCount).toBe(1);
    expect(recipe?.acquisition).toEqual(['drop']);
    expect(recipe?.stationType).toBe(STATION_BY_CRAFT[row.craft]);
    expect(recipe?.reagents).toEqual(APEX_BILLS[row.craft]);
  });

  it('R12: apex epics disenchant to the standard arcane shard', () => {
    // The disenchant table is keyed on quality alone, so pinning the epic row
    // plus every def's epic quality (above) is the whole R12 surface.
    expect(DISENCHANT_MATERIAL_BY_QUALITY.epic).toBe('arcane_shard');
  });

  it('the rating spread complements the drops: one Hit piece, crit and haste fill', () => {
    const counts = { hitRating: 0, critRating: 0, hasteRating: 0 };
    for (const row of Object.values(APEX_ARMOR)) counts[row.rating[0]] += 1;
    expect(counts).toEqual({ hitRating: 1, critRating: 5, hasteRating: 3 });
  });

  it('the apex bag: best capacity in the game, epic, tradable, NOT masterwrought', () => {
    const bag = ITEMS[APEX_BAG_ID] as ItemDef & Record<string, unknown>;
    expect(bag.kind).toBe('bag');
    expect(bag.quality).toBe('epic');
    expect(bag.bagSlots).toBe(16);
    expect(bag.masterwrought).toBeUndefined();
    expect(bag.soulbound).toBeUndefined();
    expect(bag.noMarketList).toBeUndefined();
    expect(bag.stats).toBeUndefined();
    for (const field of RATING_FIELDS) expect(bag[field]).toBeUndefined();
    expect(itemLevel(bag), 'bags are not item-level eligible').toBeUndefined();
    // Strictly the largest bag: every other bag def sits below 16 slots.
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'bag' || def.id === APEX_BAG_ID) continue;
      expect(def.bagSlots ?? 0, `${def.id} must stay below the apex bag`).toBeLessThan(16);
    }
    const recipe = APEX_ARMOR_RECIPES.find((r) => r.resultItemId === APEX_BAG_ID);
    expect(recipe?.professionId).toBe('tailoring');
    expect(recipe?.skillReq).toBe(100);
    expect(recipe?.acquisition).toEqual(['drop']);
    expect(recipe?.reagents).toEqual(APEX_BILLS.tailoring);
  });

  it('economy: every apex output vendors strictly below its reagent input value', () => {
    // recipe_economy.test.ts owns the invariant repo-wide; this arm keeps the
    // apex slice self-contained so a phase 09/10 row appended to the table
    // cannot ship priced above its bill even if the sweep list there drifts.
    for (const recipe of APEX_ARMOR_RECIPES) {
      const input = recipe.reagents.reduce((sum, r) => {
        const def = ITEMS[r.itemId];
        const unit =
          def.buyValue !== undefined && def.buyValue > 0 ? def.buyValue : (def.sellValue ?? 0);
        return sum + unit * r.count;
      }, 0);
      const output = (ITEMS[recipe.resultItemId].sellValue ?? 0) * recipe.resultCount;
      expect(output, `${recipe.id} output ${output} vs input ${input}`).toBeLessThan(input);
    }
  });
});
