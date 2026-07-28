// Orkadia: a hand-authored orc war-camp dungeon held in the black volcanic
// rock of the Drakelands, an open field lit by toxic-green warpyres. The
// overworld entrance is a skull-and-tusk gate near the Trollmoot raiding camp;
// inside, the `orkadia` interior variant is the first open-field dungeon
// interior: outdoor ground, sky, and the war-camp prop set instead of a closed
// room kit (see src/render/dungeon.ts `orkadia` variant, the placement table in
// src/sim/orkadia_field.ts, and INTERIOR_COLLIDERS in src/sim/colliders.ts), so
// what you see is what you collide with.
//
// Eight purpose-built orcs crew the camp. The five specialist silhouettes make
// each district read as a working war machine: scouts at the approach, a shaman
// in the ritual hollow, beast handlers at the cages, siege brutes by the engines,
// and banner captains guarding Grommok's fortress. Mob display names are
// re-localized on the client via the entity_i18n matcher (English lives here).
import type { DungeonDef, DungeonSpawn, MobTemplate } from '../types';

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
export const ORKADIA_MOBS: Record<string, MobTemplate> = {
  // Trash line (black_orc.glb): the war-camp rank and file, in pairs.
  orkadia_grunt: {
    id: 'orkadia_grunt',
    name: 'Bloodtusk Grunt',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.2,
    armorPerLevel: 21,
    moveSpeed: 6.6,
    aggroRadius: 12,
    componentTags: ['hide'],
    loot: [{ copper: 260, chance: 1 }],
    scale: 1.7,
    color: 0x3a4a2e, // mossy green-black warhide
  },
  // Heavier elite (blue_orc.glb): the camp's iron-shielded shock troops.
  orkadia_marauder: {
    id: 'orkadia_marauder',
    name: 'Ironhide Marauder',
    minLevel: 19,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 84,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 2.9,
    attackSpeed: 2.5,
    armorPerLevel: 27,
    moveSpeed: 6.4,
    aggroRadius: 13,
    componentTags: ['hide'],
    loot: [{ copper: 420, chance: 1 }],
    scale: 1.9,
    color: 0x35506a, // steel-blue plate over green hide
  },
  // Mobile ranged pressure (orkadia_axethrower.glb): scouts guarding the lower
  // terraces. The windup gives players time to read each thrown axe.
  orkadia_axethrower: {
    id: 'orkadia_axethrower',
    name: 'Bloodtusk Axethrower',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 54,
    hpPerLevel: 20,
    dmgBase: 11,
    dmgPerLevel: 2.4,
    attackSpeed: 2.2,
    armorPerLevel: 17,
    moveSpeed: 7.2,
    aggroRadius: 15,
    petSpell: {
      name: 'Barbed Axe',
      school: 'physical',
      min: 24,
      max: 34,
      range: 23,
      every: 2.7,
      windup: 0.55,
    },
    componentTags: ['hide'],
    loot: [{ copper: 310, chance: 1 }],
    scale: 1.75,
    color: 0x536c39,
  },
  // Priority caster (orkadia_fel_shaman.glb): a fel bolt plus pack healing makes
  // the ritual-ground pulls collapse quickly once the shaman is interrupted.
  orkadia_fel_shaman: {
    id: 'orkadia_fel_shaman',
    name: 'Ashenbone Fel Shaman',
    minLevel: 19,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 56,
    hpPerLevel: 20,
    dmgBase: 10,
    dmgPerLevel: 2.3,
    attackSpeed: 2.4,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 15,
    petSpell: {
      name: 'Fel Cinder',
      school: 'shadow',
      min: 27,
      max: 39,
      range: 25,
      every: 3,
      windup: 0.7,
    },
    mendAlly: {
      healMin: 34,
      healMax: 48,
      radius: 13,
      every: 8,
      name: 'Bloodfire Mending',
      school: 'shadow',
    },
    componentTags: ['hide', 'horn'],
    loot: [{ copper: 390, chance: 1 }],
    scale: 1.8,
    color: 0x44552e,
  },
  // Pack enabler (orkadia_beast_handler.glb): its cadence accelerates nearby
  // allies while the hooked chain leaves a readable bleed on the tank.
  orkadia_beast_handler: {
    id: 'orkadia_beast_handler',
    name: 'Ironhide Warbeast Handler',
    minLevel: 19,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 78,
    hpPerLevel: 24,
    dmgBase: 14,
    dmgPerLevel: 2.7,
    attackSpeed: 2.3,
    armorPerLevel: 25,
    moveSpeed: 6.8,
    aggroRadius: 14,
    bleed: {
      chance: 0.28,
      perTick: 7,
      interval: 3,
      duration: 9,
      name: 'Hooked Chain',
      school: 'physical',
    },
    warcry: {
      radius: 13,
      every: 12,
      hasteMult: 1.18,
      duration: 7,
      name: 'Hunting Cadence',
      school: 'physical',
    },
    componentTags: ['hide', 'fang'],
    loot: [{ copper: 430, chance: 1 }],
    scale: 1.9,
    color: 0x4c5b35,
  },
  // Siege-yard miniboss (orkadia_siege_brute.glb): a large, rare elite with a
  // short-range stomp and cleave. Its slow cadence keeps both tells avoidable.
  orkadia_siege_brute: {
    id: 'orkadia_siege_brute',
    name: 'Orkadia Siege Brute',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    rare: true,
    ccImmune: true,
    hpBase: 140,
    hpPerLevel: 34,
    dmgBase: 18,
    dmgPerLevel: 3.2,
    attackSpeed: 2.8,
    armorPerLevel: 34,
    moveSpeed: 6.1,
    aggroRadius: 15,
    stomp: {
      radius: 8,
      every: 13,
      duration: 1.2,
      min: 20,
      max: 30,
      name: 'Siegebreaker Stomp',
      school: 'physical',
    },
    cleave: { radius: 7, mult: 0.55, name: 'Basalt Sweep' },
    enrage: { belowHpPct: 0.25, dmgMult: 1.3, hasteMult: 1.15 },
    componentTags: ['hide', 'horn'],
    loot: [{ copper: 900, chance: 1 }],
    scale: 2.3,
    color: 0x26382c,
  },
  // Inner-gate miniboss (orkadia_banner_captain.glb): a rare elite commander
  // whose banner turns the honor guard into a coordinated final pull.
  orkadia_banner_captain: {
    id: 'orkadia_banner_captain',
    name: 'Black Banner Captain',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    rare: true,
    ccImmune: true,
    hpBase: 112,
    hpPerLevel: 30,
    dmgBase: 16,
    dmgPerLevel: 3,
    attackSpeed: 2.5,
    armorPerLevel: 31,
    moveSpeed: 6.6,
    aggroRadius: 16,
    rally: {
      radius: 14,
      every: 11,
      ap: 32,
      duration: 8,
      name: 'Black Banner Rally',
      school: 'physical',
    },
    wardAllies: {
      radius: 12,
      every: 14,
      amount: 65,
      duration: 7,
      name: 'Ironwall Order',
      school: 'physical',
    },
    componentTags: ['hide', 'horn'],
    loot: [{ copper: 850, chance: 1 }],
    scale: 2.1,
    color: 0x4a3029,
  },
  // Boss (red_orc.glb): Warlord Grommok Skullcleaver on the dais. A Warstomp
  // nova plus an enrage under 30%, mirroring the Gravewyrm Sanctum boss shape.
  orkadia_warlord: {
    id: 'orkadia_warlord',
    name: 'Warlord Grommok Skullcleaver',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    boss: true,
    ccImmune: true,
    hpBase: 440,
    hpPerLevel: 50,
    dmgBase: 16,
    dmgPerLevel: 3.1,
    attackSpeed: 2.6,
    armorPerLevel: 34,
    moveSpeed: 7,
    aggroRadius: 18,
    aoePulse: { min: 28, max: 40, radius: 13, every: 9, name: 'Warstomp' },
    knockback: { chance: 0.2, distance: 6, name: 'Skull Cleave' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    yells: {
      engage: 'Orkadia does not kneel! For the black banners!',
      enrage: 'BLEED FOR THE WARLORD!',
    },
    loot: [
      { copper: 50000, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.8 },
      { itemId: 'wyrmfang_greatblade', chance: 0.06, rollGroup: 'orkadia_bonus' },
      { itemId: 'deathlord_warplate', chance: 0.06, rollGroup: 'orkadia_bonus' },
      { itemId: 'cultist_flayer', chance: 0.06, rollGroup: 'orkadia_bonus' },
    ],
    scale: 2.9,
    color: 0x7a2418, // blood-red warpaint
  },
};

// ---------------------------------------------------------------------------
// Spawn plan along the winding processional route. Each pull occupies a
// distinct camp pocket or terrace, with Grommok and his honor guard in the
// broad fortress ring at the top of the basin.
// ---------------------------------------------------------------------------
const ORKADIA_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'orkadia_grunt', x: 1, z: 35 },
  { mobId: 'orkadia_axethrower', x: 8, z: 36.5 },
  { mobId: 'orkadia_grunt', x: 8, z: 56 },
  { mobId: 'orkadia_marauder', x: 15, z: 57.5 },
  { mobId: 'orkadia_axethrower', x: 7, z: 79 },
  { mobId: 'orkadia_beast_handler', x: 14, z: 80.5 },
  { mobId: 'orkadia_fel_shaman', x: -4, z: 102 },
  { mobId: 'orkadia_grunt', x: 3, z: 103.5 },
  { mobId: 'orkadia_fel_shaman', x: -4, z: 119 },
  { mobId: 'orkadia_beast_handler', x: -13, z: 134 },
  { mobId: 'orkadia_grunt', x: -6, z: 135.5 },
  { mobId: 'orkadia_marauder', x: -13, z: 152 },
  { mobId: 'orkadia_banner_captain', x: -6, z: 153.5 },
  { mobId: 'orkadia_siege_brute', x: -7, z: 172 },
  { mobId: 'orkadia_marauder', x: 0, z: 173.5 },
  { mobId: 'orkadia_axethrower', x: -2, z: 181 },
  { mobId: 'orkadia_grunt', x: 2, z: 182.5 },
  { mobId: 'orkadia_banner_captain', x: -24, z: 213 },
  { mobId: 'orkadia_siege_brute', x: 24, z: 213 },
  { mobId: 'orkadia_warlord', x: 0, z: 220 },
];

// ---------------------------------------------------------------------------
// Dungeon
// ---------------------------------------------------------------------------
export const ORKADIA_DUNGEON_DEFS: Record<string, DungeonDef> = {
  orkadia: {
    id: 'orkadia',
    name: 'Orkadia',
    index: 6,
    // Skull-and-tusk warcamp gate on the dry black rock just south-east of the
    // Trollmoot raiding camp (Trollmoot POI x460 z2140), clear of its henge and
    // spawns, in the Drakelands (zone rect x[180,540] z[1820,2420]). The old
    // {500,2200} sat on drowned seabed (groundHeight -10.3, below the -4.5 sea);
    // {490,2120} is firm ground (groundHeight ~3.8, ~8.3yd above the water).
    doorPos: { x: 490, z: 2120 },
    entry: { x: 0, z: -2 }, // clear-of-aggro arrival (see dungeon_entry_clearance test)
    exitOffset: { x: 0, z: -6 },
    spawns: ORKADIA_SPAWN_LIST,
    interior: 'orkadia',
    suggestedPlayers: 5,
    enterText: 'The warpyres flare green. The war-camp of Orkadia knows you have come.',
    leaveText: 'You cut your way back out into the ashen Drakelands wind.',
  },
};
