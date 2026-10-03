// The Hollow Crypt rework's loot (docs/design/dungeon-rework/hollow_crypt.md,
// section 8): every boss now drops its own table. Normal pieces sit at the
// boss's level plus the quality bump with stats at primaryStatBudget; the two
// new heroic epics read source level 25 (item level 31) with the five-man
// heroic ratings. Rares in a boss's base table get their Heroic variant
// generated (content/heroic_variants.ts), never hand-authored here.
//
// Every id below ships a painted icon (batch hollow-crypt-icons-2026-10-03,
// scripts/generate_hollow_crypt_item_icons.mjs), the generated Heroic
// Cantor's Hymnal included; the two Heroic weapons keep their base painting.

import type { ItemDef } from '../types';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

export const HOLLOW_CRYPT_ITEMS: Record<string, ItemDef> = {
  // ---- Sexton Marrow (level 8) ----
  gravedirt_treads: {
    id: 'gravedirt_treads',
    name: 'Gravedirt Treads',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 30, str: 1, sta: 1 },
    sellValue: 150,
    requiredClass: HEAVY,
  },
  bellrope_girdle: {
    id: 'bellrope_girdle',
    name: 'Bellrope Girdle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 16, int: 1, spi: 1, sta: 1 },
    sellValue: 140,
    requiredClass: CASTER,
  },
  sextons_spadehaft: {
    id: 'sextons_spadehaft',
    name: "Sexton's Spadehaft",
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'rare',
    weapon: { min: 30, max: 46, speed: 3.3 },
    stats: { str: 5, sta: 3 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  // ---- Rimeweb (level 9) ----
  rimesilk_mantle: {
    id: 'rimesilk_mantle',
    name: 'Rimesilk Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 23, int: 2, spi: 1, sta: 1 },
    sellValue: 170,
    requiredClass: CASTER,
  },
  bonechill_carapace_vest: {
    id: 'bonechill_carapace_vest',
    name: 'Bonechill Carapace Vest',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 60, str: 2, sta: 2 },
    sellValue: 190,
    requiredClass: HEAVY,
  },
  rimeweb_hunters_leggings: {
    id: 'rimeweb_hunters_leggings',
    name: "Rimeweb Hunter's Leggings",
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 40, agi: 2, sta: 1 },
    sellValue: 180,
    requiredClass: AGILE,
  },
  rimeweb_fang: {
    id: 'rimeweb_fang',
    name: 'Rimeweb Fang',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 14, max: 21, speed: 1.7, dagger: true },
    stats: { agi: 4, sta: 3 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  // ---- Cantor Ilvane (level 9) ----
  cantors_cassock: {
    id: 'cantors_cassock',
    name: "Cantor's Cassock",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 36, int: 3, spi: 1, sta: 1 },
    sellValue: 190,
    requiredClass: CASTER,
  },
  choirward_leggings: {
    id: 'choirward_leggings',
    name: 'Choirward Leggings',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 52, str: 2, sta: 1 },
    sellValue: 180,
    requiredClass: HEAVY,
  },
  choristers_gloves: {
    id: 'choristers_gloves',
    name: "Chorister's Gloves",
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 24, agi: 2, sta: 1 },
    sellValue: 160,
    requiredClass: AGILE,
  },
  cantors_hymnal: {
    id: 'cantors_hymnal',
    name: "Cantor's Hymnal",
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'rare',
    stats: { int: 3, spi: 2, sta: 2 },
    sellValue: 850,
    requiredClass: CASTER,
  },
  // ---- Morthen the Gravecaller (level 10) ----
  gravecallers_vestments: {
    id: 'gravecallers_vestments',
    name: "Gravecaller's Vestments",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 38, int: 3, spi: 1, sta: 1 },
    sellValue: 200,
    requiredClass: CASTER,
  },
  unquiet_stalkers_hood: {
    id: 'unquiet_stalkers_hood',
    name: "Unquiet Stalker's Hood",
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 32, agi: 3, sta: 1 },
    sellValue: 190,
    requiredClass: AGILE,
  },
  // ---- Heroic epics (source level 25, item level 31) ----
  sextons_burial_spade: {
    id: 'sextons_burial_spade',
    name: "Sexton's Burial Spade",
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 50, max: 75, speed: 3.4 },
    stats: { str: 17, sta: 12 },
    hitRating: FIVE_MAN_WEAPON_RATING,
    sellValue: 14000,
    requiredClass: HEAVY,
  },
  rimesilk_hood: {
    id: 'rimesilk_hood',
    name: 'Rimesilk Hood',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 64, int: 11, spi: 7, sta: 6 },
    hitRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: CASTER,
  },
};

// EMPTY since the hollow-crypt-icons-2026-10-03 wave painted every non-weapon
// piece and the generated Heroic Cantor's Hymnal (the weapons never parked
// here: their paintings ride ITEM_WEAPON_VARIANTS).
export const HOLLOW_CRYPT_ART_PENDING_ITEM_IDS: readonly string[] = [];
