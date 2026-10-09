// The Wildheart Basin (docs/design/dungeon-rework/wildheart_basin.md): a
// level-20 five-player dungeon hidden behind the Sunken Idol in the Palmreach.
// A closed jungle caldera: a braided river and its waterfalls, basalt
// terraces, the Court's colony ruins under the roots, and the Sunbone shrine on
// a stepped pyramid under a colossal stone jaguar head. This module holds its
// items, mob templates, the packs placed on the open-air field
// (wildheart_basin_layout.ts), the patrols, the gates and encounter seals that
// make every pack mandatory, and the dungeon record (merged by data.ts).
//
// Built in phases (src/sim/encounters/wildheart_basin/CLAUDE.md): phase A the
// map, every pack and patrol with its kit, the Great Saurian showpiece and the
// three bosses as melee placeholders in their arenas; phase B the boss cores
// (G15 linked pair, the Gorgebloom's seeds, Zulgar's hunt), loot, deeds and
// the Reliquary.
//
// Trash is simple and readable (README section 5): one job per type, never a
// boss lesson.
//
//   Vineclaw Stalker       Razorvine Spear, a ranged nuke. Close on it. Quarry
//                          Mark: a marking spear that sets its raptors on
//                          someone past the tank. Kill it first.
//   Bloodmane Ravager      Tusk Sweep and Bloodmane Rend; under 30 percent a
//                          kickable War Roar enrages every ravager near it.
//   Sunbone Hexcaller      Ancestral Sap: an interruptible 2 s heal, and Toad
//                          Hex: a kickable hex (shadow, so one kick never
//                          locks both). Split the kicks.
//   Sunbone Totem-Binder   Plants a totem every 15 s, in turn a Sunbone Totem
//                          (heals its allies 3 percent every 2 s) and a Sunbone
//                          Dread Totem (Rattling Dread: everyone near it
//                          flees). Choose which to break first.
//   Basin Raptor           Pounce: leaps onto the farthest caster. Comes in
//                          fours; each death frenzies the rest. Even them out.
//   Spore Toad             Snaring Tongue: a lane that reels its catch in.
//                          Spore Burst: a 4 yd poison cloud where it dies.
//   Snarlvine Lasher       Entangling Lash: a 20 yd lane, a 2 s root. Sidestep
//                          it. Snarlbark pricks every melee swing at it.
//   The Great Saurian      The showpiece patrol (encounters/wildheart_basin/
//                          great_saurian.ts): Tail Swipe, Earthshaking Stomp,
//                          the Howdah Rider at half health, Enrage.
//
// Numbers basis (README section 7): classic-era level 19 to 20 templates priced
// by the dungeon's normal tuning row (dungeon_difficulty.ts: the Sanctum ruler,
// trash swing floor 100 and boss floor 200 on the reference warrior). Kit
// mechanic damage is stated LANDED on a level-20 cloth wearer of about 950
// health (the row stamps a mechanic factor of 1 on the new kit mobs).
import {
  BASIN_RAPTOR_ID,
  BEASTMASTER_ID,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  GREAT_SAURIAN_ID,
  HOWDAH_HEXCALLER_ID,
  SPORE_TOAD_ID,
  SUNBONE_DREAD_TOTEM_ID,
  SUNBONE_TOTEM_ID,
  THORN_SPROUT_ID,
  TOTEM_BINDER_ID,
  VINE_LASHER_ID,
  WILDHEART_DUNGEON,
  WILDHEART_SPORE_CLOUD,
  ZULGAR_ID,
} from '../encounters/wildheart_basin/ids';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_ENTANGLING_LASH,
  WILDHEART_PLANT_TOTEM,
  WILDHEART_POUNCE,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_SPORE_BURST,
  WILDHEART_TOAD_HEX,
  WILDHEART_TOTEM_PULSE,
  WILDHEART_WAR_ROAR,
} from '../mob/trash_kit/wildheart_cast_ids';
import type {
  DungeonDef,
  DungeonGateDef,
  DungeonObjectSpawn,
  DungeonSpawn,
  ItemDef,
  MobTemplate,
} from '../types';
import { HEROIC_FINALE_COPPER } from './dungeon_difficulty';
import {
  BEAST_PITS,
  GORGEBLOOM_DAIS,
  JAGUAR_MAW,
  RIVER_FORD,
  WILDHEART_BASIN_ANCHORS,
  ZULGAR_SPOT,
} from './wildheart_basin_layout';

export const WILDHEART_ITEMS: Record<string, ItemDef> = {
  // Rogue dagger (drops from the Fanglord Beastmaster, the Wildheart Basin
  // mid-boss). Shadow-bolt on-hit; the heroic twin lives in HEROIC_ITEMS.
  duskwhisper: {
    id: 'duskwhisper',
    name: 'Duskwhisper',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 20, max: 31, speed: 1.7, dagger: true },
    // ilvl-26 mainhand budget (18): the stamina point over budget came off the
    // DPS-neutral stat, keeping the agility identity.
    stats: { agi: 12, sta: 7 },
    sellValue: 9000,
    requiredClass: ['rogue', 'hunter'],
    requiredLevel: 20,
    weaponProcs: [
      {
        id: 'duskwhisper_bolt',
        name: 'Duskbolt',
        trigger: 'weaponHit',
        chance: 0.08,
        effects: [
          { kind: 'chainArc', school: 'shadow', damage: 20, jumps: 0, falloff: 0.6, radius: 8 },
        ],
      },
    ],
  },
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
    stats: { int: 15, spi: 8, sta: 8 },
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
    stats: { str: 6, agi: 5, sta: 6 },
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
    stats: { armor: 55, int: 4, spi: 3, sta: 2 },
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
    // The trash mechanics pass: a marking spear at someone past the tank,
    // only while a Basin Raptor of the fight runs near; the raptors run the
    // quarry down for 4 s (6 on heroic; a taunt still wins). Four non-elite
    // raptors on a level-20 cloth wearer land about 110 a second once they
    // arrive, so 4 s on normal stays a scare, never a kill. Physical: no
    // kick. Kill the stalker first, or keep the raptors gathered on the tank.
    trashKit: {
      wildheart: {
        mark: {
          castId: WILDHEART_QUARRY_MARK,
          name: 'Quarry Mark',
          castTime: 1.5,
          every: 14,
          first: 5,
          school: 'physical',
          range: 30,
          seconds: 4,
          heroicSeconds: 6,
          hunter: BASIN_RAPTOR_ID,
          huntRange: 30,
        },
      },
    },
    componentTags: ['hide', 'fang'],
    loot: [
      { copper: 360, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.35 },
    ],
    scale: 1.85,
    color: 0x4f7651,
  },
  // Fast melee pressure. The bleed makes target swaps and tank movement matter;
  // under 30 percent it enrages (burn it, or save the tank's cooldown).
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
    // The trash mechanics pass: the old lone enrage under 30 percent became a
    // War Roar (the same +30 percent damage and 15 percent faster swings):
    // once a pull, a 2 s roar you can kick or stun; if it lands every ravager
    // within 15 yd frenzies for the rest of the pull. A kicked roar is spent.
    trashKit: {
      wildheart: {
        roar: {
          castId: WILDHEART_WAR_ROAR,
          name: 'War Roar',
          castTime: 2,
          every: 600,
          first: 0,
          school: 'physical',
          belowHpPct: 0.3,
          radius: 15,
          packmate: 'wildheart_ravager',
          damagePct: 0.3,
          hasteMult: 1.15,
        },
      },
    },
    componentTags: ['hide', 'fang'],
    loot: [
      { copper: 450, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.4 },
    ],
    scale: 2,
    color: 0x78513f,
  },
  // Priority caster and healer: Ancestral Sap is a 2 s interruptible heal on a
  // hurt packmate (the trash kit's mend). Kick it.
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
    trashKit: {
      mend: {
        castId: WILDHEART_ANCESTRAL_SAP,
        name: 'Ancestral Sap',
        castTime: 2,
        every: 9,
        first: 4,
        school: 'nature',
        range: 25,
        healPct: 0.12,
        below: 0.8,
      },
      // The trash mechanics pass: a 2 s hex at someone past the tank, a toad
      // for 5 s (6 on heroic) that any hit frees. Shadow, so a kick on the Sap
      // (nature) never locks it: the group splits its kicks.
      wildheart: {
        hex: {
          castId: WILDHEART_TOAD_HEX,
          name: 'Toad Hex',
          castTime: 2,
          every: 16,
          first: 8,
          school: 'shadow',
          range: 30,
          seconds: 5,
          heroicSeconds: 6,
        },
      },
    },
    componentTags: ['hide', 'horn'],
    loot: [
      { copper: 430, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.45 },
    ],
    scale: 1.9,
    color: 0x688057,
  },
  // Plants a Sunbone Totem beside it every 15 s; the totem heals its allies.
  // Kill the totems fast (or the binder).
  sunbone_totem_binder: {
    id: TOTEM_BINDER_ID,
    name: 'Sunbone Totem-Binder',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    hpBase: 60,
    hpPerLevel: 21,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.3,
    armorPerLevel: 18,
    moveSpeed: 6.8,
    aggroRadius: 15,
    // The trash mechanics pass: the totems come in turn, a healing Sunbone
    // Totem then a Sunbone Dread Totem, two at most. Which to break first is
    // the question the pull asks.
    trashKit: {
      wildheart: {
        totems: {
          castId: WILDHEART_PLANT_TOTEM,
          name: 'Plant Totem',
          castTime: 1.5,
          every: 15,
          first: 3,
          school: 'nature',
          summons: [SUNBONE_TOTEM_ID, SUNBONE_DREAD_TOTEM_ID],
          maxAlive: 2,
        },
      },
    },
    componentTags: ['hide', 'horn'],
    loot: [
      { copper: 420, chance: 1 },
      { itemId: 'chipped_tusk', chance: 0.4 },
    ],
    scale: 1.95,
    color: 0x8a6a3a,
  },
  // The Totem-Binder's bone totem: it never moves or fights; every 2 s it
  // mends each ally near it for 3 percent of that ally's health.
  sunbone_totem: {
    id: SUNBONE_TOTEM_ID,
    name: 'Sunbone Totem',
    minLevel: 18,
    maxLevel: 18,
    family: 'elemental',
    untameable: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 20,
    hpPerLevel: 6,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 30,
    armorPerLevel: 10,
    moveSpeed: 0,
    aggroRadius: 20,
    idleStationary: true,
    xpMult: 0.2,
    trashKit: {
      pulse: {
        castId: WILDHEART_TOTEM_PULSE,
        name: 'Sunbone Mending',
        every: 2,
        radius: 12,
        healPct: 0.03,
        school: 'nature',
      },
    },
    loot: [],
    scale: 1.6,
    color: 0xd9b26a,
  },
  // The Totem-Binder's second totem (the trash mechanics pass): a bone post
  // under a red-painted skull. It never moves or fights; every 9 s its
  // Rattling Dread (a 2 s bar nobody can kick) sends everyone within 8 yd
  // fleeing straight away from it for 2 s (3 on heroic; a hit breaks the
  // fear): at most a fifth of the fight spent afraid on normal, a third on
  // heroic, and only by standing at the totem. Tank the pack clear of it,
  // or break it first (about 250 health on normal). It crumbles with its
  // binder.
  sunbone_dread_totem: {
    id: SUNBONE_DREAD_TOTEM_ID,
    name: 'Sunbone Dread Totem',
    minLevel: 18,
    maxLevel: 18,
    family: 'elemental',
    untameable: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 20,
    hpPerLevel: 6,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 30,
    armorPerLevel: 10,
    moveSpeed: 0,
    aggroRadius: 20,
    idleStationary: true,
    xpMult: 0.2,
    trashKit: {
      wildheart: {
        dread: {
          castId: WILDHEART_RATTLING_DREAD,
          name: 'Rattling Dread',
          castTime: 2,
          every: 9,
          first: 4,
          school: 'shadow',
          radius: 8,
          seconds: 2,
          heroicSeconds: 3,
        },
      },
    },
    loot: [],
    scale: 1.6,
    color: 0xb0483a,
  },
  // A pack hunter of the basin floor, striped for the jungle; comes in fours.
  // Pounce: it leaps onto the farthest caster in reach and holds on.
  basin_raptor: {
    id: BASIN_RAPTOR_ID,
    name: 'Basin Raptor',
    minLevel: 19,
    maxLevel: 19,
    family: 'beast',
    hpBase: 50,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 15,
    trashKit: {
      leap: {
        castId: WILDHEART_POUNCE,
        name: 'Pounce',
        every: 12,
        first: 3,
        minRange: 8,
        maxRange: 25,
        seconds: 0.6,
        fixate: 3,
      },
    },
    // The trash mechanics pass: each raptor that falls drives the rest of
    // its pack into a frenzy (30 percent faster swings for 8 s, refreshed by
    // each further death). Bring the four down evenly.
    packFrenzy: { radius: 20, hasteMult: 1.3, duration: 8 },
    componentTags: ['hide', 'fang'],
    loot: [{ copper: 150, chance: 1 }],
    scale: 1.7,
    color: 0x6f7a3a,
  },
  // A warty toad as big as a boar; its spores burst into a poison cloud where
  // it dies. Step out of the cloud.
  spore_toad: {
    id: SPORE_TOAD_ID,
    name: 'Spore Toad',
    minLevel: 19,
    maxLevel: 19,
    family: 'beast',
    elite: true,
    hpBase: 70,
    hpPerLevel: 24,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.4,
    armorPerLevel: 16,
    moveSpeed: 6,
    aggroRadius: 13,
    trashKit: {
      deathCloud: {
        castId: WILDHEART_SPORE_BURST,
        name: 'Spore Burst',
        radius: 4,
        seconds: 6,
        tick: 1,
        min: 40,
        max: 50,
        school: 'nature',
        objectTemplate: WILDHEART_SPORE_CLOUD,
      },
      // The trash mechanics pass: it swells and its tongue shoots down a
      // 22 yd lane at someone at least 8 yd off; whoever stands in it is
      // struck and reeled to its mouth at 14 yd/s, twice a run, so the drag
      // reads for about a second (into its spores, when it is low).
      // Step out sideways; it cannot be kicked. Math, landed raw: normal 60
      // to 75, 6 to 8 percent of a level 20 cloth wearer's ~950 (the cost is
      // the reel into the spores); heroic x3 (the toad's mechanic factor) 180
      // to 225, 14 to 18 percent of a heroic cloth wearer's ~1,250.
      wildheart: {
        tongue: {
          castId: WILDHEART_SNARING_TONGUE,
          name: 'Snaring Tongue',
          castTime: 1.5,
          every: 14,
          first: 6,
          school: 'nature',
          length: 22,
          halfWidth: 1.5,
          minRange: 8,
          min: 60,
          max: 75,
          reel: 14,
          stop: 2.5,
        },
      },
    },
    componentTags: ['hide'],
    loot: [{ copper: 360, chance: 1 }],
    scale: 2.4,
    color: 0x7a8a3c,
  },
  // A walking tangle of vines and bark. Entangling Lash: a telegraphed 20 yd
  // lane of vines toward one player; whoever stands in it is rooted for 2 s.
  vine_lasher: {
    id: VINE_LASHER_ID,
    // Displayed as the Snarlvine Lasher: "Vine Lasher" is an exact Pathfinder
    // 2e monster name (the IP check); the id stays.
    name: 'Snarlvine Lasher',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    untameable: true,
    hpBase: 80,
    hpPerLevel: 26,
    dmgBase: 13,
    dmgPerLevel: 2.7,
    attackSpeed: 2.6,
    armorPerLevel: 24,
    moveSpeed: 6,
    aggroRadius: 14,
    trashKit: {
      line: {
        castId: WILDHEART_ENTANGLING_LASH,
        name: 'Entangling Lash',
        castTime: 1.5,
        every: 10,
        first: 4,
        school: 'nature',
        length: 20,
        halfWidth: 2,
        min: 120,
        max: 150,
        root: 2,
      },
    },
    // Snarlbark (the trash mechanics pass): its thorned bark pricks every
    // melee swing at it, 10 nature on normal (a dual-wielder swinging about
    // twice a second pays about 20 a second, about 2 percent of a level-20
    // melee's health; the classic Thorns spell sits in the same band) and
    // 30 on heroic through the claim's mechanic factor (3). The ranged take
    // it; the melee mind their health.
    thorns: { value: 10, school: 'nature', name: 'Snarlbark' },
    // No componentTags: animated plant, like the shipped treants
    // (orchard_treant, treant_elder), so its corpse offers no harvest. No
    // HARVEST_COMPONENT_ITEMS family is wood, and an unmapped tag would be a
    // corpse that advertises a harvest it can never pay
    // (tests/harvest_geography.test.ts).
    loot: [{ copper: 400, chance: 1 }],
    scale: 2.2,
    color: 0x4f6a2e,
  },
  // The showpiece patrol (encounters/wildheart_basin/great_saurian.ts): a
  // long-necked war-beast as big as a house carrying the Sunbone's howdah
  // across the River Ford. About 10,000 health on normal through the tuning
  // row. Its kit rides its encounter module, never a template field.
  great_saurian: {
    id: GREAT_SAURIAN_ID,
    name: 'Great Saurian',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    hpBase: 150,
    hpPerLevel: 30,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.8,
    armorPerLevel: 30,
    moveSpeed: 6,
    aggroRadius: 16,
    // The house-sized beast: melee reaches it from its body's edge.
    bodyRadius: 4,
    componentTags: ['hide'],
    loot: [{ copper: 1500, chance: 1 }],
    scale: 3.2,
    color: 0x6c7a4a,
  },
  // The rider who jumps down when the howdah breaks (Howdah Rider, at the
  // Saurian's half health): the Hexcaller's kit, its Ancestral Sap channelled
  // on the Saurian. Kick it.
  howdah_hexcaller: {
    id: HOWDAH_HEXCALLER_ID,
    name: 'Howdah Hexcaller',
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
    trashKit: {
      mend: {
        castId: WILDHEART_ANCESTRAL_SAP,
        name: 'Ancestral Sap',
        castTime: 2,
        every: 7,
        first: 1.5,
        school: 'nature',
        range: 30,
        healPct: 0.04,
        below: 0.99,
        family: 'beast',
      },
    },
    componentTags: ['hide', 'horn'],
    loot: [{ copper: 430, chance: 1 }],
    scale: 1.9,
    color: 0x688057,
  },
  // What a missed Seedpod grows into (the Gorgebloom's Seed Rain, section
  // 5.2): a thorned biter as tall as a man, rooted no longer, straight at the
  // nearest player. Kill it fast; the tank picks it up. It withers when its
  // parent dies. A kit add (never a pack member), no loot.
  thorn_sprout: {
    id: THORN_SPROUT_ID,
    name: 'Thorn Sprout',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    untameable: true,
    hpBase: 60,
    hpPerLevel: 20,
    dmgBase: 11,
    dmgPerLevel: 2.4,
    attackSpeed: 2,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 14,
    // No kill XP: a missed seed must never be a farm.
    xpMult: 0,
    // No componentTags: a plant like the Snarlvine Lasher, and a missed seed
    // must never be a harvest farm either.
    loot: [],
    scale: 1.5,
    color: 0x6b8f2a,
  },
  // Boss 1 (design section 5.1), promoted from the twice-spawned rare: the
  // Fanglord Beastmaster and his Great Jaguar in the Beast Pits, spawned once.
  // His whole kit rides encounters/wildheart_basin/beastmaster.ts (the G15
  // linked pair: one health pool, Pack Bond, the jaguar's Stalk, the
  // telegraphed Beast Pit Quake, Call of the Hunt, Thickhide Ward; heroic
  // Heel! and Frenzied Bond), never a template field.
  wildheart_beastmaster: {
    id: 'wildheart_beastmaster',
    name: 'Fanglord Beastmaster',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    hpBase: 150,
    hpPerLevel: 36,
    dmgBase: 18,
    dmgPerLevel: 3.2,
    attackSpeed: 2.6,
    armorPerLevel: 32,
    moveSpeed: 6.8,
    aggroRadius: 17,
    componentTags: ['hide', 'fang'],
    // Section 8.1: one guaranteed archetype piece (wildheart_items.ts) beside
    // the shipped Beastspear and Duskwhisper rows. Every gear row is
    // normalOnly: a heroic kill pays one equipment item from
    // HEROIC_BOSS_LOOT.wildheart_beastmaster instead.
    loot: [
      { copper: 2500, chance: 1 },
      // Guaranteed troll trophy junk: the Grubjaw rare convention (zone2.ts).
      { itemId: 'chipped_tusk', chance: 1 },
      // One bonus roll: the two chase weapons keep 0.12 each and the relocated
      // Nythraxis raid pieces join them (content/nythraxis_loot.ts), so a kill
      // pays at most one of them.
      {
        itemId: 'fanglords_beastspear',
        chance: 0.12,
        rollGroup: 'beastmaster_bonus',
        normalOnly: true,
      },
      { itemId: 'duskwhisper', chance: 0.12, rollGroup: 'beastmaster_bonus', normalOnly: true },
      // Relocated Nythraxis raid pieces (content/nythraxis_loot.ts): item level 29,
      // 4% each inside this one bonus roll, so a kill never pays an extra item.
      {
        itemId: 'direfang_greatblade',
        chance: 0.04,
        rollGroup: 'beastmaster_bonus',
        normalOnly: true,
      },
      { itemId: 'direfang_quiver', chance: 0.04, rollGroup: 'beastmaster_bonus', normalOnly: true },
      {
        itemId: 'bramblehide_grips',
        chance: 0.04,
        rollGroup: 'beastmaster_bonus',
        normalOnly: true,
      },
      {
        itemId: 'bramblehide_treads',
        chance: 0.04,
        rollGroup: 'beastmaster_bonus',
        normalOnly: true,
      },
      {
        itemId: 'beastpit_warbelt',
        chance: 0.34,
        rollGroup: 'beastmaster_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'jaguar_hide_jerkin',
        chance: 0.33,
        rollGroup: 'beastmaster_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'hexbone_handwraps',
        chance: 0.33,
        rollGroup: 'beastmaster_guaranteed',
        normalOnly: true,
      },
    ],
    scale: 2.35,
    color: 0x485b3d,
  },
  // The Fanglord's Great Jaguar (design section 5.1): the great cat he raised
  // from a cub, about one and a half times a horse. It shares its master's
  // health pool and hunts a marked prey (Stalk): it cannot be taunted, and
  // stuns, roots and slows each land on it once per 20 s (the encounter's
  // control windows); its swings are the encounter's bites. The jaguar stays
  // unnamed (the IP verdict).
  fanglord_jaguar: {
    id: FANGLORD_JAGUAR_ID,
    name: "Fanglord's Great Jaguar",
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    elite: true,
    ignoreTaunt: true,
    untameable: true,
    hpBase: 120,
    hpPerLevel: 30,
    dmgBase: 15,
    dmgPerLevel: 3,
    attackSpeed: 2,
    armorPerLevel: 26,
    moveSpeed: 8,
    aggroRadius: 17,
    bodyRadius: 1.8,
    componentTags: ['hide', 'fang'],
    loot: [],
    scale: 2.4,
    color: 0xc9a040,
  },
  // Boss 2 (design section 5.2): the Gorgebloom, a carnivorous flower the size
  // of a house rooted in the plunge pool at the foot of the Weeping Falls. It
  // never moves; it turns to face its targets. Its kit rides
  // encounters/wildheart_basin/gorgebloom.ts: Seed Rain, Pollinate, Vine
  // Lash, Gorge and the Bloom Spit at a target out of its reach; heroic
  // Burrowing Seeds and Pollen Cloud.
  the_gorgebloom: {
    id: GORGEBLOOM_ID,
    name: 'The Gorgebloom',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    hpBase: 200,
    hpPerLevel: 30,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.6,
    armorPerLevel: 26,
    moveSpeed: 0,
    aggroRadius: 16,
    idleStationary: true,
    // Rooted at the terrace's front: melee reaches it from its petals' edge.
    bodyRadius: 4.5,
    // Section 8.1: one guaranteed archetype piece and the Falls-Blessed Staff
    // chase row (wildheart_items.ts). Heroic rides
    // HEROIC_BOSS_LOOT.the_gorgebloom.
    loot: [
      { copper: 2500, chance: 1 },
      {
        itemId: 'rootbound_sabatons',
        chance: 0.34,
        rollGroup: 'gorgebloom_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'pollen_dusted_leggings',
        chance: 0.33,
        rollGroup: 'gorgebloom_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'bloomsilk_cowl',
        chance: 0.33,
        rollGroup: 'gorgebloom_guaranteed',
        normalOnly: true,
      },
      // One bonus roll: the chase staff keeps 0.1 and the relocated Nythraxis raid
      // pieces join it (content/nythraxis_loot.ts).
      {
        itemId: 'falls_blessed_staff',
        chance: 0.1,
        rollGroup: 'gorgebloom_bonus',
        normalOnly: true,
      },
      // Relocated Nythraxis raid pieces (content/nythraxis_loot.ts): item level 29,
      // 4% each inside this one bonus roll, so a kill never pays an extra item.
      {
        itemId: 'bramblehide_crown',
        chance: 0.04,
        rollGroup: 'gorgebloom_bonus',
        normalOnly: true,
      },
      {
        itemId: 'bramblehide_mantle',
        chance: 0.04,
        rollGroup: 'gorgebloom_bonus',
        normalOnly: true,
      },
      {
        itemId: 'bramblehide_cinch',
        chance: 0.04,
        rollGroup: 'gorgebloom_bonus',
        normalOnly: true,
      },
    ],
    scale: 2.8,
    color: 0xa3322a,
  },
  // Boss 3 (design section 5.3): Zulgar, Voice of the Basin, on the Jaguar
  // Shrine Terrace. Jaguar Roar and the enrage stay template fields; the
  // telegraphed Wildheart Pulse and the Spirit of the Hunt (the jaguar avatar
  // chasing its Prey through the sun glyphs; heroic Twin Prey and Ambush)
  // ride encounters/wildheart_basin/zulgar.ts, which also owns his control
  // immunity (entity flags: immune outside the hunt, slowable and rootable
  // during it), so the template carries no ccImmune.
  wildheart_high_priest: {
    id: 'wildheart_high_priest',
    name: 'Zulgar, Voice of the Basin',
    minLevel: 20,
    maxLevel: 20,
    family: 'troll',
    elite: true,
    boss: true,
    hpBase: 470,
    hpPerLevel: 54,
    dmgBase: 17,
    dmgPerLevel: 3.2,
    attackSpeed: 2.55,
    armorPerLevel: 35,
    moveSpeed: 7,
    aggroRadius: 19,
    knockback: { chance: 0.22, distance: 7, name: 'Jaguar Roar' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.28 },
    yells: {
      engage: 'The basin has teeth. It will remember your blood!',
      enrage: 'THE WILD HEART BEATS THROUGH ME!',
    },
    loot: [
      // 15000c base (rolls 9000c to 21000c, roughly 1g to 2g): the same
      // gold-farm nerf Korzul took (the old 55000c paid 3.3g to 7.7g per
      // pop). bossChainPull slows a Zulgar farm but does not stop it. The
      // daily-lockout heroic clear pays the 10g finale base instead;
      // tests/heroic_finale_gold.test.ts pins the ladder.
      { copper: 15000, heroicCopper: HEROIC_FINALE_COPPER, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.8 },
      // Guaranteed uncommon (chances sum to 1.0, exactly one drops): the Korzul
      // korzul_guaranteed_uncommon pattern, one piece per armor class.
      {
        itemId: 'bloodmane_warleggings',
        chance: 0.34,
        rollGroup: 'zulgar_guaranteed_uncommon',
        normalOnly: true,
      },
      {
        itemId: 'vineclaw_stalking_breeches',
        chance: 0.33,
        rollGroup: 'zulgar_guaranteed_uncommon',
        normalOnly: true,
      },
      {
        itemId: 'sunbone_ritual_sarong',
        chance: 0.33,
        rollGroup: 'zulgar_guaranteed_uncommon',
        normalOnly: true,
      },
      {
        itemId: 'wildheart_tuskblade',
        chance: 0.06,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
      {
        itemId: 'wildheart_hexwood_staff',
        chance: 0.06,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
      {
        itemId: 'wildheart_fangknife',
        chance: 0.06,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
      // Relocated Nythraxis raid pieces (content/nythraxis_loot.ts): item level 29,
      // 4% each inside this one bonus roll, so a kill never pays an extra item.
      {
        itemId: 'bramblehide_harness',
        chance: 0.04,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
      {
        itemId: 'bramblehide_legguards',
        chance: 0.04,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
      {
        itemId: 'thornpeak_moonhide_cowl',
        chance: 0.04,
        rollGroup: 'wildheart_bonus',
        normalOnly: true,
      },
    ],
    scale: 2.8,
    color: 0x566f45,
  },
};

// ---- Spawns ---------------------------------------------------------------------

const FACE_SOUTH = Math.PI; // toward the Idol Maw
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;

/** A pack member holding formation until pulled. */
function held(
  mobId: string,
  x: number,
  z: number,
  packId: string,
  facing = FACE_SOUTH,
): DungeonSpawn {
  return { mobId, x, z, facing, packId, idleStationary: true };
}

function patrolling(
  mobId: string,
  points: readonly { x: number; z: number }[],
  packId: string,
  offset: number,
  pace?: number,
): DungeonSpawn {
  return {
    mobId,
    x: points[0].x,
    z: points[0].z,
    packId,
    patrol: { points, offset, ...(pace !== undefined ? { pace } : {}) },
  };
}

// Pack ids read as g<n> for the thirteen groups (route order) and pa pb pc pd
// for the four patrols (pa is the Great Saurian). The Beastmaster and his
// Great Jaguar share the pack `beastmaster`, so pulling one pulls both.

/** Patrol A: the Great Saurian's slow loop through the west half of the ford,
 *  clear of the basalt steps (G3) and the south bank (G2). */
export const SAURIAN_LOOP = [
  { x: -50, z: -118 },
  { x: 14, z: -118 },
  { x: 14, z: -100 },
  { x: -50, z: -100 },
] as const;
/** Patrol B: four raptors back and forth along the lower Hunt Terrace. */
const HUNT_WALK = [
  { x: -104, z: -46 },
  { x: -72, z: -46 },
];
/** Patrol C: a ring round the Central Island, outside both colony packs. */
const ISLAND_RING = [
  { x: -36, z: -28 },
  { x: 36, z: -28 },
  { x: 38, z: 58 },
  { x: -38, z: 58 },
];
/** Patrol D: up and down the middle of the Shrine Stair. */
const SHRINE_WALK = [
  { x: 0, z: 131 },
  { x: 0, z: 170 },
];

export const WILDHEART_BASIN_SPAWNS: DungeonSpawn[] = [
  // ---- The Fern Steps -----------------------------------------------------------
  // g1: the fern landing. A Vineclaw Stalker and its four raptors.
  held('wildheart_stalker', -34, -176, 'g1'),
  held('basin_raptor', -40, -180, 'g1'),
  held('basin_raptor', -28, -180, 'g1'),
  held('basin_raptor', -40, -172, 'g1'),
  held('basin_raptor', -28, -172, 'g1'),
  // ---- The River Ford -----------------------------------------------------------
  // g2: the south bank. Two ravagers and a hexcaller.
  held('wildheart_ravager', -36, -140, 'g2', FACE_EAST),
  held('wildheart_ravager', -36, -134, 'g2', FACE_EAST),
  held('wildheart_hexcaller', -42, -137, 'g2', FACE_EAST),
  // g3: the basalt steps. A Totem-Binder on the top drum, two stalkers below.
  held('sunbone_totem_binder', 43, -106, 'g3', FACE_WEST),
  held('wildheart_stalker', 37, -111, 'g3', FACE_WEST),
  held('wildheart_stalker', 37, -101, 'g3', FACE_WEST),
  // Patrol A: the Great Saurian (the showpiece), wading the shallows.
  patrolling('great_saurian', SAURIAN_LOOP, 'pa', 0, 0.35),
  // ---- West: the Hunt Terraces --------------------------------------------------
  // g4: the lower terrace. Two ravagers and two raptors.
  held('wildheart_ravager', -96, -68, 'g4', FACE_EAST),
  held('wildheart_ravager', -96, -60, 'g4', FACE_EAST),
  held('basin_raptor', -102, -70, 'g4', FACE_EAST),
  held('basin_raptor', -102, -58, 'g4', FACE_EAST),
  // g5: the upper terrace. A hexcaller, a Snarlvine Lasher and a stalker.
  held('wildheart_hexcaller', -84, -6, 'g5'),
  held('vine_lasher', -80, -14, 'g5'),
  held('wildheart_stalker', -92, -12, 'g5'),
  // Patrol B: four raptors along the lower terrace.
  patrolling('basin_raptor', HUNT_WALK, 'pb', 0),
  patrolling('basin_raptor', HUNT_WALK, 'pb', 2.5),
  patrolling('basin_raptor', HUNT_WALK, 'pb', 5),
  patrolling('basin_raptor', HUNT_WALK, 'pb', 7.5),
  // Boss 1: the Fanglord Beastmaster and his Great Jaguar in the Beast Pits.
  {
    mobId: 'wildheart_beastmaster',
    x: BEAST_PITS.x - 3,
    z: BEAST_PITS.z + 8,
    facing: FACE_SOUTH,
    packId: 'beastmaster',
    idleStationary: true,
  },
  {
    mobId: 'fanglord_jaguar',
    x: BEAST_PITS.x + 4,
    z: BEAST_PITS.z + 6,
    facing: FACE_SOUTH,
    packId: 'beastmaster',
    idleStationary: true,
  },
  // ---- East: the Waterfall Walk -------------------------------------------------
  // g6: the ledge. Three Spore Toads and a Snarlvine Lasher.
  held('spore_toad', 98, -60, 'g6', FACE_WEST),
  held('spore_toad', 104, -56, 'g6', FACE_WEST),
  held('spore_toad', 98, -52, 'g6', FACE_WEST),
  held('vine_lasher', 106, -64, 'g6', FACE_WEST),
  // g7: behind the falls. A Totem-Binder, a ravager and a hexcaller.
  held('sunbone_totem_binder', 104, -8, 'g7'),
  held('wildheart_ravager', 99, -16, 'g7'),
  held('wildheart_hexcaller', 108, -16, 'g7'),
  // Boss 2: the Gorgebloom, rooted at the pool terrace's front.
  {
    mobId: 'the_gorgebloom',
    x: GORGEBLOOM_DAIS.x,
    z: GORGEBLOOM_DAIS.z,
    facing: FACE_WEST,
    idleStationary: true,
  },
  // ---- The Central Island -------------------------------------------------------
  // g8: the colony ruins. A Snarlvine Lasher, two stalkers and a Spore Toad.
  held('vine_lasher', -22, 6, 'g8'),
  held('wildheart_stalker', -28, 2, 'g8'),
  held('wildheart_stalker', -16, 2, 'g8'),
  held('spore_toad', -22, 13, 'g8'),
  // g9: the old plaza. Two ravagers and a Totem-Binder.
  held('wildheart_ravager', 20, 34, 'g9'),
  held('wildheart_ravager', 28, 34, 'g9'),
  held('sunbone_totem_binder', 24, 41, 'g9'),
  // Patrol C: a ravager and two raptors round the island.
  patrolling('wildheart_ravager', ISLAND_RING, 'pc', 0),
  patrolling('basin_raptor', ISLAND_RING, 'pc', 3),
  patrolling('basin_raptor', ISLAND_RING, 'pc', 5.5),
  // ---- The Upper Convergence ----------------------------------------------------
  // g10: the left. Two hexcallers and a ravager.
  held('wildheart_hexcaller', -32, 112, 'g10'),
  held('wildheart_hexcaller', -24, 114, 'g10'),
  held('wildheart_ravager', -28, 106, 'g10'),
  // g11: the right. A stalker and four raptors.
  held('wildheart_stalker', 28, 114, 'g11'),
  held('basin_raptor', 23, 109, 'g11'),
  held('basin_raptor', 33, 109, 'g11'),
  held('basin_raptor', 23, 118, 'g11'),
  held('basin_raptor', 33, 118, 'g11'),
  // ---- The Shrine Stair ---------------------------------------------------------
  // g12: the first landing. A Totem-Binder, two ravagers and a hexcaller.
  held('sunbone_totem_binder', -16, 154, 'g12'),
  held('wildheart_ravager', -16, 148, 'g12'),
  held('wildheart_ravager', 16, 148, 'g12'),
  held('wildheart_hexcaller', 16, 154, 'g12'),
  // g13: the top landing. A Snarlvine Lasher, two stalkers and two Spore Toads.
  held('vine_lasher', -14, 180, 'g13'),
  held('wildheart_stalker', -19, 177, 'g13'),
  held('wildheart_stalker', 19, 177, 'g13'),
  held('spore_toad', 13, 181, 'g13'),
  held('spore_toad', 20, 182.5, 'g13'),
  // Patrol D: two stalkers up and down the stair.
  patrolling('wildheart_stalker', SHRINE_WALK, 'pd', 0),
  patrolling('wildheart_stalker', SHRINE_WALK, 'pd', 3),
  // Boss 3: Zulgar, Voice of the Basin, on the shrine terrace.
  { mobId: 'wildheart_high_priest', x: ZULGAR_SPOT.x, z: ZULGAR_SPOT.z, facing: FACE_SOUTH },
];

/** Every mandatory trash pull, the patrols included, in route order. */
export const WILDHEART_BASIN_PACKS = [
  'g1',
  'g2',
  'g3',
  'pa',
  'g4',
  'g5',
  'pb',
  'g6',
  'g7',
  'g8',
  'g9',
  'pc',
  'g10',
  'g11',
  'g12',
  'g13',
  'pd',
] as const;

/** The four patrols (dev helpers, tests); pa is the Great Saurian. */
export const WILDHEART_BASIN_PATROLS = ['pa', 'pb', 'pc', 'pd'] as const;

/** The three bosses, in route order (the Beastmaster fights beside his jaguar). */
export const WILDHEART_BASIN_BOSSES = [BEASTMASTER_ID, GORGEBLOOM_ID, ZULGAR_ID] as const;

// ---- Gates and seals ------------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const WILDHEART_BASIN_GATES: DungeonGateDef[] = [
  {
    id: 'vine_bridge_west',
    name: 'West Vine Bridge',
    kind: 'vine_bridge',
    // Where the bridge leaves the ford (its first rising cross-section).
    x: -69,
    z: -93,
    hw: 5,
    rot: across(-1, 1),
    packs: ['g1', 'g2', 'g3', 'pa'],
    openText: 'With the ford cleared, the vines stir and weave two bridges across the gorge.',
  },
  {
    id: 'vine_bridge_east',
    name: 'East Vine Bridge',
    kind: 'vine_bridge',
    x: 69,
    z: -93,
    hw: 5,
    rot: across(1, 1),
    packs: ['g1', 'g2', 'g3', 'pa'],
  },
  {
    id: 'beast_pits_thorns',
    name: 'Beast Pits Thorn Wall',
    kind: 'thorn_wall',
    x: -86,
    z: 8,
    hw: 6.6,
    rot: across(0, 1),
    packs: ['g4', 'g5', 'pb'],
    sealWhileEngaged: BEASTMASTER_ID,
    openText: 'The thorn hedge before the Beast Pits withers back into the earth.',
  },
  {
    id: 'weeping_falls_thorns',
    name: 'Weeping Falls Thorn Wall',
    kind: 'thorn_wall',
    x: 96.6,
    z: 9,
    hw: 5.6,
    rot: across(-6, 17),
    packs: ['g6', 'g7'],
    sealWhileEngaged: GORGEBLOOM_ID,
    openText: 'The thorns at the foot of the Weeping Falls shrink away from the path.',
  },
  {
    id: 'sunbone_causeway_thorns',
    name: 'Sunbone Causeway Thorn Wall',
    kind: 'thorn_wall',
    x: 0,
    z: -76,
    hw: 6.6,
    rot: across(0, 1),
    bosses: [BEASTMASTER_ID, FANGLORD_JAGUAR_ID, GORGEBLOOM_ID],
    openText:
      'With the Beastmaster and the Gorgebloom fallen, the thorns on the Sunbone Causeway recede.',
  },
  {
    id: 'convergence_arch',
    name: 'Convergence Stair Ward',
    kind: 'warded_arch',
    x: 0,
    z: 75,
    hw: 7.6,
    rot: across(0, 1),
    packs: ['g8', 'g9', 'pc'],
    openText: 'The ward across the Convergence Stair flickers and fails.',
  },
  {
    id: 'shrine_ward',
    name: 'Shrine Ward',
    kind: 'rite_ward',
    x: 0,
    z: 189,
    hw: 8.6,
    rot: across(0, 1),
    packs: ['g10', 'g11', 'g12', 'g13', 'pd'],
    sealWhileEngaged: ZULGAR_ID,
    openText: 'The Shrine Ward falls. Above the terrace, the stone jaguar watches.',
  },
];

/** One inert ground object per gate: its template id carries the state. */
export const WILDHEART_BASIN_GATE_OBJECTS: DungeonObjectSpawn[] = WILDHEART_BASIN_GATES.map(
  (g) => ({
    itemId: '',
    name: g.name,
    x: g.x,
    z: g.z,
    templateId: 'dungeon_gate_closed',
    dungeonId: WILDHEART_DUNGEON,
    lootable: false,
  }),
);

// ---- The dungeon ----------------------------------------------------------------

export const WILDHEART_DUNGEON_DEFS: Record<string, DungeonDef> = {
  wildheart_basin: {
    id: WILDHEART_DUNGEON,
    name: 'The Wildheart Basin',
    index: 7,
    // Hidden beyond the Sunken Idol, clear of its overworld guardian and the
    // Sapphire Lagoon. The door reads as the newly opened idol maw.
    doorPos: { x: -232, z: 1112 },
    // The arrival on the Idol Maw Landing, 40 yd above the ford, the whole
    // caldera in view and the first pack 40 yd off down the Fern Steps.
    entry: { x: WILDHEART_BASIN_ANCHORS.entry.x, z: WILDHEART_BASIN_ANCHORS.entry.z },
    exitOffset: { x: WILDHEART_BASIN_ANCHORS.exit.x, z: WILDHEART_BASIN_ANCHORS.exit.z },
    // Opens on Zulgar's death in the stone jaguar's maw behind the shrine,
    // 440 yd up the route from the Idol Maw, so the cleared run walks into the
    // jaws and steps out instead of walking back.
    bossExitPortal: { x: JAGUAR_MAW.portal.x, z: JAGUAR_MAW.portal.z },
    spawns: WILDHEART_BASIN_SPAWNS,
    objects: [...WILDHEART_BASIN_GATE_OBJECTS],
    gates: WILDHEART_BASIN_GATES,
    interior: 'wildheart',
    // No skipping: every pack is gated, and pulling Zulgar with any of the
    // basin alive still brings the cult down on you (instances/boss_chain_pull.ts).
    bossChainPull: true,
    areaCastsPlant: true,
    suggestedPlayers: 5,
    enterText:
      'You step through the idol maw onto a ledge high above the basin. Waterfalls thunder from the rim, and far below, something enormous wades the ford.',
    leaveText: 'You pass back beneath the stone fangs into the Palmreach sun.',
  },
};

/** The ford's centre, for the dev helpers. */
export const WILDHEART_FORD_CENTRE = {
  x: (RIVER_FORD.x0 + RIVER_FORD.x1) / 2,
  z: (RIVER_FORD.z0 + RIVER_FORD.z1) / 2,
} as const;
