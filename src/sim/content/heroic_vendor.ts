import type { ItemDef } from '../types';

// The Heroic Quartermaster's marks-currency stock: the endgame neck and ring
// jewelry bought with marks. It is not the game's only jewelry (the WARFARE
// honor sets, the rift ring abysswrought_band, and the crafted jewelcrafting
// pieces all ship elsewhere); the item-level and rating notes below describe
// THIS stock. Prices are HEROIC MARKS (the heroic_mark inventory item from
// ./dungeon_difficulty.ts), debited from the buyer's bags by
// buyHeroicVendorItem (src/sim/instances/heroic_vendor.ts).
//
// Item level: the source index (src/sim/item_level.ts) treats this stock as
// level-20 heroic content, so the epic pieces read item level 26 (20 + the epic
// bump) and their stat sums are budget-enforced by tests/item_level.test.ts:
// ring budget 11 (slot mult 0.6), neck budget 12 (slot mult 0.65).
//
// Jewelry carries no armorType, so every class can wear every piece; the stat
// identity picks its audience. Prices are tunable placeholders sized against
// the four heroic-final-boss rewards available during each realm reset cycle.
//
// Combat rating: every piece also carries ONE combat rating (hit / crit / haste)
// at JEWELRY_RATING (25 -> 2.5%), chosen by its stat identity. Ratings are off the
// primary-stat budget (like spellPower), so the sums above stay budget-enforced.
// This is jewelry's endgame identity; see docs/prd/combat-ratings-and-jewelry.md.

export const HEROIC_VENDOR_NPC_ID = 'heroic_quartermaster';

// One rating per jewelry piece. At 25 rating: 2.5% hit or 1.25% crit/haste.
const JEWELRY_RATING = 25;

export interface HeroicVendorOffer {
  itemId: string;
  marks: number;
}

export const HEROIC_VENDOR_ITEMS: Record<string, ItemDef> = {
  seal_of_the_nine_oaths: {
    id: 'seal_of_the_nine_oaths',
    name: 'Seal of the Nine Oaths',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 7, sta: 4 },
    hitRating: JEWELRY_RATING, // plate melee: Hit answers the Heroic +3 miss
    sellValue: 4500,
  },
  nielas_coldlight_band: {
    id: 'nielas_coldlight_band',
    name: "Niela's Coldlight Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 7, sta: 4 },
    hitRating: JEWELRY_RATING, // dps caster: Hit answers the Heroic +3 resist
    sellValue: 4500,
  },
  sutils_gambit: {
    id: 'sutils_gambit',
    name: "Sutil's Gambit",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 7, sta: 4 },
    critRating: JEWELRY_RATING, // agi dps: crit throughput
    sellValue: 4500,
  },
  oath_of_the_round_table: {
    id: 'oath_of_the_round_table',
    name: 'Oath of the Round Table',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { sta: 6, str: 5 },
    hitRating: JEWELRY_RATING, // tank/melee: Hit
    sellValue: 4500,
  },
  zyzzs_deathless_signet: {
    id: 'zyzzs_deathless_signet',
    name: "Zyzz's Deathless Signet",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { spi: 6, int: 5 },
    hasteRating: JEWELRY_RATING, // healer-leaning: haste
    sellValue: 4500,
  },
  architects_cornerstone: {
    id: 'architects_cornerstone',
    name: "The Architect's Cornerstone",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 6, spi: 5 },
    hasteRating: JEWELRY_RATING, // caster/healer: uptime
    sellValue: 4500,
  },
  yumis_keepsake_locket: {
    id: 'yumis_keepsake_locket',
    name: "Yumi's Keepsake Locket",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 7, sta: 5 },
    hasteRating: JEWELRY_RATING, // agi dps: uptime
    sellValue: 6000,
  },
  zense_meridian: {
    id: 'zense_meridian',
    name: 'Zense Meridian',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 7, spi: 5 },
    critRating: JEWELRY_RATING, // caster throughput
    sellValue: 6000,
  },
  swiftfang_talisman: {
    id: 'swiftfang_talisman',
    name: 'Swiftfang Talisman',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, agi: 6 },
    hitRating: JEWELRY_RATING, // hybrid melee: Hit
    sellValue: 6000,
  },
  medallion_of_endless_profit: {
    id: 'medallion_of_endless_profit',
    name: 'Medallion of Endless Profit',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 7, sta: 5 },
    critRating: JEWELRY_RATING, // melee throughput
    sellValue: 6000,
  },
};

export const HEROIC_VENDOR_STOCK: readonly HeroicVendorOffer[] = [
  { itemId: 'seal_of_the_nine_oaths', marks: 12 },
  { itemId: 'nielas_coldlight_band', marks: 12 },
  { itemId: 'sutils_gambit', marks: 12 },
  { itemId: 'oath_of_the_round_table', marks: 12 },
  { itemId: 'zyzzs_deathless_signet', marks: 12 },
  { itemId: 'architects_cornerstone', marks: 12 },
  { itemId: 'yumis_keepsake_locket', marks: 16 },
  { itemId: 'zense_meridian', marks: 16 },
  { itemId: 'swiftfang_talisman', marks: 16 },
  { itemId: 'medallion_of_endless_profit', marks: 16 },
  // Masterwrought phase 04: the deterministic Wyrmfall Core catch-up valve
  // (ruling R8's day-one vendor channel). Deliberately priced at the ring
  // point of the mark family: a bad-luck backstop for the last core, never a
  // farm that outpaces the boss faucet (1 to 3 per kill). The def lives in
  // content/items.ts with the other materials; the item_level stock bump
  // no-ops for it (junk is not item-level eligible).
  { itemId: 'wyrmfall_core', marks: 12 },
  // Masterwrought phase 11: the eight APEX_CONSUMABLE patterns, ruling R8's
  // deterministic pillar. This marks vendor IS the valve, live from day one:
  // consumable crafters get deterministic access so the raid economy
  // functions, while the gear patterns stay chase drops per R8's split.
  // Prices sit in the shipped mark family: the six skill-100 patterns at the
  // ring point (12), the two skill-125 capstones at the neck point (16).
  // Patterns are tradable, so duplicates are purchasable BY DESIGN: surplus
  // copies flow to the World Market and this vendor price acts as the market
  // ceiling. Purchase quantity is the vendor's hardcoded 1 per buy
  // (buyHeroicVendorItem debits one price and grants exactly one copy; this
  // vendor has no count multiplier). The defs live in
  // content/apex_patterns.ts; the item_level stock bump still indexes their
  // source level, but kind 'recipe' carries no slot so the rows are not
  // item-level ELIGIBLE and itemLevel() stays undefined for them.
  { itemId: 'pattern_ironhusk_flask', marks: 12 },
  { itemId: 'pattern_warboar_flask', marks: 12 },
  { itemId: 'pattern_runewater_flask', marks: 12 },
  { itemId: 'pattern_stonepot_stew', marks: 12 },
  { itemId: 'pattern_warspice_skewers', marks: 12 },
  { itemId: 'pattern_sageleaf_chowder', marks: 12 },
  { itemId: 'pattern_grand_cauldron', marks: 16 },
  { itemId: 'pattern_laden_hearth', marks: 16 },
  // Masterwrought phase 11f: the farming valve. All SIX farming patterns and
  // every tier-3 and tier-4 SEED, on the wyrmfall_core precedent above ("a
  // bad-luck backstop ... never a farm that outpaces the boss faucet"), so
  // nothing this phase puts in a drop table can fossilize behind bad luck.
  // That backstop is what makes the luck-gated arms legal at all: D13 says a
  // luck-gated trigger can never be the only faucet for a pattern.
  //
  // EVERY ROW AT 12, the ring point, and the price is DERIVED rather than
  // chosen: the shipped mark family has exactly two points, 12 for the
  // skill-100 patterns and 16 for the skill-125 capstones, and under the Phase
  // 11f rung climb every farming pattern teaches a rung-75 or rung-100 row. NO
  // farming row sits at 16, and minting a third point below 12 to make seeds
  // cheap stays reserved for a maintainer decision over the whole family.
  //
  // The seeds are kind 'junk', so the item_level stock bump no-ops for them
  // exactly as it does for wyrmfall_core, and the gear-shape sweep in
  // tests/heroic_vendor.test.ts excludes them BY KIND rather than by a growing
  // id list. They do NOT replace the copper counters: Phase 11e stocked all
  // eight at farmer_hollis and farmer_verbena and that remains the everyday
  // route, which is the whole point of the identity guard.
  { itemId: 'pattern_highwatch_gourd_soup', marks: 12 },
  { itemId: 'pattern_highwatch_barley_porridge', marks: 12 },
  { itemId: 'pattern_evergarden_sunmelon_tart', marks: 12 },
  { itemId: 'pattern_evergarden_harvest_platter', marks: 12 },
  { itemId: 'pattern_evergarden_braised_greens', marks: 12 },
  { itemId: 'pattern_harvest_feast', marks: 12 },
  { itemId: 'highland_barley_seed', marks: 12 },
  { itemId: 'frost_gourd_seed', marks: 12 },
  { itemId: 'thornpeak_cabbage_seed', marks: 12 },
  { itemId: 'frost_lentils_seed', marks: 12 },
  { itemId: 'gilded_sunmelon_seed', marks: 12 },
  { itemId: 'evergarden_greens_seed', marks: 12 },
  { itemId: 'gilded_yam_seed', marks: 12 },
  { itemId: 'evergarden_pumpkin_seed', marks: 12 },
];
