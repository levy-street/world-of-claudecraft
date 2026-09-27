// World quests round 2: the zone hunts. Every zone's rotation pool used to
// hold one or two candidates, so the same board came round every day or two.
// These are kill quests against mob camps the zone ALREADY has (never a new
// mob), each area centred on the target's camp centroid with a radius that
// covers every camp plus its wander (tests/world_quest_zone_hunts.test.ts pins
// that the ring holds at least `count` authored spawns of the target, that the
// level gate is the zone's band start like every sibling quest, and that each
// id sits in its zone's rotation pool). Kill labels come from the mob's own
// display name (world_quest_view.ts), so a record here carries no i18n, deed,
// wiki or art obligation.
//
// Pool sizes (world_quest_rotation.ts) are 1, 4 or 7 deep, never 3, 5 or 6:
// every pool length divides the 84-day roster period tests/world_quests.test.ts
// pins, and the legacy three-day cycle ids (wq3_N, canonicalised to day 3N)
// still reach every entry, which a pool of 3 or 6 would not. Palmreach keeps
// its single daily confection board on purpose: the board is a generated
// puzzle keyed by the day (32 of them), so it must be offered EVERY day, and
// it pays no champion purse, which is what keeps a full day at the cap under
// the ten-gold budget (tests/world_quest_rewards.test.ts). Galecrest is left
// alone: its two dailies are always active, and a rotating slot there would
// move the item-bearing zone draw (world_quest_item_slots.ts) for every cycle.
import type { WorldQuestDef } from '../types';

// world_quests.ts owns the exported constant and spreads this table, so the
// literal is repeated here rather than imported (a cycle otherwise); the
// hunts test pins the two equal.
const WORLD_QUEST_MIN_LEVEL = 5;

const kill = (
  id: string,
  zoneId: string,
  minLevel: number,
  area: { x: number; z: number; radius: number },
  targetMobId: string,
  count: number,
): WorldQuestDef => ({
  id,
  zoneId,
  minLevel,
  area,
  objective: { type: 'kill', targetMobId },
  count,
});

export const WORLD_QUEST_ZONE_HUNTS: readonly WorldQuestDef[] = Object.freeze([
  // Eastbrook Vale (levels 1 to 7; world quests open at 5)
  kill(
    'wq_eastbrook_boars',
    'eastbrook_vale',
    WORLD_QUEST_MIN_LEVEL,
    { x: 78, z: -57, radius: 60 },
    'wild_boar',
    6,
  ),
  kill(
    'wq_eastbrook_bones',
    'eastbrook_vale',
    WORLD_QUEST_MIN_LEVEL,
    { x: 85, z: 84, radius: 45 },
    'restless_bones',
    5,
  ),
  kill(
    'wq_eastbrook_spiders',
    'eastbrook_vale',
    WORLD_QUEST_MIN_LEVEL,
    { x: -70, z: 2, radius: 38 },
    'webwood_spider',
    5,
  ),
  // Mirefen Marsh (levels 6 to 13)
  kill('wq_mirefen_widows', 'mirefen_marsh', 6, { x: 83, z: 320, radius: 54 }, 'mire_widow', 6),
  kill('wq_mirefen_drowned', 'mirefen_marsh', 6, { x: 103, z: 435, radius: 50 }, 'drowned_dead', 6),
  kill('wq_mirefen_trolls', 'mirefen_marsh', 6, { x: -92, z: 438, radius: 54 }, 'fen_troll', 5),
  kill('wq_mirefen_prowlers', 'mirefen_marsh', 6, { x: -2, z: 228, radius: 70 }, 'mire_prowler', 6),
  kill(
    'wq_mirefen_murlocs',
    'mirefen_marsh',
    6,
    { x: -101, z: 312, radius: 68 },
    'deepfen_murloc',
    6,
  ),
  // Thornpeak Heights (levels 13 to 20)
  kill(
    'wq_thornpeak_kobolds',
    'thornpeak_heights',
    13,
    { x: 90, z: 613, radius: 48 },
    'deeprock_kobold',
    6,
  ),
  kill(
    'wq_thornpeak_ogres',
    'thornpeak_heights',
    13,
    { x: -75, z: 715, radius: 53 },
    'thornpeak_ogre',
    5,
  ),
  kill(
    'wq_thornpeak_zealots',
    'thornpeak_heights',
    13,
    { x: 56, z: 837, radius: 50 },
    'wyrmcult_zealot',
    6,
  ),
  // Veiled Hollow (levels 15 to 20)
  kill(
    'wq_hollow_glimmerwisps',
    'veiled_hollow',
    15,
    { x: 68, z: 1082, radius: 92 },
    'glimmerwisp',
    4,
  ),
  kill('wq_hollow_stags', 'veiled_hollow', 15, { x: 12, z: 1118, radius: 26 }, 'veiled_stag', 4),
  kill(
    'wq_hollow_guardians',
    'veiled_hollow',
    15,
    { x: 132, z: 1078, radius: 36 },
    'ancient_guardian',
    3,
  ),
  // Drakelands (levels 16 to 20)
  kill(
    'wq_drakelands_raiders',
    'drakelands',
    16,
    { x: 326, z: 2135, radius: 77 },
    'ashbone_raider',
    4,
  ),
  kill('wq_drakelands_trolls', 'drakelands', 16, { x: 420, z: 2037, radius: 30 }, 'dune_troll', 4),
  kill(
    'wq_drakelands_warcallers',
    'drakelands',
    16,
    { x: 375, z: 2143, radius: 100 },
    'ashbone_warcaller',
    3,
  ),
  // Frostveil (levels 17 to 20)
  kill(
    'wq_frostveil_wolves',
    'frostveil',
    17,
    { x: -20, z: 1650, radius: 77 },
    'snowdrift_wolf',
    4,
  ),
  kill(
    'wq_frostveil_terraces',
    'frostveil',
    17,
    { x: 98, z: 1815, radius: 41 },
    'terrace_howler',
    4,
  ),
  kill('wq_frostveil_wisps', 'frostveil', 17, { x: 30, z: 1745, radius: 22 }, 'ice_wisp', 3),
  kill(
    'wq_frostveil_elementals',
    'frostveil',
    17,
    { x: 38, z: 1711, radius: 113 },
    'rime_elemental',
    3,
  ),
  kill('wq_frostveil_sprites', 'frostveil', 17, { x: -84, z: 1738, radius: 22 }, 'fen_sprite', 3),
  // Willowfen (levels 19 to 20)
  kill('wq_willowfen_toads', 'willowfen', 19, { x: -363, z: 328, radius: 132 }, 'bogtoad', 6),
  kill(
    'wq_willowfen_sprites',
    'willowfen',
    19,
    { x: -356, z: 378, radius: 60 },
    'willow_sprite',
    4,
  ),
  // Amberfall (levels 18 to 20)
  kill('wq_amberfall_stags', 'amberfall', 18, { x: -360, z: 1998, radius: 86 }, 'gilded_stag', 4),
  kill(
    'wq_amberfall_sprites',
    'amberfall',
    18,
    { x: -436, z: 1984, radius: 20 },
    'harvest_sprite',
    3,
  ),
  kill(
    'wq_amberfall_treants',
    'amberfall',
    18,
    { x: -426, z: 2202, radius: 19 },
    'orchard_treant',
    2,
  ),
  // Nightbloom (level 20)
  kill(
    'wq_nightbloom_grazers',
    'nightbloom',
    20,
    { x: -378, z: 1456, radius: 81 },
    'moonfleece_grazer',
    5,
  ),
  kill(
    'wq_nightbloom_striders',
    'nightbloom',
    20,
    { x: -325, z: 1462, radius: 124 },
    'gloam_strider',
    4,
  ),
  kill(
    'wq_nightbloom_stargazers',
    'nightbloom',
    20,
    { x: -272, z: 1538, radius: 18 },
    'nightkin_stargazer',
    3,
  ),
  // Wraithwood (level 20)
  kill(
    'wq_wraithwood_spinners',
    'wraithwood',
    20,
    { x: 375, z: 1471, radius: 113 },
    'widowsilk_spinner',
    4,
  ),
  kill(
    'wq_wraithwood_shamblers',
    'wraithwood',
    20,
    { x: 444, z: 1526, radius: 20 },
    'gravenbark_shambler',
    2,
  ),
  kill(
    'wq_wraithwood_wraiths',
    'wraithwood',
    20,
    { x: 362, z: 1592, radius: 82 },
    'wood_wraith',
    4,
  ),
  // Evergarden (level 20)
  kill(
    'wq_evergarden_wolves',
    'evergarden',
    20,
    { x: 360, z: 1011, radius: 147 },
    'topiary_wolf',
    4,
  ),
  kill('wq_evergarden_gnomes', 'evergarden', 20, { x: 362, z: 972, radius: 119 }, 'hedge_gnome', 4),
  kill(
    'wq_evergarden_stags',
    'evergarden',
    20,
    { x: 345, z: 1022, radius: 145 },
    'topiary_stag',
    4,
  ),
  // Farshore Isle (levels 3 to 7; world quests open at 5)
  kill(
    'wq_farshore_wretches',
    'farshore_isle',
    WORLD_QUEST_MIN_LEVEL,
    { x: 415, z: 70, radius: 52 },
    'breach_wretch',
    5,
  ),
  kill(
    'wq_farshore_riftspawn',
    'farshore_isle',
    WORLD_QUEST_MIN_LEVEL,
    { x: 420, z: 11, radius: 85 },
    'riftspawn',
    4,
  ),
  kill(
    'wq_farshore_stalkers',
    'farshore_isle',
    WORLD_QUEST_MIN_LEVEL,
    { x: 440, z: -5, radius: 55 },
    'void_stalker',
    3,
  ),
]);
