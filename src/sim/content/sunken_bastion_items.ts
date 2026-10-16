// The Sunken Bastion rework's loot (docs/design/dungeon-rework/sunken_bastion.md,
// section 8): Olen gains a rare chase row, the new Gaoler Ossick drops his own
// table, the Gaol Turnkey (the gaol's miniboss) drops one piece per archetype
// group, and two new heroic epics join the Heroic partitions. Normal pieces sit
// at the boss's level plus the quality bump with stats at primaryStatBudget;
// the heroic epics read source level 25 (item level 31) with the five-man
// heroic ratings. Rares in a boss's base table get their Heroic variant
// generated (content/heroic_variants.ts), never hand-authored here. The
// Gaoler's Iron Key trinket lives in content/trinkets.ts.
//
// Names were IP-checked at authoring (2026-09-29): the design's "Oathwarden"
// (a Guild Wars boss surname), "Keelhauler" (a WoW item and a Starfield
// pistol) and "Shacklebreaker" (an ESO set) were replaced by generic English.
//
// Icon art: scripts/generate_sunken_bastion_item_icons.mjs (the mapping.json
// batch sunken-bastion-icons-2026-09-29), the Iron Key included.
//
// The normal blues (maintainer ruling, 2026-10-08; the full rule and the
// armour derivation are in hollow_crypt_items.ts): every boss and the Gaol
// Turnkey pay ONE normalOnly rare group (`<boss>_blue`), a cloth, leather and
// mail version of one slot plus a weapon. The Bastion's shipped rares already
// held two whole slots, split across two bosses, so they MOVE between bosses
// by loot-table edits (dungeon-rework README section 7) instead of new pieces
// being minted: Olen pays the legs (Tideguard Greaves, Eelscale Leggings and
// the Drowned Prayer Leggings from Vael), Vael the feet (Drowned Prayer
// Sandals, Eelscale Treads and the Tideguard Sabatons from Olen), Ossick the
// chest (the Tidescale Vest from Vael plus the two pieces below), and the
// Turnkey the waist. Every shipped piece keeps its item level 16
// (item_level.ts preserved source levels). New pieces read item level 16
// (boss level 13 plus the rare bump): rare waist 6, chest 9, one-hand 9.
// Their icons: batch lower-dungeon-blues-icons-2026-10-08.

import type { ItemDef } from '../types';
import { ARMOR_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

export const SUNKEN_BASTION_ITEMS: Record<string, ItemDef> = {
  // ---- Knight-Commander Olen (level 12) ----
  knight_commanders_longsword: {
    id: 'knight_commanders_longsword',
    name: "Knight-Commander's Longsword",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 16, max: 26, speed: 2.4 },
    stats: { str: 5, sta: 3 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  // ---- Gaoler Ossick (level 13) ----
  gaolers_chain_girdle: {
    id: 'gaolers_chain_girdle',
    name: "Gaoler's Chain Girdle",
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 48, str: 2, sta: 2 },
    sellValue: 160,
    requiredClass: HEAVY,
  },
  rusted_shackle_grips: {
    id: 'rusted_shackle_grips',
    name: 'Rusted Shackle Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 30, agi: 3, sta: 1 },
    sellValue: 160,
    requiredClass: AGILE,
  },
  drowned_wardens_mantle: {
    id: 'drowned_wardens_mantle',
    name: "Drowned Warden's Mantle",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 30, int: 2, spi: 2, sta: 1 },
    sellValue: 170,
    requiredClass: CASTER,
  },
  gaolyard_cudgel: {
    id: 'gaolyard_cudgel',
    name: 'Gaolyard Cudgel',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 18, max: 29, speed: 2.6 },
    stats: { str: 5, sta: 4 },
    sellValue: 950,
    requiredClass: HEAVY,
  },
  // Ossick's blue chests beside the Tidescale Vest (item level 16, budget 9;
  // armour 86 / 48).
  gaolyard_jerkin: {
    id: 'gaolyard_jerkin',
    name: 'Gaolyard Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 86, agi: 6, sta: 3 },
    sellValue: 1100,
    requiredClass: AGILE,
  },
  brinewarden_robe: {
    id: 'brinewarden_robe',
    name: 'Brinewarden Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 48, int: 6, spi: 3, sta: 3 },
    sellValue: 1100,
    requiredClass: CASTER,
  },
  // ---- Vael the Fogbinder (level 13): his blue rod (item level 16, budget 9,
  // weaponDpsBudget(16) 11.5 DPS) ----
  fogbinders_rod: {
    id: 'fogbinders_rod',
    name: "Fogbinder's Rod",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 26, max: 43, speed: 3.0 },
    stats: { int: 6, spi: 3, sta: 3 },
    sellValue: 1100,
    requiredClass: CASTER,
  },
  // ---- The Gaol Turnkey, the gaol's miniboss (level 13) ----
  jailers_iron_gauntlets: {
    id: 'jailers_iron_gauntlets',
    name: "Jailer's Iron Gauntlets",
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 38, str: 2, sta: 2 },
    sellValue: 140,
    requiredClass: HEAVY,
  },
  turnkeys_keyring_belt: {
    id: 'turnkeys_keyring_belt',
    name: "Turnkey's Keyring Belt",
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 24, agi: 3, sta: 1 },
    sellValue: 140,
    requiredClass: AGILE,
  },
  turnkeys_lantern_cowl: {
    id: 'turnkeys_lantern_cowl',
    name: "Turnkey's Lantern Cowl",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 26, int: 4, spi: 1, sta: 2 },
    sellValue: 150,
    requiredClass: CASTER,
  },
  // The Turnkey's blue belts and shank (item level 16, budget 6; armour
  // 69 / 47 / 26; the shank at weaponDpsBudget(16), 11.5 DPS).
  portcullis_girdle: {
    id: 'portcullis_girdle',
    name: 'Portcullis Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 69, str: 4, sta: 2 },
    sellValue: 1100,
    requiredClass: HEAVY,
  },
  cellwatch_belt: {
    id: 'cellwatch_belt',
    name: 'Cellwatch Belt',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 47, agi: 4, sta: 2 },
    sellValue: 1100,
    requiredClass: AGILE,
  },
  lanternwick_sash: {
    id: 'lanternwick_sash',
    name: 'Lanternwick Sash',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 26, int: 4, spi: 2, sta: 2 },
    sellValue: 1100,
    requiredClass: CASTER,
  },
  turnkeys_shank: {
    id: 'turnkeys_shank',
    name: "Turnkey's Shank",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 15, max: 24, speed: 1.7, dagger: true },
    stats: { agi: 6, sta: 3 },
    sellValue: 1100,
    requiredClass: AGILE,
  },
  // ---- Heroic epics (source level 25, item level 31) ----
  drowned_commanders_breastplate: {
    id: 'drowned_commanders_breastplate',
    name: "Drowned Commander's Breastplate",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 335, str: 12, sta: 10 },
    hitRating: ARMOR_RATING,
    sellValue: 14000,
    requiredClass: HEAVY,
  },
  gaolyard_striders: {
    id: 'gaolyard_striders',
    name: 'Gaolyard Striders',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 96, agi: 9, sta: 5 },
    critRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: AGILE,
  },
};
