// The Drakelands (levels 16-20). North across the Pale Causeway: a green
// gatewood at the entrance that dries northward into cinder desert, dune
// seas, and the volcanic Drakemaw belt of lava pools and bloodglass crystal,
// where dragons roost and the troll clans raid. The only zone entered on
// foot from a hidden realm: the causeway road climbs through the Wyrmgate
// pass (southPassX). Terrain shape: the EMBER_* tables in world.ts (coast
// lobes, the desert gradient, volcano cones).

import { CASTLE_BUILDINGS } from '../castle_layout';
import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const DRAKELANDS_ZONE: ZoneDef = {
  id: 'drakelands',
  name: 'The Drakelands',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.45, A: 0.4, S: 0.15 },
  zMin: 1820,
  zMax: 2420,
  xMin: 180,
  xMax: 540,
  levelRange: [16, 20],
  biome: 'ember',
  southPassX: 404, // the Wyrmgate road, now climbing out of the haunted wood
  westPassZ: 1890, // the Snowline: ash meets ice across the column border
  hub: { x: 404, z: 1900, radius: 24, name: 'Wyrmwatch' },
  graveyard: { x: 422, z: 1885 },
  lakes: [
    { x: 340, z: 1925, radius: 14 }, // Greenshade Pool, under the gatewood
    { x: 326, z: 1936, radius: 8 }, // ...its shaded western finger
    { x: 456, z: 1988, radius: 11 }, // the Last Spring, at the forest's edge
    { x: 300, z: 2110, radius: 10 }, // Mirage Hollow, a dune oasis
  ],
  pois: [
    { x: 404, z: 1900, label: 'Wyrmwatch', id: 'wyrmwatch' },
    { x: 360, z: 1940, label: 'The Gatewood', id: 'the_gatewood' },
    { x: 330, z: 2100, label: 'Cinder Dunes', id: 'cinder_dunes' },
    { x: 460, z: 2140, label: 'Trollmoot', id: 'trollmoot' },
    { x: 406, z: 2032, label: 'The Last Keep', id: 'the_last_keep' },
    { x: 270, z: 2270, label: 'Bloodglass Fields', id: 'bloodglass_fields' },
    { x: 390, z: 2320, label: 'Drakemaw Caldera', id: 'drakemaw_caldera' },
  ],
  welcome:
    'Hot wind rolls off the wastes ahead. Dragons wheel over the Drakemaw, and troll fires burn in the dunes.',
  welcomeQuestId: 'q_dk_ash_on_the_wind',
};

// The causeway road runs on through the Wyrmgate, then forks into the wastes.
// Authored always-bloom flower circles (render/foliage.ts reads these the
// way the dusk realm reads REALM_FLOWER_MEADOWS): firebloom fields on the
// green land around Wyrmwatch and down the Gatewood road verges, before the
// waste opens. The ember flower palette is bright red and orange, so the
// fields read as drifts of flame against the grass line.
export const DRAKELANDS_FLOWER_MEADOWS: { x: number; z: number; r: number }[] = [
  // the gate lawns north of town, flanking the causeway road
  { x: 384, z: 1858, r: 9 },
  { x: 426, z: 1866, r: 8 },
  // the east downs off the hub ring
  { x: 440, z: 1908, r: 11 },
  { x: 432, z: 1934, r: 7 },
  // the west approach and the warren hollow
  { x: 368, z: 1884, r: 9 },
  { x: 352, z: 1914, r: 7 },
  // the Gatewood road south, verges widening toward the dune fork
  { x: 382, z: 1946, r: 10 },
  { x: 356, z: 1986, r: 12 },
  { x: 390, z: 1992, r: 8 },
  // the second bloom wave: the causeway shore, the pass mouth, and the
  // gatewood clearings past the warren
  { x: 404, z: 1826, r: 7 },
  { x: 418, z: 1842, r: 8 },
  { x: 344, z: 1866, r: 8 },
  { x: 330, z: 1940, r: 10 },
  { x: 416, z: 1966, r: 9 },
];

export const DRAKELANDS_ROADS: { x: number; z: number }[][] = [
  [
    { x: 404, z: 1804 },
    { x: 404, z: 1850 },
    { x: 404, z: 1900 },
  ], // the Pale Causeway -> the Wyrmgate pass -> Wyrmwatch
  [
    { x: 404, z: 1900 },
    { x: 370, z: 1970 },
    { x: 350, z: 2040 },
    { x: 330, z: 2100 },
  ], // Wyrmwatch -> Cinder Dunes
  [
    { x: 330, z: 2100 },
    { x: 380, z: 2180 },
    { x: 390, z: 2280 },
    { x: 390, z: 2298 },
  ], // Cinder Dunes -> the Drakemaw crater rim
  [
    { x: 380, z: 2180 },
    { x: 460, z: 2140 },
  ], // dune fork -> Trollmoot
  [
    { x: 330, z: 2100 },
    { x: 270, z: 2210 },
    { x: 270, z: 2270 },
  ], // Cinder Dunes -> Bloodglass Fields
  [
    { x: 380, z: 2180 },
    { x: 352, z: 2280 },
    { x: 350, z: 2355 },
  ], // the dune fork -> the crater's north rim
  [
    { x: 330, z: 2100 },
    { x: 276, z: 2044 },
    { x: 230, z: 1964 },
    { x: 186, z: 1892 },
  ], // the Cinder Dunes -> west to the Snowline crossing (fire meets ice)
];

// The wastes' first inhabitants: the dragonkin brood nests across the
// Drakemaw belt (broodlords ring their egg clutches, broodguards patrol
// between them, and whelps hatch out of any egg a boot or a shout cracks),
// the ashbone dead muster in the dunes, and the troll clans raid the roads.
export const DRAKELANDS_MOBS: Record<string, MobTemplate> = {
  // RETIRED from spawning (v0.35 dragonkin brood rework): the wheeling drake
  // is replaced by the ground brood below. The template stays so nothing that
  // recorded the id (kill credit in old saves, combat logs) dangles; it has
  // no camp, so it never spawns. Its quest scale drop moved to the brood.
  emberwing_drake: {
    id: 'emberwing_drake',
    name: 'Emberwing Drake',
    minLevel: 19,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 130,
    hpPerLevel: 32,
    dmgBase: 16,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 16,
    moveSpeed: 9,
    aggroRadius: 18,
    elite: true,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'emberwing_scale', chance: 0.7, questId: 'q_dk_scales_of_the_maw' },
    ],
    scale: 1.4,
    color: 0xd84028,
  },
  // The brood clutch: a 1 HP puzzle-object mob (the spider_egg_sac pattern).
  // Shooting or striking one cracks it open; src/sim/mob/dragonkin_brood.ts
  // hatches a whelp out of it, ripples the break to neighboring eggs, and
  // springs the ambush when a player walks too close.
  dragonkin_egg: {
    id: 'dragonkin_egg',
    name: 'Dragonkin Egg',
    minLevel: 20,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 1,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1.1,
    color: 0x69a06a,
    // Dies to any single hit; the hatched whelp is the real fight.
    xpMult: 0,
    // Chain 5.5 (under the ring spacing) so shooting one egg ripples its
    // neighbors without a single roadside egg unzipping a whole scatter
    // field; proximity 3 means a boot practically ON the shell.
    offStreamIdle: true,
    broodEgg: {
      chainRadius: 5.5,
      chainDelay: 0.3,
      proximityRadius: 3,
      hatchMobId: 'dragonkin_whelp',
    },
  },
  // The hatchling ambusher: glass cannon. One player hit kills it, but its
  // pounce hits like a wagon and sets the victim burning. Hatches hating the
  // nearest healer or damage-dealer (the brood smells soft targets); only
  // when nobody fragile is in reach does it settle for whoever is closest.
  dragonkin_whelp: {
    id: 'dragonkin_whelp',
    name: 'Dragonkin Whelp',
    minLevel: 19,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 26,
    hpPerLevel: 1,
    dmgBase: 13,
    dmgPerLevel: 2.6,
    attackSpeed: 1.5,
    armorPerLevel: 4,
    moveSpeed: 10,
    aggroRadius: 12,
    // Coin is GUARANTEED, never a lottery: the economy curve
    // (tests/economy_yield.test.ts) requires an unconditional copper drop on
    // every camp-spawned combat mob, and a 60% chance failed that rule.
    loot: [{ copper: 15, chance: 1 }],
    componentTags: ['hide', 'fang'],
    scale: 0.85,
    color: 0x4e8a5f,
    // Swarm chaff: a sliver of kill XP each so a cracked clutch is a hazard,
    // not an XP farm.
    xpMult: 0.3,
    // Restless hatchlings: the wander pause divides by 3, so loose whelps
    // skitter around their patch instead of standing statuesque.
    wanderHaste: 3,
    // The pounce is a CALCULATED leap: duration derives from the live
    // distance at launch (speed = moveSpeed x leapSpeedMult, capped at
    // leapSeconds), triggered from anywhere inside leapRange, and loose
    // whelps re-pounce on aggro after a cooldown (dragonkin_brood.ts).
    offStreamIdle: true,
    broodWhelp: {
      leapRange: 24,
      leapSpeedMult: 2.6,
      leapSeconds: 1.5,
      burn: { perTick: 5, interval: 1, duration: 6, name: 'Hatchling Burn' },
    },
  },
  // The brood's rank and file. Bellows a challenge the moment it spots prey
  // (rooted mid-shout, the player's cue to pre-position), then comes on.
  dragonkin_broodguard: {
    id: 'dragonkin_broodguard',
    name: 'Dragonkin Broodguard',
    minLevel: 19,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 60,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 14,
    loot: [
      { copper: 90, chance: 1 },
      { itemId: 'emberwing_scale', chance: 0.5, questId: 'q_dk_scales_of_the_maw' },
    ],
    // Only MAPPED families (HARVEST_COMPONENT_ITEMS): claw and horn read well on
    // a dragonkin but yield no item, so they would be dead weight that still
    // inflates the concentration bonus (the denominator is the advertised tag
    // count), which is the #2514 shape tests/mob_component_tags.test.ts guards.
    componentTags: ['hide', 'fang'],
    offStreamIdle: true,
    // Playtest bump: 30% over the first cut. Still inside the stock melee
    // profile's honest reach (the bespoke-reach threshold is the scale-2
    // wildheart case); the menace ladder reads whelp 0.85 -> guard 1.5 ->
    // broodlord 2.25 -> matriarch 2.85.
    scale: 1.5,
    color: 0x3e6b4f,
    engageShout: { rootSeconds: 1.3 },
  },
  // The clutch-lords of the Drakemaw: four stand across the dragon belt, each
  // ringed by eggs. The opening shout cracks every egg around it and wards
  // the hatchlings (one free hit each); in the fight it counters any stun
  // with a tail hammer of its own, cleaves the whole front arc on a cadence,
  // and hoses a fire cone on a timer.
  drakemaw_broodlord: {
    id: 'drakemaw_broodlord',
    name: 'Drakemaw Broodlord',
    minLevel: 20,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 150,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 17,
    moveSpeed: 9.5,
    aggroRadius: 20,
    hardLeashRadius: 50,
    elite: true,
    offStreamIdle: true,
    // Rare-flagged: the 4x respawn window (respawn_policy.ts) keeps the four
    // lords feeling like standing minibosses, and rare camp mobs feed the
    // 'slain:' deed credit (RARE_SLAIN_TEMPLATES).
    rare: true,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'emberwing_scale', chance: 0.9, questId: 'q_dk_scales_of_the_maw' },
    ],
    // Menace scale: half again over the first cut. Its melee reach follows
    // through the bespoke combat profile (mob_combat.ts), never the visual
    // alone (the Wildheart whiff lesson).
    // Mapped families only, same reasoning as the broodguard above.
    componentTags: ['hide', 'fang'],
    scale: 2.25,
    color: 0x50392e,
    yells: {
      engage: 'The brood wakes! Rise, hatchlings, and strip their bones!',
    },
    engageShout: {
      rootSeconds: 1.6,
      breakEggsRadius: 26,
      wardWhelps: { duration: 20, name: "Broodlord's Ward" },
    },
    arcCleave: {
      every: 5,
      arcDeg: 150,
      // reaches past the scale-2.25 body's own melee arc (mob_combat.ts)
      range: 8,
      mult: 1.0,
      name: 'Brood Cleave',
      burn: { perTick: 4, interval: 1, duration: 8, name: 'Seared Scales' },
    },
    breathCone: {
      castId: 'broodlord_fire_breath',
      name: 'Fire Breath',
      castTime: 1.6,
      every: 14,
      range: 13,
      arcDeg: 60,
      min: 26,
      max: 34,
      school: 'fire',
      burn: { perTick: 4, interval: 1, duration: 8, name: 'Seared Scales' },
    },
    counterStun: { seconds: 2, cooldown: 25, name: 'Tail Hammer' },
  },
  ashbone_raider: {
    id: 'ashbone_raider',
    name: 'Ashbone Raider',
    minLevel: 17,
    maxLevel: 18,
    family: 'undead',
    hpBase: 50,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [
      { copper: 90, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.4 },
      { itemId: 'ashbone_war_brand', chance: 0.6, questId: 'q_dk_marrow_and_ash' },
    ],
    scale: 1,
    color: 0xe8dcc8,
  },
  ashbone_warcaller: {
    id: 'ashbone_warcaller',
    name: 'Ashbone Warcaller',
    minLevel: 18,
    maxLevel: 19,
    family: 'undead',
    hpBase: 62,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 2.1,
    armorPerLevel: 13,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [
      { copper: 95, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.4 },
      { itemId: 'ashbone_war_brand', chance: 0.6, questId: 'q_dk_marrow_and_ash' },
    ],
    scale: 1.1,
    color: 0xd8c8a8,
  },
  dune_troll: {
    id: 'dune_troll',
    name: 'Dune Troll',
    minLevel: 17,
    maxLevel: 19,
    family: 'troll',
    hpBase: 66,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.3,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 14,
    loot: [
      { copper: 90, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.4 },
    ],
    scale: 1.15,
    color: 0xb07040,
  },
  // The brood-mother of the whole Drakemaw clutch, gold as a coal about to
  // catch against her green-scaled children (q_dk_matriarch_of_the_maw).
  // Spawned by the quest camps appended at the END of the merged CAMPS array
  // (draw-order rule); her crater roost sits well off every road, ringed by
  // her own eggs. She runs the full broodlord kit, scaled up: the wake-shout
  // that cracks and wards her clutch, the cadenced front-arc cleave, the fire
  // cone, and the counter-stun tail.
  cindraleth_maw_matriarch: {
    id: 'cindraleth_maw_matriarch',
    name: 'Cindraleth the Maw Matriarch',
    minLevel: 20,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 170,
    hpPerLevel: 36,
    dmgBase: 18,
    dmgPerLevel: 3.2,
    attackSpeed: 2.3,
    armorPerLevel: 18,
    moveSpeed: 9,
    aggroRadius: 20,
    elite: true,
    offStreamIdle: true,
    loot: [{ copper: 100, chance: 1 }],
    // The matriarch keeps her half-again margin over the grown broodlords
    // (reach profile beside theirs in mob_combat.ts).
    scale: 2.85,
    color: 0xf0b040,
    yells: {
      engage: 'You crunch across MY nursery, little thief. The Maw remembers its own.',
    },
    engageShout: {
      rootSeconds: 1.6,
      breakEggsRadius: 30,
      wardWhelps: { duration: 20, name: "Matriarch's Ward" },
    },
    arcCleave: {
      every: 5,
      arcDeg: 150,
      // reaches past the scale-2.85 body's own melee arc (mob_combat.ts)
      range: 9,
      mult: 1.0,
      name: 'Maw Cleave',
      burn: { perTick: 5, interval: 1, duration: 8, name: 'Seared Scales' },
    },
    breathCone: {
      castId: 'matriarch_fire_breath',
      name: 'Fire Breath',
      castTime: 1.6,
      every: 12,
      range: 14,
      arcDeg: 60,
      min: 30,
      max: 38,
      school: 'fire',
      burn: { perTick: 5, interval: 1, duration: 8, name: 'Seared Scales' },
    },
    counterStun: { seconds: 2, cooldown: 25, name: 'Tail Hammer' },
  },
};
// The folk of the wastes: the gatecaptain and her quartermaster hold
// Wyrmwatch, and a lone scout camps in the far dunes within sight of the
// Orkadia wargate. The scout stands far from the hub on purpose: the war
// chain sends players out to find her.
export const DRAKELANDS_NPCS: Record<string, NpcDef> = {
  gatecaptain_brannoc: {
    id: 'gatecaptain_brannoc',
    name: 'Gatecaptain Brannoc',
    title: 'Commander of Wyrmwatch',
    pos: { x: 407, z: 1895 },
    facing: 2.6,
    color: 0xa84838,
    questIds: [
      'q_dk_ash_on_the_wind',
      'q_dk_banners_over_the_dunes',
      'q_dk_watcher_at_the_wargate',
      'q_dk_matriarch_of_the_maw',
    ],
    greeting: 'Wyrmwatch holds the gate. Has held it forty years. It will hold it tonight.',
  },
  quartermaster_sela: {
    id: 'quartermaster_sela',
    name: 'Quartermaster Sela',
    title: 'Keeper of the Garrison Stores',
    pos: { x: 398, z: 1908 },
    facing: -0.6,
    color: 0xc09858,
    questIds: ['q_dk_trolls_on_the_road', 'q_dk_scorched_stores'],
    greeting: 'Every crate in this yard crossed forty miles of ash to get here. Treat them kindly.',
  },
  scout_yerrin: {
    id: 'scout_yerrin',
    name: 'Scout Yerrin',
    title: 'Far-Dune Watcher',
    pos: { x: 494, z: 2100 },
    facing: -2.4,
    color: 0x8a7a58,
    questIds: [
      'q_dk_watcher_at_the_wargate',
      'q_dk_marrow_and_ash',
      'q_dk_scales_of_the_maw',
      'q_dk_matriarch_of_the_maw',
    ],
    greeting: 'Keep low. Sound carries strangely off the glass, and the gate below has ears.',
  },
};

export const DRAKELANDS_QUESTS: Record<string, QuestDef> = {
  q_dk_ash_on_the_wind: {
    id: 'q_dk_ash_on_the_wind',
    name: 'Ash on the Wind',
    giverNpcId: 'gatecaptain_brannoc',
    turnInNpcId: 'gatecaptain_brannoc',
    text: 'Look south off the palisade, $N. Those fires in the dunes are not troll cookfires, they are ashbone musters, and every night there are more. The dead come up out of the bonefields with sand still in their teeth. Cut down ten raiders before they cut a road to my gate.',
    completionText:
      'Ten fewer blades in the dunes, and the muster fires burned lower last night. My sentries slept, which they have not done in a week. Well cut, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'ashbone_raider', count: 10, label: 'Ashbone Raider slain' },
    ],
    xpReward: 3800,
    copperReward: 1800,
    itemRewards: {},
    minLevel: 16,
  },
  q_dk_trolls_on_the_road: {
    id: 'q_dk_trolls_on_the_road',
    name: 'Trolls on the Road',
    giverNpcId: 'quartermaster_sela',
    turnInNpcId: 'quartermaster_sela',
    text: 'The dune trolls have learned the sound of a supply wagon, $N. They hit the Cinder Dunes road three times this month, and the last driver walked in carrying nothing but the reins. Eight trolls off that road and my wagons roll again.',
    completionText:
      'Eight, and my drivers have stopped writing farewell letters before every run. The garrison eats because of you, $N.',
    objectives: [{ type: 'kill', targetMobId: 'dune_troll', count: 8, label: 'Dune Troll slain' }],
    xpReward: 4200,
    copperReward: 2000,
    itemRewards: {},
    minLevel: 16,
  },
  q_dk_scorched_stores: {
    id: 'q_dk_scorched_stores',
    name: 'Scorched Stores',
    giverNpcId: 'quartermaster_sela',
    turnInNpcId: 'quartermaster_sela',
    text: 'The last wagon burned, $N, but iron-strapped crates do not burn through. Four of them are still lying scorched along the dunes road with a season of salt, nails, and bowstrings inside. Bring my stores home before the trolls work out how to open them.',
    completionText:
      'Scorched black and every latch still holding. The smith gets his nails, the fletcher her strings, and you get the boots I was saving for whoever brought my crates back, $N.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'scorched_supply_crate',
        count: 4,
        label: 'Scorched supply crate recovered',
      },
    ],
    xpReward: 4000,
    copperReward: 1900,
    itemRewards: {
      warrior: 'cinderwalk_treads',
      mage: 'cinderwalk_treads',
      rogue: 'cinderwalk_treads',
    },
    requiresQuest: 'q_dk_trolls_on_the_road',
    minLevel: 17,
  },
  q_dk_banners_over_the_dunes: {
    id: 'q_dk_banners_over_the_dunes',
    name: 'Banners over the Dunes',
    giverNpcId: 'gatecaptain_brannoc',
    turnInNpcId: 'gatecaptain_brannoc',
    text: 'The ashbone muster at the old bonefield graves, $N, and my patrols cannot read the dunes the way they read a wall. Kill five of their warcallers, the ones that scream the dead upright, and plant a warning banner on each muster ground so my sentries can mark it from the ridge.',
    completionText:
      'Three banners snapping in the hot wind, right where my glass can find them. With five warcallers silenced, whatever answers their call will come slower. You bought us time, $N.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ashbone_warcaller',
        count: 5,
        label: 'Ashbone Warcaller slain',
      },
      {
        type: 'interact',
        targetObjectItemId: 'wyrmwatch_warning_banner',
        count: 3,
        label: 'Warning banner planted',
      },
    ],
    xpReward: 4800,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_dk_ash_on_the_wind',
    minLevel: 17,
  },
  q_dk_watcher_at_the_wargate: {
    id: 'q_dk_watcher_at_the_wargate',
    name: 'The Watcher at the Wargate',
    giverNpcId: 'gatecaptain_brannoc',
    turnInNpcId: 'scout_yerrin',
    text: 'Something is pulling the ashbone east, $N, and I sent my best to learn what. Scout Yerrin has camped a month in the far dunes past Trollmoot, in sight of a gate nobody built in my lifetime. Her reports stopped ten days ago. Find her camp and get me her eyes.',
    completionText:
      'Brannoc sent you? Then my last runner never made it. Keep your voice down and sit, $N. You see that gate below? Count the war-banners in front of it, and you will understand why I stopped writing things down.',
    objectives: [
      { type: 'interact', targetNpcId: 'scout_yerrin', count: 1, label: 'Find Scout Yerrin' },
    ],
    xpReward: 2400,
    copperReward: 950,
    itemRewards: {},
    requiresQuest: 'q_dk_banners_over_the_dunes',
    minLevel: 18,
  },
  q_dk_marrow_and_ash: {
    id: 'q_dk_marrow_and_ash',
    name: 'Marrow and Ash',
    giverNpcId: 'scout_yerrin',
    turnInNpcId: 'scout_yerrin',
    text: 'Every ashbone raider carries a war-brand, $N: a scorched tally of the host it marches under. I have counted four hosts from this ridge, but guesses are not intelligence. Bring me six brands off the raiders and their warcallers, and I will give Brannoc the shape of the war that is coming.',
    completionText:
      'Six brands, and one mark burned into every one of them. This is no raid muster, $N. Every host in the dunes answers to the wargate below us, the trolls call it Orkadia, and no five soldiers I ever served with could break what drums behind that door. Perhaps five like you.',
    objectives: [
      { type: 'collect', itemId: 'ashbone_war_brand', count: 6, label: 'Ashbone War-Brand' },
    ],
    xpReward: 4400,
    copperReward: 2200,
    itemRewards: {},
    requiresQuest: 'q_dk_watcher_at_the_wargate',
  },
  q_dk_scales_of_the_maw: {
    id: 'q_dk_scales_of_the_maw',
    name: 'Scales of the Maw',
    giverNpcId: 'scout_yerrin',
    turnInNpcId: 'scout_yerrin',
    text: 'When the wind turns off the Drakemaw, the emberwing drakes ride it over my camp low enough to count their teeth, $N. They range farther every day, and something in that crater drives them. Bring me three of their scales. Scales remember heat, and I can read where a drake has been roosting by the burn.',
    completionText:
      'Look at the underside of this one, $N: scorched in a spiral, and only one thing nests in circles. These drakes are brood-guards. Something in the Drakemaw is a mother.',
    objectives: [
      { type: 'collect', itemId: 'emberwing_scale', count: 3, label: 'Emberwing Scale' },
    ],
    xpReward: 5000,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_dk_watcher_at_the_wargate',
    minLevel: 19,
    suggestedPlayers: 2,
  },
  q_dk_matriarch_of_the_maw: {
    id: 'q_dk_matriarch_of_the_maw',
    name: 'Matriarch of the Maw',
    giverNpcId: 'scout_yerrin',
    turnInNpcId: 'gatecaptain_brannoc',
    text: 'The scales told it true, $N. I climbed the rim at dawn and saw her on the crater floor: Cindraleth, the matriarch every emberwing in this sky was hatched under, gold as a coal about to catch. While she broods, the drakes grow bolder, and Wyrmwatch cannot fight dragons and the ashbone both. End her in her crater, then carry the word to Gatecaptain Brannoc. Do not go alone.',
    completionText:
      "The sky over the Drakemaw has been empty for two days, and now you walk through my gate with a matriarch's blood on your boots. Wyrmwatch has stood forty years on watch for exactly this, $N. Take these pauldrons, mawscale, worked by our own smith. Wear them where the drakes can see.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'cindraleth_maw_matriarch',
        count: 1,
        label: 'Cindraleth the Maw Matriarch slain',
      },
    ],
    xpReward: 6000,
    copperReward: 3600,
    itemRewards: {
      warrior: 'mawscale_pauldrons',
      mage: 'mawscale_pauldrons',
      rogue: 'mawscale_pauldrons',
    },
    requiresQuest: 'q_dk_scales_of_the_maw',
    minLevel: 19,
    suggestedPlayers: 2,
  },
};

// Level-braided presentation order (not strictly chain order), matching the
// Veiled Hollow convention.
export const DRAKELANDS_QUEST_ORDER: string[] = [
  'q_dk_ash_on_the_wind',
  'q_dk_trolls_on_the_road',
  'q_dk_scorched_stores',
  'q_dk_banners_over_the_dunes',
  'q_dk_watcher_at_the_wargate',
  'q_dk_marrow_and_ash',
  'q_dk_scales_of_the_maw',
  'q_dk_matriarch_of_the_maw',
];

export const DRAKELANDS_ITEMS: Record<string, ItemDef> = {
  // --- keepsakes ---
  // The Last Keep's entrance-hall souvenir: the interior instance's one
  // ground object (a dungeon must place at least one encounter; the
  // zero-combat keep places a keepsake instead of a fight).
  last_keep_signet: {
    id: 'last_keep_signet',
    name: 'Signet of the Last Keep',
    kind: 'junk',
    sellValue: 25,
  },
  // --- quest items ---
  ashbone_war_brand: {
    id: 'ashbone_war_brand',
    name: 'Ashbone War-Brand',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dk_marrow_and_ash',
  },
  emberwing_scale: {
    id: 'emberwing_scale',
    name: 'Emberwing Scale',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dk_scales_of_the_maw',
  },
  scorched_supply_crate: {
    id: 'scorched_supply_crate',
    name: 'Scorched Supply Crate',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dk_scorched_stores',
    noVendorSell: true,
  },
  wyrmwatch_warning_banner: {
    id: 'wyrmwatch_warning_banner',
    name: 'Wyrmwatch Warning Banner',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dk_banners_over_the_dunes',
    noVendorSell: true,
  },
  // --- quest rewards ---
  cinderwalk_treads: {
    id: 'cinderwalk_treads',
    name: 'Cinderwalk Treads',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 58, sta: 4, spi: 3 },
    sellValue: 900,
  },
  mawscale_pauldrons: {
    id: 'mawscale_pauldrons',
    name: 'Mawscale Pauldrons',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 72, sta: 6, int: 4 },
    sellValue: 2200,
  },
  // --- the Drakemaw legendary ---
  // Has NO acquisition path yet: the broodlord drop was pulled (owner call,
  // 2026-08-04) because hanging the only farmable epic mount on the quest
  // chain's own 90% scale source camped the Drakemaw belt. The reins move to a
  // dedicated world boss in a follow-up; the def stays so the mount, its GLB,
  // and its strings keep shipping. Owning the reins IS owning the mount
  // (src/sim/mounts.ts mountOwned). Unbound like every player reins (the
  // tradable-reins policy): only the dev tank stays soulbound, and while this
  // has no acquisition path there is nothing to trade anyway.
  reins_drakemaw_raptor: {
    id: 'reins_drakemaw_raptor',
    name: 'Reins of the Drakemaw Raptor',
    kind: 'mount',
    mount: 'drakemaw_raptor',
    quality: 'epic',
    noVendorSell: true,
    noDiscard: true,
    sellValue: 0,
  },
};
export const DRAKELANDS_CAMPS: CampDef[] = [
  { mobId: 'dune_troll', center: { x: 460, z: 2140 }, radius: 10, count: 3 },
  { mobId: 'dune_troll', center: { x: 476, z: 2124 }, radius: 8, count: 2 },
  { mobId: 'ashbone_raider', center: { x: 356, z: 2086 }, radius: 10, count: 3 },
  { mobId: 'ashbone_raider', center: { x: 296, z: 2184 }, radius: 10, count: 3 },
  { mobId: 'ashbone_warcaller', center: { x: 448, z: 2106 }, radius: 8, count: 2 },
  // Brood rework: the two drake-den rows were REPLACED IN PLACE (same array
  // slots, same count) by two of the four broodlords, so every later camp in
  // the merged CAMPS array keeps its world-gen rng draws. The dens still sit
  // on the probed level shelves at the volcano feet (render/ember_features.ts
  // hoards rest on flat ground); the second den moved west into Bloodglass
  // for even spread (a center move changes no draw count).
  { mobId: 'drakemaw_broodlord', center: { x: 419, z: 2266 }, radius: 8, count: 1 },
  { mobId: 'drakemaw_broodlord', center: { x: 288, z: 2278 }, radius: 8, count: 1 },
];
export const DRAKELANDS_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'scorched_supply_crate',
    name: 'Scorched Supply Crate',
    // Strewn where the burned wagon broke apart along the Wyrmwatch -> Cinder
    // Dunes road.
    positions: [
      { x: 372, z: 1968 },
      { x: 360, z: 2014 },
      { x: 348, z: 2046 },
      { x: 332, z: 2094 },
    ],
  },
  {
    itemId: 'wyrmwatch_warning_banner',
    name: 'Wyrmwatch Warning Banner',
    // Banner stakes dropped at the three bonefield muster grounds, one per
    // grave-ring, waiting to be driven in.
    positions: [
      { x: 350, z: 2090 },
      { x: 302, z: 2180 },
      { x: 450, z: 2110 },
    ],
  },
];

// Quest-camp additions (a warcaller muster, a far-ranging drake, and the
// matriarch's crater roost). Kept separate from DRAKELANDS_CAMPS and appended
// at the very END of the merged CAMPS array in data.ts: camps draw world-gen
// rng in array order, so only a tail append leaves every existing spawn
// untouched.
export const DRAKELANDS_QUEST_CAMPS: CampDef[] = [
  { mobId: 'ashbone_warcaller', center: { x: 302, z: 2180 }, radius: 8, count: 2 },
  // Brood rework: the far-ranging drake's slot (same count) now spawns the
  // third broodlord, moved deep onto the crater's north rim for even spread.
  { mobId: 'drakemaw_broodlord', center: { x: 352, z: 2352 }, radius: 8, count: 1 },
  // Cindraleth's roost: a lava crater on the Drakemaw's eastern flank, well
  // away from every marked road.
  { mobId: 'cindraleth_maw_matriarch', center: { x: 436, z: 2348 }, radius: 6, count: 1 },
];

// The dragonkin brood belt (v0.35 rework): the fourth broodlord, the egg
// clutches ringing every broodlord and the matriarch, the loose scatter
// fields between nests, and the broodguard patrols. A NEW list appended at
// the very END of the merged CAMPS array in data.ts (below even the
// quest-camp block): every pre-existing camp keeps its world-gen rng draws,
// so no shipped spawn moves. Whelps have no camp: they hatch from eggs at
// runtime (src/sim/mob/dragonkin_brood.ts).
export const DRAKELANDS_BROOD_CAMPS: CampDef[] = [
  // the fourth broodlord: the southeast rim over the wargate approach
  {
    mobId: 'drakemaw_broodlord',
    center: { x: 458, z: 2302 },
    radius: 8,
    count: 1,
    offStream: true,
  },
  // egg clutches: a ring around each broodlord...
  { mobId: 'dragonkin_egg', center: { x: 419, z: 2266 }, radius: 9, count: 7, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 288, z: 2278 }, radius: 9, count: 7, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 352, z: 2352 }, radius: 9, count: 7, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 458, z: 2302 }, radius: 9, count: 7, offStream: true },
  // ...and the matriarch's own clutch in the crater
  { mobId: 'dragonkin_egg', center: { x: 436, z: 2348 }, radius: 10, count: 8, offStream: true },
  // loose scatter fields between the nests (sparser than the rings, so a
  // careless boot pops a local cascade, not the whole field). The first
  // field sits EAST of the crater-rim road terminus (390, 2298): centered on
  // the road it cascaded on every walk-by and read as pre-hatched.
  { mobId: 'dragonkin_egg', center: { x: 404, z: 2318 }, radius: 10, count: 5, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 330, z: 2300 }, radius: 12, count: 5, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 430, z: 2380 }, radius: 12, count: 5, offStream: true },
  // broodguard patrols: the caldera belt, Bloodglass, and the dune approach
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 378, z: 2242 },
    radius: 9,
    count: 3,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 392, z: 2296 },
    radius: 9,
    count: 3,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 352, z: 2282 },
    radius: 8,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 418, z: 2338 },
    radius: 8,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 302, z: 2302 },
    radius: 9,
    count: 3,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 268, z: 2252 },
    radius: 8,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'dragonkin_broodguard',
    center: { x: 438, z: 2384 },
    radius: 8,
    count: 2,
    offStream: true,
  },
  // Guard clutches (playtest wave 2, appended at this list's tail so every
  // camp above keeps its world-gen draws): a loose scatter of eggs beside
  // each broodguard patrol, so the guards walk among shells and a fight in
  // the pack risks waking hatchlings. Centers sit offset from the patrols
  // AND clear of the road lines (the crater-rim, north-rim, and dune-fork
  // legs), so no walk-by pops them; the guards themselves never can (only a
  // player inside proximityRadius springs a shell).
  { mobId: 'dragonkin_egg', center: { x: 372, z: 2242 }, radius: 7, count: 4, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 401, z: 2303 }, radius: 7, count: 4, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 344, z: 2286 }, radius: 6, count: 3, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 421, z: 2334 }, radius: 7, count: 3, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 306, z: 2308 }, radius: 7, count: 4, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 264, z: 2258 }, radius: 7, count: 3, offStream: true },
  { mobId: 'dragonkin_egg', center: { x: 441, z: 2380 }, radius: 7, count: 3, offStream: true },
];

export const DRAKELANDS_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // fallen keeps of the old drake-cult: castle ruins across the wastes.
  // (The Last Keep's ring at (422, 2032) is gone: that castle STANDS now,
  // rebuilt as the walled garrison in castle_layout.ts.)
  ruinRings: [
    { x: 330, z: 2114, ringR: 10, columns: 8 }, // the Cinder Bastion
    { x: 338, z: 2124, ringR: 6, columns: 5 },
    { x: 468, z: 2158, ringR: 7, columns: 6 }, // the Trollmoot henge
    { x: 268, z: 2256, ringR: 6, columns: 5 }, // Bloodglass watch
  ],
  graveyards: [
    { x: 354, z: 2092 },
    { x: 300, z: 2176 },
    { x: 452, z: 2112 },
  ],
  // Wyrmwatch: the dragon-watch garrison town on the Wyrmgate road. The
  // north palisade parts at x 44 for the causeway gate; the southwest road
  // to the dunes leaves between the inn and the well.
  buildings: [
    { kind: 'inn', x: 390, z: 1904, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: 414, z: 1892, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: 393, z: 1888, w: 5, d: 5, rot: 2.0 },
    { kind: 'house', x: 416, z: 1912, w: 5, d: 6, rot: 2.6 },
  ],
  wells: [
    { x: 410, z: 1902, r: 1.5 },
    // the Last Keep's courtyard well
    { x: 408, z: 2033, r: 1.5 },
  ],
  stalls: [
    { x: 398, z: 1896, rot: 0.5, r: 1.6 },
    { x: 410, z: 1910, rot: -1.2, r: 1.6 },
    // the keep's market row inside the main gate
    { x: 391, z: 2033, rot: 0.7, r: 1.6 },
    { x: 402, z: 2044.5, rot: -2.1, r: 1.6 },
  ],
  // the Last Keep's bailey: every building comes from the castle plan (one
  // source of truth with the walls, walks, and colliders)
  decorProps: [...CASTLE_BUILDINGS],
  crates: [
    [406, 1892],
    [396, 1912],
  ],
  fences: [
    // the north palisade, parted at the causeway gate
    { x1: 390, z1: 1882, x2: 400, z2: 1882 },
    { x1: 408, z1: 1882, x2: 416, z2: 1882 },
  ],
  // the old waypost stays: a garrison keeps its road camp
  tents: [
    { x: 396, z: 1894, rot: 0.8, scale: 1 },
    { x: 412, z: 1906, rot: -1.9, scale: 1 },
    { x: 497, z: 2097, rot: -2.2, scale: 1 }, // Scout Yerrin's ridge camp above the wargate
  ],
  campfires: [
    [404, 1900],
    [492, 2103], // Yerrin's low fire, banked so the gate does not see it
  ],
};
