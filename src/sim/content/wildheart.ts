// The Wildheart Basin: a level-20 open-field dungeon hidden behind the Sunken
// Idol in Palmreach. Unlike Orkadia's processional war-camp, this interior is a
// flooded jungle caldera with two routes around a central beast island. Both
// paths climb into one ritual terrace beneath a colossal jaguar shrine.
import type { DungeonDef, DungeonSpawn, ItemDef, MobTemplate } from '../types';

export const WILDHEART_ITEMS: Record<string, ItemDef> = {
  wildheart_tuskblade: {
    id: 'wildheart_tuskblade',
    name: 'Wildheart Tuskblade',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    weapon: { min: 33, max: 53, speed: 2.6 },
    stats: { str: 14, sta: 9 },
    sellValue: 8000,
    requiredClass: ['warrior', 'hunter', 'shaman', 'paladin'],
  },
  wildheart_hexwood_staff: {
    id: 'wildheart_hexwood_staff',
    name: 'Hexwood Staff of the Basin',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    weapon: { min: 40, max: 60, speed: 3 },
    stats: { int: 15, spi: 8 },
    sellValue: 8000,
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
  wildheart_fangknife: {
    id: 'wildheart_fangknife',
    name: 'Fangknife of Zulgar',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 19, max: 30, speed: 1.7, dagger: true },
    stats: { agi: 12, sta: 6 },
    sellValue: 8000,
    requiredClass: ['rogue', 'hunter'],
  },
  // The Beastmaster's signature rare: item level 23 (source 20 + rare 3). 2H dps
  // on the weaponDpsBudget(23) x TWOHAND_DPS_MULT curve (~15.6 at speed 3.2);
  // stat budget round(13 x TWOHAND_STAT_MULT) = 17.
  fanglords_beastspear: {
    id: 'fanglords_beastspear',
    name: "Fanglord's Beastspear",
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'rare',
    weapon: { min: 40, max: 60, speed: 3.2 },
    stats: { str: 7, agi: 5, sta: 5 },
    sellValue: 3200,
    requiredClass: ['warrior', 'hunter', 'shaman', 'paladin'],
  },
  // Zulgar's guaranteed uncommon trio (the Korzul boneplate/revenant/nightwalk
  // pattern, one per armor class): legs at item level 21, budget
  // round(21 x 0.55 x 0.9 x 0.7) = 7, armor ~0.9x the Sanctum uncommon chests.
  bloodmane_warleggings: {
    id: 'bloodmane_warleggings',
    name: 'Bloodmane Warleggings',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 153, str: 3, sta: 4 },
    sellValue: 800,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  vineclaw_stalking_breeches: {
    id: 'vineclaw_stalking_breeches',
    name: 'Vineclaw Stalking Breeches',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 95, agi: 5, sta: 2 },
    sellValue: 800,
    requiredClass: ['rogue', 'hunter'],
  },
  sunbone_ritual_sarong: {
    id: 'sunbone_ritual_sarong',
    name: 'Sunbone Ritual Sarong',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 55, int: 4, spi: 3 },
    sellValue: 800,
    requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
};

export const WILDHEART_MOBS: Record<string, MobTemplate> = {
  // A mobile ranged hunter that pressures whichever bank the group chooses.
  wildheart_stalker: {
    id: 'wildheart_stalker',
    name: 'Vineclaw Stalker',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    hpBase: 62,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.1,
    armorPerLevel: 18,
    moveSpeed: 7.4,
    aggroRadius: 16,
    petSpell: {
      // 'nature', not 'physical': a physical-school petSpell replays the
      // attacker's melee Attack clip on every impact (renderer damage-event
      // heuristic), so the thrower looked like it was whiffing melee swings
      // from 24yd. The roll path is unchanged (hostile petSpells take no
      // armor step; resist is school-independent), and every other petSpell
      // in the game is a magic school, but dealDamage's school-scoped folds
      // DO shift: physical-only DR (a prot warrior's Raised Guard) and the
      // physical-amp debuff stop applying to the spear, and magic-amp
      // debuffs start. Revisit the stalker's rangedDamageMultiplierByMob
      // tuning if tank intake reads hot.
      name: 'Razorvine Spear',
      school: 'nature',
      min: 26,
      max: 36,
      range: 24,
      every: 2.8,
      windup: 0.55,
    },
    componentTags: ['hide', 'fang'],
    loot: [
      { copper: 360, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.35 },
    ],
    scale: 1.85,
    color: 0x4f7651,
  },
  // Fast melee pressure. The bleed makes target swaps and tank movement matter.
  wildheart_ravager: {
    id: 'wildheart_ravager',
    name: 'Bloodmane Ravager',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    hpBase: 88,
    hpPerLevel: 27,
    dmgBase: 15,
    dmgPerLevel: 2.9,
    attackSpeed: 2.25,
    armorPerLevel: 26,
    // 7.5, not 7.1: player RUN_SPEED is 7, so at 7.1 the "fast melee
    // pressure" closed on a moving target at 0.1 yd/s and effectively never
    // caught anyone on normal (heroic already floors mob speed at 8).
    // drowned_thrall sets the precedent at 7.5.
    moveSpeed: 7.5,
    aggroRadius: 14,
    bleed: {
      chance: 0.3,
      perTick: 8,
      interval: 3,
      duration: 9,
      name: 'Bloodmane Rend',
      school: 'physical',
    },
    cleave: { radius: 6.5, mult: 0.5, name: 'Tusk Sweep' },
    componentTags: ['hide', 'fang'],
    loot: [
      { copper: 450, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.4 },
    ],
    scale: 2,
    color: 0x78513f,
  },
  // Priority caster and healer on the ritual shelves.
  wildheart_hexcaller: {
    id: 'wildheart_hexcaller',
    name: 'Sunbone Hexcaller',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    hpBase: 60,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 18,
    moveSpeed: 6.6,
    aggroRadius: 16,
    petSpell: {
      name: 'Sunvenom Hex',
      school: 'nature',
      min: 29,
      max: 41,
      range: 25,
      every: 3,
      windup: 0.7,
    },
    mendAlly: {
      healMin: 36,
      healMax: 50,
      radius: 14,
      every: 8,
      name: 'Ancestral Sap',
      school: 'nature',
    },
    componentTags: ['hide', 'horn'],
    loot: [
      { copper: 430, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.45 },
    ],
    scale: 1.9,
    color: 0x688057,
  },
  // The beast-island miniboss turns nearby hunters into a coordinated pack.
  wildheart_beastmaster: {
    id: 'wildheart_beastmaster',
    name: 'Fanglord Beastmaster',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    rare: true,
    ccImmune: true,
    hpBase: 150,
    hpPerLevel: 36,
    dmgBase: 18,
    dmgPerLevel: 3.2,
    attackSpeed: 2.6,
    armorPerLevel: 32,
    moveSpeed: 6.8,
    aggroRadius: 17,
    warcry: {
      radius: 15,
      every: 12,
      hasteMult: 1.2,
      duration: 7,
      name: 'Call of the Hunt',
      school: 'physical',
    },
    wardAllies: {
      radius: 13,
      every: 14,
      amount: 70,
      duration: 7,
      name: 'Thickhide Ward',
      school: 'nature',
    },
    stomp: {
      radius: 8,
      every: 13,
      duration: 1.1,
      min: 21,
      max: 31,
      name: 'Beast Pit Quake',
      school: 'physical',
    },
    componentTags: ['hide', 'fang'],
    loot: [
      { copper: 2500, chance: 1 },
      // Guaranteed troll trophy junk: the Grubjaw rare convention (zone2.ts).
      { itemId: 'chipped_tusk', chance: 1 },
      { itemId: 'fanglords_beastspear', chance: 0.12 },
    ],
    scale: 2.35,
    color: 0x485b3d,
  },
  // Final boss on the high terrace. The pulse and knockback exploit the broad
  // arena without relying on corridor geometry.
  wildheart_high_priest: {
    id: 'wildheart_high_priest',
    name: 'Zulgar, Voice of the Basin',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    boss: true,
    ccImmune: true,
    hpBase: 470,
    hpPerLevel: 54,
    dmgBase: 17,
    dmgPerLevel: 3.2,
    attackSpeed: 2.55,
    armorPerLevel: 35,
    moveSpeed: 7,
    aggroRadius: 19,
    aoePulse: { min: 30, max: 43, radius: 14, every: 9, name: 'Wildheart Pulse' },
    knockback: { chance: 0.22, distance: 7, name: 'Jaguar Roar' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.28 },
    yells: {
      engage: 'The basin has teeth. It will remember your blood!',
      enrage: 'THE WILD HEART BEATS THROUGH ME!',
    },
    loot: [
      { copper: 55000, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.8 },
      // Guaranteed uncommon (chances sum to 1.0, exactly one drops): the Korzul
      // korzul_guaranteed_uncommon pattern, one piece per armor class.
      { itemId: 'bloodmane_warleggings', chance: 0.34, rollGroup: 'zulgar_guaranteed_uncommon' },
      {
        itemId: 'vineclaw_stalking_breeches',
        chance: 0.33,
        rollGroup: 'zulgar_guaranteed_uncommon',
      },
      { itemId: 'sunbone_ritual_sarong', chance: 0.33, rollGroup: 'zulgar_guaranteed_uncommon' },
      { itemId: 'wildheart_tuskblade', chance: 0.06, rollGroup: 'wildheart_bonus' },
      { itemId: 'wildheart_hexwood_staff', chance: 0.06, rollGroup: 'wildheart_bonus' },
      { itemId: 'wildheart_fangknife', chance: 0.06, rollGroup: 'wildheart_bonus' },
    ],
    scale: 2.8,
    color: 0x566f45,
  },
};

const WILDHEART_SPAWN_LIST: DungeonSpawn[] = [
  // Arrival and the fork.
  { mobId: 'wildheart_stalker', x: -7, z: 36 },
  { mobId: 'wildheart_ravager', x: 7, z: 37.5 },

  // Western hunt terraces.
  { mobId: 'wildheart_ravager', x: -31, z: 63 },
  { mobId: 'wildheart_stalker', x: -39, z: 68 },
  { mobId: 'wildheart_ravager', x: -34, z: 96 },
  { mobId: 'wildheart_hexcaller', x: -25, z: 102 },

  // Eastern waterfall walk.
  { mobId: 'wildheart_stalker', x: 31, z: 66 },
  { mobId: 'wildheart_ravager', x: 40, z: 72 },
  { mobId: 'wildheart_hexcaller', x: 27, z: 104 },
  { mobId: 'wildheart_stalker', x: 38, z: 111 },

  // Central beast island.
  { mobId: 'wildheart_stalker', x: -10, z: 116 },
  { mobId: 'wildheart_ravager', x: 10, z: 117 },
  { mobId: 'wildheart_beastmaster', x: 0, z: 111 },

  // Upper convergence.
  { mobId: 'wildheart_hexcaller', x: -34, z: 155 },
  { mobId: 'wildheart_ravager', x: -25, z: 160 },
  { mobId: 'wildheart_stalker', x: 34, z: 160 },
  { mobId: 'wildheart_ravager', x: 25, z: 166 },
  { mobId: 'wildheart_beastmaster', x: 0, z: 183 },
  { mobId: 'wildheart_hexcaller', x: -8, z: 184.5 },

  // High shrine.
  { mobId: 'wildheart_high_priest', x: 0, z: 213 },
];

export const WILDHEART_DUNGEON_DEFS: Record<string, DungeonDef> = {
  wildheart_basin: {
    id: 'wildheart_basin',
    name: 'The Wildheart Basin',
    index: 7,
    // Hidden beyond the Sunken Idol, clear of its overworld guardian and the
    // Sapphire Lagoon. The door reads as the newly opened idol maw.
    doorPos: { x: -232, z: 1112 },
    entry: { x: 0, z: -5 },
    exitOffset: { x: 0, z: -10 },
    // Opens on Zulgar's death at the shrine terrace (owner request,
    // live-playtest round 2): the terrace is ~220yd from the entrance exit,
    // so the cleared run steps out here instead of walking the route back.
    // Clear of the pyramid collider (r13.8 at z237) and Zulgar's spawn (z213).
    bossExitPortal: { x: 0, z: 222 },
    spawns: WILDHEART_SPAWN_LIST,
    interior: 'wildheart',
    // The basin answers as one. Pulling Zulgar with any of the route still alive
    // brings the whole cult down on you (instances/boss_chain_pull.ts): the two
    // open routes make skipping trash to the shrine trivial otherwise, since
    // nothing here is a corridor that has to be fought through.
    bossChainPull: true,
    suggestedPlayers: 5,
    enterText: 'Warm rain hisses on old stone. The Wildheart Basin opens before you.',
    leaveText: 'You pass back beneath the stone fangs into the Palmreach sun.',
  },
};
