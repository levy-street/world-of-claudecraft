// Heroic-only boss drops: epic gear that ONLY rolls when the final boss of a
// heroic instance dies (loot/loot_roll.ts appends these entries to the normal
// table when the mob's claimed instance is heroic, so party need/greed rules
// apply unchanged). Every piece reads item level 31: the source index
// (item_level.ts) registers these ids at HEROIC_LOOT_SOURCE_LEVEL 25 (level-20
// content plus the heroic tier bump) and the epic quality bonus adds 6. Stat
// sums are exact per the item-level budget (STAT_PER_ILVL x slot mult), pinned
// by the tests/item_level.test.ts heroic sweep. requiredClass locks follow the
// three established archetype groups so every class has pieces to chase.

import type { ItemDef, LootEntry } from '../types';

// Source level the heroic drop table reads as in the item-level index: the
// dungeons are level-20 content and heroic is the tier above (+5), so the
// epic pieces land at item level 31 (25 + the epic bump of 6).
export const HEROIC_LOOT_SOURCE_LEVEL = 25;

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass'];
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const AGILE_WILD = ['rogue', 'hunter', 'druid'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

export const HEROIC_ITEMS: Record<string, ItemDef> = {
  // ---- Heroic Hollow Crypt: Morthen ----
  morthens_cryptforged_hauberk: {
    id: 'morthens_cryptforged_hauberk',
    name: "Morthen's Cryptforged Hauberk",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 335, str: 12, sta: 10 },
    sellValue: 14000,
    requiredClass: HEAVY,
  },
  shadowpulse_handwraps: {
    id: 'shadowpulse_handwraps',
    name: 'Shadowpulse Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 52, int: 9, spi: 6 },
    sellValue: 9500,
    requiredClass: CASTER,
  },
  bonechill_striders: {
    id: 'bonechill_striders',
    name: 'Bonechill Striders',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 96, agi: 9, sta: 5 },
    sellValue: 9500,
    requiredClass: AGILE,
  },
  // ---- Heroic Sunken Bastion: Vael the Mistcaller ----
  mistcallers_fang: {
    id: 'mistcallers_fang',
    name: "Mistcaller's Fang",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 24, max: 40, speed: 1.8 },
    stats: { agi: 13, sta: 9 },
    sellValue: 15000,
    requiredClass: AGILE,
  },
  tidebound_spaulders: {
    id: 'tidebound_spaulders',
    name: 'Tidebound Spaulders',
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 148, agi: 10, sta: 6 },
    sellValue: 11000,
    requiredClass: AGILE_WILD,
  },
  sash_of_the_sunken_court: {
    id: 'sash_of_the_sunken_court',
    name: 'Sash of the Sunken Court',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 48, int: 9, sta: 6 },
    sellValue: 9500,
    requiredClass: CASTER,
  },
  // ---- Heroic Drowned Temple: Ysolei ----
  lunar_tide_greatstaff: {
    id: 'lunar_tide_greatstaff',
    name: 'Lunar Tide Greatstaff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 30, max: 50, speed: 3.0 },
    stats: { int: 13, spi: 9 },
    sellValue: 15000,
    requiredClass: CASTER,
  },
  tidewoven_trousers: {
    id: 'tidewoven_trousers',
    name: 'Tidewoven Trousers',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 132, agi: 12, sta: 8 },
    sellValue: 12000,
    requiredClass: AGILE,
  },
  choirmothers_casque: {
    id: 'choirmothers_casque',
    name: "Choirmother's Casque",
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 292, int: 10, spi: 8 },
    sellValue: 12000,
    requiredClass: HEAVY,
  },
  // ---- Heroic Gravewyrm Sanctum: Korzul the Gravewyrm ----
  gravewyrm_cleaver: {
    id: 'gravewyrm_cleaver',
    name: 'Gravewyrm Cleaver',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 26, max: 44, speed: 2.6 },
    stats: { str: 13, sta: 9 },
    sellValue: 15000,
    requiredClass: HEAVY,
  },
  shroud_of_the_gravewyrm: {
    id: 'shroud_of_the_gravewyrm',
    name: 'Shroud of the Gravewyrm',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 90, int: 12, spi: 10 },
    sellValue: 14000,
    requiredClass: CASTER,
  },
  sanctum_prowlers_grips: {
    id: 'sanctum_prowlers_grips',
    name: "Sanctum Prowler's Grips",
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 104, agi: 9, sta: 6 },
    sellValue: 9500,
    requiredClass: AGILE,
  },
  // ---- Heroic Nythraxis, Scourge of Thornpeak ----
  scepter_of_the_deathless_court: {
    id: 'scepter_of_the_deathless_court',
    name: 'Scepter of the Deathless Court',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 22, max: 38, speed: 2.4 },
    stats: { int: 12, spi: 10 },
    sellValue: 16000,
    requiredClass: CASTER,
  },
  deathless_warguard_legmail: {
    id: 'deathless_warguard_legmail',
    name: 'Deathless Warguard Legmail',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 315, str: 11, sta: 9 },
    sellValue: 13000,
    requiredClass: HEAVY,
  },
  soulrend_diadem: {
    id: 'soulrend_diadem',
    name: 'Soulrend Diadem',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 76, int: 10, spi: 8 },
    sellValue: 12000,
    requiredClass: CASTER,
  },
  scourgehide_carapace: {
    id: 'scourgehide_carapace',
    name: 'Scourgehide Carapace',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 172, agi: 12, sta: 10 },
    sellValue: 14000,
    requiredClass: AGILE_WILD,
  },
};

// Heroic-only drop tables per final boss. Chances inside each rollGroup sum to
// 1.0 so exactly ONE heroic epic drops per kill (the classic one-epic-per-boss
// heroic cadence); loot_roll.ts rolls these only for a heroic-claimed instance.
export const HEROIC_BOSS_LOOT: Record<string, LootEntry[]> = {
  morthen: [
    { itemId: 'morthens_cryptforged_hauberk', chance: 0.34, rollGroup: 'morthen_heroic' },
    { itemId: 'shadowpulse_handwraps', chance: 0.33, rollGroup: 'morthen_heroic' },
    { itemId: 'bonechill_striders', chance: 0.33, rollGroup: 'morthen_heroic' },
  ],
  vael_the_mistcaller: [
    { itemId: 'mistcallers_fang', chance: 0.34, rollGroup: 'vael_heroic' },
    { itemId: 'tidebound_spaulders', chance: 0.33, rollGroup: 'vael_heroic' },
    { itemId: 'sash_of_the_sunken_court', chance: 0.33, rollGroup: 'vael_heroic' },
  ],
  ysolei: [
    { itemId: 'lunar_tide_greatstaff', chance: 0.34, rollGroup: 'ysolei_heroic' },
    { itemId: 'tidewoven_trousers', chance: 0.33, rollGroup: 'ysolei_heroic' },
    { itemId: 'choirmothers_casque', chance: 0.33, rollGroup: 'ysolei_heroic' },
  ],
  korzul_the_gravewyrm: [
    { itemId: 'gravewyrm_cleaver', chance: 0.34, rollGroup: 'korzul_heroic' },
    { itemId: 'shroud_of_the_gravewyrm', chance: 0.33, rollGroup: 'korzul_heroic' },
    { itemId: 'sanctum_prowlers_grips', chance: 0.33, rollGroup: 'korzul_heroic' },
  ],
  nythraxis_scourge_of_thornpeak: [
    { itemId: 'scepter_of_the_deathless_court', chance: 0.25, rollGroup: 'nythraxis_heroic' },
    { itemId: 'deathless_warguard_legmail', chance: 0.25, rollGroup: 'nythraxis_heroic' },
    { itemId: 'soulrend_diadem', chance: 0.25, rollGroup: 'nythraxis_heroic' },
    { itemId: 'scourgehide_carapace', chance: 0.25, rollGroup: 'nythraxis_heroic' },
  ],
};
