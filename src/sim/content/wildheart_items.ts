// The Wildheart Basin's reworked loot (docs/design/dungeon-rework/wildheart_basin.md,
// section 8): the Fanglord Beastmaster and the Gorgebloom each drop one
// guaranteed piece of a three-way archetype group (Heavy: warrior, paladin,
// shaman; Agile: rogue, hunter; Caster: mage, priest, warlock, druid), and the
// Gorgebloom adds the Falls-Blessed Staff as its rare chase row. Zulgar keeps
// his shipped table (WILDHEART_ITEMS in wildheart.ts). Normal pieces sit at the
// bosses' level 20 plus the quality bump (uncommon 21, rare 23), stats exactly
// on primaryStatBudget with the stamina baseline model (item_budget.ts):
//   waist 21 uncommon: round(21 x 0.55 x 0.7 x 0.7) = 6
//   chest 21 uncommon: round(21 x 0.55 x 1.0 x 0.7) = 8
//   gloves 21 uncommon: 6, feet: 5, legs: 7, helmet: 7
//   two-hand staff 23 rare: round(round(23 x 0.8 x 1.0 x 0.7) x 1.3) = 17
// (caster pieces carry their free stamina baseline, round(budget / 3), on top).
// Armor matches the same-slot shipped item-level-21 siblings: the Nightwalk
// Jerkin (105), Vineclaw Stalking Breeches (95), Gravebound Silk Wraps and
// Shearkeeper Gloves (52); the cloth helmet takes the item-level-21 value 49.
// No mail waist or feet piece ships at item level 21, so those two ride the
// item-level-21 slot ratios over the 170 mail chest: waist 0.565 (cloth waist
// 34 over cloth chest 60) = 96, feet 0.686 (leather feet 72 over leather
// chest 105) = 117.
//
// The two heroic epics read source level 25 (item level 31) with the five-man
// heroic armor rating, each matched to its same-slot shipped sibling in
// heroic_loot.ts's tier: the Hide Mantle to the Tidebound Spaulders (leather
// shoulder, 148 armor, 16 points, 40 crit), the Greathelm to the Cryptplate
// Helm (mail helmet, 292 armor, 18 points, 40 hit). The Falls-Blessed Staff's
// Heroic variant is generated (content/heroic_variants.ts), never authored
// here; the two trinkets live with the others in content/trinkets.ts.
//
// Names were re-checked at authoring (2026-10-02, design section 10): every
// item name is a generic English compound with no game hit, except "Thornroot",
// a World of Warcraft coined token (Wild Thornroot, the Thornroot Vest and
// Hauberk armor): the helm ships as the Thorncrowned Greathelm (display only;
// the design's id stays).

import type { ItemDef } from '../types';
import { ARMOR_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];
// The repo's caster-weapon proficiency set (equipment_rules.ts, items.ts,
// heroic_loot.ts): paladins wield caster staves too.
const CASTER_WEAPON_CLASSES = [
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
] as ItemDef['requiredClass'];

export const WILDHEART_BASIN_ITEMS: Record<string, ItemDef> = {
  // ---- The Fanglord Beastmaster (level 20) ----
  beastpit_warbelt: {
    id: 'beastpit_warbelt',
    name: 'Beastpit Warbelt',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 96, str: 4, sta: 2 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  jaguar_hide_jerkin: {
    id: 'jaguar_hide_jerkin',
    name: 'Jaguar-Hide Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 105, agi: 5, sta: 3 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  hexbone_handwraps: {
    id: 'hexbone_handwraps',
    name: 'Hexbone Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 52, int: 4, spi: 2, sta: 2 },
    sellValue: 900,
    requiredClass: CASTER,
  },
  // ---- The Gorgebloom (level 20) ----
  rootbound_sabatons: {
    id: 'rootbound_sabatons',
    name: 'Rootbound Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 117, str: 3, sta: 2 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  pollen_dusted_leggings: {
    id: 'pollen_dusted_leggings',
    name: 'Pollen-Dusted Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 95, agi: 5, sta: 2 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  bloomsilk_cowl: {
    id: 'bloomsilk_cowl',
    name: 'Bloomsilk Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 49, int: 4, spi: 3, sta: 2 },
    sellValue: 900,
    requiredClass: CASTER,
  },
  // The Gorgebloom's rare chase row: item level 23. 2H dps on the
  // weaponDpsBudget(23) x TWOHAND_DPS_MULT curve (13.6 x 1.15, about 15.6 at
  // speed 3.1); the item-level-23 rare caster staff's stat line.
  falls_blessed_staff: {
    id: 'falls_blessed_staff',
    name: 'Falls-Blessed Staff',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'rare',
    weapon: { min: 39, max: 58, speed: 3.1 },
    stats: { int: 11, spi: 6, sta: 6 },
    sellValue: 3200,
    requiredClass: CASTER_WEAPON_CLASSES,
  },
  // ---- Heroic epics (source level 25, item level 31) ----
  fanglords_hide_mantle: {
    id: 'fanglords_hide_mantle',
    name: "Fanglord's Hide Mantle",
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    // primaryStatBudget(31, epic, shoulder) = round(31 x 0.75 x 0.7) = 16.
    stats: { armor: 148, agi: 10, sta: 6 },
    critRating: ARMOR_RATING,
    sellValue: 11000,
    requiredClass: AGILE,
  },
  thornroot_greathelm: {
    id: 'thornroot_greathelm',
    name: 'Thorncrowned Greathelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    // primaryStatBudget(31, epic, helmet) = round(31 x 0.85 x 0.7) = 18.
    stats: { armor: 292, str: 10, sta: 8 },
    hitRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: HEAVY,
  },
};
