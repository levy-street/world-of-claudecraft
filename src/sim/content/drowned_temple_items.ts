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

import type { ItemDef } from '../types';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

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
