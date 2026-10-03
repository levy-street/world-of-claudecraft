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
