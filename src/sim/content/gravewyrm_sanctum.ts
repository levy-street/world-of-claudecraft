// Gravewyrm Sanctum, the Ice Tomb of the Wyrm (docs/design/dungeon-rework/
// gravewyrm_sanctum.md): the capstone of the Gravecaller campaign, rebuilt as an
// open-air glacier cirque on the shared authored field
// (gravewyrm_sanctum_layout.ts). This module holds the reworked trash's new
// templates, the Sledge Tusker, the packs placed down the route, the patrols,
// the gates and encounter seals that make every pack mandatory, and the run's
// story markers. The dungeon record itself stays in dungeons.ts (its id, index
// and door are shipped) and reads its spawns, gates and objects from here.
//
// Built in phases (src/sim/encounters/gravewyrm_sanctum/CLAUDE.md): phase A
// the map, every trash pack and patrol with its kit, the Sledge Tusker, the
// Calving Face's story steps and the bosses as placeholders in their arenas;
// phase B the three bosses' cores (G23 restraint parts, G24 death-site rule,
// G25 plate floor, G26 airborne phase), the loot, the deeds and the Reliquary.
//
// Trash is simple and readable (README section 5): one job per type, never a
// boss lesson. The trash mechanics pass (E:/woc/entregas/investigacion/
// MECANICAS_TRASH.md section 8, approved 2026-10-04) gives the packs a group
// idea, fire against ice, on the trash engine's generic keys
// (src/sim/mob/trash_kit/CLAUDE.md "Engine pieces"):
//
//   Sanctum Boneguard      Onrush (kept). One of the held dead thawed out; a
//                          fallen one is what the Thawcaller raises.
//   Sanctum Scaleguard     Cinder Breath: a telegraphed 90 degree cone. Step out.
//                          Counterweight Lash: its tail behind it. Its flanks
//                          are safe. Heroic: the breath leaves Boiling Meltwater.
//   Broodsworn Thawcaller  Warming Rite: an interruptible 30 percent heal. Kick it.
//                          Thaw the Held: an interruptible rite that raises a
//                          fallen Boneguard as a Bonewalker. Kick it, or kill
//                          the Thawcaller first.
//   Broodsworn Goadsmith   Goad: an interruptible enrage on one ally. Kick it.
//                          Branding Iron: an interruptible brand on one player;
//                          douse it in a meltwater pool, or hide from the bar.
//   Broodsworn Pyre-Tender Plants a Soul Brazier every 15 s. Kill the brazier.
//   Soul Brazier           Its soulfire quickens every ally within 10 yd. Or
//                          kick it over (the G3 use): it spills soulfire that
//                          burns the pack standing in it.
//   Rime Whelp             Comes in fours; a slowing Hoarfrost Pop as it dies.
//                          Rime Breath: a short frost cone; five stacks of
//                          Creeping Rime freeze you solid. Face them away.
//   Ogre Sledge-Hauler     Ice Block Toss at the farthest player; enrages low.
//                          The block stays as an Ice Slab wall for 15 s: cover.
//   Glacier Splinter       Shatters 2 s after it dies. Step away from the body.
//                          Fracture: at half health it splits in two; spread
//                          the two deaths apart.
//   The Sledge Tusker      The showpiece patrol (encounters/gravewyrm_sanctum/
//                          sledge_tusker.ts): Tusk Sweep, Trample, Spilled
//                          Braziers, Enrage.
//
// Numbers basis (README section 7): classic-era level 18 to 20 templates in the
// Sanctum's family (elite x2.3 health, x1.5 damage), priced by the dungeon's
// normal tuning row (dungeon_difficulty.ts: trash swing floor 100, the Tusker
// in the 150 band and the bosses at 200 on the reference warrior). Mechanic
// damage is stated LANDED on a level-20 cloth wearer of about 950 health: a
// fumbled trash dodge costs about 15 to 20 percent, the Tusker's avoidables
// about 20 to 25. Heroic scales them through the dungeon's difficulty transform.

import {
  SANCTUM_DUNGEON,
  SANCTUM_STORY_PREFIX,
  SEAL_SHACKLE_IDS,
  SEAL_TOOLS,
  type SealTool,
} from '../encounters/gravewyrm_sanctum/ids';
import { shuttleLoop } from '../mob/patrol_route';
import {
  SANCTUM_BRANDED,
  SANCTUM_BRANDING_IRON,
  SANCTUM_CREEPING_RIME,
  SANCTUM_FRACTURE,
  SANCTUM_GOAD,
  SANCTUM_HOARFROST_POP,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_ICE_SLAB,
  SANCTUM_ICED_OVER,
  SANCTUM_PLANT_BRAZIER,
  SANCTUM_RIME_BREATH,
  SANCTUM_SHATTER,
  SANCTUM_SOULFIRE_STOKE,
  SANCTUM_SPILLED_SOULFIRE,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
  SANCTUM_WARMING_RITE,
} from '../mob/trash_kit/sanctum_cast_ids';
import type { DungeonGateDef, DungeonObjectSpawn, DungeonSpawn, MobTemplate } from '../types';
import { KORGATH_SPOT, KORZUL_SPOT, STORY_MARKERS, VELKHAR_SPOT } from './gravewyrm_sanctum_layout';

// ---- Mob templates --------------------------------------------------------------

/** Korgath's four Seal Shackles, one template per chain so its nameplate names
 *  the chain it pins. */
function sealShackles(): Record<string, MobTemplate> {
  const names: Record<SealTool, string> = {
    hammer: 'Hammer Shackle',
    tongs: 'Tongs Shackle',
    anvil: 'Anvil Shackle',
    bellows: 'Bellows Shackle',
  };
  const out: Record<string, MobTemplate> = {};
  for (const tool of SEAL_TOOLS) {
    const id = SEAL_SHACKLE_IDS[tool];
    out[id] = {
      id,
      name: names[tool],
      minLevel: 20,
      maxLevel: 20,
      family: 'elemental',
      untameable: true,
      ccImmune: true,
      slowImmune: true,
      ignoreTaunt: true,
      quietMechanics: true,
      xpMult: 0,
      hpBase: 750,
      hpPerLevel: 0,
      dmgBase: 0,
      dmgPerLevel: 0,
      attackSpeed: 999,
      armorPerLevel: 20,
      moveSpeed: 0,
      aggroRadius: 0,
      idleStationary: true,
      loot: [],
      scale: 1.4,
      color: 0x5b7da8,
    };
  }
  return out;
}

export const GRAVEWYRM_SANCTUM_MOBS: Record<string, MobTemplate> = {
  // A Gravecaller in furs swinging a soulfire censer on a chain.
  broodsworn_thawcaller: {
    id: 'broodsworn_thawcaller',
    name: 'Broodsworn Thawcaller',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 56,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 2.2,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    trashKit: {
      // Warming Rite: a long, interruptible heal on a hurt ally for 30 percent
      // of its health. Kick it.
      mend: {
        castId: SANCTUM_WARMING_RITE,
        name: 'Warming Rite',
        castTime: 2.5,
        every: 12,
        first: 4,
        school: 'shadow',
        range: 30,
        healPct: 0.3,
        below: 0.7,
        // Trash only: never the Tusker it walks beside, never a boss.
        exclude: [
          'sledge_tusker',
          'korgath_the_bound',
          'grand_necromancer_velkhar',
          'korzul_the_gravewyrm',
        ],
      },
      // Thaw the Held (MECANICAS_TRASH.md 8.1 A and 8.3): a 3 s
      // interruptible rite on a fallen Boneguard's corpse within 30 yd; when
      // it lands the soldier climbs back out of the ice as a Raised
      // Bonewalker at 60 percent of its health, on the Thawcaller's victim.
      // Each corpse rises once. First 6 s in (after the Warming Rite's
      // opening 4 s), then every 14 s while a corpse lies in reach. Normal
      // stays survivable unkicked: a Bonewalker is a non-elite add (about 360
      // health risen on normal), at most one per fallen Boneguard.
      reanimate: {
        castId: SANCTUM_THAW_THE_HELD,
        name: 'Thaw the Held',
        castTime: 3,
        every: 14,
        first: 6,
        school: 'shadow',
        range: 30,
        corpses: ['sanctum_boneguard'],
        summon: 'raised_bonewalker',
        hpPct: 0.6,
      },
    },
    loot: [
      { copper: 340, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.35 },
    ],
    scale: 1.6,
    color: 0x5a4a6e,
  },
  // A burly cultist with a glowing goad iron and a leather apron.
  broodsworn_goadsmith: {
    id: 'broodsworn_goadsmith',
    name: 'Broodsworn Goadsmith',
    minLevel: 19,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 62,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.4,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 12,
    trashKit: {
      // Goad: a 2 s interruptible goad that drives one ally into a fury, 30
      // percent more damage for 8 s. Kick it.
      goad: {
        castId: SANCTUM_GOAD,
        name: 'Goad',
        castTime: 2,
        every: 14,
        first: 5,
        school: 'fire',
        range: 25,
        damagePct: 0.3,
        seconds: 8,
      },
      // Branding Iron (MECANICAS_TRASH.md 8.4): a 2 s interruptible bar at
      // one player in its sight (never the tank while anyone else stands in
      // reach); out of sight when it ends (behind an Ice Slab, a serac, a
      // tent) it fizzles. Landed, the brand burns 30 every 2 s for 12 s, 180
      // in all on the 950 health cloth reference (19 percent, the fumbled
      // trash dodge band), and a meltwater pool (QUENCH_POOLS, every pull a
      // Goadsmith stands in has two within 14 yd) puts it out at once.
      // First 9 s in, between its Goads, then every 16 s.
      brand: {
        castId: SANCTUM_BRANDING_IRON,
        name: 'Branding Iron',
        castTime: 2,
        every: 16,
        first: 9,
        school: 'fire',
        range: 30,
        perTick: 30,
        interval: 2,
        seconds: 12,
        auraId: SANCTUM_BRANDED,
        auraName: 'Branded',
      },
    },
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.35 },
    ],
    scale: 1.75,
    color: 0x6e4a32,
  },
  // A cultist carrying a brazier on a yoke.
  broodsworn_pyre_tender: {
    id: 'broodsworn_pyre_tender',
    name: 'Broodsworn Pyre-Tender',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 54,
    hpPerLevel: 20,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 2.2,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    trashKit: {
      // Plants a Soul Brazier beside her every 15 s. Kill the braziers fast.
      call: {
        castId: SANCTUM_PLANT_BRAZIER,
        name: 'Plant Soul Brazier',
        castTime: 1.5,
        every: 15,
        first: 3,
        school: 'fire',
        summon: 'soul_brazier',
        count: 1,
        maxAlive: 2,
      },
    },
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.35 },
    ],
    scale: 1.65,
    color: 0x7a3e22,
  },
  // The brazier a Pyre-Tender plants: soulfire that quickens the cult's blades.
  // It never walks and never swings; it gutters out if its tender dies.
  soul_brazier: {
    id: 'soul_brazier',
    name: 'Soul Brazier',
    minLevel: 18,
    maxLevel: 18,
    family: 'elemental',
    untameable: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 24,
    hpPerLevel: 7,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 30,
    armorPerLevel: 10,
    moveSpeed: 0,
    aggroRadius: 20,
    idleStationary: true,
    xpMult: 0.2,
    trashKit: {
      stoke: {
        castId: SANCTUM_SOULFIRE_STOKE,
        name: 'Soulfire',
        every: 2,
        radius: 10,
        hastePct: 0.15,
        seconds: 3,
        school: 'shadow',
      },
      // Topple Brazier (MECANICAS_TRASH.md 8.5, the G3 use): a player within
      // 4 yd targets it and presses interact: a 1 s kick (any hit, a step or
      // a stun breaks it), then the brazier crashes over and its soulfire
      // spills 1.5 yd past it, away from the kicker, a 4.5 yd pool for 8 s
      // that burns every trash mob standing in it for 4 percent of its
      // health a second (never a boss or a great body). The tank parks the
      // pack on the brazier and somebody kicks it: up to a third of each
      // mob's health if they stay in it, and the quickening is gone.
      usable: {
        castId: SANCTUM_TOPPLE_BRAZIER,
        name: 'Topple Brazier',
        channel: 1,
        range: 4,
        effect: {
          kind: 'topple',
          ahead: 1.5,
          hazard: {
            castId: SANCTUM_SPILLED_SOULFIRE,
            name: 'Spilled Soulfire',
            objectTemplate: SANCTUM_SPILLED_SOULFIRE,
            radius: 4.5,
            seconds: 8,
            tick: 1,
            min: 0,
            max: 0,
            school: 'shadow',
            hits: 'mobs',
            pctMaxHp: 0.04,
          },
        },
      },
    },
    loot: [],
    scale: 1.6,
    color: 0x8fd6a0,
  },
  // A thawed whelp of Korzul's drowned brood, frost on its wings. Comes in fours.
  rime_whelp: {
    id: 'rime_whelp',
    name: 'Rime Whelp',
    minLevel: 18,
    maxLevel: 18,
    family: 'dragonkin',
    untameable: true,
    hpBase: 40,
    hpPerLevel: 13,
    dmgBase: 8,
    dmgPerLevel: 2.1,
    attackSpeed: 1.8,
    armorPerLevel: 8,
    moveSpeed: 8,
    aggroRadius: 12,
    xpMult: 0.5,
    trashKit: {
      // Hoarfrost Pop: it bursts in a puff of hoarfrost as it dies, a small
      // ring that chills whoever stands in it.
      deathBurst: {
        castId: SANCTUM_HOARFROST_POP,
        name: 'Hoarfrost Pop',
        delay: 0,
        radius: 3,
        min: 40,
        max: 50,
        school: 'frost',
        slow: { mult: 0.5, seconds: 2 },
      },
      // Rime Breath (MECANICAS_TRASH.md 8.6): a 0.6 s bar, then a 60 degree
      // puff of frost 6 yd at the one it fights, 28 to 34 (3 percent), and a
      // stack of Creeping Rime: 8 percent slower per stack for 8 s
      // (refreshed). The fifth stack freezes the victim solid for 2 s and
      // clears them. Four whelps on the tank freeze it about once a pull
      // (each breathes every 7 s, the pack staggered); the group stays out
      // of their fronts and burns them down together.
      cone: {
        castId: SANCTUM_RIME_BREATH,
        name: 'Rime Breath',
        castTime: 0.6,
        every: 7,
        first: 3,
        school: 'frost',
        range: 6,
        arcDeg: 60,
        min: 28,
        max: 34,
        freezeStack: {
          auraId: SANCTUM_CREEPING_RIME,
          name: 'Creeping Rime',
          perStack: 0.08,
          maxStacks: 5,
          seconds: 8,
          freezeAuraId: SANCTUM_ICED_OVER,
          freezeName: 'Iced Over',
          freezeSeconds: 2,
        },
      },
    },
    loot: [{ copper: 60, chance: 1 }],
    scale: 1.6,
    color: 0xc8e4f4,
  },
  // An ogre of the clans that sold their axes to the cult, in furs and a
  // hauling harness.
  ogre_sledge_hauler: {
    id: 'ogre_sledge_hauler',
    name: 'Ogre Sledge-Hauler',
    minLevel: 20,
    maxLevel: 20,
    family: 'ogre',
    elite: true,
    hpBase: 70,
    hpPerLevel: 25,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.6,
    armorPerLevel: 24,
    moveSpeed: 6.5,
    aggroRadius: 13,
    // Below 30 percent it hits 30 percent harder and swings 20 percent faster
    // (classic trash frenzy, the shipped 1.3 / 1.2 pairing).
    enrage: { belowHpPct: 0.3, dmgMult: 1.3, hasteMult: 1.2 },
    trashKit: {
      // Ice Block Toss: a block of ice at the farthest player, onto a 5 yd ring
      // painted where they stood 2 s before it lands.
      toss: {
        castId: SANCTUM_ICE_BLOCK_TOSS,
        name: 'Ice Block Toss',
        castTime: 2,
        every: 12,
        first: 5,
        school: 'frost',
        range: 35,
        radius: 5,
        min: 150,
        max: 180,
        // The block stays (MECANICAS_TRASH.md 8.7, the temporary combat
        // wall): an Ice Slab about 4 by 3 yd and over a head tall, where the
        // ring was, for 15 s. It blocks bodies and sight: cover from the
        // Goadsmith's Branding Iron, or a corner the tank pulls the casters
        // round. At most two stand at once (a toss every 12 s).
        leavesWall: { objectTemplate: SANCTUM_ICE_SLAB, name: 'Ice Slab', seconds: 15 },
      },
    },
    loot: [{ copper: 380, chance: 1 }],
    scale: 2.1,
    color: 0x8a7a62,
  },
  // A walking shard of the Quench: blue ice over a core of the Smith's rune-iron.
  glacier_splinter: {
    id: 'glacier_splinter',
    name: 'Glacier Splinter',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    untameable: true,
    hpBase: 66,
    hpPerLevel: 24,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.4,
    armorPerLevel: 28,
    moveSpeed: 6,
    aggroRadius: 12,
    trashKit: {
      // Shatter: 2 s after it falls it bursts where it lies, 6 yd. Step away.
      deathBurst: {
        castId: SANCTUM_SHATTER,
        name: 'Shatter',
        delay: 2,
        radius: 6,
        min: 150,
        max: 180,
        school: 'frost',
      },
      // Fracture (MECANICAS_TRASH.md 8.8): the first time it drops under
      // half health it splits in two, each half 72 percent of its size with
      // 60 percent of the health it had left (so the pair is 1.2 times the
      // remaining half), each Shattering smaller when it dies: a 3.6 yd ring
      // for 90 to 108. Spread the two deaths apart and step out of each.
      split: {
        castId: SANCTUM_FRACTURE,
        name: 'Fracture',
        belowHpPct: 0.5,
        share: 0.6,
        scale: 0.72,
        burstScale: 0.6,
      },
    },
    loot: [{ copper: 360, chance: 1 }],
    scale: 1.9,
    color: 0x7fc4e8,
  },
  // Korgath's four Seal Shackles (encounters/gravewyrm_sanctum/korgath.ts, G23):
  // the iron cuff at each seal pillar's foot where his chain is pinned. Raised
  // by his encounter (never placed in the spawn list, so they never count
  // toward a clear, never chain-pull and drop nothing), held untouchable until
  // he is pulled, and never moving, swinging or taking a taunt. About 1,500
  // health on normal through the dungeon's tuning rows.
  ...sealShackles(),
  // The showpiece patrol: a shaggy mountain tusker as big as a house, dragging
  // a sledge of burning soul braziers up and down the haul road. Its kit rides
  // encounters/gravewyrm_sanctum/sledge_tusker.ts.
  sledge_tusker: {
    id: 'sledge_tusker',
    name: 'Sledge Tusker',
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
    aggroRadius: 14,
    // Drawn about three times a player's height and 9 yd long: melee reaches
    // it from its flanks and its brow, never from inside its coat.
    bodyRadius: 3.5,
    loot: [{ copper: 1500, chance: 1 }],
    scale: 2.8,
    color: 0x6a5a48,
  },
};

// ---- Spawns ---------------------------------------------------------------------

const FACE_SOUTH = Math.PI; // back up the route, toward the gate
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

// Pack ids read as g<n> for the twelve groups (route order) and pa pb pc pd
// for the patrols (pa is the Sledge Tusker).

/** Patrol A's centre line: the haul road from the court's foot, round the
 *  upper bend, to the lower bend (the bends are the road's turns). */
export const TUSKER_ROAD_LINE = [
  { x: -13, z: -163.25 },
  { x: -37, z: -144 },
  { x: 21, z: -113.6 },
] as const;
/** Patrol A: the Sledge Tusker up and down the haul road as one closed loop.
 *  Down one lane and back up the other, 2 yd either side of the centre line,
 *  a U-turn at each end and an arc round the upper bend's pad, so the
 *  house-sized beast and its sledge turn round instead of flipping on the
 *  spot, and its coat (2.6 yd either side of its walk) stays on the road,
 *  clear of the crevasse lips between the road's legs and of every prop
 *  (tests/gravewyrm_sanctum_tusker_patrol.test.ts). */
export const TUSKER_ROAD = shuttleLoop(TUSKER_ROAD_LINE, 2, 4.5, 0.5);
/** Patrol B: a loop round the Serac Field's upper shelf. */
const SERAC_LOOP = [
  { x: -72, z: -96 },
  { x: -94, z: -96 },
  { x: -94, z: -84 },
  { x: -72, z: -84 },
];
/** Patrol C: up and down the Thaw Works road between the two terraces. */
const WORKS_WALK = [
  { x: 0, z: 34 },
  { x: 0, z: 62 },
];
/** Patrol D: along the Shore of the Held between the two groups. */
const SHORE_WALK = [
  { x: -22, z: 140 },
  { x: 0, z: 135 },
  { x: 22, z: 140 },
  { x: 0, z: 135 },
];

export const GRAVEWYRM_SANCTUM_SPAWNS: DungeonSpawn[] = [
  // ---- The Keystone Court ---------------------------------------------------------
  // g1: two Boneguard and a Thawcaller round the keystone socket.
  held('sanctum_boneguard', -4, -178, 'g1'),
  held('sanctum_boneguard', 4, -178, 'g1'),
  held('broodsworn_thawcaller', 0, -173, 'g1'),
  // ---- The Sledge Road ------------------------------------------------------------
  // g2: the upper bend. An Ogre Sledge-Hauler and two Goadsmiths.
  held('ogre_sledge_hauler', -44, -146, 'g2', FACE_EAST),
  held('broodsworn_goadsmith', -41, -152, 'g2', FACE_EAST),
  held('broodsworn_goadsmith', -45, -139, 'g2', FACE_EAST),
  // g3: the lower bend. A Pyre-Tender and four Rime Whelps.
  held('broodsworn_pyre_tender', 33, -110, 'g3', FACE_WEST),
  held('rime_whelp', 29, -115, 'g3', FACE_WEST),
  held('rime_whelp', 35, -115, 'g3', FACE_WEST),
  held('rime_whelp', 29, -105, 'g3', FACE_WEST),
  held('rime_whelp', 35, -105, 'g3', FACE_WEST),
  // Patrol A: the Sledge Tusker (the showpiece).
  patrolling('sledge_tusker', TUSKER_ROAD, 'pa', 0, 0.45),
  // ---- West: the Serac Field ------------------------------------------------------
  // g4: the far end of the ice bridge. Two Glacier Splinters and a Scaleguard.
  held('glacier_splinter', -86, -54, 'g4'),
  held('glacier_splinter', -78, -54, 'g4'),
  held('sanctum_drakonid', -82, -50, 'g4'),
  // g5: the top of the West Chain Stair. A Thawcaller, two Boneguard and a
  // Pyre-Tender.
  held('broodsworn_thawcaller', -70, -30, 'g5', FACE_EAST),
  held('sanctum_boneguard', -66, -24, 'g5', FACE_EAST),
  held('sanctum_boneguard', -66, -36, 'g5', FACE_EAST),
  held('broodsworn_pyre_tender', -74, -30, 'g5', FACE_EAST),
  // Patrol B: four Rime Whelps and a Scaleguard round the upper shelf.
  patrolling('rime_whelp', SERAC_LOOP, 'pb', 0),
  patrolling('rime_whelp', SERAC_LOOP, 'pb', 2),
  patrolling('rime_whelp', SERAC_LOOP, 'pb', 4),
  patrolling('rime_whelp', SERAC_LOOP, 'pb', 6),
  patrolling('sanctum_drakonid', SERAC_LOOP, 'pb', 9),
  // ---- East: the Anchor Ledge -----------------------------------------------------
  // g6: under the rune wall. An Ogre Sledge-Hauler, a Goadsmith and a Thawcaller.
  held('ogre_sledge_hauler', 98, -94, 'g6', FACE_WEST),
  held('broodsworn_goadsmith', 95, -88, 'g6', FACE_WEST),
  held('broodsworn_thawcaller', 95, -100, 'g6', FACE_WEST),
  // g7: the top of the East Chain Stair. Two Scaleguard and a Glacier Splinter.
  held('sanctum_drakonid', 68, -26, 'g7', FACE_WEST),
  held('sanctum_drakonid', 68, -34, 'g7', FACE_WEST),
  held('glacier_splinter', 72, -30, 'g7', FACE_WEST),
  // Boss 1: Korgath the Bound, chained in the middle of the Lock Terrace.
  {
    mobId: 'korgath_the_bound',
    x: KORGATH_SPOT.x,
    z: KORGATH_SPOT.z,
    facing: FACE_SOUTH,
    idleStationary: true,
  },
  // ---- The Thaw Works -------------------------------------------------------------
  // g8: the sledge park. Two Goadsmiths, a Pyre-Tender and an Ogre Sledge-Hauler.
  held('broodsworn_goadsmith', -30, 40, 'g8'),
  held('broodsworn_goadsmith', -26, 46, 'g8'),
  held('broodsworn_pyre_tender', -35, 45, 'g8'),
  held('ogre_sledge_hauler', -31, 50, 'g8'),
  // g9: the melt channel. Four Rime Whelps and two Thawcallers.
  held('rime_whelp', 26, 38, 'g9'),
  held('rime_whelp', 32, 38, 'g9'),
  held('rime_whelp', 26, 44, 'g9'),
  held('rime_whelp', 32, 44, 'g9'),
  held('broodsworn_thawcaller', 22, 48, 'g9'),
  held('broodsworn_thawcaller', 36, 48, 'g9'),
  // g10: before the vault. Two Boneguard, a Scaleguard and a Glacier Splinter.
  held('sanctum_boneguard', -9, 75, 'g10'),
  held('sanctum_boneguard', 9, 75, 'g10'),
  held('sanctum_drakonid', -4, 71, 'g10'),
  held('glacier_splinter', 4, 71, 'g10'),
  // Patrol C: a Goadsmith and two Boneguard on the works road.
  patrolling('broodsworn_goadsmith', WORKS_WALK, 'pc', 0),
  patrolling('sanctum_boneguard', WORKS_WALK, 'pc', 2),
  patrolling('sanctum_boneguard', WORKS_WALK, 'pc', 4),
  // Boss 2: Grand Necromancer Velkhar between his three thaw pyres.
  {
    mobId: 'grand_necromancer_velkhar',
    x: VELKHAR_SPOT.x,
    z: VELKHAR_SPOT.z,
    facing: FACE_SOUTH,
    idleStationary: true,
  },
  // ---- The Shore of the Held ------------------------------------------------------
  // g11: west. Two Scaleguard and four Rime Whelps.
  held('sanctum_drakonid', -32, 149, 'g11', FACE_EAST),
  held('sanctum_drakonid', -28, 150, 'g11', FACE_EAST),
  held('rime_whelp', -36, 154, 'g11', FACE_EAST),
  held('rime_whelp', -38, 147, 'g11', FACE_EAST),
  held('rime_whelp', -26, 146, 'g11', FACE_EAST),
  held('rime_whelp', -35, 151, 'g11', FACE_EAST),
  // g12: east. An Ogre Sledge-Hauler, a Thawcaller, a Pyre-Tender and a
  // Glacier Splinter.
  held('ogre_sledge_hauler', 32, 150, 'g12', FACE_WEST),
  held('broodsworn_thawcaller', 28, 151, 'g12', FACE_WEST),
  held('broodsworn_pyre_tender', 37, 154, 'g12', FACE_WEST),
  held('glacier_splinter', 27, 146, 'g12', FACE_WEST),
  // Patrol D: two Scaleguard along the shore.
  patrolling('sanctum_drakonid', SHORE_WALK, 'pd', 0),
  patrolling('sanctum_drakonid', SHORE_WALK, 'pd', 2.5),
  // Boss 3: Korzul the Gravewyrm on the lake's north side, under the face.
  {
    mobId: 'korzul_the_gravewyrm',
    x: KORZUL_SPOT.x,
    z: KORZUL_SPOT.z,
    facing: FACE_SOUTH,
    idleStationary: true,
  },
];

/** Every mandatory trash pull, the patrols included, in route order. */
export const GRAVEWYRM_SANCTUM_PACKS = [
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
  'g10',
  'pc',
  'g11',
  'g12',
  'pd',
] as const;

/** The four patrols (dev helpers, tests); pa is the Sledge Tusker. */
export const GRAVEWYRM_SANCTUM_PATROLS = ['pa', 'pb', 'pc', 'pd'] as const;

/** The three bosses, in route order. */
export const GRAVEWYRM_SANCTUM_BOSSES = [
  'korgath_the_bound',
  'grand_necromancer_velkhar',
  'korzul_the_gravewyrm',
] as const;

// ---- Gates and seals ------------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Both wings: the two Chain Stairs rise together once BOTH are clear (the
 *  terrace is entered only with both stairs open, design section 4). Korgath
 *  shouts down at the group as these fall (encounters/gravewyrm_sanctum/
 *  korgath_barks.ts). */
export const SANCTUM_WING_PACKS = ['g4', 'g5', 'pb', 'g6', 'g7'] as const;

export const GRAVEWYRM_SANCTUM_GATES: DungeonGateDef[] = [
  {
    id: 'rime_gate',
    name: 'Rime Gate',
    kind: 'ice_wall',
    x: 15,
    z: -93.5,
    hw: 7.6,
    rot: across(-14, 11),
    packs: ['g1', 'g2', 'g3', 'pa'],
    openText: 'The Rime Gate cracks from top to bottom and crashes down in a storm of ice.',
  },
  {
    id: 'west_chain_stair',
    name: 'West Chain Stair',
    kind: 'chain_gate',
    x: -40,
    z: -25.5,
    hw: 5.6,
    rot: across(32, 7),
    packs: [...SANCTUM_WING_PACKS],
    sealWhileEngaged: 'korgath_the_bound',
    openText: 'Both wings fall silent. The grates of the Chain Stairs rise on groaning chains.',
  },
  {
    id: 'east_chain_stair',
    name: 'East Chain Stair',
    kind: 'chain_gate',
    x: 40,
    z: -25.5,
    hw: 5.6,
    rot: across(-32, 7),
    packs: [...SANCTUM_WING_PACKS],
    sealWhileEngaged: 'korgath_the_bound',
  },
  {
    id: 'chain_bridge',
    name: 'Chain Bridge',
    kind: 'chain_bridge',
    x: 0,
    z: 2,
    hw: 5,
    rot: across(0, 1),
    bosses: ['korgath_the_bound'],
    openText:
      "A slack chain as thick as a mast falls across the gulf and pulls taut: the Smith's chain is the way down.",
  },
  {
    id: 'vault_ward',
    name: 'Vault Ward',
    kind: 'rite_ward',
    x: 0,
    z: 85,
    hw: 6.6,
    rot: across(0, 1),
    packs: ['g8', 'g9', 'g10', 'pc'],
    sealWhileEngaged: 'grand_necromancer_velkhar',
    openText: 'The Vault Ward gutters out. Below, the thaw pyres roar.',
  },
  {
    id: 'tithe_gate',
    name: 'Tithe Gate',
    kind: 'ice_wall',
    x: 0,
    z: 127.5,
    hw: 6.6,
    rot: across(0, 1),
    bosses: ['grand_necromancer_velkhar'],
    openText: 'With the rite broken, the Tithe Gate shatters. The shore of the held lies open.',
  },
  {
    id: 'hollow_ward',
    name: 'Hollow Ward',
    kind: 'rite_ward',
    x: 0,
    z: 143,
    hw: 5.6,
    rot: across(0, 1),
    packs: ['g11', 'g12', 'pd'],
    sealWhileEngaged: 'korzul_the_gravewyrm',
    openText: "The Hollow Ward fails. On the lake, the ice groans under the Wyrm's weight.",
  },
];

/** One inert ground object per gate: its template id carries the state. */
export const GRAVEWYRM_SANCTUM_GATE_OBJECTS: DungeonObjectSpawn[] = GRAVEWYRM_SANCTUM_GATES.map(
  (g) => ({
    itemId: '',
    name: g.name,
    x: g.x,
    z: g.z,
    templateId: 'dungeon_gate_closed',
    dungeonId: SANCTUM_DUNGEON,
    lootable: false,
  }),
);

/** The run's story markers (encounters/gravewyrm_sanctum/story.ts): inert
 *  anchors carrying the Calving Face's crack step in their template id. */
export const GRAVEWYRM_SANCTUM_STORY_OBJECTS: DungeonObjectSpawn[] = STORY_MARKERS.map((m) => ({
  itemId: '',
  name: 'The Calving Face',
  x: m.x,
  z: m.z,
  templateId: `${SANCTUM_STORY_PREFIX}0` as 'sanctum_story_0',
  dungeonId: SANCTUM_DUNGEON,
  lootable: false,
}));
