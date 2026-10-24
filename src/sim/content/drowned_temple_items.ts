// The Drowned Temple rework's loot (docs/design/dungeon-rework/drowned_temple.md,
// section 8): Choirmother Selthe and the new Tideglass Colossus each drop one
// guaranteed piece of a three-way archetype group and a rare chase row, and two
// new heroic epics join their Heroic partitions. Normal pieces sit at the boss's
// level plus the quality bump; the heroic epics read source level 25 (item
// level 31) with the five-man heroic ratings. Rares in a boss's base table get
// their Heroic variant generated (content/heroic_variants.ts), never
// hand-authored here. Ysolei's shipped table is unchanged.
//
// Names were checked at authoring (2026-09-30): every name is a generic English
// compound (conch, chorus, refrain, tideglass, prism, moonburn); "Tideglass" is
// already the game's own (the Tideglass Dirk).
//
// The normal blues (maintainer ruling, 2026-10-08; the full rule and the
// armour derivation are in hollow_crypt_items.ts): every boss pays ONE
// normalOnly rare group (`<boss>_blue`), a cloth, leather and mail version of
// one slot plus a weapon. Selthe pays the feet (her shipped Sea-Striders plus
// the two below) with the Chorus Conch, the Colossus the gloves with the
// Tideglass Shiv, the Mere Hydra (its centre head, the one table that rolls
// once per kill) the helm with the Merecleaver, and Ysolei her shipped
// Moonwrack chests with the Moonwrack Stave. New pieces read the boss level
// plus the rare bump (Selthe 19, the Colossus and the Hydra 20, Ysolei 21):
// rare feet 19 = 7, gloves 20 = 8, helm 20 = 10, a two-hander 20 = 14 and
// 21 = 16. Selthe's shipped Sea-Striders keep their shipped item level 21.
// Their icons: batch lower-dungeon-blues-icons-2026-10-08.

import type { ItemDef } from '../types';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];
// The repo's caster-weapon proficiency set (equipment_rules.ts, items.ts,
// heroic_loot.ts): paladins and shamans wield caster staves too.
const CASTER_WEAPON_CLASSES = [
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
] as ItemDef['requiredClass'];

export const DROWNED_TEMPLE_ITEMS: Record<string, ItemDef> = {
  // ---- Choirmother Selthe (level 16) ----
  conchplate_girdle: {
    id: 'conchplate_girdle',
    name: 'Conchplate Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 58, str: 3, sta: 2 },
    sellValue: 210,
    requiredClass: HEAVY,
  },
  pale_chorus_leggings: {
    id: 'pale_chorus_leggings',
    name: 'Pale Chorus Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 72, agi: 4, sta: 2 },
    sellValue: 240,
    requiredClass: AGILE,
  },
  refrain_silk_gloves: {
    id: 'refrain_silk_gloves',
    name: 'Refrain Silk Gloves',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 26, int: 3, spi: 2, sta: 2 },
    sellValue: 200,
    requiredClass: CASTER,
  },
  chorus_conch: {
    id: 'chorus_conch',
    name: 'Chorus Conch',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'rare',
    stats: { int: 5, spi: 3, sta: 3 },
    sellValue: 1100,
    requiredClass: CASTER,
  },
  // Selthe's blue feet beside her Sea-Striders (item level 19, budget 7;
  // armour 145 / 52).
  conchplate_sabatons: {
    id: 'conchplate_sabatons',
    name: 'Conchplate Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 145, str: 5, sta: 2 },
    sellValue: 1100,
    requiredClass: HEAVY,
  },
  pale_chorus_slippers: {
    id: 'pale_chorus_slippers',
    name: 'Pale Chorus Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 52, int: 5, spi: 2, sta: 2 },
    sellValue: 1100,
    requiredClass: CASTER,
  },
  // ---- The Tideglass Colossus (level 17) ----
  tideglass_pauldrons: {
    id: 'tideglass_pauldrons',
    name: 'Tideglass Pauldrons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 88, str: 3, sta: 2 },
    sellValue: 240,
    requiredClass: HEAVY,
  },
  moonburn_treads: {
    id: 'moonburn_treads',
    name: 'Moonburn Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 50, agi: 3, sta: 2 },
    sellValue: 230,
    requiredClass: AGILE,
  },
  prism_etched_cowl: {
    id: 'prism_etched_cowl',
    name: 'Prism-Etched Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 36, int: 4, spi: 2, sta: 2 },
    sellValue: 240,
    requiredClass: CASTER,
  },
  tideglass_shiv: {
    id: 'tideglass_shiv',
    name: 'Tideglass Shiv',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 15, max: 25, speed: 1.7, dagger: true },
    stats: { agi: 7, sta: 4 },
    sellValue: 1300,
    requiredClass: AGILE,
  },
  // The Colossus's blue gloves (item level 20, budget 8; armour 120 / 76 / 43).
  tideglass_gauntlets: {
    id: 'tideglass_gauntlets',
    name: 'Tideglass Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 120, str: 5, sta: 3 },
    sellValue: 1300,
    requiredClass: HEAVY,
  },
  moonburn_grips: {
    id: 'moonburn_grips',
    name: 'Moonburn Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 76, agi: 5, sta: 3 },
    sellValue: 1300,
    requiredClass: AGILE,
  },
  prism_etched_handwraps: {
    id: 'prism_etched_handwraps',
    name: 'Prism-Etched Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 43, int: 5, spi: 3, sta: 3 },
    sellValue: 1300,
    requiredClass: CASTER,
  },
  // ---- The Mere Hydra (level 17; its centre head carries the table) ----
  // Helms at item level 20, budget 10 (armour 185 / 117 / 66), and the
  // Merecleaver: a Heavy two-hander at item level 20, budget round(11 x 1.3)
  // = 14, weaponDpsBudget(20) x 1.15 = 14.6 DPS.
  mere_crested_helm: {
    id: 'mere_crested_helm',
    name: 'Mere-Crested Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 185, str: 7, sta: 3 },
    sellValue: 1300,
    requiredClass: HEAVY,
  },
  mereskin_hood: {
    id: 'mereskin_hood',
    name: 'Mereskin Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 117, agi: 7, sta: 3 },
    sellValue: 1300,
    requiredClass: AGILE,
  },
  merewater_cowl: {
    id: 'merewater_cowl',
    name: 'Merewater Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 66, int: 7, spi: 3, sta: 3 },
    sellValue: 1300,
    requiredClass: CASTER,
  },
  merecleaver: {
    id: 'merecleaver',
    name: 'Merecleaver',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'rare',
    weapon: { min: 39, max: 60, speed: 3.4 },
    stats: { str: 9, sta: 5 },
    sellValue: 1300,
    requiredClass: HEAVY,
  },
  // ---- Ysolei (level 18): the Moonwrack Stave beside her shipped Moonwrack
  // chests. A caster two-hander at item level 21: line round(12 x 1.3) = 16
  // plus its stamina baseline 5, weaponDpsBudget(21) x 1.15 = 15.0 DPS. ----
  moonwrack_stave: {
    id: 'moonwrack_stave',
    name: 'Moonwrack Stave',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'rare',
    weapon: { min: 37, max: 55, speed: 3.1 },
    stats: { int: 10, spi: 6, sta: 5 },
    sellValue: 2400,
    requiredClass: CASTER_WEAPON_CLASSES,
  },
  // ---- Heroic epics (source level 25, item level 31) ----
  pale_chorus_vestment: {
    id: 'pale_chorus_vestment',
    name: 'Pale Chorus Vestment',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 90, int: 12, spi: 10, sta: 7 },
    hasteRating: ARMOR_RATING,
    sellValue: 14000,
    requiredClass: CASTER,
  },
  tideglass_warmaul: {
    id: 'tideglass_warmaul',
    name: 'Tideglass Warmaul',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 34, max: 56, speed: 2.8 },
    stats: { str: 13, sta: 9 },
    hitRating: FIVE_MAN_WEAPON_RATING,
    sellValue: 15000,
    requiredClass: HEAVY,
  },
};
