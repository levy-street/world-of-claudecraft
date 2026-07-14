// Frostreach Frontier Season 1 vendor: the Frostreach Quartermaster, who stands
// in the Frontier safe hub and sells the item-level-31 Season 1 PvP set for hero
// points (the frost-rare currency). Mirrors the FURY honor Quartermaster pattern
// (src/sim/content/pvp_honor.ts): a reserved entity id spawned after the rng-driven
// world roster, a fixed vendor stock, and epic pieces whose item level is pinned by
// registering their source level in item_level.ts.
//
// The set is mail Strength/Stamina, one tier above FURY's furyforged battlegear:
// FROSTREACH_SOURCE_LEVEL (25) plus the epic quality bump (6) lands every piece at
// item level 31. Stats sum to the exact primaryStatBudget for that level/quality/
// slot (tests/item_level enforces it). Everything is soulbound with no buyValue, so
// the only way to own it is to earn hero points in the Frontier and spend them here.
//
// The Frostreach hub coordinate comes from ../pvp/frontier (the single geometry
// source), so the vendor cannot drift out of the safe zone.

import { FRONTIER_HUB } from '../pvp/frontier';
import type { ItemDef, NpcDef } from '../types';

export const FRONTIER_QM_NPC_ID = 'frostreach_quartermaster';
// Reserved so adding the Quartermaster does not shift the deterministic nextId
// sequence used by every existing world spawn and parity replay. FURY holds
// 1_000_000_001; this is the next reserved slot.
export const FRONTIER_QM_ENTITY_ID = 1_000_000_002;

// Source level the Season 1 stock reads as. 25 + the epic quality bump (6) puts
// every piece at item level 31, one tier above FURY's item-level-28 warfare set.
export const FROSTREACH_SOURCE_LEVEL = 25;

export const SEASON1_ITEMS: Record<string, ItemDef> = {
  // Frostrend Battlegear: item-level-31 mail Strength and Stamina, the Season 1
  // physical set. Stat sums per slot equal primaryStatBudget(31, 'epic', slot):
  // helmet 18, shoulder 16, chest 22, waist 15, legs 20, gloves 15, feet 14,
  // neck 14, ring 13.
  frostrend_helm: {
    id: 'frostrend_helm',
    name: 'Frostrend Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 300, str: 8, sta: 10 },
    pvpOffenseRating: 19,
    pvpDefenseRating: 19,
    priceHero: 70,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_spaulders: {
    id: 'frostrend_spaulders',
    name: 'Frostrend Spaulders',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 255, str: 7, sta: 9 },
    pvpOffenseRating: 17,
    pvpDefenseRating: 17,
    priceHero: 55,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_hauberk: {
    id: 'frostrend_hauberk',
    name: 'Frostrend Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 360, str: 10, sta: 12 },
    pvpOffenseRating: 22,
    pvpDefenseRating: 22,
    priceHero: 90,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_girdle: {
    id: 'frostrend_girdle',
    name: 'Frostrend Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 235, str: 7, sta: 8 },
    pvpOffenseRating: 16,
    pvpDefenseRating: 16,
    priceHero: 45,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_legguards: {
    id: 'frostrend_legguards',
    name: 'Frostrend Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 335, str: 9, sta: 11 },
    pvpOffenseRating: 20,
    pvpDefenseRating: 20,
    priceHero: 80,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_gauntlets: {
    id: 'frostrend_gauntlets',
    name: 'Frostrend Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 235, str: 7, sta: 8 },
    pvpOffenseRating: 16,
    pvpDefenseRating: 16,
    priceHero: 45,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_sabatons: {
    id: 'frostrend_sabatons',
    name: 'Frostrend Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 220, str: 6, sta: 8 },
    pvpOffenseRating: 15,
    pvpDefenseRating: 15,
    priceHero: 45,
    sellValue: 0,
    soulbound: true,
  },
  // Jewelry: no armorType gate, usable by any physical class. Neck 14, ring 13.
  frostrend_choker: {
    id: 'frostrend_choker',
    name: 'Frostrend Choker',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, sta: 8 },
    pvpOffenseRating: 15,
    pvpDefenseRating: 15,
    priceHero: 45,
    sellValue: 0,
    soulbound: true,
  },
  frostrend_band: {
    id: 'frostrend_band',
    name: 'Frostrend Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, sta: 7 },
    pvpOffenseRating: 14,
    pvpDefenseRating: 14,
    priceHero: 40,
    sellValue: 0,
    soulbound: true,
  },
};

export const FRONTIER_QM_STOCK: readonly string[] = Object.keys(SEASON1_ITEMS);

export const FRONTIER_QM_NPC: NpcDef = {
  id: FRONTIER_QM_NPC_ID,
  name: 'Vaelka Frostwarden',
  title: 'Frostreach Quartermaster',
  pos: { x: FRONTIER_HUB.x - 8, z: FRONTIER_HUB.z + 6 },
  facing: -Math.PI / 2,
  color: 0x8fc7e8,
  questIds: [],
  vendorItems: [...FRONTIER_QM_STOCK],
  dynamic: true,
  greeting: 'The Frontier pays in blood and frost. Spend your hero points well.',
};

// The Frontier Marshal: the hub's daily-quest giver. Stands opposite the
// Quartermaster and hands out the repeatable honor daily. Same reserved-id,
// dynamic, spawn-after-the-roster pattern as the vendor, so parity is untouched.
export const FRONTIER_MARSHAL_NPC_ID = 'frontier_marshal';
export const FRONTIER_MARSHAL_ENTITY_ID = 1_000_000_003;

export const FRONTIER_MARSHAL_NPC: NpcDef = {
  id: FRONTIER_MARSHAL_NPC_ID,
  name: 'Marshal Dregg',
  title: 'Frontier Marshal',
  pos: { x: FRONTIER_HUB.x + 8, z: FRONTIER_HUB.z - 6 },
  facing: Math.PI / 2,
  color: 0x4a6fa5,
  questIds: ['frontier_daily_muster'],
  dynamic: true,
  greeting: 'Hold the line, soldier. The Frontier never sleeps, and neither do we.',
};
