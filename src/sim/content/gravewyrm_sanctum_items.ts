// The Gravewyrm Sanctum's reworked loot (docs/design/dungeon-rework/
// gravewyrm_sanctum.md, section 9): Korgath the Bound and Grand Necromancer
// Velkhar stop sharing Korzul's trio and drop a guaranteed piece of their own
// three-way archetype group (Heavy: warrior, paladin, shaman; Agile: rogue,
// hunter; Caster: mage, priest, warlock, druid). Korzul keeps the shipped trio;
// every shipped bonus row, the reagent satchel, the gold and the reins stay.
// Normal pieces sit at the bosses' level 20 plus the quality bump (uncommon
// 21), stats exactly on primaryStatBudget with the stamina baseline model
// (item_budget.ts):
//   gloves 21 uncommon: 6, feet: 5, shoulder: 6, legs: 7, helmet: 7, waist: 6
// (caster pieces carry their free stamina baseline, round(budget / 3), on top).
// Armor follows the same-slot item-level-21 five-man values: mail legs 153,
// leather helmet 86, cloth waist 34, leather feet 72. The mail gloves and
// cloth shoulder step up from their item-level-20 values (104 and 44), one
// point of armor per level up: 106 and 45.
//
// The two heroic epics read source level 25 (item level 31) with the five-man
// heroic ratings for their slot: the Hammer of the Open Lock as a Heavy
// two-hander (50 hit), the Vestments of the Waking Rite as a cloth chest (40
// haste). The three trinkets live with the others in content/trinkets.ts.
//
// Names were re-checked at authoring (2026-10-03, design section 11):
// exact-phrase searches for every item name (Foreman's Grips, Serac-Stride
// Boots, Seal-Rune Mantle, Thawbound Legguards, Pyre-Tender's Hood, Meltwater
// Cord, Hammer of the Open Lock, Vestments of the Waking Rite, Foreman's Last
// Link, Phial of the Tithe, Quenchwater Flask) found no game use. World of
// Warcraft has a "Foreman's Gloves" (a different full name built from generic
// English), so the Grips stay. Every name is a generic English compound.

import type { ItemDef } from '../types';
import { ARMOR_RATING, FIVE_MAN_WEAPON_RATING } from './heroic_loot';

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

export const GRAVEWYRM_SANCTUM_ITEMS: Record<string, ItemDef> = {
  // ---- Korgath the Bound (level 20) ----
  foremans_grips: {
    id: 'foremans_grips',
    name: "Foreman's Grips",
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 106, str: 4, sta: 2 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  serac_stride_boots: {
    id: 'serac_stride_boots',
    name: 'Serac-Stride Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 72, agi: 3, sta: 2 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  seal_rune_mantle: {
    id: 'seal_rune_mantle',
    name: 'Seal-Rune Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 45, int: 4, spi: 2, sta: 2 },
    sellValue: 900,
    requiredClass: CASTER,
  },
  // ---- Grand Necromancer Velkhar (level 20) ----
  thawbound_legguards: {
    id: 'thawbound_legguards',
    name: 'Thawbound Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 153, str: 4, sta: 3 },
    sellValue: 900,
    requiredClass: HEAVY,
  },
  pyre_tenders_hood: {
    id: 'pyre_tenders_hood',
    name: "Pyre-Tender's Hood",
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 86, agi: 4, sta: 3 },
    sellValue: 900,
    requiredClass: AGILE,
  },
  meltwater_cord: {
    id: 'meltwater_cord',
    name: 'Meltwater Cord',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 34, int: 4, spi: 2, sta: 2 },
    sellValue: 900,
    requiredClass: CASTER,
  },
  // ---- Heroic epics (source level 25, item level 31) ----
  hammer_of_the_open_lock: {
    id: 'hammer_of_the_open_lock',
    name: 'Hammer of the Open Lock',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    requiredLevel: 20,
    // The Steam Hammer's line: a five-man heroic HEAVY two-hander.
    weapon: { min: 50, max: 75, speed: 3.4 },
    stats: { str: 17, sta: 12 },
    hitRating: FIVE_MAN_WEAPON_RATING,
    sellValue: 15000,
    requiredClass: HEAVY,
  },
  vestments_of_the_waking_rite: {
    id: 'vestments_of_the_waking_rite',
    name: 'Vestments of the Waking Rite',
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
};
