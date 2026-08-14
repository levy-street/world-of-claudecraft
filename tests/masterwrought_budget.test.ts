// The Masterwrought apex budget sweep (born in phase 08, grew the phase 09
// gear families): EVERY apex item authored so far has a primary stat sum
// EQUAL to the formula budget, a pinned single-rating allocation at its
// FAMILY band (armor 40, weapons 50, jewelry 25, held/shield 20), the
// masterwrought flag on the counted pieces, and the R2/R12/R14 texture
// (tradable, standard disenchant behavior for the kind, pure stats). The
// EXPECTED tables are deliberately literal: a stat retune, rating swap,
// armor drift, or price change reds here even when the formula would still
// balance (the constant-self-comparison trap: deriving expectations from
// the same tables under test proves nothing). The two completeness arms
// force every future masterwrought def and every apex recipe row into these
// tables, so phase 10 APPENDS rows here in the same change that ships its
// items.
import { describe, expect, it } from 'vitest';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from '../src/sim/content/heroic_loot';
import { APEX_ARMOR_RECIPES, APEX_GEAR_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  primaryStatBudget,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import {
  ARMOR_SECONDARY_BY_TYPE,
  DISENCHANT_MATERIAL_BY_QUALITY,
  typedSecondaryFor,
} from '../src/sim/professions/disenchant_reagents';
import { isDisenchantable } from '../src/sim/professions/enchanting';
import type { EquipSlot, ItemDef, ItemSlot } from '../src/sim/types';

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

// --- Phase 09 gear families -----------------------------------------------
// Same deliberate-literal doctrine as APEX_ARMOR: each row is the hand-checked
// def, with the formula tie asserted as a second arm in its family block.

const APEX_WEAPONS: Record<
  string,
  {
    craft: string;
    twoHand: boolean;
    weapon: { min: number; max: number; speed: number };
    budget: number;
    stats: Record<string, number>;
    rating: [RatingField, number];
    requiredClass: string[];
    sellValue: number;
  }
> = {
  duskforged_warblade: {
    craft: 'weaponcrafting',
    twoHand: false,
    // (30 + 50) / 2 / 2.5 = 16.00 dps, weaponDpsBudget(31) exactly.
    weapon: { min: 30, max: 50, speed: 2.5 },
    budget: 22,
    stats: { str: 13, sta: 9 },
    rating: ['hitRating', 50],
    requiredClass: ['warrior', 'paladin', 'shaman'],
    sellValue: 320,
  },
  ridgebreaker: {
    craft: 'weaponcrafting',
    twoHand: true,
    // (49 + 76) / 2 / 3.4 = 18.38 dps vs the 16.0 x TWOHAND_DPS_MULT = 18.4
    // line; budget 29 = round(22 x TWOHAND_STAT_MULT).
    weapon: { min: 49, max: 76, speed: 3.4 },
    budget: 29,
    stats: { str: 17, sta: 12 },
    rating: ['hitRating', 50],
    requiredClass: ['warrior', 'paladin', 'shaman'],
    sellValue: 340,
  },
};

const APEX_SHIELDS: Record<
  string,
  {
    craft: string;
    armorType: string;
    budget: number;
    stats: Record<string, number>;
    rating: [RatingField, number];
    blockValue: number;
    armor: number;
    requiredClass: string[];
    sellValue: number;
  }
> = {
  duskforged_bulwark: {
    craft: 'weaponcrafting',
    armorType: 'mail',
    budget: 16,
    stats: { sta: 11, str: 5 },
    rating: ['hitRating', 20],
    blockValue: 32,
    // Extrapolated from bonewrought_bulwark (680 at ilvl 29) up 2 ilvls at
    // twice the 13-armor/ilvl epic mail chest slope; re-derived in the block.
    armor: 732,
    requiredClass: ['warrior', 'paladin', 'shaman'],
    sellValue: 300,
  },
};

const APEX_JEWELRY: Record<
  string,
  {
    craft: string;
    // Jewelry declares the abstract 'ring' slot (never a concrete socket).
    slot: ItemSlot;
    budget: number;
    stats: Record<string, number>;
    rating: [RatingField, number];
    sellValue: number;
  }
> = {
  wyrmfall_pendant: {
    craft: 'jewelcrafting',
    slot: 'neck',
    budget: 14,
    stats: { int: 8, sta: 6 },
    rating: ['hasteRating', 25],
    sellValue: 320,
  },
  warhewn_signet: {
    craft: 'jewelcrafting',
    slot: 'ring',
    budget: 13,
    stats: { str: 8, sta: 5 },
    rating: ['hitRating', 25],
    sellValue: 300,
  },
  prismglass_loop: {
    craft: 'jewelcrafting',
    slot: 'ring',
    budget: 13,
    stats: { int: 8, sta: 5 },
    rating: ['hasteRating', 25],
    sellValue: 300,
  },
};

const APEX_HELD: Record<
  string,
  {
    craft: string;
    budget: number;
    stats: Record<string, number>;
    rating: [RatingField, number];
    requiredClass: string[];
    sellValue: number;
  }
> = {
  gyrelens_array: {
    craft: 'engineering',
    budget: 16,
    stats: { int: 10, sta: 6 },
    rating: ['critRating', 20],
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
    sellValue: 340,
  },
  voidbound_grimoire: {
    craft: 'inscription',
    budget: 16,
    stats: { int: 8, spi: 5, sta: 3 },
    rating: ['hasteRating', 20],
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
    sellValue: 340,
  },
};

// The two deliberately UNFLAGGED phase 09 outputs: tools, never counted
// combat power, pinned the way APEX_BAG_ID is below.
const APEX_TOOLS: Record<
  string,
  { craft: string; use: Record<string, unknown>; sellValue: number }
> = {
  masters_field_forge: {
    craft: 'engineering',
    // stationCraftId is a CRAFT id (stationTypeForCraft resolves 'forge').
    use: { type: 'placeMobileStation', stationCraftId: 'weaponcrafting' },
    sellValue: 380,
  },
  makers_charm: {
    craft: 'engineering',
    // Effect id EQUALS the item id (one identity across mint and slot).
    use: { type: 'toolEffect', effectId: 'makers_charm' },
    sellValue: 150,
  },
};

// Every flagged id the phase 09 tables carry, beside the phase 08 armor.
const FLAGGED_TABLE_IDS: readonly string[] = [
  ...Object.keys(APEX_ARMOR),
  ...Object.keys(APEX_WEAPONS),
  ...Object.keys(APEX_SHIELDS),
  ...Object.keys(APEX_JEWELRY),
  ...Object.keys(APEX_HELD),
];

// The uniform per-craft gear bills (the phase 07 demand math again: 3 of the
// craft's own intermediate, 2 Wyrmfall Cores, the craft's gathered family).
const APEX_GEAR_BILLS: Record<string, { itemId: string; count: number }[]> = {
  weaponcrafting: [
    { itemId: 'duskforged_billet', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'thorium_ore', count: 4 },
    { itemId: 'iron_ore', count: 2 },
  ],
  jewelcrafting: [
    { itemId: 'prismglass_setting', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'thorium_ore', count: 4 },
    { itemId: 'arcane_essence', count: 2 },
  ],
  engineering: [
    { itemId: 'precision_chassis', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'ashwood_log', count: 4 },
    { itemId: 'thorium_ore', count: 2 },
  ],
  inscription: [
    { itemId: 'sablewax_vellum', count: 3 },
    { itemId: 'wyrmfall_core', count: 2 },
    { itemId: 'sunpetal_herb', count: 2 },
    { itemId: 'arcane_essence', count: 2 },
    { itemId: 'glass_vial', count: 1 },
  ],
};

// Gear crafts reuse their existing per-craft stations (the wiki station field
// stays unanimous per craft).
const GEAR_STATION_BY_CRAFT: Record<string, string> = {
  weaponcrafting: 'forge',
  jewelcrafting: 'forge',
  engineering: 'toolworks',
  inscription: 'apothecary',
};

// Per-family whole-def key whitelists, the same R14 review-moment device as
// ALLOWED_ARMOR_KEYS: a new field on any apex def must be admitted here
// deliberately. The base set is what every flagged family shares.
const APEX_BASE_KEYS = [
  'id',
  'name',
  'kind',
  'slot',
  'quality',
  'stats',
  'hitRating',
  'critRating',
  'hasteRating',
  'sellValue',
  'masterwrought',
];
const ALLOWED_WEAPON_KEYS = new Set([...APEX_BASE_KEYS, 'hand', 'weapon', 'requiredClass']);
const ALLOWED_SHIELD_KEYS = new Set([
  ...APEX_BASE_KEYS,
  'armorType',
  'shield',
  'blockValue',
  'requiredClass',
]);
// Jewelry admits NOTHING beyond the base set: no armorType, no requiredClass
// (the heroic-vendor jewelry precedent).
const ALLOWED_JEWELRY_KEYS = new Set(APEX_BASE_KEYS);
const ALLOWED_HELD_KEYS = new Set([...APEX_BASE_KEYS, 'requiredClass']);
const ALLOWED_TOOL_KEYS = new Set(['id', 'name', 'kind', 'quality', 'use', 'sellValue']);

// Shared per-family pins. Helpers rather than one mega it.each so each family
// block keeps its own band constants and shape laws readable in place.
function expectFlaggedIdentity(def: ItemDef & Record<string, unknown>, id: string): void {
  expect(def, `${id} must exist in the merged table`).toBeTruthy();
  expect(def.quality).toBe('epic');
  // The equip gate is DERIVED (source 25 clamps to MAX_LEVEL), never a
  // hand-authored field, exactly like the phase 08 armor.
  expect(requiredLevelFor(def)).toBe(20);
  expect(def.requiredLevel).toBeUndefined();
  expect(itemLevel(def)).toBe(31);
  expect(def.masterwrought).toBe(true);
  expect(def.spellPower).toBeUndefined();
  expect(def.pvpOffenseRating).toBeUndefined();
  expect(def.pvpDefenseRating).toBeUndefined();
}

function expectSingleRating(
  def: ItemDef & Record<string, unknown>,
  id: string,
  rating: [RatingField, number],
): void {
  const [field, value] = rating;
  expect(def[field], `${id} ${field}`).toBe(value);
  for (const other of RATING_FIELDS) {
    if (other !== field) expect(def[other], `${id} ${other}`).toBeUndefined();
  }
}

function expectTradableTexture(def: ItemDef & Record<string, unknown>, sellValue: number): void {
  expect(def.soulbound).toBeUndefined();
  expect(def.noMarketList).toBeUndefined();
  expect(def.noDiscard).toBeUndefined();
  expect(def.noVendorSell).toBeUndefined();
  expect(def.sellValue).toBe(sellValue);
}

function expectGearRecipe(id: string, craft: string): void {
  const recipe = APEX_GEAR_RECIPES.find((r) => r.resultItemId === id);
  expect(recipe, `${id} recipe`).toBeTruthy();
  expect(recipe?.id).toBe(`recipe_${id}`);
  expect(recipe?.professionId).toBe(craft);
  expect(recipe?.skillReq).toBe(100);
  expect(recipe?.level).toBe(25);
  expect(recipe?.itemLevelBudget).toBe(25);
  expect(recipe?.resultCount).toBe(1);
  expect(recipe?.acquisition).toEqual(['drop']);
  expect(recipe?.stationType).toBe(GEAR_STATION_BY_CRAFT[craft]);
  expect(recipe?.reagents).toEqual(APEX_GEAR_BILLS[craft]);
  // No daily gate on apex rows (the same reasoning as the armor arm): pacing
  // lives in the catalyst-day bill, so oncePerDay would double-gate the climb.
  expect(recipe?.oncePerDay).toBeUndefined();
}

describe('masterwrought apex budget sweep', () => {
  it('the EXPECTED tables cover exactly the flagged defs (phase 10 appends here)', () => {
    // R6 note: this sweep pins the DEFS; the counted-family cap interplay
    // with the real phase 09 pieces (the 2H, the held offhand) is pinned in
    // tests/masterwrought_cap.test.ts.
    const flagged = Object.values(ITEMS)
      .filter((def) => def.masterwrought)
      .map((def) => def.id)
      .sort();
    // No id may sit in two family tables (a duplicate would make the sorted
    // union equality below pass over a def the wrong family block never ran).
    expect(new Set(FLAGGED_TABLE_IDS).size).toBe(FLAGGED_TABLE_IDS.length);
    expect(flagged).toEqual([...FLAGGED_TABLE_IDS].sort());
  });

  it('every apex recipe output is in a table, plus the unflagged bag and tools', () => {
    const outputs = [...APEX_ARMOR_RECIPES, ...APEX_GEAR_RECIPES].map((r) => r.resultItemId).sort();
    expect(outputs).toEqual([...FLAGGED_TABLE_IDS, APEX_BAG_ID, ...Object.keys(APEX_TOOLS)].sort());
  });

  it.each(Object.entries(APEX_ARMOR))('%s: budget, rating, armor, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expect(def, `${id} must exist in the merged table`).toBeTruthy();

    // Identity and band.
    expect(def.kind).toBe('armor');
    expect(def.slot).toBe(row.slot);
    expect((def as { armorType?: string }).armorType).toBe(row.armorType);
    expect(def.quality).toBe('epic');
    // The equip gate is DERIVED (source 25 clamps to MAX_LEVEL), never a
    // hand-authored field: pin the GATE, and pin that no override crept in.
    expect(requiredLevelFor(def)).toBe(20);
    expect(def.requiredLevel).toBeUndefined();
    expect(itemLevel(def)).toBe(31);
    expect(def.masterwrought).toBe(true);

    // Primary sum EQUALS the formula budget AND the literal (two independent
    // sources: the def literal here, the formula there; either moving reds).
    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(primaries).toEqual(row.stats);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(31, 'epic', row.slot));

    // Exactly ONE rating, at exactly the band's 40, the pinned field. The
    // band tie is live: ARMOR_RATING is what every same-band drop carries,
    // so a band retune reds here instead of leaving the apex set behind.
    const [field, value] = row.rating;
    expect(def[field]).toBe(value);
    for (const other of RATING_FIELDS) {
      if (other !== field) expect(def[other], `${id} ${other}`).toBeUndefined();
    }
    // Both halves on purpose, doing different jobs: the literal is the band
    // LAW pin (a future append must carry 40 even if it invents its own
    // constant), the ARMOR_RATING tie is the drift pin (a band retune reds
    // instead of stranding the apex set). Not a self-comparison.
    expect(value).toBe(40);
    expect(value).toBe(ARMOR_RATING);
    expect(def.spellPower).toBeUndefined();
    expect(def.pvpOffenseRating).toBeUndefined();
    expect(def.pvpDefenseRating).toBeUndefined();
    // The complement rule from the def comments: the rating COMPLEMENTS the
    // same-slot reference drop, never duplicates it.
    expect(
      (ITEMS[row.armorRef] as unknown as Record<string, unknown>)[field],
      `${id} duplicates its reference drop's ${field}`,
    ).toBeUndefined();

    // Armor is COPIED from the same-band same-slot reference, never invented,
    // and the reference's identity is pinned too (same slot, same armor
    // class, same band), so re-pointing armorRef at a coincidentally equal
    // piece cannot pass.
    const ref = ITEMS[row.armorRef] as ItemDef & { armorType?: string };
    expect(ref.slot).toBe(row.slot);
    expect(ref.armorType).toBe(row.armorType);
    expect(ref.quality).toBe('epic');
    expect(itemLevel(ref)).toBe(31);
    expect(armor).toBe(row.armor);
    expect(armor).toBe((ref.stats as Record<string, number>).armor);

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
    // No daily gate on apex rows: pacing lives in the catalyst-day bill, so a
    // oncePerDay creeping onto a row would double-gate the climb.
    expect(recipe?.oncePerDay).toBeUndefined();
  });

  it.each(Object.entries(APEX_WEAPONS))('%s: weapon budget, rating, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expectFlaggedIdentity(def, id);
    expect(def.kind).toBe('weapon');
    expect(def.slot).toBe('mainhand');
    expect(def.hand).toBe(row.twoHand ? 'twohand' : undefined);
    // Class gating mirrors the family reference (gravewyrm_cleaver /
    // greatfang_of_the_basin): the HEAVY plate/mail melee group literal.
    expect(def.requiredClass).toEqual(row.requiredClass);

    // Weapon damage is the pinned literal; the band tie holds realized dps
    // within the per-row quantization ceiling of weaponDpsBudget(31)
    // (x TWOHAND_DPS_MULT for the 2H), not a taste band: integer min/max
    // make the mean a multiple of 0.5, so the closest dps an authored speed
    // can reach is 0.25 / speed off target (0.1 at the fastest shipped
    // speed, 2.5). The 0.05 pad refuses real drift while staying
    // self-maintaining for any future faster row; the shipped 2H sits 0.018
    // off its 18.4 line.
    expect(def.weapon).toEqual(row.weapon);
    const dps = (row.weapon.min + row.weapon.max) / 2 / row.weapon.speed;
    const dpsTarget = weaponDpsBudget(31) * (row.twoHand ? TWOHAND_DPS_MULT : 1);
    expect(Math.abs(dps - dpsTarget)).toBeLessThanOrEqual(0.25 / row.weapon.speed + 0.05);

    // Stats: the literal, then the formula as the independent second arm
    // (expectedStatBudget applies TWOHAND_STAT_MULT for the 2H), then the
    // mainhand-line derivation spelled out so a mult retune reds here.
    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(armor).toBeUndefined();
    expect(primaries).toEqual(row.stats);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(expectedStatBudget(def)).toBe(row.budget);
    expect(row.budget).toBe(
      Math.round(primaryStatBudget(31, 'epic', 'mainhand') * (row.twoHand ? TWOHAND_STAT_MULT : 1)),
    );

    // Exactly one rating at the weapon band's 50. Both halves on purpose:
    // the literal is the band LAW pin, the FIVE_MAN_WEAPON_RATING tie is the
    // drift pin (same division of labor as the armor arm's 40).
    expectSingleRating(def, id, row.rating);
    expect(row.rating[1]).toBe(50);
    expect(row.rating[1]).toBe(FIVE_MAN_WEAPON_RATING);

    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_WEAPON_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // R12: an epic weapon disenchants on the standard ladder; both rows are
    // melee families, and an unclassified weapon also falls back to steel,
    // so this pin is stable across skin-classification changes.
    expect(isDisenchantable(def)).toBe(true);
    expect(typedSecondaryFor(def), id).toBe('resonant_steel');

    expectGearRecipe(id, row.craft);
  });

  it.each(Object.entries(APEX_SHIELDS))('%s: shield budget, rating, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expectFlaggedIdentity(def, id);
    expect(def.kind).toBe('armor');
    expect(def.slot).toBe('offhand');
    expect(def.shield).toBe(true);
    expect((def as { armorType?: string }).armorType).toBe(row.armorType);
    // The bonewrought_bulwark gate.
    expect(def.requiredClass).toEqual(row.requiredClass);

    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(primaries).toEqual(row.stats);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(31, 'epic', 'offhand'));

    // blockValue extrapolates the hand-authored shield ladder (buckler 6,
    // Wallshield 14, bonewrought_bulwark 30 at ilvl 29) to ilvl 31.
    expect(def.blockValue).toBe(row.blockValue);
    expect(row.blockValue).toBe(32);
    // Armor is EXTRAPOLATED, never copied (no same-slot ilvl-31 reference
    // exists): bonewrought_bulwark's 680 at ilvl 29, up 2 ilvls at 26/ilvl
    // (twice the 13-armor/ilvl epic mail chest slope, the 2x-chest shield
    // rule). The reference's identity is pinned so a bulwark retune reds
    // here and forces a re-derivation instead of leaving 732 orphaned.
    const ref = ITEMS.bonewrought_bulwark as ItemDef & { armorType?: string };
    expect(ref.slot).toBe('offhand');
    expect(ref.armorType).toBe(row.armorType);
    expect(itemLevel(ref)).toBe(29);
    expect((ref.stats as Record<string, number>).armor).toBe(680);
    expect(armor).toBe(row.armor);
    expect(row.armor).toBe(680 + 2 * 26);

    // The held/shield band: one rating at 20; physical tank identity is Hit
    // (threat). Both halves: the literal 20 is the band LAW pin, the
    // bonewrought_bulwark tie is the provenance drift pin.
    expectSingleRating(def, id, row.rating);
    expect(row.rating[1]).toBe(20);
    expect(row.rating[1]).toBe((ref as unknown as Record<string, unknown>).hitRating);

    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_SHIELD_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // R12: mail armor, so the standard shard plus the mail weave.
    expect(isDisenchantable(def)).toBe(true);
    expect(typedSecondaryFor(def), id).toBe('resonant_links');

    expectGearRecipe(id, row.craft);
  });

  it.each(Object.entries(APEX_JEWELRY))('%s: jewelry budget, rating, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expectFlaggedIdentity(def, id);
    expect(def.kind).toBe('armor');
    expect(def.slot).toBe(row.slot);
    // The heroic-vendor jewelry shape law: no armor class, no armor value,
    // no class lock, and exactly two stats (a primary plus stamina).
    expect((def as { armorType?: string }).armorType).toBeUndefined();
    expect(def.requiredClass).toBeUndefined();
    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(armor).toBeUndefined();
    expect(primaries).toEqual(row.stats);
    expect(Object.keys(row.stats)).toHaveLength(2);
    expect(row.stats.sta).toBeGreaterThan(0);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(31, 'epic', row.slot));

    // Exactly one rating at the jewelry band's 25. heroic_vendor.ts keeps
    // JEWELRY_RATING module-private, so the literal is pinned here with the
    // live tie to a vendor row (zense_meridian carries the same constant):
    // the literal is the band LAW pin, the vendor tie the drift pin.
    expectSingleRating(def, id, row.rating);
    expect(row.rating[1]).toBe(25);
    expect(row.rating[1]).toBe(
      (ITEMS.zense_meridian as unknown as Record<string, unknown>).critRating,
    );

    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_JEWELRY_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // R12: jewelry is disenchantable armor but carries no armor class, so
    // the yield is the shard alone (the documented no-weave fall-through).
    expect(isDisenchantable(def)).toBe(true);
    expect(typedSecondaryFor(def), id).toBeNull();

    expectGearRecipe(id, row.craft);
  });

  it.each(Object.entries(APEX_HELD))('%s: held-offhand budget, rating, and texture', (id, row) => {
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expectFlaggedIdentity(def, id);
    expect(def.kind).toBe('held_offhand');
    expect(def.slot).toBe('offhand');
    // occupiesHand defaults true: these price on the HELD 0.75 offhand line,
    // never the worn 0.45 one (WORN_OFFHAND_STAT_MULT); a def gaining the
    // key must also be admitted through the whitelist below.
    expect(def.occupiesHand).toBeUndefined();
    // The wraithfire_orb gate: the caster weapon-proficiency group literal.
    expect(def.requiredClass).toEqual(row.requiredClass);

    const { armor, ...primaries } = def.stats as Record<string, number>;
    expect(armor).toBeUndefined();
    expect(primaries).toEqual(row.stats);
    expect(primaryStatSum(def)).toBe(row.budget);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(31, 'epic', 'offhand'));

    // The held/shield band: one rating at 20. Both halves: the literal is
    // the band LAW pin, the wraithfire_orb tie the provenance drift pin.
    expectSingleRating(def, id, row.rating);
    expect(row.rating[1]).toBe(20);
    expect(row.rating[1]).toBe(
      (ITEMS.wraithfire_orb as unknown as Record<string, unknown>).critRating,
    );

    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_HELD_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // Held offhands sit OUTSIDE the disenchant kind gate (weapon/armor
    // only), the shipped wraithfire_orb behavior, so R12 has no yield arm
    // here; this pin reds if enchanting.ts ever widens the gate, forcing a
    // conscious re-decision for the family.
    expect(isDisenchantable(def)).toBe(false);

    expectGearRecipe(id, row.craft);
  });

  it('R12: apex epics disenchant to the standard arcane shard', () => {
    expect(DISENCHANT_MATERIAL_BY_QUALITY.epic).toBe('arcane_shard');
    // The weave mapping itself pinned literally, so the routing arm below is
    // never the same table on both sides of its own expectation.
    expect(ARMOR_SECONDARY_BY_TYPE).toEqual({
      cloth: 'resonant_thread',
      leather: 'resonant_hide',
      mail: 'resonant_links',
    });
    // The quality row alone predates this phase, so pin the whole R12
    // surface per def: each apex piece is actually disenchantable (the kind
    // gate) and yields its armor class's standard typed secondary beside
    // the shard, the ordinary epic-armor behavior R12 rides on.
    for (const [id, row] of Object.entries(APEX_ARMOR)) {
      const def = ITEMS[id];
      expect(isDisenchantable(def), id).toBe(true);
      expect(typedSecondaryFor(def), id).toBe(ARMOR_SECONDARY_BY_TYPE[row.armorType]);
    }
  });

  it('the rating spread complements the drops: one Hit piece, crit and haste fill', () => {
    const counts = { hitRating: 0, critRating: 0, hasteRating: 0 };
    for (const row of Object.values(APEX_ARMOR)) counts[row.rating[0]] += 1;
    expect(counts).toEqual({ hitRating: 1, critRating: 5, hasteRating: 3 });
    // The phase 09 families shift the whole-set spread deliberately: both
    // weapons and the shield carry Hit (the weapon band identity and the
    // tank threat line), jewelry leans haste (the vendor set's missing
    // lines), the held pair splits crit/haste. Pinned as the union so a
    // family retune re-cuts this table beside the defs.
    const all = { hitRating: 0, critRating: 0, hasteRating: 0 };
    const familyRows: { rating: [RatingField, number] }[] = [
      ...Object.values(APEX_ARMOR),
      ...Object.values(APEX_WEAPONS),
      ...Object.values(APEX_SHIELDS),
      ...Object.values(APEX_JEWELRY),
      ...Object.values(APEX_HELD),
    ];
    for (const row of familyRows) all[row.rating[0]] += 1;
    expect(all).toEqual({ hitRating: 5, critRating: 6, hasteRating: 6 });
  });

  it('the apex bag: best capacity in the game, epic, tradable, NOT masterwrought', () => {
    const bag = ITEMS[APEX_BAG_ID] as ItemDef & Record<string, unknown>;
    expect(bag.kind).toBe('bag');
    expect(bag.quality).toBe('epic');
    expect(bag.bagSlots).toBe(16);
    // The same whole-def key whitelist treatment as the armor pieces: any
    // new field (a bind, a market ban, an effect) must be admitted here.
    const ALLOWED_BAG_KEYS = new Set(['id', 'name', 'kind', 'quality', 'bagSlots', 'sellValue']);
    for (const key of Object.keys(bag)) {
      expect(ALLOWED_BAG_KEYS.has(key), `${APEX_BAG_ID} carries unexpected field ${key}`).toBe(
        true,
      );
    }
    expect(bag.masterwrought).toBeUndefined();
    expect(bag.soulbound).toBeUndefined();
    expect(bag.noMarketList).toBeUndefined();
    expect(bag.stats).toBeUndefined();
    for (const field of RATING_FIELDS) expect(bag[field]).toBeUndefined();
    expect(itemLevel(bag), 'bags are not item-level eligible').toBeUndefined();
    // The bag sits outside R12: kind 'bag' fails the disenchant kind gate, and
    // this pin reds if enchanting.ts ever widens that gate past weapon/armor.
    expect(isDisenchantable(bag)).toBe(false);
    // Strictly the largest bag: every other bag def sits below 16 slots.
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'bag' || def.id === APEX_BAG_ID) continue;
      expect(def.bagSlots ?? 0, `${def.id} must stay below the apex bag`).toBeLessThan(16);
    }
    const recipe = APEX_ARMOR_RECIPES.find((r) => r.resultItemId === APEX_BAG_ID);
    expect(recipe?.id).toBe(`recipe_${APEX_BAG_ID}`);
    expect(recipe?.professionId).toBe('tailoring');
    expect(recipe?.skillReq).toBe(100);
    expect(recipe?.level).toBe(25);
    expect(recipe?.itemLevelBudget).toBe(25);
    expect(recipe?.resultCount).toBe(1);
    expect(recipe?.stationType).toBe('loom');
    expect(recipe?.acquisition).toEqual(['drop']);
    expect(recipe?.reagents).toEqual(APEX_BILLS.tailoring);
    expect(recipe?.oncePerDay).toBeUndefined();
  });

  it.each(Object.entries(APEX_TOOLS))('%s: unflagged tool, epic, tradable', (id, row) => {
    // The bag treatment for the two phase 09 tools: full identity, band, R2
    // texture, R12 position, and recipe pins, with the flag ABSENCE the
    // point (a tool is never counted combat power).
    const def = ITEMS[id] as ItemDef & Record<string, unknown>;
    expect(def, `${id} must exist in the merged table`).toBeTruthy();
    expect(def.kind).toBe('tool');
    expect(def.quality).toBe('epic');
    expect(def.masterwrought).toBeUndefined();
    // The whole use payload pinned literally: the forge's stationCraftId is
    // a CRAFT id (stationTypeForCraft resolves the station type), and the
    // charm's effect id equals its item id.
    expect(def.use).toEqual(row.use);
    expect(def.stats).toBeUndefined();
    for (const field of RATING_FIELDS) expect(def[field]).toBeUndefined();
    // Tools are not item-level eligible (no slot, non-combat kind).
    expect(itemLevel(def)).toBeUndefined();
    // Outside R12: kind 'tool' fails the disenchant kind gate, like the bag.
    expect(isDisenchantable(def)).toBe(false);
    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_TOOL_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }
    expectGearRecipe(id, row.craft);
  });

  it('economy: every apex output vendors strictly below its reagent input value', () => {
    // recipe_economy.test.ts owns the invariant repo-wide; this arm keeps the
    // apex slice self-contained so a phase 09/10 row appended to the table
    // cannot ship priced above its bill even if the sweep list there drifts.
    for (const recipe of [...APEX_ARMOR_RECIPES, ...APEX_GEAR_RECIPES]) {
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
