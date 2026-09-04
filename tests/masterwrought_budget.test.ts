// The Masterwrought apex budget sweep (born in phase 08, grew the phase 09
// gear families, then the phase 10 consumables and capstones): EVERY apex item
// authored so far has a primary stat sum
// EQUAL to the formula budget, a pinned single-rating allocation at its
// FAMILY band (armor 40, weapons 50, jewelry 25, held/shield 20), the
// masterwrought flag on the counted pieces, and the R2/R12/R14 texture
// (tradable, standard disenchant behavior for the kind, pure stats). The
// EXPECTED tables are deliberately literal: a stat retune, rating swap,
// armor drift, or price change reds here even when the formula would still
// balance (the constant-self-comparison trap: deriving expectations from
// the same tables under test proves nothing). The two completeness arms
// force every future masterwrought def and every apex recipe row into these
// tables, so a later phase APPENDS rows here in the same change that ships its
// items. Not every apex output is FLAGGED: the bag, the tools, and the phase 10
// consumables carry no worn power, so they are pinned in their own tables and
// the flag's ABSENCE is part of what each of those arms asserts.
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
} from '../src/sim/content/recipes';
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
import { perfectedBonusStats } from '../src/sim/professions/perfecting';
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
    // Haste since Phase 15: Hit converts at twice the rate of crit and haste,
    // and this def clones the caster BiS chest exactly, so Hit here made it
    // the sole source of the scarcest double-value rating in the biggest
    // slot. Haste still complements the reference's crit.
    rating: ['hasteRating', 40],
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
// intermediate (one piece = 3 catalyst-days), 2 Wyrmfall Cores, and the
// craft's gathered family. These literals are the shipped per-craft budget.
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
    // Both mitigation numbers MATCH bonewrought_bulwark since Phase 15; they
    // extrapolated past it before (30 -> 32, 680 -> 732) and produced the
    // game's best shield, because the heroic variant generator freezes armor
    // and blockValue so heroic_bonewrought_bulwark still reads 30 / 680 at
    // ilvl 33. Re-derived in the block below against BOTH references.
    blockValue: 30,
    armor: 680,
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

// The two phase 10 consumable bills, one per craft: the consumable idiom is a
// BATCH output off ONE of the craft's intermediate, where the gear rungs take
// three for a single piece.
//
// THE TWO FAMILIES NO LONGER SHARE THEIR SHAPE, and this pin is where the
// amended uniform-bill rule is expressed rather than described (masterwrought
// Phase 11h, 11h-GATE-A). The flask family stays BYTE-IDENTICAL, so one shared
// constant still serves all three rows. The FOOD family differs by EXACTLY ONE
// CROP ROW, so its shared constant is now a BASE that each plate appends its
// own crop to. Written this way on purpose: a fourth plate, or a second
// difference on any of the three, cannot be expressed without editing the
// helper, which is the amendment's scope made structural instead of trusted.
const FLASK_BILL: { itemId: string; count: number }[] = [
  { itemId: 'quickening_catalyst', count: 1 },
  { itemId: 'pristine_venom_gland', count: 1 },
  { itemId: 'venom_gland', count: 2 },
  { itemId: 'sunpetal_herb', count: 2 },
  // masterwrought Phase 11h's tier-3 grain, identical on all three flasks.
  { itemId: 'highland_barley', count: 1 },
  { itemId: 'glass_vial', count: 1 },
];
/** The FIVE reagents every role plate shares, in shipped order, with the ONE
 *  crop row spliced in at the position the bills author it (after the meats,
 *  before the herb). Every plate is those five plus exactly one entry.
 *  (The count read "four" until the Phase 11h QA; the shared set is
 *  seasoned_stock, prime_cut, game_meat, sunpetal_herb and cooking_salt, and
 *  tests/provisioning_supply_line_apex.test.ts asserts five one file over.) */
const roleFoodBill = (cropId: string, count: number): { itemId: string; count: number }[] => [
  { itemId: 'seasoned_stock', count: 1 },
  { itemId: 'prime_cut', count: 2 },
  { itemId: 'game_meat', count: 4 },
  { itemId: cropId, count },
  { itemId: 'sunpetal_herb', count: 2 },
  { itemId: 'cooking_salt', count: 2 },
  // masterwrought Phase 11i's uniform fish row, appended to all three plates
  // (and to the hearth below). It sits in the SHARED half of the bill, not the
  // differing half: the crop row is what tells the three plates apart, the fish
  // row is identical on every one of them.
  { itemId: 'raw_deepbarb_catfish', count: 4 },
];

// masterwrought Phase 11i's three angler outputs, named as their own group.
// They ride APEX_CONSUMABLE_RECIPES (they are drop-taught apex cooking rows)
// but they are NOT phase-10 consumables and the arms over APEX_CONSUMABLES
// above pin phase-10 shapes, so they are censused here instead: two plain rare
// dishes with no payload at all and one placeable epic feast whose payload is
// another dish's. masterwrought R14 is why they carry no power of their own.
const ANGLER_OUTPUTS = ['peppered_deepbarb_catfish', 'roast_hollowgill_sturgeon'] as const;

// masterwrought Phase 11k's apex feast tier, which REPLACED Phase 11i's single
// capstone feast (that id and its recipe are retired, not moved). Their own
// list rather than an ANGLER_OUTPUTS append, because they belong to the
// provisioning capstone rather than to the angler block: each carries NO power
// of its own and serves a shipped apex plate through feast.dishItemId, which is
// masterwrought R14 satisfied by construction rather than by a magnitude check.
const APEX_FEAST_OUTPUTS = ['stonepot_feast', 'warspice_feast', 'sageleaf_feast'] as const;

// The five no-power outputs' sell values, as LITERALS. The whole-def arm below
// used to pass `def.sellValue` as its own expected value, which is the constant
// self-comparison trap: the key was whitelisted and the value unpinned, so any
// number passed. Two of the five had no exact pin anywhere.
const NO_POWER_SELL_VALUES: Record<string, number> = {
  peppered_deepbarb_catfish: 75,
  roast_hollowgill_sturgeon: 150,
  stonepot_feast: 300,
  warspice_feast: 300,
  sageleaf_feast: 300,
};

// The deliberately UNFLAGGED tool outputs: tools, never counted combat power,
// pinned the way APEX_BAG_ID is below. The phase 09 pair came off
// APEX_GEAR_RECIPES at skillReq 100; the phase 10 capstones off
// APEX_CONSUMABLE_RECIPES at skillReq 125, which is why each row names its own
// recipe array and skill rung rather than inheriting one.
const APEX_TOOLS: Record<
  string,
  {
    craft: string;
    use: Record<string, unknown>;
    sellValue: number;
    recipes: typeof APEX_GEAR_RECIPES;
    skillReq: number;
    stationType: string;
    reagents: { itemId: string; count: number }[];
  }
> = {
  masters_field_forge: {
    craft: 'engineering',
    // stationCraftId is a CRAFT id (stationTypeForCraft resolves 'forge').
    use: { type: 'placeMobileStation', stationCraftId: 'weaponcrafting' },
    sellValue: 380,
    recipes: APEX_GEAR_RECIPES,
    skillReq: 100,
    stationType: 'toolworks',
    reagents: [
      { itemId: 'precision_chassis', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'thorium_ore', count: 2 },
    ],
  },
  makers_charm: {
    craft: 'engineering',
    // Effect id EQUALS the item id (one identity across mint and slot).
    use: { type: 'toolEffect', effectId: 'makers_charm' },
    sellValue: 150,
    recipes: APEX_GEAR_RECIPES,
    skillReq: 100,
    stationType: 'toolworks',
    reagents: [
      { itemId: 'precision_chassis', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'thorium_ore', count: 2 },
    ],
  },
  // The phase 10 capstones: pure mobile_station family reuse, one rung above
  // everything else in the game. stationCraftId is again a CRAFT id, so
  // stationTypeForCraft resolves apothecary and kitchens respectively.
  grand_cauldron: {
    craft: 'alchemy',
    use: { type: 'placeMobileStation', stationCraftId: 'alchemy' },
    sellValue: 380,
    recipes: APEX_CONSUMABLE_RECIPES,
    skillReq: 125,
    stationType: 'apothecary',
    reagents: [
      { itemId: 'quickening_catalyst', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      // masterwrought Phase 11h's tier-4 showcase pair (11h-GATE-D).
      { itemId: 'gilded_sunmelon', count: 2 },
      { itemId: 'fine_gilded_sunmelon', count: 1 },
      { itemId: 'sunpetal_herb', count: 4 },
      { itemId: 'goldleaf_herb', count: 2 },
    ],
  },
  laden_hearth: {
    craft: 'cooking',
    use: { type: 'placeMobileStation', stationCraftId: 'cooking' },
    sellValue: 380,
    recipes: APEX_CONSUMABLE_RECIPES,
    skillReq: 125,
    stationType: 'kitchens',
    // EIGHT entries: seven at masterwrought Phase 11h, then 11i's uniform fish
    // row. It held the longest bill ALONE until Phase 11k, whose three apex
    // role feasts TIE it at eight; the four holders are enumerated in
    // tests/provisioning_supply_line_apex.test.ts and the wiki prose says "one
    // of the longest bills" for the same reason.
    reagents: [
      { itemId: 'seasoned_stock', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'prime_cut', count: 4 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'evergarden_greens', count: 2 },
      { itemId: 'fine_evergarden_greens', count: 1 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'raw_deepbarb_catfish', count: 4 },
    ],
  },
};

// The phase 10 apex CONSUMABLES: the alchemy flasks and the cooking role
// foods. Unflagged like the tools and the bag (a consumable is not worn power),
// so they are pinned here rather than in the flagged family tables. Values are
// literal for the same reason every table above is: a retune must red here.
const APEX_CONSUMABLES: Record<
  string,
  {
    craft: string;
    kind: string;
    resultCount: number;
    stationType: string;
    sellValue: number;
    // The flask payload (kind 'flask') or the wellFed payload (kind 'food').
    effect: { aura: string; kind: string; value: number; duration: number };
    foodHp?: number;
    reagents: { itemId: string; count: number }[];
  }
> = {
  ironhusk_flask: {
    craft: 'alchemy',
    kind: 'flask',
    resultCount: 2,
    stationType: 'apothecary',
    sellValue: 25,
    effect: { aura: 'Ironhusk Vigor', kind: 'buff_sta', value: 13, duration: 1200 },
    reagents: FLASK_BILL,
  },
  warboar_flask: {
    craft: 'alchemy',
    kind: 'flask',
    resultCount: 2,
    stationType: 'apothecary',
    sellValue: 25,
    effect: { aura: 'Warboar Might', kind: 'buff_ap', value: 13, duration: 1200 },
    reagents: FLASK_BILL,
  },
  runewater_flask: {
    craft: 'alchemy',
    kind: 'flask',
    resultCount: 2,
    stationType: 'apothecary',
    sellValue: 25,
    effect: { aura: 'Runewater Clarity', kind: 'buff_int', value: 13, duration: 1200 },
    reagents: FLASK_BILL,
  },
  stonepot_stew: {
    craft: 'cooking',
    kind: 'food',
    resultCount: 4,
    stationType: 'kitchens',
    sellValue: 90,
    effect: { aura: 'Well Fed', kind: 'buff_sta', value: 6, duration: 900 },
    foodHp: 1392,
    // The TANK plate's own crop (masterwrought Phase 11h, 11h-GATE-B).
    reagents: roleFoodBill('frost_gourd', 2),
  },
  warspice_skewers: {
    craft: 'cooking',
    kind: 'food',
    resultCount: 4,
    stationType: 'kitchens',
    sellValue: 90,
    effect: { aura: 'Well Fed', kind: 'buff_ap', value: 6, duration: 900 },
    foodHp: 1392,
    // The PHYSICAL plate's own crop.
    reagents: roleFoodBill('highland_barley', 2),
  },
  sageleaf_chowder: {
    craft: 'cooking',
    kind: 'food',
    resultCount: 4,
    stationType: 'kitchens',
    sellValue: 90,
    effect: { aura: 'Well Fed', kind: 'buff_int', value: 6, duration: 900 },
    foodHp: 1392,
    // The CASTER plate's own crop, the tier-3 leaf.
    reagents: roleFoodBill('thornpeak_cabbage', 2),
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
// The consumable families' own whole-def whitelists, the same review-moment
// device. A flask carries its effect payload under `elixir` (the shipped family
// field it deliberately reuses); a role food carries the sit-down restore plus
// the separate `wellFed` payload. Neither may grow a stat line, a rating, a
// bind, or a market ban without being admitted here.
const ALLOWED_FLASK_KEYS = new Set(['id', 'name', 'kind', 'quality', 'elixir', 'sellValue']);
const ALLOWED_ROLE_FOOD_KEYS = new Set([
  'id',
  'name',
  'kind',
  'quality',
  'foodHp',
  'wellFed',
  'sellValue',
]);
// The two remaining apex-output families' whitelists, added at Phase 15 because
// the power audit found them the only apex outputs with no power pin of any
// kind: a rating or a stat line planted on an angler dish or an apex feast
// survived the FULL suite. An angler dish is a plain sit-down restore with NO
// wellFed payload (R14: the fish line adds no rung to the food curve), and an
// apex feast is a delivery vehicle whose only payload is another dish's id.
const ALLOWED_ANGLER_DISH_KEYS = new Set(['id', 'name', 'kind', 'quality', 'foodHp', 'sellValue']);
const ALLOWED_APEX_FEAST_KEYS = new Set(['id', 'name', 'kind', 'quality', 'sellValue', 'feast']);

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

// The phase 10 rows do NOT go through expectGearRecipe: that helper hard-codes
// skillReq 100, resultCount 1, and the per-craft GEAR bill, and every one of
// those is deliberately different here (a batch output, a one-intermediate
// bill, and for the capstones the 125 rung). A sibling helper rather than a
// widened one, so neither shape can drift into the other's pins.
function expectConsumableRecipe(
  id: string,
  row: { craft: string; resultCount: number; stationType: string; reagents: unknown },
  skillReq: number,
): void {
  const recipe = APEX_CONSUMABLE_RECIPES.find((r) => r.resultItemId === id);
  expect(recipe, `${id} recipe`).toBeTruthy();
  expect(recipe?.id).toBe(`recipe_${id}`);
  expect(recipe?.professionId).toBe(row.craft);
  expect(recipe?.skillReq).toBe(skillReq);
  expect(recipe?.level).toBe(25);
  expect(recipe?.itemLevelBudget).toBe(25);
  expect(recipe?.resultCount).toBe(row.resultCount);
  expect(recipe?.acquisition).toEqual(['drop']);
  expect(recipe?.stationType).toBe(row.stationType);
  expect(recipe?.reagents).toEqual(row.reagents);
  // No daily gate spelled on the row itself. The flask chain is still paced
  // daily, TRANSITIVELY, through recipe_quickening_catalyst's own oncePerDay.
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

  it('every apex recipe output is in a table, plus the unflagged bag, tools, and consumables', () => {
    // The union runs over ALL THREE apex arrays against ALL the tables that
    // claim an output, so a new apex row is forced into a table here in the
    // change that ships it. The right-hand side is deliberately the whole
    // census, flagged and unflagged alike: the flagged families are counted
    // combat power, while the bag, the tools, and the phase 10 consumables are
    // apex outputs that carry no worn power and so live outside the flag. An
    // output belonging to no table (or a table naming an id nothing crafts)
    // fails the equality in whichever direction the mistake was made.
    const outputs = [...APEX_ARMOR_RECIPES, ...APEX_GEAR_RECIPES, ...APEX_CONSUMABLE_RECIPES]
      .map((r) => r.resultItemId)
      .sort();
    expect(outputs).toEqual(
      [
        ...FLAGGED_TABLE_IDS,
        APEX_BAG_ID,
        ...Object.keys(APEX_TOOLS),
        ...Object.keys(APEX_CONSUMABLES),
        ...ANGLER_OUTPUTS,
        ...APEX_FEAST_OUTPUTS,
      ].sort(),
    );
    // The angler block is named apart rather than folded into APEX_CONSUMABLES,
    // because that table is the PHASE 10 census and its per-row arms pin phase
    // 10's shapes (epic, resultCount, the wellFed payload). Two of these three
    // are rare plain dishes and one is a placeable, so folding them in would
    // have meant loosening those arms for rows they were never about.
    expect(ANGLER_OUTPUTS).toHaveLength(2);
    // Same reasoning for the apex feast tier, one rung up: three placeables
    // whose whole power story is an indirection at a shipped plate, so the
    // phase-10 per-row arms would have had nothing true to say about them.
    expect(APEX_FEAST_OUTPUTS).toHaveLength(3);
  });

  // MERGE-INHERITED, EXPECTED-FAIL rows (2026-08-30, the eighth v0.41.0 sync,
  // release tip 3e801dc925). The release's incumbent set-stack retune
  // (d404eab938) swapped hit for crit on the same-slot reference drops these
  // two apex twins COMPLEMENT (bloodmane_war_legguards and gravescale_girdle:
  // 40 hit -> 40 crit), so on the merged tree the twins DUPLICATE their reference's rating
  // and the complement arm below reds exactly as authored. forgefold_legguards
  // is the very piece the ratified R5 record measures (section 9.6: dead hit on
  // the reference, live crit on the twin), so re-cutting either rating is a
  // re-tune of the R5 surface: the rows are kept byte-identical and marked
  // expected-fail so the contradiction stays visible. The unresolved choice
  // is to re-complement the twins against the retuned references or re-measure
  // R5 on the merged world. Flip both back into the held set in the SAME commit
  // that executes the ruling.
  const MERGE_INHERITED_TWIN_DUPLICATES = new Set(['forgefold_legguards', 'spiritweld_girdle']);
  const armorRowSweep = (id: string, row: (typeof APEX_ARMOR)[keyof typeof APEX_ARMOR]) => {
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
  };
  it.each(Object.entries(APEX_ARMOR).filter(([id]) => !MERGE_INHERITED_TWIN_DUPLICATES.has(id)))(
    '%s: budget, rating, armor, and texture',
    armorRowSweep,
  );
  for (const [id, row] of Object.entries(APEX_ARMOR).filter(([id]) =>
    MERGE_INHERITED_TWIN_DUPLICATES.has(id),
  )) {
    it.fails(`${id}: budget, rating, armor, and texture`, () => armorRowSweep(id, row));
  }
  it('the merge-inherited twin set names live apex armor rows, never a stale id', () => {
    for (const id of MERGE_INHERITED_TWIN_DUPLICATES) expect(APEX_ARMOR[id], id).toBeDefined();
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

    // MITIGATION MATCHES THE REFERENCE (Phase 15). Both numbers used to
    // extrapolate the shield ladder two item levels past bonewrought_bulwark
    // (30 -> 32 block, 680 -> 732 armor at 26 armor per ilvl). The extrapolation
    // is internally sound and it produced the game's best mitigation item,
    // because makeHeroicVariant passes armor and blockValue through untouched:
    // heroic_bonewrought_bulwark is ilvl 33 and still reads 30 / 680, so no
    // heroic upgrade could ever answer a crafted shield. Both references are
    // pinned by identity AND value here, in BOTH directions, so neither a
    // bulwark retune nor a heroic-variant change can leave this def orphaned
    // or let it climb back over the raid line.
    const ref = ITEMS.bonewrought_bulwark as ItemDef & { armorType?: string };
    expect(ref.slot).toBe('offhand');
    expect(ref.armorType).toBe(row.armorType);
    expect(itemLevel(ref)).toBe(29);
    expect((ref.stats as Record<string, number>).armor).toBe(680);
    expect((ref as unknown as Record<string, unknown>).blockValue).toBe(30);
    const heroicRef = ITEMS.heroic_bonewrought_bulwark as ItemDef & { armorType?: string };
    expect(heroicRef.slot).toBe('offhand');
    expect(itemLevel(heroicRef)).toBe(33);
    expect(def.blockValue).toBe(row.blockValue);
    expect(row.blockValue).toBe(30);
    expect(row.blockValue).toBe((ref as unknown as Record<string, unknown>).blockValue);
    expect(armor).toBe(row.armor);
    expect(row.armor).toBe(680);
    expect(row.armor).toBe((ref.stats as Record<string, number>).armor);
    // THE INVERSION GUARD, the reason the two numbers moved: no crafted apex
    // shield may out-mitigate the raid shield it competes with on either axis.
    const heroicArmor = (heroicRef.stats as Record<string, number>).armor;
    const heroicBlock = (heroicRef as unknown as Record<string, unknown>).blockValue as number;
    expect(heroicArmor, 'the heroic shield still carries the frozen armor').toBe(680);
    expect(heroicBlock, 'and the frozen blockValue').toBe(30);
    expect(armor, 'apex shield armor never exceeds the raid shield').toBeLessThanOrEqual(
      heroicArmor,
    );
    expect(
      def.blockValue as number,
      'apex shield blockValue never exceeds the raid shield',
    ).toBeLessThanOrEqual(heroicBlock);

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
    // THE ANCHOR'S IDENTITY, added at Phase 15: the tie above pinned only the
    // NUMBER, so delisting zense_meridian from the vendor left the sweep fully
    // green while the pin still read "tied to the same-band heroic-vendor
    // jewelry" (mutation-proven). It is heroic-vendor jewelry and it is a
    // neck; it is also ilvl 26, NOT the apex band, so a second tie names an
    // ilvl-31 ring carrying the same 25 and the rule is satisfied on both
    // halves at once.
    const vendorAnchor = ITEMS.zense_meridian as ItemDef & Record<string, unknown>;
    expect(vendorAnchor.slot).toBe('neck');
    expect(vendorAnchor.quality).toBe('epic');
    expect(itemLevel(vendorAnchor)).toBe(26);
    expect(
      HEROIC_VENDOR_STOCK.some((o) => o.itemId === 'zense_meridian'),
      'the jewelry anchor is really heroic-vendor stock',
    ).toBe(true);
    const bandAnchor = ITEMS.abysswrought_band as ItemDef & Record<string, unknown>;
    expect(itemLevel(bandAnchor), 'the same-BAND anchor is ilvl 31').toBe(31);
    expect(row.rating[1], 'and carries the same jewelry band value').toBe(bandAnchor.hasteRating);

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
    // The anchor's identity, added at Phase 15 for the same reason as the
    // jewelry arm: the number alone cannot tell a real anchor from a
    // coincidentally equal piece.
    const heldAnchor = ITEMS.wraithfire_orb as ItemDef & Record<string, unknown>;
    expect(heldAnchor.kind).toBe('held_offhand');
    expect(heldAnchor.slot).toBe('offhand');
    expect(itemLevel(heldAnchor)).toBe(29);

    expectTradableTexture(def, row.sellValue);
    for (const key of Object.keys(def)) {
      expect(ALLOWED_HELD_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
    }

    // Held offhands sat OUTSIDE the disenchant kind gate until the release
    // v0.40.0 widened isDisenchantable to admit kind 'held_offhand' (a copy a
    // class cannot wield is never stuck valueless): the tripwire this pin
    // carried fired at that sync and the re-decision ADOPTS the upstream
    // family rule. The R12 routing below already covers the yield (epic ->
    // arcane_shard primary; a held offhand has no typed secondary, the
    // jewelry shape), so no new faucet class opens here.
    expect(isDisenchantable(def)).toBe(true);

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

  it('the rating spread complements the drops: no Hit on armour, crit and haste fill', () => {
    // ZERO Hit on the armour set since Phase 15. Hit is the double-value
    // rating (10 rating per percent against 20 for crit and haste), and the
    // complement rule forces the one Hit slot to be the one piece whose
    // reference drop does NOT carry Hit, which was the cloth chest: the
    // largest-budget slot, cloned from the caster BiS chest, and the only
    // source of caster chest Hit in the game. It carries haste now.
    const counts = { hitRating: 0, critRating: 0, hasteRating: 0 };
    for (const row of Object.values(APEX_ARMOR)) counts[row.rating[0]] += 1;
    expect(counts).toEqual({ hitRating: 0, critRating: 5, hasteRating: 4 });
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
    expect(all).toEqual({ hitRating: 4, critRating: 6, hasteRating: 7 });
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
    // MERGE-INHERITED RESCOPE at the merge of release/v0.41.0 (tip
    // e19d832b47): the packet ruled this bag STRICTLY the largest, and that
    // held on the packet's tree. The release's Bank Storage Expansion ships
    // two GENERAL 16-slot bags (resonant_weave_bag, wayfarers_backpack) that
    // TIE it, and two materials-only satchels on the two-pool model whose
    // slots serve only the materials pool (a different capacity axis, so the
    // general-capacity claim does not cover them). Neither side's magnitude
    // may be edited by a merge, so the pin is restated for the merged tree:
    // no general bag EXCEEDS the apex bag, the ties are exactly the named
    // set, and the materials-only satchels are pinned by exact id and size.
    // Whether the apex bag should be re-distinguished (or the strictly-best
    // ruling amended) is an OPEN maintainer ruling: re-tighten this to
    // toBeLessThan and drop the tie set if the bag is re-distinguished; the
    // rescoped pin below IS the final shape if the position is amended.
    const APEX_TIE_BAGS = ['resonant_weave_bag', 'wayfarers_backpack'];
    const ties: string[] = [];
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'bag' || def.id === APEX_BAG_ID) continue;
      if (def.materialsOnly === true) continue;
      expect(def.bagSlots ?? 0, `${def.id} must not exceed the apex bag`).toBeLessThanOrEqual(16);
      if ((def.bagSlots ?? 0) === 16) ties.push(def.id);
    }
    expect(ties.sort()).toEqual(APEX_TIE_BAGS);
    const materialsOnlyBags = Object.values(ITEMS).filter(
      (d) => d.kind === 'bag' && d.materialsOnly === true,
    );
    expect(Object.fromEntries(materialsOnlyBags.map((d) => [d.id, d.bagSlots]))).toEqual({
      burlap_reagent_pouch: 8,
      foragers_haversack: 12,
      necromancers_reagent_satchel: 20,
      loombound_reagent_satchel: 24,
    });
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
    // Each tool names its own array and rung, so the phase 09 pair keeps the
    // gear-recipe shape while the phase 10 capstones are checked at 125.
    const recipe = row.recipes.find((r) => r.resultItemId === id);
    expect(recipe, `${id} recipe`).toBeTruthy();
    expect(recipe?.id).toBe(`recipe_${id}`);
    expect(recipe?.professionId).toBe(row.craft);
    expect(recipe?.skillReq).toBe(row.skillReq);
    expect(recipe?.level).toBe(25);
    expect(recipe?.itemLevelBudget).toBe(25);
    expect(recipe?.resultCount).toBe(1);
    expect(recipe?.acquisition).toEqual(['drop']);
    expect(recipe?.stationType).toBe(row.stationType);
    expect(recipe?.reagents).toEqual(row.reagents);
    expect(recipe?.oncePerDay).toBeUndefined();
  });

  it.each(Object.entries(APEX_CONSUMABLES))(
    '%s: unflagged consumable, epic, tradable, payload and recipe pinned',
    (id, row) => {
      const def = ITEMS[id] as ItemDef & Record<string, unknown>;
      expect(def, `${id} must exist in the merged table`).toBeTruthy();
      expect(def.kind).toBe(row.kind);
      expect(def.quality).toBe('epic');
      // The flag ABSENCE is the point, as with the bag and the tools: a
      // consumable buff is never counted worn power, so it never competes for
      // the masterwrought family cap.
      expect(def.masterwrought).toBeUndefined();
      expect(def.stats).toBeUndefined();
      for (const field of RATING_FIELDS) expect(def[field]).toBeUndefined();
      // Not item-level eligible (no slot, non-combat kind), and outside R12:
      // neither kind clears the disenchant gate.
      expect(itemLevel(def)).toBeUndefined();
      expect(isDisenchantable(def)).toBe(false);
      expectTradableTexture(def, row.sellValue);
      // The effect payload pinned WHOLE, so a retuned value, kind, duration, or
      // aura display name reds here rather than drifting past the sweep. A
      // flask carries it under `elixir` (the reused family field); a role food
      // under `wellFed` beside its ordinary sit-down restore.
      if (row.kind === 'flask') {
        expect(def.elixir).toEqual(row.effect);
        expect(def.wellFed).toBeUndefined();
        expect(def.foodHp).toBeUndefined();
        for (const key of Object.keys(def)) {
          expect(ALLOWED_FLASK_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(true);
        }
      } else {
        expect(def.wellFed).toEqual(row.effect);
        expect(def.elixir).toBeUndefined();
        expect(def.foodHp).toBe(row.foodHp);
        for (const key of Object.keys(def)) {
          expect(ALLOWED_ROLE_FOOD_KEYS.has(key), `${id} carries unexpected field ${key}`).toBe(
            true,
          );
        }
      }
      expectConsumableRecipe(id, row, 100);
    },
  );

  it('the flasks break the elixir band ceiling deliberately, and only there', () => {
    // The value <= 12 / duration <= 900 ceiling is the ELIXIR and SCROLL band
    // rule (tests/inscription_scroll_exclusivity.test.ts states it there). The
    // apex rung is meant to beat it, so this asserts the break EXPLICITLY
    // rather than letting the flasks quietly sit outside a pin that never sees
    // them: every flask clears both bounds, and no elixir or scroll does.
    const flasks = Object.values(ITEMS).filter((d) => d.kind === 'flask');
    expect(flasks.map((d) => d.id).sort()).toEqual(
      ['ironhusk_flask', 'runewater_flask', 'warboar_flask'].sort(),
    );
    for (const def of flasks) {
      expect(def.elixir!.value, `${def.id} beats the elixir value ceiling`).toBeGreaterThan(12);
      expect(def.elixir!.duration, `${def.id} beats the elixir duration ceiling`).toBeGreaterThan(
        900,
      );
    }
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'elixir' && def.kind !== 'scroll') continue;
      expect(def.elixir!.value, `${def.id} stays inside the band`).toBeLessThanOrEqual(12);
      expect(def.elixir!.duration, `${def.id} stays inside the band`).toBeLessThanOrEqual(900);
    }
  });

  it('the role foods clear the shipped food ceiling, and Well Fed shares one band', () => {
    const roleFoodIds = Object.keys(APEX_CONSUMABLES).filter(
      (id) => APEX_CONSUMABLES[id].kind === 'food',
    );
    for (const id of roleFoodIds) {
      const def = ITEMS[id];
      // Strictly above every other food in the game: 1392 is the next classic
      // band over the shipped 980 ceiling, and this reds if anything else is
      // ever authored at or past it without moving the apex rung too.
      for (const other of Object.values(ITEMS)) {
        if (other.kind !== 'food' || roleFoodIds.includes(other.id)) continue;
        expect(other.foodHp ?? 0, `${other.id} must stay below the apex food`).toBeLessThan(
          def.foodHp!,
        );
      }
    }
    // Resolved through the KIND narrowing rather than a cast: wellFed lives on
    // FoodItemDef alone, so reading it requires proving the def is a food,
    // which is the scoping this arm exists to hold.
    const wellFedOf = (id: string) => {
      const def = ITEMS[id];
      if (def.kind !== 'food' || !def.wellFed) throw new Error(`${id} carries no wellFed payload`);
      return def.wellFed;
    };
    // One shared apex band across all three roles (value 6 at the 11c ladder's
    // apex duration 900), so the choice is which stat you carry, never how
    // much; the band's own derivation lives in the phase 10 increment pins.
    const bands = new Set(
      roleFoodIds.map((id) => `${wellFedOf(id).value}/${wellFedOf(id).duration}`),
    );
    expect(bands).toEqual(new Set(['6/900']));
    // One shared aura display NAME too, which puts every role food (and since
    // 11c every farming buff dish) on the single 'well_fed' exclusivity id
    // minted by src/sim/wellfed.ts.
    expect(new Set(roleFoodIds.map((id) => wellFedOf(id).aura))).toEqual(new Set(['Well Fed']));
  });

  it.each([...ANGLER_OUTPUTS, ...APEX_FEAST_OUTPUTS])(
    '%s: an apex output with NO power of its own, whole-def pinned',
    (id) => {
      // ADDED AT PHASE 15. These five were the only apex outputs in the census
      // with no power pin at all: they appeared solely as census membership
      // plus a length check on their own local list, which is a constant
      // comparing to itself. Measured at the audit: critRating 40 planted on
      // peppered_deepbarb_catfish survived a whole-suite run (the count noted
      // at the time was 47,677, with no worker bound or tip recorded beside
      // it, so it is not the packet's frozen 47738-at-d51139a103 stamp; the
      // SURVIVAL is what this arm answers, not the count), and hitRating 40 on
      // stonepot_feast survived ten targeted suites. The
      // masterwrought FLAG was already covered transitively (the census arm
      // reds); it is ratings and stats specifically that were open, which is
      // exactly the throttle-proof surface R14 and the Power placement name.
      const def = ITEMS[id] as ItemDef & Record<string, unknown>;
      expect(def, `${id} must exist in the merged table`).toBeTruthy();
      // Never flagged: neither a dish nor a feast is worn power, so neither
      // may ever compete for the two-piece family cap.
      expect(def.masterwrought).toBeUndefined();
      expect(def.stats).toBeUndefined();
      for (const field of RATING_FIELDS) expect(def[field]).toBeUndefined();
      expect(def.spellPower).toBeUndefined();
      expect(def.pvpOffenseRating).toBeUndefined();
      expect(def.pvpDefenseRating).toBeUndefined();
      // Not item-level eligible: no slot, non-combat kind.
      expect(itemLevel(def)).toBeUndefined();
      const isFeast = (APEX_FEAST_OUTPUTS as readonly string[]).includes(id);
      if (isFeast) {
        expect(def.kind).toBe('junk');
        expect(def.quality).toBe('epic');
        // A feast's ONLY payload is another dish's id: it grants nothing of
        // its own, so its power is whatever that dish already carries and is
        // pinned in the dish's own arm.
        const feast = def.feast as Record<string, unknown>;
        expect(feast, `${id} carries a feast payload`).toBeTruthy();
        expect(Object.keys(feast).sort()).toEqual([
          'charges',
          'dishItemId',
          'durationTicks',
          'templateId',
        ]);
        expect(feast.charges).toBe(10);
        expect(feast.durationTicks).toBe(3600);
        expect(APEX_FOOD_IDS as readonly string[]).toContain(feast.dishItemId as string);
        expect(def.foodHp).toBeUndefined();
        expect(def.wellFed).toBeUndefined();
        expect(def.elixir).toBeUndefined();
      } else {
        expect(def.kind).toBe('food');
        expect(def.quality).toBe('rare');
        // R14 in one assertion: the angler dishes reuse a shipped foodHp rung
        // and carry NO Well Fed payload, so the fish line adds no rung to the
        // food curve and no buff to the R5 kit.
        expect(def.wellFed).toBeUndefined();
        expect(def.elixir).toBeUndefined();
        expect(def.feast).toBeUndefined();
        expect(typeof def.foodHp).toBe('number');
      }
      const allowed = isFeast ? ALLOWED_APEX_FEAST_KEYS : ALLOWED_ANGLER_DISH_KEYS;
      for (const key of Object.keys(def)) {
        expect(allowed.has(key), `${id} carries unexpected field ${key}`).toBe(true);
      }
      const expectedSell = NO_POWER_SELL_VALUES[id];
      expect(expectedSell, `${id} has a pinned sell value`).toBeDefined();
      expectTradableTexture(def, expectedSell);
    },
  );

  it('the rating relationship to each reference is STATED, duplicate or complement', () => {
    // ADDED AT PHASE 15. The complement rule ("the apex rating complements its
    // reference drop, never duplicates it") is asserted as a LAW for the nine
    // armour pieces only. Four of the other eight deliberately DO duplicate
    // their named reference's rating field, each for a reason its def comment
    // gives, and the suite said nothing either way: a reader could not tell an
    // intentional duplicate from a missing arm, and a future jewelry append
    // (the stat-light slot the Lariat rule is about) would get no check at
    // all. Both halves are stated here as literals, so a change of mind about
    // any one of them reds.
    const soleRating = (id: string): [RatingField, number] => {
      const def = ITEMS[id] as ItemDef & Record<string, unknown>;
      const found = RATING_FIELDS.filter((f) => typeof def[f] === 'number');
      expect(found, `${id} carries exactly one rating`).toHaveLength(1);
      return [found[0], def[found[0]] as number];
    };
    // The four deliberate duplicates: same field, same value, on purpose.
    for (const [apex, ref] of [
      ['duskforged_warblade', 'greatfang_of_the_basin'],
      ['ridgebreaker', 'greatfang_of_the_basin'],
      ['duskforged_bulwark', 'bonewrought_bulwark'],
      ['gyrelens_array', 'wraithfire_orb'],
    ] as Array<[string, string]>) {
      expect(soleRating(apex), `${apex} deliberately shares ${ref}'s rating`).toEqual(
        soleRating(ref),
      );
    }
    // And the one held offhand that complements instead.
    expect(soleRating('voidbound_grimoire')[0]).toBe('hasteRating');
    expect(soleRating('wraithfire_orb')[0]).toBe('critRating');
    // The JEWELRY arm, swept rather than hand-listed, and scoped to the BAND:
    // no ilvl-31 jewelry piece may be another one's twin (the same stat axes
    // AND the same rating field). That is the Lariat failure form in the two
    // stat-light slots: two pieces the same shape in the same band means one
    // of them is strictly the better and the choice is not a choice. Scoped to
    // ilvl 31 on purpose. A cross-band comparison would flag ordinary
    // progression: warhewn_signet (ring, str/sta, hit 25) IS a strict superset
    // of the ilvl-26 vendor ring seal_of_the_nine_oaths (str/sta, hit 25) by
    // one point on each axis, which is what five item levels buy and what the
    // vendor band's own rating allocation for a strength ring already reads.
    // Recorded in power-verification.md rather than pinned as a defect.
    const bandRows = (Object.values(ITEMS) as Array<ItemDef & Record<string, unknown>>).filter(
      (d) =>
        (d.slot === 'neck' || d.slot === 'ring') &&
        itemLevel(d) === 31 &&
        d.pvpOffenseRating === undefined &&
        RATING_FIELDS.some((f) => typeof d[f] === 'number'),
    );
    // Exactly four, named: wyrmfall_pendant, warhewn_signet, prismglass_loop
    // and abysswrought_band. A floor under the real count is what lets a row
    // leave the sweep silently, so the uniqueness law below would then be
    // enforced over a quietly smaller band.
    expect(
      bandRows.length,
      `the apex jewelry band is four rows: ${bandRows.map((d) => d.id).join(', ')}`,
    ).toBe(4);
    const shapeOf = (d: ItemDef & Record<string, unknown>): string =>
      `${d.slot}|${Object.keys(d.stats as Record<string, number>)
        .sort()
        .join(',')}|${soleRating(d.id)[0]}`;
    const shapes = bandRows.map(shapeOf);
    expect(new Set(shapes).size, `two ilvl-31 jewelry twins: ${shapes.join(' / ')}`).toBe(
      shapes.length,
    );
  });

  // MERGE-INHERITED, EXPECTED-FAIL (2026-08-30, the eighth v0.41.0 sync, release
  // tip 3e801dc925): the release's Crucible raid catalog and Thronebane-band
  // legendaries (4ed7a279b4) put stronger pre-packet incumbents into the pool,
  // so the measured chest lead is now NEGATIVE (-1 against the ratified cap of
  // 2): the Perfected apex chest sits BELOW the best non-packet chest. The
  // caps are the R5 record's own zero-slack measurement (Phase 15 and its QA),
  // ratified 2026-08-29 and frozen; re-cutting them to the merged world is a
  // re-tune of the R5 surface. Kept byte-identical and marked expected-fail so
  // the contradiction stays visible. The unresolved choice is to re-measure
  // R5 on the merged world or keep the record as a measurement of the pre-raid
  // catalog. Flip back to
  // it() in the SAME commit that executes the ruling.
  it.fails('R5: a Perfected apex piece stays within its pinned lead over the pre-packet slot', () => {
    // ADDED AT PHASE 15, because the packet's defining ruling had no guard.
    // The sweep pins each apex piece's BASE budget and the perfecting suite
    // pins its DELTA against the formula, but nothing anywhere pinned the R5
    // quantity itself ON THE PRIMARY-STAT AXIS: the Perfected TOTAL measured
    // against what the slot already offered. A later phase that lowers or
    // re-sources a pre-packet epic silently widens the envelope with every
    // existing suite green. The other two axes this phase had to tune are
    // pinned elsewhere and deliberately not re-pinned here: ARMOUR by the
    // shield inversion guard, RATINGS by the per-family rating spread arm.
    // Baseline pool, stated as the filter below actually runs it rather than
    // as the doc's lane pool: NON-LEGENDARY, non-PvP equipment of ANY quality
    // that carries a primary stat, held offhands included. It is deliberately
    // WIDER than the epic-only loadouts power-verification.md section 3 fixes
    // for its three throughput lanes, and wider is the strict side here: a
    // bigger pool can only raise `best`, which can only SHRINK the lead an
    // apex piece is allowed, never grow it. Legendaries are the one exclusion,
    // because a legendary incumbent would mask a real lead behind a piece the
    // packet never competes with. Literal caps, never a self-derived bound.
    // The Phase 15 QA tightened mainhand (2 to 1) and feet (1 to 0) to the
    // measured leads: both rows carried authored slack the sweep below now
    // refuses on every slot.
    const MAX_LEAD_BY_SLOT: Record<string, number> = {
      chest: 2,
      gloves: 2,
      waist: 2,
      legs: 1,
      feet: 0,
      neck: 3,
      ring: 1,
      offhand: 1,
      mainhand: 1,
    };
    // The identity-matched caps, per slot: how far a Perfected apex piece may
    // lead the best pre-packet piece CARRYING THE SAME lead stat. Throughput
    // is paid in the lead stat, so this is the bound that binds; the sum caps
    // above are the second arm.
    // Every row is the EXACT measured lead, zero slack, so any widening reds,
    // and the sweep ENFORCES the exactness after the loop (the Phase 15 QA:
    // the claim used to ride on nothing, and the sum table above had quietly
    // gathered two slots of slack).
    // The offhand's 3 is gyrelens_array and it is the packet's largest
    // single-axis lead: int 11 Perfected against the best pre-packet offhand
    // carrying int (heroic_wraithfire_orb, 8). It is recorded rather than
    // tuned because it BUYS that concentration, giving up 55 rating net to do
    // it (power-verification.md section 11.2), which is the self-limiting
    // shape R14 allows. The neck's and ring's 2 are wyrmfall_pendant and the
    // two apex rings against pre-packet fields that top out at 7.
    const MAX_LEAD_STAT_BY_SLOT: Record<string, number> = {
      chest: 1,
      gloves: 1,
      waist: 1,
      legs: 1,
      feet: 0,
      neck: 2,
      ring: 2,
      offhand: 3,
      mainhand: 1,
    };
    const slotKey = (d: ItemDef & Record<string, unknown>): string =>
      d.slot === 'ring1' || d.slot === 'ring2' ? 'ring' : String(d.slot);
    const pool = (Object.values(ITEMS) as Array<ItemDef & Record<string, unknown>>).filter(
      (d) =>
        d.masterwrought !== true &&
        !!d.slot &&
        d.quality !== 'legendary' &&
        (d.kind === 'armor' || d.kind === 'weapon' || d.kind === 'held_offhand') &&
        d.pvpOffenseRating === undefined &&
        (primaryStatSum(d) ?? 0) > 0,
    );
    // Floor near the real count (470 today), not a decorative one: a floor far
    // under it lets the pool quietly shrink, and a smaller pool lowers `best`,
    // which is the direction that hides a lead.
    expect(pool.length, 'the baseline pool really has rows').toBeGreaterThan(400);
    let checked = 0;
    const observedSum: Record<string, number> = {};
    const observedLead: Record<string, number> = {};
    const noteMax = (table: Record<string, number>, key: string, value: number): void => {
      table[key] = Math.max(table[key] ?? Number.NEGATIVE_INFINITY, value);
    };
    for (const [id, def] of Object.entries(ITEMS) as Array<
      [string, ItemDef & Record<string, unknown>]
    >) {
      if (def.masterwrought !== true) continue;
      const recipe = ALL_RECIPES.find((r) => r.resultItemId === id);
      expect(recipe, `${id} has an apex recipe`).toBeTruthy();
      const bonus = perfectedBonusStats(def, recipe!) as Record<string, number> | null;
      expect(bonus, `${id} takes a Perfected bonus`).toBeTruthy();
      const bonusSum = Object.values(bonus!).reduce((a, b) => a + b, 0);
      const perfected = (primaryStatSum(def) ?? 0) + bonusSum;
      const key = slotKey(def);
      const best = pool
        .filter((d) => slotKey(d) === key && (d.hand === 'twohand') === (def.hand === 'twohand'))
        .reduce((a, d) => Math.max(a, primaryStatSum(d) ?? 0), 0);
      expect(best, `${id}: the slot has a pre-packet incumbent`).toBeGreaterThan(0);
      const cap = MAX_LEAD_BY_SLOT[key];
      expect(cap, `${key} has a pinned lead`).toBeDefined();
      expect(
        perfected - best,
        `${id}: Perfected ${perfected} over the best pre-packet ${key} (${best})`,
      ).toBeLessThanOrEqual(cap);
      noteMax(observedSum, key, perfected - best);

      // THE IDENTITY-MATCHED ARM, and it is the one that actually binds. The
      // sum comparison above is stat-agnostic, so an off-axis piece can set
      // the bar and hide a real lead: warhewn_signet (str 8 / sta 5, Perfected
      // str 9) leads the best pre-packet STRENGTH ring by 2, and passes the
      // sum arm only because abysswrought_band (sta 8 / spi 5 = 13, a ring no
      // strength wearer takes) sets that bar at 13. Throughput is paid in the
      // LEAD stat, so the lead is compared to the best pre-packet piece that
      // carries the same stat. Literal caps, per slot.
      // The axis comes from the DEF's own stat profile, never from the bonus
      // map: the bonus ties at 1 on five of the seventeen, and a tie there
      // resolves by object key insertion order, which silently measured
      // gyrelens_array on stamina (delta -4 against a cap of 1, five points of
      // dead slack) and duskforged_bulwark on strength. Both hid a real lead.
      // Largest primary wins; ties inside the def resolve by the fixed order
      // below so the pick is deterministic rather than authoring-order bound.
      const AXES = ['str', 'agi', 'int', 'sta', 'spi'] as const;
      const defStats = (def.stats ?? {}) as Record<string, number>;
      const lead = [...AXES]
        .filter((a) => (defStats[a] ?? 0) > 0)
        .sort((a, b) => (defStats[b] ?? 0) - (defStats[a] ?? 0))[0];
      expect(lead, `${id} carries at least one primary stat`).toBeDefined();
      const perfectedLead = (defStats[lead] ?? 0) + (bonus![lead] ?? 0);
      const bestLead = pool
        .filter((d) => slotKey(d) === key && (d.hand === 'twohand') === (def.hand === 'twohand'))
        .reduce(
          (a, d) => Math.max(a, (d.stats as Record<string, number> | undefined)?.[lead] ?? 0),
          0,
        );
      const leadCap = MAX_LEAD_STAT_BY_SLOT[key];
      expect(leadCap, `${key} has a pinned lead-stat cap`).toBeDefined();
      expect(
        perfectedLead - bestLead,
        `${id}: Perfected ${lead} ${perfectedLead} over the best pre-packet ${key} carrying ${lead} (${bestLead})`,
      ).toBeLessThanOrEqual(leadCap);
      noteMax(observedLead, key, perfectedLead - bestLead);
      checked++;
    }
    expect(checked, 'every flagged def was measured').toBe(17);
    // ZERO SLACK, enforced. A widening reds on the caps above; a SHRINK (a
    // stronger pre-packet incumbent arriving, or an apex piece trimmed) reds
    // here and demands the cap be re-cut to the new measured lead, so the
    // tables stay the exact measurement they claim to be in both directions.
    for (const [key, cap] of Object.entries(MAX_LEAD_BY_SLOT)) {
      expect(observedSum[key], `${key}: the sum cap is the measured lead, zero slack`).toBe(cap);
    }
    for (const [key, cap] of Object.entries(MAX_LEAD_STAT_BY_SLOT)) {
      expect(observedLead[key], `${key}: the lead-stat cap is the measured lead, zero slack`).toBe(
        cap,
      );
    }
  });

  // THE NAMED CRUCIBLE CARVE-OUT (masterwrought ruling
  // qr-19-apex-tier-vs-crucible-placement, 2026-09-01). The arm below sweeps
  // EVERY recipe in the game, which is the whole point of it: an unflagged,
  // full-budget, item-level-31 epic authored into any OTHER recipe array is
  // invisible to the two-piece family cap, because masterwroughtConflictSlot
  // returns null on an unflagged def. The release's staged Crucible crafted
  // fast-follow (PR 3704) will land epics at ilvl 37 that are DELIBERATELY
  // outside the masterwrought family (sub-decision S1: the fast-follow does not
  // inherit the flag or the cap, which is what the code already implements), so
  // it would red this arm for a ruled reason.
  //
  // The ruling's shape is a NAMED carve-out on the ignivar_loot precedent, NOT
  // a re-key of the sweep to the masterwrought family: re-keying would remove
  // exactly the hole the arm exists to close. Empty today, because none of
  // those recipes is in the tree yet. Adding an entry is a reviewable act with
  // a written reason, and the arm below checks the claim rather than trusting
  // it, so an entry that does not describe a real band-reaching unflagged
  // recipe fails here instead of silently exempting something else.
  const CRUCIBLE_BAND_CARVE_OUT: ReadonlyArray<{
    readonly recipeId: string;
    readonly reason: string;
  }> = [];

  // The per-entry check, hoisted out of the arm so it can be DRIVEN. The list is
  // empty until PR 3704 lands, so an arm that only walked it would assert
  // [] === [] and prove nothing about the validation the next author leans on;
  // the control below runs each refusal branch over synthetic entries.
  const carveOutDefects = (
    entries: ReadonlyArray<{ readonly recipeId: string; readonly reason: string }>,
  ): string[] => {
    const stale: string[] = [];
    for (const entry of entries) {
      const recipe = ALL_RECIPES.find((r) => r.id === entry.recipeId);
      if (!recipe) {
        stale.push(`${entry.recipeId}: no such recipe; drop the entry`);
        continue;
      }
      const def = ITEMS[recipe.resultItemId] as (ItemDef & Record<string, unknown>) | undefined;
      const ilvl = def ? itemLevel(def) : undefined;
      if (ilvl === undefined || ilvl < 31)
        stale.push(
          `${entry.recipeId}: output does not reach the apex band, so it needs no carve-out`,
        );
      if (def?.masterwrought === true)
        stale.push(
          `${entry.recipeId}: output IS flagged, so it belongs in the apex arrays, not here`,
        );
      if (entry.reason.length <= 40) stale.push(`${entry.recipeId}: needs a written reason`);
    }
    return stale;
  };

  it('every band carve-out entry names a real, unflagged, band-reaching recipe', () => {
    expect(carveOutDefects(CRUCIBLE_BAND_CARVE_OUT), 'a carve-out entry is stale').toEqual([]);
  });

  it('the carve-out validation refuses each shape it exists to refuse', () => {
    // Every branch, driven, because the live list is empty and stays empty until
    // another packet's PR lands: the day the first entry arrives the reviewer
    // must not be trusting unexercised code.
    const reason = 'a stated reason long enough to clear the written-reason floor here';
    expect(carveOutDefects([{ recipeId: 'no_such_recipe_id', reason }])).toEqual([
      'no_such_recipe_id: no such recipe; drop the entry',
    ]);
    const flagged = ALL_RECIPES.find(
      (r) => (ITEMS[r.resultItemId] as ItemDef & { masterwrought?: boolean })?.masterwrought,
    );
    expect(flagged, 'the catalog really has a flagged crafted output').toBeTruthy();
    expect(carveOutDefects([{ recipeId: flagged?.id ?? '', reason }])).toEqual([
      `${flagged?.id}: output IS flagged, so it belongs in the apex arrays, not here`,
    ]);
    const belowBand = ALL_RECIPES.find((r) => {
      const lvl = itemLevel(ITEMS[r.resultItemId]) ?? 0;
      return lvl > 0 && lvl < 31;
    });
    expect(belowBand, 'the catalog really has a below-band crafted output').toBeTruthy();
    expect(carveOutDefects([{ recipeId: belowBand?.id ?? '', reason }])).toEqual([
      `${belowBand?.id}: output does not reach the apex band, so it needs no carve-out`,
    ]);
    expect(carveOutDefects([{ recipeId: belowBand?.id ?? '', reason: 'too short' }])).toContain(
      `${belowBand?.id}: needs a written reason`,
    );
  });

  it('no crafted output outside the apex arrays reaches the apex item level', () => {
    // ADDED AT PHASE 15. The completeness arm above enumerates only three of
    // ALL_RECIPES' arrays, so an unflagged, full-budget, item-level-31 epic
    // authored into any OTHER recipe array passes the whole budget suite and
    // is invisible to the two-piece family cap (masterwroughtConflictSlot
    // returns null on an unflagged def). Mutation-proven at the audit. This
    // arm closes the hole from the other side: over EVERY recipe in the game,
    // any output that reaches the apex band must be flagged, which is what
    // puts it back inside the census.
    const apexOutputs = new Set(
      [...APEX_ARMOR_RECIPES, ...APEX_GEAR_RECIPES, ...APEX_CONSUMABLE_RECIPES].map(
        (r) => r.resultItemId,
      ),
    );
    const carvedOut = new Set(CRUCIBLE_BAND_CARVE_OUT.map((entry) => entry.recipeId));
    let scanned = 0;
    const offenders: string[] = [];
    for (const recipe of ALL_RECIPES) {
      scanned++;
      if (carvedOut.has(recipe.id)) continue;
      const def = ITEMS[recipe.resultItemId] as (ItemDef & Record<string, unknown>) | undefined;
      if (!def) continue;
      const ilvl = itemLevel(def);
      if (ilvl === undefined || ilvl < 31) continue;
      if (def.masterwrought === true) continue;
      offenders.push(`${recipe.id} -> ${recipe.resultItemId} (ilvl ${ilvl})`);
    }
    expect(scanned, 'the sweep really walked every recipe').toBeGreaterThan(150);
    // Non-vacuity: the sweep's own filter really finds the apex band when it
    // is there, so an empty offender list means "all flagged", not "none
    // reached the band".
    const atBand = ALL_RECIPES.filter(
      (r) => !carvedOut.has(r.id) && (itemLevel(ITEMS[r.resultItemId]) ?? 0) >= 31,
    );
    // The literal survives the carve-out by construction: an entry only ever
    // removes a recipe the packet does not own, so 17 is still the packet's own
    // at-band family. If this number moves, a masterwrought recipe moved.
    expect(atBand.length, 'recipes really do reach the apex band').toBe(17);
    for (const r of atBand) expect(apexOutputs.has(r.resultItemId), r.id).toBe(true);
    expect(offenders, 'an unflagged crafted output reached the apex item level').toEqual([]);
  });

  it('economy: every apex output vendors strictly below its reagent input value', () => {
    // recipe_economy.test.ts owns the invariant repo-wide; this arm keeps the
    // apex slice self-contained so a phase 09/10 row appended to the table
    // cannot ship priced above its bill even if the sweep list there drifts.
    for (const recipe of [
      ...APEX_ARMOR_RECIPES,
      ...APEX_GEAR_RECIPES,
      ...APEX_CONSUMABLE_RECIPES,
    ]) {
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

// --- Phase 10 increment pins ------------------------------------------------
// The apex consumables and enchants are each ONE RUNG over a shipped ladder,
// and "one rung" is the ladder's OWN step, not a number someone liked. Every
// arm below reads the shipped rungs LIVE (so a baseline retune reds here and
// forces the apex rung to move with it) and pins them as literals beside the
// apex value (so a drift that moved both sides together cannot pass). Comparing
// the apex numbers against copies of themselves would prove nothing, which is
// the whole reason these are separate from the payload equality pins above.

/** The elixir-family payload a flask or elixir carries, resolved through the
 *  kind narrowing rather than a cast. */
function elixirPayload(id: string): {
  aura: string;
  kind: string;
  value: number;
  duration: number;
} {
  const def = ITEMS[id];
  if ((def.kind !== 'elixir' && def.kind !== 'flask') || !def.elixir) {
    throw new Error(`${id} carries no elixir payload`);
  }
  return def.elixir;
}

function foodDef(id: string): { foodHp?: number; wellFed?: { value: number; duration: number } } {
  const def = ITEMS[id];
  if (def.kind !== 'food') throw new Error(`${id} is not a food`);
  return def;
}

const statBonus = (enchantId: string, axis: 'str' | 'agi' | 'sta' | 'int'): number => {
  const def = ENCHANTS[enchantId];
  if (!def) throw new Error(`${enchantId} is not in the enchant table`);
  return def.statBonus[axis] ?? 0;
};

const APEX_FOOD_IDS = ['stonepot_stew', 'warspice_skewers', 'sageleaf_chowder'] as const;

/** The feast payload's shape (src/sim/types.ts). Spelled out here rather than
 *  indexed off ItemDef, which is a union whose other members carry no `feast`. */
interface FeastPayload {
  charges: number;
  durationTicks: number;
  dishItemId: string;
  templateId: string;
}

/** Every feast-bearing def in the live catalog with its payload. Read off
 *  ITEMS rather than a hand list so a feast authored later joins the sweep. */
function feastPayloads(): { id: string; feast: FeastPayload }[] {
  const out: { id: string; feast: FeastPayload }[] = [];
  for (const def of Object.values(ITEMS)) {
    const feast = (def as { feast?: FeastPayload }).feast;
    if (feast) out.push({ id: def.id, feast });
  }
  return out;
}

describe('the phase 10 apex rungs step exactly one rung off the shipped ladders', () => {
  it('the skill-125 capstones sit above the skill-100 apex rungs', () => {
    // The SKILL dimension of "one rung above", which nothing said out loud: the
    // two placement capstones are the only apex rows past the 100 wall every
    // other apex recipe in the game sits on, and the two tool rows that carry
    // the number today are named for their flag and tradability, so a 125 to 100
    // slip reads as an unrelated row passing. Both sides literal, and the six
    // consumable ids come off the local table so a phase-appended row is
    // checked here the day it is added.
    const rungOf = (resultItemId: string): number => {
      const recipe = APEX_CONSUMABLE_RECIPES.find((r) => r.resultItemId === resultItemId);
      if (!recipe) throw new Error(`${resultItemId} has no APEX_CONSUMABLE_RECIPES row`);
      return recipe.skillReq;
    };
    const CAPSTONE_IDS = ['grand_cauldron', 'laden_hearth'] as const;
    for (const id of CAPSTONE_IDS) expect(rungOf(id), `${id} capstone rung`).toBe(125);
    const consumableIds = Object.keys(APEX_CONSUMABLES);
    expect(consumableIds.length, 'the six phase 10 consumables').toBe(6);
    // The array is exactly these THIRTEEN rows today (six phase-10 rungs, two
    // station capstones, masterwrought Phase 11i's two surviving angler rows,
    // and Phase 11k's three apex role feasts), so a third station capstone or a
    // fourteenth row of any kind forces a visit here instead of landing
    // unchecked beside a hand-picked capstone list.
    expect(
      APEX_CONSUMABLE_RECIPES,
      'six apex rungs, two station capstones, two angler rows, three apex feasts',
    ).toHaveLength(13);
    // And the split is named, so a row moving BETWEEN the three groups cannot
    // keep the total right while changing what the groups mean.
    expect(
      consumableIds.length +
        CAPSTONE_IDS.length +
        ANGLER_OUTPUTS.length +
        APEX_FEAST_OUTPUTS.length,
    ).toBe(13);
    for (const id of consumableIds) expect(rungOf(id), `${id} apex rung`).toBe(100);
    // The relation itself, so the two numbers can never be levelled without
    // this line failing even if both moved together.
    for (const capstone of CAPSTONE_IDS) {
      for (const id of consumableIds) {
        expect(rungOf(capstone), `${capstone} vs ${id}`).toBeGreaterThan(rungOf(id));
      }
    }
  });

  it('the flask band clears the elixir ceiling on an ENVELOPE-derived value', () => {
    const boar = elixirPayload('elixir_of_the_boar');
    const vipersear = elixirPayload('venomfire_elixir');
    const serpent = elixirPayload('elixir_of_the_serpent');
    // The shipped ladder, read live and pinned literally: 6/600, 9/900, 12/900.
    expect([boar.value, vipersear.value, serpent.value]).toEqual([6, 9, 12]);
    expect([boar.duration, vipersear.duration, serpent.duration]).toEqual([600, 900, 900]);
    // elixir_of_the_bear (buff_sta 12/900) shares the serpent's top rung as a
    // duplicate; it sits inside the band sweep above and does not touch the
    // first-to-second duration step the apex food derivation reads.

    // The ladder's own steps, taken from the rungs that HAVE one (the top two
    // rungs share a duration, so the duration step is the first-to-second one).
    const valueStep = vipersear.value - boar.value;
    const durationStep = vipersear.duration - boar.duration;
    expect(valueStep).toBe(3);
    expect(durationStep).toBe(300);

    // THE VALUE IS ENVELOPE-DERIVED, NOT LADDER-DERIVED, AND PHASE 15 MADE IT
    // SO (15 to 13). The ladder's own step would put the flask at 15, and that
    // is where it shipped. The measured R5 pass
    // (docs/design/power-verification.md) read the full kit at 5.86
    // and 6.08 percent at 15; at 13 the central estimates straddle the line,
    // and the R5 verdict, SUSPENDED on 2026-08-28 pending the gear-term
    // ruling, is CLOSED BY RULING since 2026-08-29 (its Verdict and section
    // 9.6), so 13 is a conservative
    // margin, not a proven crossing. The flask is the single largest term,
    // because it is the first offensive consumable the game has ever had (every
    // pre-packet elixir and scroll is stamina) and its whole magnitude lands as
    // new throughput with nothing to net it off. R5 is the contract and the
    // packet's own record names flask 15 as the first tune-down knob, so the
    // value answers to the envelope. What the ladder still owns: the flask must
    // stand STRICTLY above the elixir ceiling (that is what makes it a rung),
    // and the DURATION is untouched at the ladder's own step.
    for (const id of ['ironhusk_flask', 'warboar_flask', 'runewater_flask']) {
      const flask = elixirPayload(id);
      expect(flask.value, `${id} value literal`).toBe(13);
      expect(flask.value, `${id} clears the elixir ceiling`).toBeGreaterThan(serpent.value);
      expect(
        flask.value,
        `${id} sits BELOW the ladder step, the Phase 15 envelope trim`,
      ).toBeLessThan(serpent.value + valueStep);
      expect(flask.duration, `${id} duration`).toBe(serpent.duration + durationStep);
      expect(flask.duration, `${id} duration literal`).toBe(1200);
    }
  });

  it('the role foods clear the shipped food ceiling, and the apex Well Fed band derives from the elixir ladder', () => {
    // The shipped ceiling derived from the live table rather than named, so a
    // newly authored 1,000-hp food reds here instead of quietly passing the
    // apex rung.
    const shippedCeiling = Math.max(
      ...Object.values(ITEMS)
        .filter((d) => d.kind === 'food' && !(APEX_FOOD_IDS as readonly string[]).includes(d.id))
        .map((d) => (d.kind === 'food' ? (d.foodHp ?? 0) : 0)),
    );
    expect(shippedCeiling, 'the shipped food ceiling').toBe(980);

    // The 11c derivation (ruling 11c-D-2), computed LIVE with the twin
    // literals the file's own idiom uses: the apex VALUE is still the
    // consumable family's own entry rung (the bottom elixir, the number R5's
    // kit was measured against), and the apex DURATION takes the elixir
    // ladder's own duration step above that entry rung (boar to venomfire,
    // 600 + 300 = 900), so the plate strictly dominates the farming rungs
    // below without moving the R5 magnitude.
    const entry = elixirPayload('elixir_of_the_boar');
    const durationStep = elixirPayload('venomfire_elixir').duration - entry.duration;
    for (const id of APEX_FOOD_IDS) {
      const def = foodDef(id);
      expect(def.foodHp, `${id} sits above the shipped ceiling`).toBeGreaterThan(shippedCeiling);
      expect(def.foodHp, `${id} foodHp literal`).toBe(1392);
      expect(def.wellFed?.value, `${id} enters at the elixir entry value`).toBe(entry.value);
      expect(def.wellFed?.duration, `${id} duration is entry plus the ladder step`).toBe(
        entry.duration + durationStep,
      );
      expect(def.wellFed?.value, `${id} well-fed value literal`).toBe(6);
      expect(def.wellFed?.duration, `${id} well-fed duration literal`).toBe(900);
    }
  });

  it('the apex plates strictly dominate every non-apex well-fed food on BOTH axes', () => {
    // Swept over the LIVE catalog rather than a hand-listed set, so a fifth
    // farming dish (or any future well-fed food) authored at or above the
    // apex band reds here the day it ships: the power inversion the 11c
    // re-tune removed (a cooking-50 trainer dish at 12/900 beating the
    // cooking-100 apex plate) can never quietly return.
    // A feast is a delivery VEHICLE, not a food of its own: its bite serves
    // feast.dishItemId, so what a feast grants is whatever that dish already
    // carries. That indirection is the one path this sweep cannot see (a
    // dishItemId pointing outside the food catalog escapes it entirely), and
    // the arm below closes it at an AT-MOST-the-apex bound rather than a
    // strictly-below one, because 11k's apex feasts serve the apex plates by
    // design (equal to the apex, never above it).
    const nonApex = Object.values(ITEMS).filter(
      (d): d is Extract<typeof d, { kind: 'food' }> =>
        d.kind === 'food' &&
        d.wellFed !== undefined &&
        !(APEX_FOOD_IDS as readonly string[]).includes(d.id),
    );
    // Non-vacuity: the farming rungs really are inside the sweep.
    expect(nonApex.length).toBeGreaterThanOrEqual(4);
    for (const apexId of APEX_FOOD_IDS) {
      const apex = foodDef(apexId).wellFed;
      expect(apex, `${apexId} carries the apex payload`).toBeDefined();
      for (const other of nonApex) {
        expect(
          other.wellFed!.value,
          `${other.id} value must stay strictly below the apex`,
        ).toBeLessThan(apex!.value);
        expect(
          other.wellFed!.duration,
          `${other.id} duration must stay strictly below the apex`,
        ).toBeLessThan(apex!.duration);
      }
    }
    // The ruling's ADJACENCY, not just the ordering: the farming ladder tops
    // out EXACTLY one point below the apex (11c-D-2, "topping out one below
    // the apex"). Without this arm the dominance sweep would stay green if
    // the apex drifted upward and reopened a gap the ruling closed.
    const topRung = Math.max(...nonApex.map((d) => d.wellFed!.value));
    const apexValue = foodDef(APEX_FOOD_IDS[0]).wellFed!.value;
    expect(topRung, 'the farming ladder tops out one below the apex').toBe(apexValue - 1);
  });

  it('every feast serves a well-fed FOOD at or below the apex point, on both axes', () => {
    // The dominance sweep's blind spot, closed. A feast grants nothing itself;
    // it names a dish, and the eating slot points at that dish, so a
    // dishItemId that stopped resolving to a well-fed food (re-kinded, renamed
    // out from under the payload, or authored above the plates) would deliver
    // a buff no arm above polices. Swept over the LIVE catalog, so a feast
    // authored in a later phase joins on the day it ships.
    const apex = foodDef(APEX_FOOD_IDS[0]).wellFed;
    expect(apex, 'the apex plate carries a Well Fed payload').toBeDefined();
    // "The apex point" is one value/duration pair, not the first plate's
    // accident: all three plates sit on it (they differ only in buff KIND, one
    // per role table), which is what makes the bound below meaningful.
    for (const id of APEX_FOOD_IDS) {
      const plate = foodDef(id).wellFed;
      expect(plate?.value, `${id} sits on the apex value`).toBe(apex?.value);
      expect(plate?.duration, `${id} sits on the apex duration`).toBe(apex?.duration);
    }
    const feasts = feastPayloads();
    // Non-vacuity: the three apex feasts plus the farming harvest_feast.
    expect(feasts.length, 'feasts in the live catalog').toBeGreaterThanOrEqual(4);
    for (const { id, feast } of feasts) {
      const dish = ITEMS[feast.dishItemId];
      expect(dish, `${id} serves ${feast.dishItemId}, which must exist`).toBeDefined();
      expect(dish.kind, `${id} must serve a food`).toBe('food');
      const wellFed = dish.kind === 'food' ? dish.wellFed : undefined;
      expect(wellFed, `${id}'s dish ${dish.id} must carry a Well Fed payload`).toBeDefined();
      expect(
        wellFed?.value,
        `${id}'s dish ${dish.id} value must not exceed the apex`,
      ).toBeLessThanOrEqual(apex?.value as number);
      expect(
        wellFed?.duration,
        `${id}'s dish ${dish.id} duration must not exceed the apex`,
      ).toBeLessThanOrEqual(apex?.duration as number);
    }
    // The bound is a real ceiling rather than an equality every row trivially
    // meets: at least one shipped feast serves a dish STRICTLY under the apex
    // on both axes (the farming rung), and at least one sits exactly on it.
    const served = feasts.map(({ feast }) => foodDef(feast.dishItemId).wellFed);
    expect(
      served.some((w) => (w?.value ?? 0) < (apex?.value as number)),
      'a feast serves a dish below the apex value',
    ).toBe(true);
    expect(
      served.some((w) => (w?.duration ?? 0) < (apex?.duration as number)),
      'a feast serves a dish below the apex duration',
    ).toBe(true);
    expect(
      served.some((w) => w?.value === apex?.value && w?.duration === apex?.duration),
      'a feast serves a dish exactly on the apex point',
    ).toBe(true);
  });

  it('each apex enchant continues its OWN slot ladder, the weapon rung at HALF its step', () => {
    // Weapon strength: 2 base, 3 runed, 5 Greater, so the ladder's own step is
    // +2 and the apex rung would read 7 on it.
    expect([
      statBonus('enchant_weapon_might', 'str'),
      statBonus('enchant_weapon_runed_edge', 'str'),
      statBonus('enchant_weapon_greater_might', 'str'),
    ]).toEqual([2, 3, 5]);
    const weaponStep =
      statBonus('enchant_weapon_greater_might', 'str') -
      statBonus('enchant_weapon_runed_edge', 'str');
    expect(weaponStep).toBe(2);
    // THE WEAPON RUNG IS THE ONE EXCEPTION, AND PHASE 15 MADE IT ONE (7 to 6).
    // The weapon slot is the only enchant slot that lands TWICE on a character:
    // a one-hand weapon declares slot 'mainhand' and is legal in the offhand,
    // and the enchant slot gate compares itemDef.slot, so a fury warrior, an
    // enhancement shaman and a rogue all wear the weapon enchant on both
    // hands. At the ladder's own +2 the per-character step over Greater was 4
    // for a dual-wielder, twice what the ratified R5 arithmetic counted; at
    // half the step it is the 2 the envelope was measured on. Every other apex
    // rung below still takes its own full ladder step, because no other slot
    // doubles.
    expect(statBonus('enchant_weapon_lucent_might', 'str')).toBe(
      statBonus('enchant_weapon_greater_might', 'str') + weaponStep / 2,
    );
    expect(statBonus('enchant_weapon_lucent_might', 'str')).toBe(6);
    expect(
      statBonus('enchant_weapon_lucent_might', 'str'),
      'still strictly above Greater',
    ).toBeGreaterThan(statBonus('enchant_weapon_greater_might', 'str'));

    // The weapon INT twin (phase 10 QA D10-D1 ruling) mirrors the str ladder
    // exactly: Spellpower 2, Runed Sigil 3, Greater Spellpower 5, apex 6 on
    // the same halved step, with the bill byte-identical to Lucent Might.
    expect([
      statBonus('enchant_weapon_intellect', 'int'),
      statBonus('enchant_weapon_runed_focus', 'int'),
      statBonus('enchant_weapon_greater_spellpower', 'int'),
    ]).toEqual([2, 3, 5]);
    expect(statBonus('enchant_weapon_lucent_spellpower', 'int')).toBe(
      statBonus('enchant_weapon_greater_spellpower', 'int') + weaponStep / 2,
    );
    expect(statBonus('enchant_weapon_lucent_spellpower', 'int')).toBe(6);
    // The twins share a bill. Both sides are live, so the LITERAL below is
    // what makes the equality mean something: emptying or retuning both bills
    // together would otherwise pass.
    expect(ENCHANTS.enchant_weapon_lucent_spellpower.reagents).toEqual(
      ENCHANTS.enchant_weapon_lucent_might.reagents,
    );
    expect(ENCHANTS.enchant_weapon_lucent_might.reagents).toEqual([
      { itemId: 'lucent_reagent', count: 1 },
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ]);

    // Chest stamina: 4 base, 7 Greater, so its own step is +3 and the apex
    // takes it again.
    expect([
      statBonus('enchant_chest_stamina', 'sta'),
      statBonus('enchant_chest_greater_stamina', 'sta'),
    ]).toEqual([4, 7]);
    const chestStep =
      statBonus('enchant_chest_greater_stamina', 'sta') - statBonus('enchant_chest_stamina', 'sta');
    expect(chestStep).toBe(3);
    expect(statBonus('enchant_chest_lucent_stamina', 'sta')).toBe(
      statBonus('enchant_chest_greater_stamina', 'sta') + chestStep,
    );
    expect(statBonus('enchant_chest_lucent_stamina', 'sta')).toBe(10);
    // The Perfected-only capstone continues that same chest ladder once more.
    expect(statBonus('enchant_lucent_infusion', 'sta')).toBe(
      statBonus('enchant_chest_lucent_stamina', 'sta') + chestStep,
    );
    expect(statBonus('enchant_lucent_infusion', 'sta')).toBe(13);

    // Boots have no Greater rung by design (R7 keeps the boots enchant a stat
    // line only), so the apex takes the SMALL base-to-runed sized step the
    // weapon line spells out, deliberately not the Greater-sized one.
    const baseToRunedStep =
      statBonus('enchant_weapon_runed_edge', 'str') - statBonus('enchant_weapon_might', 'str');
    expect(baseToRunedStep).toBe(1);
    expect(statBonus('enchant_feet_agility', 'agi')).toBe(2);
    expect(statBonus('enchant_feet_lucent_agility', 'agi')).toBe(
      statBonus('enchant_feet_agility', 'agi') + baseToRunedStep,
    );
    expect(statBonus('enchant_feet_lucent_agility', 'agi')).toBe(3);
    // No Greater boots rung exists to step off: pinned so a future one forces
    // this derivation to be re-read rather than silently orphaning it.
    expect(
      Object.values(ENCHANTS).filter(
        (e) => e.itemSlot === 'feet' && e.reagents.some((r) => r.itemId === 'arcane_shard'),
      ),
    ).toEqual([]);
  });
});
