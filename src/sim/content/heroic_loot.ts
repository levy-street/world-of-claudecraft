// Heroic-only boss drops: epic gear that ONLY rolls when the final boss of a
// heroic instance dies (loot/loot_roll.ts appends these entries to the normal
// table when the mob's claimed instance is heroic, so party need/greed rules
// apply unchanged). Every piece reads item level 31: the source index
// (item_level.ts) registers these ids at HEROIC_LOOT_SOURCE_LEVEL 25 (level-20
// content plus the heroic tier bump) and the epic quality bonus adds 6. Stat
// sums are exact per the item-level budget (STAT_PER_ILVL x slot mult), pinned
// by the tests/item_level.test.ts heroic sweep. requiredClass locks follow the
// established archetype groups so every class has a near-complete set to chase.
//
// Each final boss drops TWO heroic epics: one from its `_heroic` group and one
// from its `_heroic2` group (each group's chances sum to 1, so exactly one item
// drops per group). The set is built so every armor archetype covers all eight
// droppable slots (helmet/shoulder/chest/waist/legs/gloves/feet + mainhand;
// neck + rings come from the Heroic Quartermaster), and the mail casters
// (elemental/resto shaman, holy paladin) and str plate get real coverage rather
// than a single token piece.

import type { ItemDef, LootEntry } from '../types';

// Source level the heroic drop table reads as in the item-level index: the
// dungeons are level-20 content and heroic is the tier above (+5), so the
// epic pieces land at item level 31 (25 + the epic bump of 6).
export const HEROIC_LOOT_SOURCE_LEVEL = 25;

// The 10-player heroic raid (Heroic Nythraxis) is one tier ABOVE the five-man
// heroics: its drop table registers at source level 27 so its epics land at item
// level 33 and its legendaries at 37 (27 + the quality bump). Its heroic set
// pieces are the same collectible slots as the five-man versions, only rescaled
// to this raid tier. See buildHeroicVariants + the item-level source index.
export const NYTHRAXIS_RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
export const NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL = 27;

// Combat-rating allowance for the ilvl-31 five-player heroic set: ONE rating
// (hit/crit/haste) per piece, the tier's differentiator over ilvl 26/28 gear.
// The three Heroic Nythraxis weapons below are item level 33 instead and carry the
// raid tier's 65-point primary plus a 20-point complementary secondary. Ratings are
// off the primary-stat budget (like spellPower), so stat sums stay budget-enforced.
// Roughly half the set is Hit (the Heroic +3 answer); crit/haste fill throughput by
// archetype; healer-facing pieces never take Hit (heals are not resisted by level).
// The ilvl 33/37 raid variants scale these up + add a secondary rating (see
// heroic_variants.ts). See docs/prd/combat-ratings-and-jewelry.md.
const ARMOR_RATING = 40; // 40 rating = 4.0%
const FIVE_MAN_WEAPON_RATING = 50; // 50 rating = 5.0%
const RAID_WEAPON_PRIMARY_RATING = 65; // 65 rating = 6.5%
const RAID_SECONDARY_RATING = 20; // 20 rating = 2.0%

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass']; // plate/mail
const HEAL_MAIL = ['paladin', 'shaman'] as ItemDef['requiredClass']; // int/spi mail wearers
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const AGILE_WILD = ['rogue', 'hunter', 'druid'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];

export const HEROIC_ITEMS: Record<string, ItemDef> = {
  // ================= Heroic Hollow Crypt: Morthen =================
  morthens_cryptforged_hauberk: {
    id: 'morthens_cryptforged_hauberk',
    name: "Morthen's Cryptforged Hauberk",
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
  shadowpulse_handwraps: {
    id: 'shadowpulse_handwraps',
    name: 'Shadowpulse Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 52, int: 9, spi: 6 },
    hitRating: ARMOR_RATING,
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
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: AGILE,
  },
  cryptplate_helm: {
    id: 'cryptplate_helm',
    name: 'Cryptplate Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 292, str: 10, sta: 8 },
    hitRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: HEAVY,
  },
  shadowpulse_slippers: {
    id: 'shadowpulse_slippers',
    name: 'Shadowpulse Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 44, int: 8, spi: 6 },
    critRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: CASTER,
  },
  bonechill_cord: {
    id: 'bonechill_cord',
    name: 'Bonechill Cord',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 100, agi: 9, sta: 6 },
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: AGILE_WILD,
  },
  // ================= Heroic Sunken Bastion: Vael the Mistcaller =================
  mistcallers_fang: {
    id: 'mistcallers_fang',
    name: "Mistcaller's Fang",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 22, max: 36, speed: 1.8 },
    stats: { agi: 13, sta: 9 },
    critRating: FIVE_MAN_WEAPON_RATING,
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
    critRating: ARMOR_RATING,
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
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: CASTER,
  },
  mistforged_pauldrons: {
    id: 'mistforged_pauldrons',
    name: 'Mistforged Pauldrons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 240, str: 9, sta: 7 },
    critRating: ARMOR_RATING,
    sellValue: 11000,
    requiredClass: HEAVY,
  },
  tideguard_faceguard: {
    id: 'tideguard_faceguard',
    name: 'Tideguard Faceguard',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 168, agi: 10, sta: 8 },
    critRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: AGILE,
  },
  sunken_court_mantle: {
    id: 'sunken_court_mantle',
    name: 'Sunken Court Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 56, int: 9, spi: 7 },
    hasteRating: ARMOR_RATING,
    sellValue: 11000,
    requiredClass: CASTER,
  },
  // ================= Heroic Drowned Temple: Ysolei =================
  lunar_tide_greatstaff: {
    id: 'lunar_tide_greatstaff',
    name: 'Lunar Tide Greatstaff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 36, max: 60, speed: 3.0 },
    stats: { int: 13, spi: 9 },
    hitRating: FIVE_MAN_WEAPON_RATING,
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
    hitRating: ARMOR_RATING,
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
    hasteRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: HEAL_MAIL,
  },
  lunar_choir_leggings: {
    id: 'lunar_choir_leggings',
    name: 'Lunar Choir Leggings',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 72, int: 12, spi: 8 },
    hitRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: CASTER,
  },
  choir_blessed_spaulders: {
    id: 'choir_blessed_spaulders',
    name: 'Choir-Blessed Spaulders',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 240, int: 9, spi: 7 },
    critRating: ARMOR_RATING,
    sellValue: 11000,
    requiredClass: HEAL_MAIL,
  },
  tideworn_warboots: {
    id: 'tideworn_warboots',
    name: 'Tideworn Warboots',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 212, str: 8, sta: 6 },
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAVY,
  },
  // ================= Heroic Gravewyrm Sanctum: Korzul the Gravewyrm =================
  gravewyrm_cleaver: {
    id: 'gravewyrm_cleaver',
    name: 'Gravewyrm Cleaver',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 31, max: 52, speed: 2.6 },
    stats: { str: 13, sta: 9 },
    critRating: FIVE_MAN_WEAPON_RATING,
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
    critRating: ARMOR_RATING,
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
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: AGILE_WILD,
  },
  gravewyrm_claws: {
    id: 'gravewyrm_claws',
    name: 'Gravewyrm Claws',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 224, str: 9, sta: 6 },
    critRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAVY,
  },
  gravescale_girdle: {
    id: 'gravescale_girdle',
    name: 'Gravescale Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 224, str: 9, sta: 6 },
    hitRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAVY,
  },
  wyrmchoir_handwraps: {
    id: 'wyrmchoir_handwraps',
    name: 'Wyrmchoir Handwraps',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 224, int: 9, spi: 6 },
    hasteRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAL_MAIL,
  },
  // ================= Heroic Nythraxis, Scourge of Thornpeak (raid) =================
  scepter_of_the_deathless_court: {
    id: 'scepter_of_the_deathless_court',
    name: 'Scepter of the Deathless Court',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 29, max: 51, speed: 2.4 },
    stats: { int: 13, spi: 10 },
    hasteRating: RAID_WEAPON_PRIMARY_RATING,
    critRating: RAID_SECONDARY_RATING,
    sellValue: 16000,
    requiredClass: CASTER,
  },
  deathless_greatblade: {
    id: 'deathless_greatblade',
    name: 'Deathless Greatblade',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    requiredLevel: 20,
    // 2H dps premium at the raid tier: weaponDpsBudget(33) = 16.6 x
    // TWOHAND_DPS_MULT -> 19.1 dps.
    weapon: { min: 52, max: 78, speed: 3.4 },
    // v0.27.1 re-budget: round(primaryStatBudget(33, epic, mainhand) = 23 x
    // TWOHAND_STAT_MULT) = 30 points; the dps premium is the 2H's compensation.
    stats: { str: 18, sta: 12 },
    hitRating: RAID_WEAPON_PRIMARY_RATING,
    critRating: RAID_SECONDARY_RATING,
    sellValue: 16000,
    requiredClass: HEAVY,
  },
  stormcallers_focus: {
    id: 'stormcallers_focus',
    name: "Stormcaller's Focus",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    requiredLevel: 20,
    weapon: { min: 31, max: 52, speed: 2.5 },
    stats: { int: 14, spi: 9 },
    hasteRating: RAID_WEAPON_PRIMARY_RATING,
    critRating: RAID_SECONDARY_RATING,
    sellValue: 16000,
    requiredClass: HEAL_MAIL,
  },
};

// RETIRED, save-compat only. v0.25.0 replaced the standalone heroic Nythraxis
// armor drops with the heroic loot swap and deleted these four defs, orphaning
// the ids players earned during the v0.24.x window: an equipped orphan rendered
// its paperdoll slot as Empty and granted zero stats while the id sat dormant
// in the persisted save. Item ids that ever reached a player are permanent API:
// these defs (byte-identical to v0.24.2) exist so those saves resolve again,
// and they must NEVER return to a loot table, vendor, or the heroic variant
// builder (tests/retired_heroic_items.test.ts pins all of that).
export const RETIRED_HEROIC_ITEMS: Record<string, ItemDef> = {
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
  soulforged_warplate: {
    id: 'soulforged_warplate',
    name: 'Soulforged Warplate',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 335, int: 12, spi: 10 },
    sellValue: 14000,
    requiredClass: HEAL_MAIL,
  },
};

// Heroic-only drop tables per final boss, TWO rollGroups each (chances inside a
// group sum to 1.0, so exactly one item drops per group => two heroic epics per
// heroic kill). loot_roll.ts rolls these only for a heroic-claimed instance.
export const HEROIC_BOSS_LOOT: Record<string, LootEntry[]> = {
  morthen: [
    { itemId: 'morthens_cryptforged_hauberk', chance: 0.34, rollGroup: 'morthen_heroic' },
    { itemId: 'shadowpulse_handwraps', chance: 0.33, rollGroup: 'morthen_heroic' },
    { itemId: 'bonechill_striders', chance: 0.33, rollGroup: 'morthen_heroic' },
    { itemId: 'cryptplate_helm', chance: 0.34, rollGroup: 'morthen_heroic2' },
    { itemId: 'shadowpulse_slippers', chance: 0.33, rollGroup: 'morthen_heroic2' },
    { itemId: 'bonechill_cord', chance: 0.33, rollGroup: 'morthen_heroic2' },
  ],
  vael_the_mistcaller: [
    { itemId: 'mistcallers_fang', chance: 0.34, rollGroup: 'vael_heroic' },
    { itemId: 'tidebound_spaulders', chance: 0.33, rollGroup: 'vael_heroic' },
    { itemId: 'sash_of_the_sunken_court', chance: 0.33, rollGroup: 'vael_heroic' },
    { itemId: 'mistforged_pauldrons', chance: 0.34, rollGroup: 'vael_heroic2' },
    { itemId: 'tideguard_faceguard', chance: 0.33, rollGroup: 'vael_heroic2' },
    { itemId: 'sunken_court_mantle', chance: 0.33, rollGroup: 'vael_heroic2' },
  ],
  ysolei: [
    { itemId: 'lunar_tide_greatstaff', chance: 0.34, rollGroup: 'ysolei_heroic' },
    { itemId: 'tidewoven_trousers', chance: 0.33, rollGroup: 'ysolei_heroic' },
    { itemId: 'choirmothers_casque', chance: 0.33, rollGroup: 'ysolei_heroic' },
    { itemId: 'lunar_choir_leggings', chance: 0.34, rollGroup: 'ysolei_heroic2' },
    { itemId: 'choir_blessed_spaulders', chance: 0.33, rollGroup: 'ysolei_heroic2' },
    { itemId: 'tideworn_warboots', chance: 0.33, rollGroup: 'ysolei_heroic2' },
  ],
  korzul_the_gravewyrm: [
    { itemId: 'gravewyrm_cleaver', chance: 0.34, rollGroup: 'korzul_heroic' },
    { itemId: 'shroud_of_the_gravewyrm', chance: 0.33, rollGroup: 'korzul_heroic' },
    { itemId: 'sanctum_prowlers_grips', chance: 0.33, rollGroup: 'korzul_heroic' },
    { itemId: 'gravewyrm_claws', chance: 0.34, rollGroup: 'korzul_heroic2' },
    { itemId: 'gravescale_girdle', chance: 0.33, rollGroup: 'korzul_heroic2' },
    { itemId: 'wyrmchoir_handwraps', chance: 0.33, rollGroup: 'korzul_heroic2' },
  ],
  nythraxis_scourge_of_thornpeak: [
    // The heroic set pieces and legendaries come free from the heroic loot swap:
    // the raid boss's normal set-piece and legendary drops auto-upgrade to their
    // raid-tier (item level 33/37) heroic variants in a heroic claim
    // (loot/loot_roll.ts + heroic_variants.ts). This table adds only the
    // heroic-ONLY extras the normal table never carries: the three bespoke raid
    // weapons, one of which drops per heroic kill (chances sum to 1.0).
    { itemId: 'deathless_greatblade', chance: 0.34, rollGroup: 'nythraxis_heroic_weapon' },
    {
      itemId: 'scepter_of_the_deathless_court',
      chance: 0.33,
      rollGroup: 'nythraxis_heroic_weapon',
    },
    { itemId: 'stormcallers_focus', chance: 0.33, rollGroup: 'nythraxis_heroic_weapon' },
  ],
};
