import type { ItemDef } from '../types';

// The Heroic Quartermaster's marks-currency stock: the game's only source of
// neck and ring jewelry. Prices are HEROIC MARKS (the heroic_mark inventory
// item from ./dungeon_difficulty.ts), debited from the buyer's bags by
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

// One rating per jewelry piece, 25 rating = 2.5% (10 rating = 1%).
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
];
