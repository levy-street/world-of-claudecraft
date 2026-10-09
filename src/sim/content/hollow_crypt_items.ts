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
//
// The normal blues (maintainer ruling, 2026-10-08): every boss pays ONE
// normalOnly rare group (`<boss>_blue`): a cloth, a leather and a mail
// version of one armour slot plus one weapon, about 35 percent in equal
// shares on a wing boss and guaranteed on Morthen. The shipped rare chase
// rows (Spadehaft, Bride's Icicle, Cantor's Hymnal) are each boss's weapon.
// Slots: Marrow gloves, the Lady helm, Ilvane shoulders, Morthen chest. Item
// level is the boss level plus the rare bump (11, 12, 12, 13); stats sit
// exactly on primaryStatBudget with the stamina baseline model
// (item_budget.ts): rare gloves 11 = 4, helm 12 = 6, shoulder 12 = 5, chest
// 13 = 7, a one-hand 13 = 7 (caster pieces add round(budget / 3) stamina).
// Armour has no repo-wide budget; it follows the items.ts Inventory 2.0
// slot weighting (head 1.0, shoulder 0.75, gloves 0.65, waist 0.55; feet
// 0.85, measured on the Bastion's shipped rare legs/feet pairs) off a
// per-type chest/legs baseline interpolated by item level between the three
// lower dungeons' own archetype rares: item level 10 (the Crypt's shipped
// rare chests: mail 105, leather 65, cloth 38), 16 (the Bastion's Tideguard,
// Eelscale and Drowned Prayer legs: 125, 86, 48) and 21 (Ysolei's Moonwrack
// chests: 200, 125, 70). Weapon damage is weaponDpsBudget at the item level.
// Their icons: batch lower-dungeon-blues-icons-2026-10-08.

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
  // Marrow's blue gloves (item level 11, budget 4; armour 70 / 45 / 26).
  spadeworn_gauntlets: {
    id: 'spadeworn_gauntlets',
    name: 'Spadeworn Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 70, str: 3, sta: 1 },
    sellValue: 850,
    requiredClass: HEAVY,
  },
  gravedirt_grips: {
    id: 'gravedirt_grips',
    name: 'Gravedirt Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 45, agi: 3, sta: 1 },
    sellValue: 850,
    requiredClass: AGILE,
  },
  bellrope_mitts: {
    id: 'bellrope_mitts',
    name: 'Bellrope Mitts',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 26, int: 3, spi: 1, sta: 1 },
    sellValue: 850,
    requiredClass: CASTER,
  },
  // ---- The Lady of the Bonechill (level 9; boss id rimeweb). The spider
  // placeholder's leftovers keep their frozen ids under bridal frost names. ----
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
    name: 'Bonechill Hauberk',
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
    name: 'Rime-Laced Leggings',
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
    name: "Bride's Icicle",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 14, max: 21, speed: 1.7, dagger: true },
    stats: { agi: 4, sta: 3 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  // The Lady's blue helms (item level 12, budget 6; armour 112 / 72 / 41).
  rimewreath_coif: {
    id: 'rimewreath_coif',
    name: 'Rimewreath Coif',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 112, str: 4, sta: 2 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  rime_laced_hood: {
    id: 'rime_laced_hood',
    name: 'Rime-Laced Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 72, agi: 4, sta: 2 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  lamenting_veil: {
    id: 'lamenting_veil',
    name: 'Lamenting Veil',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 41, int: 4, spi: 2, sta: 2 },
    sellValue: 900,
    requiredClass: CASTER,
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
  // Ilvane's blue shoulders (item level 12, budget 5; armour 84 / 54 / 31).
  choirward_pauldrons: {
    id: 'choirward_pauldrons',
    name: 'Choirward Pauldrons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 84, str: 3, sta: 2 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  choristers_spaulders: {
    id: 'choristers_spaulders',
    name: "Chorister's Spaulders",
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 54, agi: 3, sta: 2 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  cantors_stole: {
    id: 'cantors_stole',
    name: "Cantor's Stole",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 31, int: 3, spi: 2, sta: 2 },
    sellValue: 900,
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
  // Morthen's blue chests and rod (item level 13, budget 7; armour
  // 115 / 76 / 43; the rod at weaponDpsBudget(13), 10.6 DPS).
  knellbound_hauberk: {
    id: 'knellbound_hauberk',
    name: 'Knellbound Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 115, str: 5, sta: 2 },
    sellValue: 950,
    requiredClass: HEAVY,
  },
  candlewatch_jerkin: {
    id: 'candlewatch_jerkin',
    name: 'Candlewatch Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 76, agi: 5, sta: 2 },
    sellValue: 950,
    requiredClass: AGILE,
  },
  robe_of_the_unquiet_rite: {
    id: 'robe_of_the_unquiet_rite',
    name: 'Robe of the Unquiet Rite',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 43, int: 5, spi: 2, sta: 2 },
    sellValue: 950,
    requiredClass: CASTER,
  },
  gravecallers_rod: {
    id: 'gravecallers_rod',
    name: "Gravecaller's Rod",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 24, max: 40, speed: 3.0 },
    stats: { int: 5, spi: 2, sta: 2 },
    sellValue: 950,
    requiredClass: CASTER,
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
