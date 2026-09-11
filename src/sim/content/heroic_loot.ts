// Heroic boss equipment shares one guaranteed slot per five-player encounter.
// Every former base-gear and bespoke heroic path remains in that slot, weighted
// by its former per-kill chance. Normal loot and non-equipment chances are
// unchanged. Migrated base drops retain their original source tier and stats.

import { VARKHUL_BOSS_ID } from '../ignivar_raid_ids';
import { weightedLootGroup } from '../loot/weighted_loot_group';
import { IGNIVAR_BOSS_ID, type ItemDef, type LootEntry } from '../types';
import { FERAL } from './items';

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
export const ARMOR_RATING = 40; // 40 rating = 4.0%
export const FIVE_MAN_WEAPON_RATING = 50; // 50 rating = 5.0%
const RAID_WEAPON_PRIMARY_RATING = 65; // 65 rating = 6.5%
const RAID_SECONDARY_RATING = 20; // 20 rating = 2.0%

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass']; // plate/mail
const HEAL_MAIL = ['paladin', 'shaman'] as ItemDef['requiredClass']; // int/spi mail wearers
const HEAL_LEATHER = ['druid'] as ItemDef['requiredClass']; // int/spi leather wearers
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const AGILE_WILD = ['rogue', 'hunter', 'druid'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];
const CASTER_WEAPON_CLASSES = [
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
] as ItemDef['requiredClass'];

export const HEROIC_ITEMS: Record<string, ItemDef> = {
  // heroic_duskwhisper is NOT hand-written: buildHeroicVariants auto-generates it
  // from the base Duskwhisper (WILDHEART_ITEMS) because the Fanglord Beastmaster
  // heroic loot table below references it. It inherits the base proc and variant.
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
    critRating: ARMOR_RATING,
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
    weapon: { min: 22, max: 36, speed: 1.8, dagger: true },
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
    name: 'Fogforged Pauldrons',
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
    requiredClass: CASTER_WEAPON_CLASSES,
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
    critRating: ARMOR_RATING,
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
    critRating: ARMOR_RATING,
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
  // ================= Heroic leather caster line (druid int/spi) =================
  lunarward_cinch: {
    id: 'lunarward_cinch',
    name: 'Lunarward Cinch',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'epic',
    requiredLevel: 20,
    // Item level 31 heroic-only drop: waist budget 15.
    stats: { armor: 100, int: 9, spi: 6 },
    hasteRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAL_LEATHER,
  },
  dreamroot_boots: {
    id: 'dreamroot_boots',
    name: 'Dreamroot Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'epic',
    requiredLevel: 20,
    // Item level 31 heroic-only drop: feet budget 14.
    stats: { armor: 96, int: 8, spi: 6 },
    critRating: ARMOR_RATING,
    sellValue: 9500,
    requiredClass: HEAL_LEATHER,
  },
  stormbark_mantle: {
    id: 'stormbark_mantle',
    name: 'Stormbark Mantle',
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    // Item level 31 heroic-only drop: shoulder budget 16.
    stats: { armor: 148, int: 9, spi: 5, sta: 2 },
    critRating: ARMOR_RATING,
    sellValue: 11000,
    requiredClass: HEAL_LEATHER,
  },
  wildsoul_maul: {
    id: 'wildsoul_maul',
    name: 'Wildsoul Maul',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    requiredLevel: 20,
    // Item level 31 heroic-only feral two-hander: 2H dps on the weaponDpsBudget(31)
    // x TWOHAND_DPS_MULT curve (~18.4 at speed 3.6), stat budget 29.
    weapon: { min: 55, max: 78, speed: 3.6 },
    stats: { str: 13, agi: 9, sta: 7 },
    hitRating: FIVE_MAN_WEAPON_RATING,
    sellValue: 15000,
    requiredClass: FERAL,
  },
  // ================= Heroic Wildheart Basin: Zulgar =================
  basin_stalkers_tunic: {
    id: 'basin_stalkers_tunic',
    name: "Basin Stalker's Tunic",
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    // Fills the agi-leather chest hole left by the retired scourgehide_carapace,
    // which was AGILE_WILD: feral druids lost their only ilvl-31 agi-leather
    // chest in that retirement too, so the replacement keeps their access.
    stats: { armor: 172, agi: 13, sta: 9 },
    hitRating: ARMOR_RATING,
    sellValue: 14000,
    requiredClass: AGILE_WILD,
  },
  verdant_heart_vestment: {
    id: 'verdant_heart_vestment',
    name: 'Verdant-Heart Vestment',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    // The first druid int-leather chest anywhere in the game.
    stats: { armor: 172, int: 13, spi: 9 },
    hasteRating: ARMOR_RATING,
    sellValue: 14000,
    requiredClass: HEAL_LEATHER,
  },
  sunbone_ritual_hauberk: {
    id: 'sunbone_ritual_hauberk',
    name: 'Sunbone Ritual Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    // Fills the int-mail chest hole left by the retired soulforged_warplate.
    stats: { armor: 335, int: 12, spi: 10 },
    hasteRating: ARMOR_RATING,
    sellValue: 14000,
    requiredClass: HEAL_MAIL,
  },
  greatfang_of_the_basin: {
    id: 'greatfang_of_the_basin',
    name: 'Greatfang of the Basin',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    requiredLevel: 20,
    // The first five-man HEAVY two-hander: 2H dps on the weaponDpsBudget(31) x
    // TWOHAND_DPS_MULT curve (~18.4 at speed 3.4), stat budget 29.
    weapon: { min: 50, max: 75, speed: 3.4 },
    stats: { str: 17, sta: 12 },
    hitRating: FIVE_MAN_WEAPON_RATING,
    sellValue: 15000,
    requiredClass: HEAVY,
  },
  // Fills the CASTER helmet hole left by the retired soulrend_diadem (same
  // armor 76 / budget 18, plus the one rating every live heroic piece carries).
  sunbone_oracles_crown: {
    id: 'sunbone_oracles_crown',
    name: "Sunbone Oracle's Crown",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 76, int: 11, spi: 7 },
    critRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: CASTER,
  },
  // Fills the HEAVY legs hole left by the retired deathless_warguard_legmail
  // (same armor 315 / budget 20, plus the rating).
  bloodmane_war_legguards: {
    id: 'bloodmane_war_legguards',
    name: 'Bloodmane War-Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 315, str: 11, sta: 9 },
    critRating: ARMOR_RATING,
    sellValue: 12000,
    requiredClass: HEAVY,
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

// Heroic-only append tables. Five-player encounters pay one equipment group;
// raid heroic slots replace their Normal-only slot. Non-gear rolls stay separate.
// Heroic mount drop rates per rarity tier. These are APPENDED after all gear
// roll-group draws so the gear draw-order stays byte-identical to non-mount runs.
// Green (UNCOMMON) mounts: 0.5% per heroic clear on their single boss. The tier
// name finally matches the item colour: these used to be quality 'common' (white),
// which made "green mount" a misnomer for the whole life of the feature.
const HEROIC_GREEN_MOUNT_CHANCE = 0.005;
// Blue (rare) mounts: 0.1% per heroic clear everywhere (their paired five-man
// boss and the Nythraxis heroic raid, which adds both blues so every
// heroic-raider has a path to each). A rifts pays the same 0.1%, so a rift is
// never a cheaper route to a mount than the content it belongs to.
const HEROIC_BLUE_MOUNT_CHANCE = 0.001;
const HEROIC_RAID_BLUE_MOUNT_CHANCE = 0.001;

// Farming's DUNGEON channel (Phase 11f, masterwrought R8): the two rung-75
// farm patterns ride every heroic FIVE-MAN final boss as one appended tail
// rollGroup. This is the pillar the packet had never used for a recipe, so it
// takes the lowest-risk shape available.
//
// WHY A GROUP AND NOT TWO UNGROUPED ROWS, even though the four-reins ungrouped
// pin in tests/dungeons.test.ts reads only the RAID table and would not have
// moved: a group is one draw instead of two, it partitions rather than
// compounding (at most one pattern per clear), and it keeps the ungrouped set
// on every five-man table exactly the mount rows it has always been, which is
// what makes a future ungrouped entry a visible decision.
//
// WHY IT MUST SIT LAST IN EACH TABLE, and the detail worth writing down: in
// EVERY heroic table the ungrouped mount rows sit at the END, and loot_roll.ts
// walks heroic entries in array order. Splicing the group in above them would
// move each mount's chance() draw one position later and change which value it
// compares against. Appended after them, the group adds exactly one draw at the
// very end and every mount roll keeps its stream position.
//
// RATE: 0.04 per entry, the SHIPPED per-pattern point from the raid channel,
// reused rather than re-derived. Two entries, so 0.08 total per heroic clear,
// against five heroic five-mans; the deterministic quartermaster route at 12
// marks is what keeps either pattern from fossilizing behind that.
const FARM_PATTERN_HEROIC_CHANCE = 0.04;
/** The rollGroup name, EXPORTED because five suites need to exclude it from a
 *  gear census and a copied string literal in each is how one of them silently
 *  stops matching. The IMPORTERS are four: tests/dungeons.test.ts (the channel
 *  and append-position pins), tests/apex_pattern_channels.test.ts (the
 *  sanctioned-host registry), tests/wildheart.test.ts (the gear arms) and
 *  tests/farm_pattern_items.test.ts (the farm channel map). The Reliquary
 *  carve-out and the heroic item-level sweep exclude the same rows BY KIND
 *  instead, deliberately, so their reason travels with the item rather than
 *  with this group name. */
export const FARM_HEROIC_PATTERN_GROUP = 'heroic_farm_patterns';
const heroicFarmPatternRows = (): LootEntry[] => [
  {
    itemId: 'pattern_highwatch_gourd_soup',
    chance: FARM_PATTERN_HEROIC_CHANCE,
    rollGroup: FARM_HEROIC_PATTERN_GROUP,
  },
  {
    itemId: 'pattern_highwatch_barley_porridge',
    chance: FARM_PATTERN_HEROIC_CHANCE,
    rollGroup: FARM_HEROIC_PATTERN_GROUP,
  },
];

// These former base-table sources must not acquire the bespoke heroic tier
// merely because their acquisition rows now share the heroic equipment slot.
const PRESERVED_BASE_LOOT_SOURCES = new Set([
  'bloodmane_warleggings',
  'boneplate_vest',
  'cryptbone_greaves',
  'cryptbone_helm',
  'cryptbone_pauldrons',
  'cultist_flayer',
  'eelskin_tunic',
  'emberwood_staff',
  'fenmist_robe',
  'greyjaw_hide_boots',
  'heroic_boneguard_breastplate',
  'heroic_boundstone_girdle',
  'heroic_boundstone_helm',
  'heroic_deathlord_legguards',
  'heroic_deathlord_warplate',
  'heroic_deathlords_dread_visage',
  'heroic_drowned_prayer_leggings',
  'heroic_drowned_prayer_sandals',
  'heroic_eelscale_leggings',
  'heroic_eelscale_treads',
  'heroic_fang_of_korzul',
  'heroic_gravewyrm_bone_quiver',
  'heroic_gravewyrm_gauntlets',
  'heroic_gravewyrm_mantle',
  'heroic_gravewyrm_sabatons',
  'heroic_gravewyrm_stalkers_treads',
  'heroic_grovewardens_grips',
  'heroic_korgaths_chainwraps',
  'heroic_moonshroud_breastplate',
  'heroic_moonshroud_robe',
  'heroic_moonshroud_tunic',
  'heroic_necromancers_soulspire_mantle',
  'heroic_necromancers_soulsteps',
  'heroic_necromancers_starshroud',
  'heroic_nightfangs_greatstaff',
  'heroic_selthes_seastriders',
  'heroic_shadowmeld_tunic',
  'heroic_staff_of_the_gravewyrm',
  'heroic_staff_of_velkhar',
  'heroic_tideguard_greaves',
  'heroic_tideguard_sabatons',
  'heroic_tidescale_vest',
  'heroic_verdant_walkers',
  'heroic_wildgrowth_leggings',
  'heroic_wildheart_fangknife',
  'heroic_wildheart_hexwood_staff',
  'heroic_wildheart_tuskblade',
  'heroic_wyrmcult_grand_robe',
  'heroic_wyrmcult_soulsteps',
  'heroic_wyrmfang_greatblade',
  'heroic_wyrmshadow_harness',
  'heroic_wyrmshadow_legguards',
  'heroic_wyrmshadow_talongrips',
  'heroic_wyrmshadow_treads',
  'heroic_ysols_pearl_greaves',
  'marshstrider_boots',
  'mistveil_cord',
  'mistveil_grips',
  'nightwalk_jerkin',
  'oiled_boots',
  'quilted_trousers',
  'revenant_silk_robe',
  'sunbone_ritual_sarong',
  'trollhide_leggings',
  'vineclaw_stalking_breeches',
  'zealotsbane_blade',
]);

const preserveBaseLootSource = (entry: LootEntry): LootEntry =>
  entry.itemId && PRESERVED_BASE_LOOT_SOURCES.has(entry.itemId)
    ? { ...entry, preserveSourceTier: true }
    : entry;

export const HEROIC_BOSS_LOOT: Record<string, LootEntry[]> = {
  sexton_marrow: [
    ...weightedLootGroup('sexton_marrow_heroic', [
      ['quilted_trousers', 0.4],
      ['oiled_boots', 0.4],
    ]).map(preserveBaseLootSource),
  ],
  knight_commander_olen: [
    ...weightedLootGroup('knight_commander_olen_heroic', [
      ['trollhide_leggings', 0.5],
      ['marshstrider_boots', 0.5],
      ['fenmist_robe', 0.25],
      ['heroic_tideguard_greaves', 0.1],
      ['heroic_tideguard_sabatons', 0.1],
      ['heroic_eelscale_leggings', 0.1],
    ]).map(preserveBaseLootSource),
  ],
  choirmother_selthe: [
    ...weightedLootGroup('choirmother_selthe_heroic', [['heroic_selthes_seastriders', 0.4]]).map(
      preserveBaseLootSource,
    ),
  ],
  korgath_the_bound: [
    ...weightedLootGroup('korgath_the_bound_heroic', [
      ['boneplate_vest', 0.34],
      ['revenant_silk_robe', 0.33],
      ['nightwalk_jerkin', 0.33],
      ['zealotsbane_blade', 0.19],
      ['heroic_korgaths_chainwraps', 0.1],
      ['heroic_staff_of_velkhar', 0.1],
      ['heroic_shadowmeld_tunic', 0.1],
      ['heroic_wyrmcult_grand_robe', 0.1],
      ['heroic_gravewyrm_sabatons', 0.1],
      ['heroic_wyrmcult_soulsteps', 0.1],
      ['heroic_wyrmshadow_treads', 0.05],
      ['heroic_boundstone_helm', 0.08],
      ['heroic_gravewyrm_mantle', 0.08],
    ]).map(preserveBaseLootSource),
  ],
  grand_necromancer_velkhar: [
    ...weightedLootGroup('grand_necromancer_velkhar_heroic', [
      ['boneplate_vest', 0.34],
      ['revenant_silk_robe', 0.33],
      ['nightwalk_jerkin', 0.33],
      ['emberwood_staff', 0.2],
      ['heroic_boneguard_breastplate', 0.1],
      ['heroic_shadowmeld_tunic', 0.1],
      ['heroic_staff_of_velkhar', 0.1],
      ['heroic_gravewyrm_stalkers_treads', 0.1],
      ['heroic_deathlord_legguards', 0.05],
      ['heroic_necromancers_soulsteps', 0.05],
      ['heroic_wyrmshadow_legguards', 0.05],
    ]).map(preserveBaseLootSource),
    { itemId: 'necromancers_reagent_satchel', chance: 0.2, preserveSourceTier: true },
  ],
  morthen: [
    ...weightedLootGroup('morthen_heroic', [
      ['cryptbone_greaves', 0.34],
      ['quilted_trousers', 0.33],
      ['oiled_boots', 0.33],
      ['greyjaw_hide_boots', 0.25],
      ['cryptbone_helm', 0.18],
      ['cryptbone_pauldrons', 0.18],
      ['morthens_cryptforged_hauberk', 0.25],
      ['shadowpulse_handwraps', 0.25],
      ['bonechill_striders', 0.25],
      ['lunarward_cinch', 0.25],
      ['cryptplate_helm', 0.34],
      ['shadowpulse_slippers', 0.33],
      ['bonechill_cord', 0.33],
    ]).map(preserveBaseLootSource),
    { itemId: 'gravewoven_bag', chance: 0.2, preserveSourceTier: true },
    { itemId: 'reins_stormfeather_griffin', chance: HEROIC_GREEN_MOUNT_CHANCE },
    ...heroicFarmPatternRows(),
  ],
  vael_the_mistcaller: [
    ...weightedLootGroup('vael_heroic', [
      ['trollhide_leggings', 0.34],
      ['marshstrider_boots', 0.33],
      ['fenmist_robe', 0.33],
      ['eelskin_tunic', 0.2],
      ['heroic_tidescale_vest', 0.1],
      ['heroic_drowned_prayer_leggings', 0.1],
      ['heroic_drowned_prayer_sandals', 0.1],
      ['heroic_eelscale_treads', 0.1],
      ['mistveil_cord', 0.12],
      ['mistveil_grips', 0.12],
      ['mistcallers_fang', 0.34],
      ['tidebound_spaulders', 0.33],
      ['sash_of_the_sunken_court', 0.33],
      ['mistforged_pauldrons', 0.25],
      ['tideguard_faceguard', 0.25],
      ['sunken_court_mantle', 0.25],
      ['dreamroot_boots', 0.25],
    ]).map(preserveBaseLootSource),
    { itemId: 'mistcallers_duffel', chance: 0.1, preserveSourceTier: true },
    { itemId: 'reins_shadowjump_toad', chance: HEROIC_GREEN_MOUNT_CHANCE },
    ...heroicFarmPatternRows(),
  ],
  ysolei: [
    ...weightedLootGroup('ysolei_heroic', [
      ['heroic_ysols_pearl_greaves', 0.5],
      ['heroic_moonshroud_breastplate', 0.34],
      ['heroic_moonshroud_robe', 0.33],
      ['heroic_moonshroud_tunic', 0.33],
      ['lunar_tide_greatstaff', 0.25],
      ['tidewoven_trousers', 0.25],
      ['choirmothers_casque', 0.25],
      ['stormbark_mantle', 0.25],
      ['lunar_choir_leggings', 0.34],
      ['choir_blessed_spaulders', 0.33],
      ['tideworn_warboots', 0.33],
    ]).map(preserveBaseLootSource),
    { itemId: 'reins_grag_bear', chance: HEROIC_BLUE_MOUNT_CHANCE },
    ...heroicFarmPatternRows(),
  ],
  korzul_the_gravewyrm: [
    ...weightedLootGroup('korzul_heroic', [
      ['boneplate_vest', 0.34],
      ['revenant_silk_robe', 0.33],
      ['nightwalk_jerkin', 0.33],
      ['cultist_flayer', 0.1],
      ['heroic_wyrmfang_greatblade', 0.05],
      ['heroic_staff_of_the_gravewyrm', 0.05],
      ['heroic_fang_of_korzul', 0.05],
      ['heroic_deathlord_warplate', 0.05],
      ['heroic_necromancers_starshroud', 0.05],
      ['heroic_wyrmshadow_harness', 0.05],
      ['heroic_boundstone_girdle', 0.05],
      ['heroic_gravewyrm_gauntlets', 0.05],
      ['heroic_deathlords_dread_visage', 0.04],
      ['heroic_necromancers_soulspire_mantle', 0.04],
      ['heroic_wyrmshadow_talongrips', 0.04],
      ['heroic_nightfangs_greatstaff', 0.05],
      ['heroic_wildgrowth_leggings', 0.05],
      ['heroic_grovewardens_grips', 0.05],
      ['heroic_verdant_walkers', 0.05],
      ['heroic_gravewyrm_bone_quiver', 0.05],
      ['gravewyrm_cleaver', 0.34],
      ['shroud_of_the_gravewyrm', 0.33],
      ['sanctum_prowlers_grips', 0.33],
      ['gravewyrm_claws', 0.25],
      ['gravescale_girdle', 0.25],
      ['wyrmchoir_handwraps', 0.25],
      ['wildsoul_maul', 0.25],
    ]).map(preserveBaseLootSource),
    { itemId: 'reins_stalkglider_snail', chance: HEROIC_BLUE_MOUNT_CHANCE },
    ...heroicFarmPatternRows(),
  ],
  // Heroic mid-boss table: the Fanglord Beastmaster drops the heroic twin of
  // Duskwhisper (the normal drops from his normal-mode kill in WILDHEART_ITEMS).
  wildheart_beastmaster: [{ itemId: 'heroic_duskwhisper', chance: 0.18 }],
  wildheart_high_priest: [
    ...weightedLootGroup('wildheart_heroic', [
      ['bloodmane_warleggings', 0.34],
      ['vineclaw_stalking_breeches', 0.33],
      ['sunbone_ritual_sarong', 0.33],
      ['heroic_wildheart_tuskblade', 0.06],
      ['heroic_wildheart_hexwood_staff', 0.06],
      ['heroic_wildheart_fangknife', 0.06],
      ['basin_stalkers_tunic', 0.34],
      ['verdant_heart_vestment', 0.33],
      ['sunbone_ritual_hauberk', 0.33],
      ['greatfang_of_the_basin', 0.34],
      ['sunbone_oracles_crown', 0.33],
      ['bloodmane_war_legguards', 0.33],
    ]).map(preserveBaseLootSource),
    { itemId: 'reins_grag_bear', chance: HEROIC_BLUE_MOUNT_CHANCE },
    { itemId: 'reins_stalkglider_snail', chance: HEROIC_BLUE_MOUNT_CHANCE },
    ...heroicFarmPatternRows(),
  ],
  nythraxis_scourge_of_thornpeak: [
    // The heroic set pieces and legendaries come free from the heroic loot swap:
    // the raid boss's normal set-piece and legendary drops auto-upgrade to their
    // raid-tier (item level 33/37) heroic variants in a heroic claim
    // (loot/loot_roll.ts + heroic_variants.ts). This table adds only the
    // heroic-ONLY extras the normal table never carries: the three bespoke raid
    // weapons, one of which drops per heroic kill (chances sum to 1.0), plus the
    // blue and green mount secondary paths (same per-mount rate as their five-man
    // sources; the raid offers both of each so every heroic raider has a path).
    { itemId: 'deathless_greatblade', chance: 0.34, rollGroup: 'nythraxis_heroic_weapon' },
    {
      itemId: 'scepter_of_the_deathless_court',
      chance: 0.33,
      rollGroup: 'nythraxis_heroic_weapon',
    },
    { itemId: 'stormcallers_focus', chance: 0.33, rollGroup: 'nythraxis_heroic_weapon' },
    // Blue mount secondary paths on the heroic raid (0.1% each, equal per-mount
    // to the five-man rate; both blues available so aggregate ~0.2%); the primary
    // path for each is its five-man heroic boss. Epic mounts are rift S-only.
    { itemId: 'reins_grag_bear', chance: HEROIC_RAID_BLUE_MOUNT_CHANCE },
    { itemId: 'reins_stalkglider_snail', chance: HEROIC_RAID_BLUE_MOUNT_CHANCE },
    // Uncommon mount secondary paths on the heroic raid (0.5% each), mirroring the
    // five-man uncommon paths; every heroic raider has a path to each.
    { itemId: 'reins_stormfeather_griffin', chance: HEROIC_GREEN_MOUNT_CHANCE },
    { itemId: 'reins_shadowjump_toad', chance: HEROIC_GREEN_MOUNT_CHANCE },
  ],
  // ============== Crucible of the Last Spring (Heroic-only appends) ==============
  // The Ignivar raid has NO heroic item-level layer (docs/prd/ignivar-raid-loot.md):
  // a Heroic kill pays the SAME count as Normal (one item per five raiders, so
  // two on the 10-player raid) at the same ilvl 35, and differs only in WHICH
  // items it can drop. Each boss's Normal-only off-set slot (LootEntry.normalOnly
  // in dungeons.ts) is skipped on a heroic claim and this ONE exclusive group
  // pays in its place: the Robe sigil that finishes the 5-piece, the marquee
  // weapons, and (Varkhul) the shields. The ids register at
  // IGNIVAR_RAID_LOOT_SOURCE_LEVEL in item_level.ts, which out-ranks this table's
  // default source. Re-cut 2026-09-02 from the launch appends (one robe group
  // plus one weapon group per boss, plus Varkhul's shield group); from here the
  // partition is APPEND-only, never reorder.
  // Crucible of the Last Spring (docs/prd/ignivar-raid-loot.md, "Boss loot
  // tables"): a Heroic kill pays TWO guaranteed groups here, on top of the
  // boss's shared sigil slot. The exclusive slot is gear only (marquee
  // weapons, and Varkhul's shields); the Robe sigil has its OWN guaranteed
  // group, appended after it. Re-cut 2026-09-11: the Robes used to share the
  // exclusive slot, so a Heroic kill could roll a second sigil and no weapon
  // (the same two-sigil haul Normal pays). Draw order is parity-sensitive on
  // a heroic claim: the exclusive group keeps its position, the Robe group
  // draws after it, entries APPEND, never reorder.
  [IGNIVAR_BOSS_ID]: [
    // Marquee weapons, one guaranteed: Anvil 0.34 / Ember 0.33 / Tempest 0.33.
    // Three weapons, not four: the Emberflight Longbow was pulled from the
    // tier (bows wait for the hunter ranged-slot rework; maintainer decision
    // 2026-08-28), and the hunter ranged marquee returns with that rework.
    { itemId: 'forgefathers_warhammer', chance: 0.34, rollGroup: 'ignivar_h_exclusive' },
    { itemId: 'anvilguard_blade', chance: 0.33, rollGroup: 'ignivar_h_exclusive' },
    { itemId: 'springtouched_crozier', chance: 0.33, rollGroup: 'ignivar_h_exclusive' },
    // The Robe sigil, one guaranteed per Heroic kill: Anvil 0.34 / Ember 0.33
    // / Tempest 0.33, the same family balance as the merged sigil slot.
    { itemId: 'sigil_anvil_chest', chance: 0.34, rollGroup: 'ignivar_h_robe' },
    { itemId: 'sigil_ember_chest', chance: 0.33, rollGroup: 'ignivar_h_robe' },
    { itemId: 'sigil_tempest_chest', chance: 0.33, rollGroup: 'ignivar_h_robe' },
  ],
  [VARKHUL_BOSS_ID]: [
    // Shields 0.50 / marquee weapons 0.50 (the Robes' former 0.35 returned to
    // the gear it displaced, split evenly). Emberward keeps its ABSOLUTE 3
    // percent per heroic kill inside the shield share (the two epic shields
    // split the remaining 0.47 evenly), so the legendary's odds did not move
    // with either re-cut. Every weight is chosen so the group sums to
    // EXACTLY 1 in floating point (pinned by tests/ignivar_loot.test.ts).
    { itemId: 'bulwark_of_the_inner_crucible', chance: 0.235, rollGroup: 'varkhul_h_exclusive' },
    { itemId: 'ember_wardens_barrier', chance: 0.235, rollGroup: 'varkhul_h_exclusive' },
    { itemId: 'varkhul_emberward', chance: 0.03, rollGroup: 'varkhul_h_exclusive' },
    { itemId: 'heart_of_the_end_greatblade', chance: 0.17, rollGroup: 'varkhul_h_exclusive' },
    { itemId: 'forgefire_spire', chance: 0.17, rollGroup: 'varkhul_h_exclusive' },
    { itemId: 'staff_of_the_last_spring', chance: 0.16, rollGroup: 'varkhul_h_exclusive' },
    // The Robe sigil, one guaranteed per Heroic kill (see Ignivar above).
    { itemId: 'sigil_anvil_chest', chance: 0.34, rollGroup: 'varkhul_h_robe' },
    { itemId: 'sigil_ember_chest', chance: 0.33, rollGroup: 'varkhul_h_robe' },
    { itemId: 'sigil_tempest_chest', chance: 0.33, rollGroup: 'varkhul_h_robe' },
  ],
};
