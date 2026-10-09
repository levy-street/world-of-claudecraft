// The Drowned Temple rework (docs/design/dungeon-rework/drowned_temple.md): the
// new trash, the Mere Hydra, the Tideglass Colossus and its reflections, the
// packs placed on the open-air lagoon temple (drowned_temple_layout.ts), the
// patrols, and the gates and encounter seals that make every pack mandatory.
// The shipped Temple templates (Drowned Templeguard, Pale Choir Acolyte,
// Glimmerscale Lurker, Pearlguard Sentinel, Choirmother Selthe, Moonspawn,
// Ysolei) stay in temple.ts under their frozen ids, reworked there. Merged by
// data.ts (mobs) and temple.ts (the dungeon's spawns, gates and objects).
//
// Trash is simple and readable (README section 5): one job per type, never a
// boss lesson.
//
//   Drowned Templeguard  Onrush, a telegraphed Trident Sweep and a Skewering Trident
//                        down a lane. Step out. Heroic: the Moonset Oath, half
//                        a casting singer's hits on the guard. Stun it.
//   Pale Choir Acolyte   Lullaby: an interruptible sleep on one player, and Pale
//                        Mending on a hurt packmate. Kick them. Shrine Vigil
//                        while two pilgrims kneel by her; heroic Lullaby Echo.
//   Glimmerscale Lurker  Pounce onto the farthest caster (a bleed), and an
//                        interruptible Glimmer Venom bolt. Prism Glare: turn
//                        your back on it.
//   Moonmantle Ray       (id pearlguard_sentinel) Lunar Glide, a charge; a Tidal
//                        Wingbeat that throws back all near it; Nacre Cocoon
//                        shields it once when low. Burst it.
//   Lagoon Snapper       Snap: a telegraphed bite across its front, and it shells
//                        up once when low, spinning a Spiral Whirlpool that
//                        drags the group in. Walk out, then burn it.
//   Ice Wraith           Static Coil: an interruptible shock round it; Lightning Spit,
//                        a lane of lightning; Arcing Spark, a kickable bolt that
//                        leaps between players. Spread out.
//   Moonlit Siren        Call the Tide: an interruptible song of three Tidewisps.
//                        Shrine Vigil while two pilgrims kneel by her. Call of
//                        the Shallows draws one player to her: kick it, stun
//                        her, or break her sight behind a column.
//   Tidewisp             Bursts (and chills) when it reaches a player. Kill it on
//                        the way in; on heroic two that touch swell into one.
//   Drowned Pilgrim      fodder in fours, enrages when low; their prayer keeps
//                        the Shrine Vigil on their singer. Kill them first.
//
// Numbers are classic-era normal-mode bases for levels 16 to 18, anchored to
// Ysolei's shipped Lunar Tide (22 to 32) and a level 17 cloth wearer of about
// 600 health (README section 7). Heroic scales them through the dungeon's
// difficulty transform (mechanicDamageMult).

import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_LIGHTNING_SPIT,
  TEMPLE_SNAP,
  TEMPLE_STATIC_COIL,
} from '../mob/trash_kit/temple_cast_ids';
import {
  ALL_CLASSES,
  type DungeonGateDef,
  type DungeonObjectSpawn,
  type DungeonSpawn,
  type LootEntry,
  type MobTemplate,
} from '../types';
import { HYDRA_HEADS, PRISM_PLINTH, YSOLEI_DAIS } from './drowned_temple_layout';

/** The Mere Hydra's three head templates, left to right. */
export const MERE_HYDRA_HEAD_IDS = [
  'mere_hydra_head_left',
  'mere_hydra_head_center',
  'mere_hydra_head_right',
] as const;

/** The Mere Hydra's normal blue (drowned_temple_items.ts): the helm trio and
 *  the Merecleaver, 35 percent in equal shares. Each head pays its own table
 *  once, on its first death (hydra_regrowth.ts: a regrown head pays nothing),
 *  and all three die for a kill, so only the centre head carries it: one roll
 *  per kill. The left and right heads keep their copper alone. */
const HYDRA_BLUE: LootEntry[] = [
  { itemId: 'mere_crested_helm', chance: 0.0875, rollGroup: 'hydra_blue', normalOnly: true },
  { itemId: 'mereskin_hood', chance: 0.0875, rollGroup: 'hydra_blue', normalOnly: true },
  { itemId: 'merewater_cowl', chance: 0.0875, rollGroup: 'hydra_blue', normalOnly: true },
  { itemId: 'merecleaver', chance: 0.0875, rollGroup: 'hydra_blue', normalOnly: true },
];

function hydraHead(
  id: string,
  name: string,
  color: number,
  bossLoot: readonly LootEntry[] = [],
): MobTemplate {
  return {
    id,
    name,
    minLevel: 17,
    maxLevel: 17,
    family: 'dragonkin',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    // About 2,000 health each on normal through the Temple's tuning row
    // (dungeon_difficulty.ts healthMultiplierByMob): the three die in about
    // 55 s at 110 party DPS.
    hpBase: 150,
    hpPerLevel: 30,
    // Snap is each head's own bite on whoever stands in its long reach (the
    // tank); the elemental attacks (Freezing Breath, Venom Spit, Crushing
    // Torrent), the Tsunami and the regrowth are the encounter's
    // (encounters/drowned_temple/mere_hydra.ts and its hydra_* siblings).
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.6,
    armorPerLevel: 24,
    moveSpeed: 0,
    aggroRadius: 16,
    idleStationary: true,
    // Each head rises inside the one Hydra's 12 yd body: melee reaches it from
    // 6 yd (bodyRadius + 3), off the body's edge in the pool. The Snap keeps
    // its 8 yd.
    bodyRadius: 3,
    loot: [{ copper: 400, chance: 1 }, ...bossLoot],
    // A long neck: the body's scale sets the Snap's reach (8 yd); the renderer
    // draws the one Hydra model at its own size.
    scale: 2,
    color,
  };
}

/** The Colossus's Reflections wear their owner's class look: one template per
 *  class (`tideglass_reflection_<class>`), the same numbers, so the renderer
 *  draws a glass copy of that class with no wire change. */
export function reflectionTemplateFor(playerClass: string): string {
  return `tideglass_reflection_${playerClass}`;
}

export const DROWNED_TEMPLE_MOBS: Record<string, MobTemplate> = {
  lagoon_snapper: {
    id: 'lagoon_snapper',
    name: 'Lagoon Snapper',
    minLevel: 16,
    maxLevel: 16,
    family: 'beast',
    elite: true,
    untameable: true,
    hpBase: 64,
    hpPerLevel: 23,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 26,
    moveSpeed: 6,
    aggroRadius: 12,
    // Snap: a slow, telegraphed bite across its front. Only the tank belongs in it.
    breathCone: {
      castId: TEMPLE_SNAP,
      name: 'Snap',
      castTime: 1.5,
      every: 10,
      range: 6,
      arcDeg: 90,
      min: 80,
      max: 100,
      school: 'physical',
    },
    // Shell Up (the sixth pass): once, under 35 percent, it pulls into its
    // shell for 5 s, taking 60 percent less. Wait it out, then burn it.
    trashKit: {
      withdraw: { belowHpPct: 0.35, seconds: 5, reduction: 0.6, name: 'Shell Up' },
      // The trash mechanics pass: while it shells up the shell spins, and the
      // water within 8 yd drags everyone toward it at 2.5 yd/s (3.5 on heroic,
      // both well under a run); the 3 yd core bites once a second. Walk out.
      // Math, landed raw: normal 30 to 40 a bite, 5 to 7 percent of a level
      // 17 cloth wearer's ~600, and only for the seconds spent in the core;
      // heroic x5.5 (the snapper's mechanic factor) 165 to 220 a bite, 13 to
      // 18 percent of ~1,250, so one walked-out second is the usual cost.
      temple: {
        whirlpool: {
          radius: 8,
          pull: 2.5,
          heroicPull: 3.5,
          core: 3,
          tick: 1,
          min: 30,
          max: 40,
          name: 'Spiral Whirlpool',
          school: 'frost',
        },
      },
    },
    loot: [
      { copper: 190, chance: 1 },
      { itemId: 'pale_pearl', chance: 0.5 },
    ],
    scale: 1.2,
    color: 0x6f8a7a,
  },
  ice_wraith: {
    id: 'ice_wraith',
    name: 'Ice Wraith',
    minLevel: 16,
    maxLevel: 17,
    family: 'beast',
    elite: true,
    untameable: true,
    hpBase: 54,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 1.9,
    armorPerLevel: 14,
    moveSpeed: 7.5,
    aggroRadius: 12,
    trashKit: {
      // Static Coil: its coils charge and it shocks everyone near. Kick it.
      screech: {
        castId: TEMPLE_STATIC_COIL,
        name: 'Static Coil',
        castTime: 2,
        every: 13,
        first: 5,
        school: 'nature',
        radius: 8,
        stun: 1.5,
        min: 45,
        max: 55,
      },
      // Lightning Spit (the sixth pass): lightning spat down a lane at one player.
      // Not a kick: step out sideways before the bar runs out.
      line: {
        castId: TEMPLE_LIGHTNING_SPIT,
        name: 'Lightning Spit',
        castTime: 1.8,
        every: 11,
        first: 8,
        school: 'nature',
        length: 24,
        halfWidth: 1.6,
        min: 60,
        max: 70,
      },
      // The trash mechanics pass: a kickable bolt that leaps on to the nearest
      // player within 6 yd of the last one struck, up to four. Spread out.
      // Math, landed raw per player struck: normal 40 to 50, 7 to 8 percent
      // of a level 17 cloth wearer's ~600; heroic x5.5 (the eel's mechanic
      // factor) 220 to 275, 18 to 22 percent of ~1,250. A bunched group pays
      // it four times over, never one player more than once.
      temple: {
        spark: {
          castId: TEMPLE_ARCING_SPARK,
          name: 'Arcing Spark',
          castTime: 2,
          every: 15,
          first: 11,
          school: 'nature',
          range: 30,
          jump: 6,
          hits: 4,
          min: 40,
          max: 50,
        },
      },
    },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'moonpale_scale', chance: 0.5 },
    ],
    scale: 1.2,
    color: 0x2f6f78,
  },
  moonlit_siren: {
    id: 'moonlit_siren',
    name: 'Moonlit Siren',
    minLevel: 17,
    maxLevel: 17,
    family: 'humanoid',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 10,
    dmgPerLevel: 2.4,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    petSpell: {
      name: 'Brine Lash',
      school: 'frost',
      min: 24,
      max: 32,
      range: 26,
      every: 3.2,
      windup: 0.6,
    },
    trashKit: {
      // Call the Tide: three Tidewisps rise round her. Kick it, or kill them fast.
      call: {
        castId: TEMPLE_CALL_THE_TIDE,
        name: 'Call the Tide',
        castTime: 2.5,
        every: 18,
        first: 5,
        school: 'frost',
        summon: 'tidewisp',
        count: 3,
        maxAlive: 3,
      },
      // The trash mechanics pass: while two or more Drowned Pilgrims of the
      // fight kneel within 15 yd, their Shrine Vigil turns 75 percent of all
      // damage she takes (85 on heroic). Kill the pilgrims first.
      temple: {
        vigil: {
          guardian: 'drowned_pilgrim',
          range: 15,
          min: 2,
          reduction: 0.75,
          heroicReduction: 0.85,
          name: 'Shrine Vigil',
        },
        // Call of the Shallows (the trash pass's second wave, temple_lure.ts):
        // a 3 s kickable song at one player past the tank within 25 yd. They
        // keep half their own run speed and are drawn to her at 2 yd a second
        // (heroic 2.5); drawn within 2.5 yd, or when the song ends, they are
        // Song-Struck, stunned 1.5 s (heroic 2 s). Out of her sight (a
        // column, a wall) the song breaks at once. No damage: the cost is
        // the stun beside her and the trip, so it is safe at any level.
        lure: {
          castId: TEMPLE_CALL_OF_THE_SHALLOWS,
          name: 'Call of the Shallows',
          castTime: 3,
          every: 20,
          first: 12,
          school: 'arcane',
          range: 25,
          pull: 2,
          heroicPull: 2.5,
          reach: 2.5,
          stun: 1.5,
          heroicStun: 2,
          stunName: 'Song-Struck',
        },
      },
    },
    loot: [
      { copper: 210, chance: 1 },
      { itemId: 'pale_pearl', chance: 0.4 },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x9fdcff,
  },
  tidewisp: {
    id: 'tidewisp',
    name: 'Tidewisp',
    minLevel: 15,
    maxLevel: 15,
    family: 'elemental',
    hpBase: 24,
    hpPerLevel: 7,
    dmgBase: 4,
    dmgPerLevel: 1,
    attackSpeed: 2,
    armorPerLevel: 4,
    moveSpeed: 8.5,
    aggroRadius: 14,
    xpMult: 0.2,
    untameable: true,
    trashKit: {
      detonate: {
        reach: 2.2,
        radius: 3,
        min: 50,
        max: 60,
        name: 'Tidewisp Burst',
        school: 'frost',
        // The trash mechanics pass: the moon-water chills whoever it caught,
        // half speed for 2 s (the Rime Whelp's Hoarfrost Pop precedent).
        slow: { mult: 0.5, seconds: 2 },
      },
      // Heroic only: two wisps that touch flow into one (pooled health), each
      // merge widening its burst by 1 yd and raising it by 40 percent, at most
      // two. A fully swollen wisp lands about 1.8 x 55 x 5.5 = 545 on heroic,
      // the same 40 percent of a heroic cloth wearer as a missed trash dodge.
      // Kill them apart.
      temple: {
        merge: { reach: 1.2, max: 2, radiusPer: 1, damagePer: 0.4, name: 'Swollen Tide' },
      },
    },
    loot: [],
    scale: 0.8,
    color: 0x6fe3e0,
  },
  drowned_pilgrim: {
    id: 'drowned_pilgrim',
    name: 'Drowned Pilgrim',
    minLevel: 16,
    maxLevel: 16,
    family: 'undead',
    hpBase: 44,
    hpPerLevel: 13,
    dmgBase: 9,
    dmgPerLevel: 2.4,
    attackSpeed: 2.2,
    armorPerLevel: 8,
    moveSpeed: 6.5,
    aggroRadius: 11,
    xpMult: 0.5,
    // Classic trash frenzy: harder and faster, the shipped 1.3 / 1.2 pairing.
    enrage: { belowHpPct: 0.3, dmgMult: 1.3, hasteMult: 1.2 },
    loot: [
      { copper: 40, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    scale: 0.95,
    color: 0x8f9a94,
  },
  mere_hydra_head_left: hydraHead('mere_hydra_head_left', 'Mere Hydra', 0xd9e6e2),
  mere_hydra_head_center: hydraHead('mere_hydra_head_center', 'Mere Hydra', 0xe6efe9, HYDRA_BLUE),
  mere_hydra_head_right: hydraHead('mere_hydra_head_right', 'Mere Hydra', 0xd2e1e6),
  // Boss 2: the Tideglass Colossus on the Prism Terrace (encounter module:
  // src/sim/encounters/drowned_temple/tideglass_colossus.ts).
  tideglass_colossus: {
    id: 'tideglass_colossus',
    name: 'Tideglass Colossus',
    minLevel: 17,
    maxLevel: 17,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    // About 11,500 health on normal through the Temple's tuning row.
    hpBase: 200,
    hpPerLevel: 30,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.8,
    armorPerLevel: 30,
    // A lumbering giant that walks its foe down across the terrace (a step
    // slower than a running player), plants its feet for each bar and never
    // leaves the Prism Terrace (encounters/drowned_temple/tideglass_colossus.ts).
    moveSpeed: 6,
    aggroRadius: 14,
    // One guaranteed piece per archetype group, plus the Shiv chase row.
    // Heroic rides HEROIC_BOSS_LOOT.tideglass_colossus.
    loot: [
      { copper: 1200, chance: 1 },
      {
        itemId: 'tideglass_pauldrons',
        chance: 0.34,
        rollGroup: 'colossus_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'moonburn_treads',
        chance: 0.33,
        rollGroup: 'colossus_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'prism_etched_cowl',
        chance: 0.33,
        rollGroup: 'colossus_guaranteed',
        normalOnly: true,
      },
      // The normal blue (drowned_temple_items.ts): one draw, 35 percent in
      // equal shares, the gloves trio and the Tideglass Shiv (once its own
      // 0.10 row).
      {
        itemId: 'tideglass_gauntlets',
        chance: 0.0875,
        rollGroup: 'colossus_blue',
        normalOnly: true,
      },
      { itemId: 'moonburn_grips', chance: 0.0875, rollGroup: 'colossus_blue', normalOnly: true },
      {
        itemId: 'prism_etched_handwraps',
        chance: 0.0875,
        rollGroup: 'colossus_blue',
        normalOnly: true,
      },
      { itemId: 'tideglass_shiv', chance: 0.0875, rollGroup: 'colossus_blue', normalOnly: true },
    ],
    // A giant's reach: the body's scale sets its melee reach (about 8.6 yd),
    // so it swings from beyond its own bulk; the renderer's height allows for it.
    scale: 2.2,
    color: 0xcfe6f0,
  },
  // The Colossus's Reflections: one per player, a glass copy of that player
  // (the renderer draws the owner's look, read from forcedTargetId). It takes
  // no damage from its owner (encounters/drowned_temple/reflection_guard.ts).
  tideglass_reflection: {
    id: 'tideglass_reflection',
    name: 'Tideglass Reflection',
    minLevel: 17,
    maxLevel: 17,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    hpBase: 60,
    hpPerLevel: 12,
    dmgBase: 8,
    dmgPerLevel: 2.2,
    attackSpeed: 2.2,
    armorPerLevel: 8,
    moveSpeed: 7.5,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.0,
    color: 0xdde8f5,
  },
};

for (const cls of ALL_CLASSES) {
  const id = reflectionTemplateFor(cls);
  DROWNED_TEMPLE_MOBS[id] = { ...DROWNED_TEMPLE_MOBS.tideglass_reflection, id };
}

// ---- Spawns ---------------------------------------------------------------

const FACE_SOUTH = Math.PI; // toward the entrance
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;
const FACE_SOUTH_WEST = -Math.PI * 0.75;

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

// Pack ids read as g<n> for the thirteen groups (route order), pa pb pc for
// the three patrols, and hydra for the Mere Hydra's three heads.

/** Patrol A: the causeway road, end to end. */
const CAUSEWAY_WALK = [
  { x: -7, z: -148 },
  { x: 0, z: -90 },
];
/** Patrol B: back and forth along the Waterfall Walk, behind the falls. */
const FALLS_WALK = [
  { x: 61, z: 32 },
  { x: 75, z: 55 },
];
/** Patrol C: up and down the Prism Stair between its landings. */
const PRISM_WALK = [
  { x: 51, z: 146 },
  { x: 62, z: 155 },
];

export const DROWNED_TEMPLE_SPAWNS: DungeonSpawn[] = [
  // ---- The Pilgrim Steps -------------------------------------------------------
  // g1: the mid landing. Four pilgrims kneeling round a singer at the shrine.
  held('drowned_pilgrim', -30, -185, 'g1', FACE_EAST),
  held('drowned_pilgrim', -38, -185, 'g1', FACE_EAST),
  held('drowned_pilgrim', -30, -192, 'g1', FACE_EAST),
  held('drowned_pilgrim', -38, -192, 'g1', FACE_EAST),
  held('pale_choir_acolyte', -36, -196, 'g1', FACE_EAST),
  // ---- The Reflecting Causeway -----------------------------------------------
  // g2: the stepping stones. Two templeguards and a snapper.
  held('drowned_templeguard', -14, -123, 'g2', FACE_EAST),
  held('drowned_templeguard', -20, -126, 'g2', FACE_EAST),
  held('lagoon_snapper', -17, -131, 'g2', FACE_EAST),
  // g3: the island. A siren and two lurkers.
  held('moonlit_siren', 22, -106, 'g3', FACE_WEST),
  held('glimmerscale_lurker', 15, -100, 'g3', FACE_WEST),
  held('glimmerscale_lurker', 15, -109, 'g3', FACE_WEST),
  // Patrol A: two templeguards and an acolyte walking the causeway.
  patrolling('drowned_templeguard', CAUSEWAY_WALK, 'pa', 0),
  patrolling('drowned_templeguard', CAUSEWAY_WALK, 'pa', 3),
  patrolling('pale_choir_acolyte', CAUSEWAY_WALK, 'pa', 6),
  // ---- The Colonnade of Tides ---------------------------------------------------
  // g4: the statue row. A sentinel, two pilgrims and an acolyte.
  held('pearlguard_sentinel', 0, -60, 'g4'),
  held('drowned_pilgrim', -5, -64, 'g4'),
  held('drowned_pilgrim', 5, -64, 'g4'),
  held('pale_choir_acolyte', 0, -55, 'g4'),
  // g5: the colonnade's end, before the Choir Veil. Two eels and a siren.
  held('ice_wraith', -9, -47, 'g5'),
  held('ice_wraith', 9, -47, 'g5'),
  held('moonlit_siren', 0, -43, 'g5'),
  // Boss 1: Choirmother Selthe on the Choir Court's stage.
  { mobId: 'choirmother_selthe', x: 0, z: 10, facing: FACE_SOUTH, idleStationary: true },
  // ---- West: the Tidepool Terraces -----------------------------------------------
  // g6: the low terrace. Three lurkers and an acolyte.
  held('glimmerscale_lurker', -50, 18, 'g6', FACE_EAST),
  held('glimmerscale_lurker', -57, 17, 'g6', FACE_EAST),
  held('glimmerscale_lurker', -53, 26, 'g6', FACE_EAST),
  held('pale_choir_acolyte', -60, 24, 'g6', FACE_EAST),
  // g7: the high terrace. A sentinel and two templeguards (the west one
  // clear of the tide basin at (-72, 72), whose collider would hold it).
  held('pearlguard_sentinel', -66, 66, 'g7'),
  held('drowned_templeguard', -62, 72, 'g7'),
  held('drowned_templeguard', -68, 76, 'g7'),
  // ---- East: the Waterfall Walk -------------------------------------------------
  // g8: the ledge. A siren and four pilgrims.
  held('moonlit_siren', 58, 24, 'g8', FACE_WEST),
  held('drowned_pilgrim', 51, 17, 'g8', FACE_WEST),
  held('drowned_pilgrim', 50, 23, 'g8', FACE_WEST),
  held('drowned_pilgrim', 53, 28, 'g8', FACE_WEST),
  held('drowned_pilgrim', 56, 17, 'g8', FACE_WEST),
  // g9: the grotto behind the falls. An eel, a snapper and a sentinel.
  held('pearlguard_sentinel', 80, 64, 'g9'),
  held('ice_wraith', 85, 70, 'g9'),
  held('lagoon_snapper', 76, 70, 'g9'),
  // Patrol B: a sentinel and two lurkers pacing behind the curtain of the falls.
  patrolling('pearlguard_sentinel', FALLS_WALK, 'pb', 0),
  patrolling('glimmerscale_lurker', FALLS_WALK, 'pb', 3),
  patrolling('glimmerscale_lurker', FALLS_WALK, 'pb', 6),
  // ---- The Hydra Pool: the Mere Hydra (showpiece) -----------------------------
  ...HYDRA_HEADS.map(
    (h, i): DungeonSpawn => ({
      mobId: MERE_HYDRA_HEAD_IDS[i],
      x: h.x,
      z: h.z,
      facing: FACE_SOUTH,
      packId: 'hydra',
      idleStationary: true,
    }),
  ),
  // ---- The Prism Stair -----------------------------------------------------------
  // g10: the first landing. Two templeguards, a siren and an acolyte.
  held('drowned_templeguard', 40, 133, 'g10', FACE_SOUTH_WEST),
  held('drowned_templeguard', 45, 133, 'g10', FACE_SOUTH_WEST),
  held('moonlit_siren', 45, 139, 'g10', FACE_SOUTH_WEST),
  held('pale_choir_acolyte', 39, 139, 'g10', FACE_SOUTH_WEST),
  // g11: the upper landing. Two sentinels and two lurkers.
  held('pearlguard_sentinel', 70, 161, 'g11', FACE_SOUTH_WEST),
  held('pearlguard_sentinel', 75, 162, 'g11', FACE_SOUTH_WEST),
  held('glimmerscale_lurker', 69, 167, 'g11', FACE_SOUTH_WEST),
  held('glimmerscale_lurker', 75, 167, 'g11', FACE_SOUTH_WEST),
  // Patrol C: a siren and two snappers up and down the stair.
  patrolling('moonlit_siren', PRISM_WALK, 'pc', 0),
  patrolling('lagoon_snapper', PRISM_WALK, 'pc', 3),
  patrolling('lagoon_snapper', PRISM_WALK, 'pc', 6),
  // Boss 2: the Tideglass Colossus on its plinth.
  {
    mobId: 'tideglass_colossus',
    x: PRISM_PLINTH.x,
    z: PRISM_PLINTH.z,
    facing: FACE_SOUTH,
    idleStationary: true,
  },
  // ---- The Altar Landing ----------------------------------------------------------
  // g12: the south half. Three templeguards and an acolyte.
  held('drowned_templeguard', 23, 193, 'g12', FACE_EAST),
  held('drowned_templeguard', 27, 196, 'g12', FACE_EAST),
  held('drowned_templeguard', 21, 199, 'g12', FACE_EAST),
  held('pale_choir_acolyte', 17, 194, 'g12', FACE_EAST),
  // g13: the north half. A sentinel, a siren, a snapper, an eel and an acolyte.
  held('pearlguard_sentinel', 25, 219, 'g13', FACE_EAST),
  held('moonlit_siren', 19, 221, 'g13', FACE_EAST),
  held('lagoon_snapper', 27, 214, 'g13', FACE_EAST),
  held('ice_wraith', 21, 215, 'g13', FACE_EAST),
  held('pale_choir_acolyte', 16, 218, 'g13', FACE_EAST),
  // Boss 3: Ysolei coiled against the Moon Altar's east face (just clear of
  // the altar stone's collider), on the causeway line, facing the causeway.
  {
    mobId: 'ysolei',
    x: YSOLEI_DAIS.x,
    z: YSOLEI_DAIS.z,
    facing: FACE_EAST,
    idleStationary: true,
  },
];

/** Every mandatory trash pull, patrols and the Hydra included, in route order. */
export const DROWNED_TEMPLE_PACKS = [
  'g1',
  'g2',
  'g3',
  'pa',
  'g4',
  'g5',
  'g6',
  'g7',
  'g8',
  'g9',
  'pb',
  'hydra',
  'g10',
  'g11',
  'pc',
  'g12',
  'g13',
] as const;

/** The three patrols (dev helpers, tests). */
export const DROWNED_TEMPLE_PATROLS = ['pa', 'pb', 'pc'] as const;

/** The three bosses, in route order. */
export const DROWNED_TEMPLE_BOSSES = [
  'choirmother_selthe',
  'tideglass_colossus',
  'ysolei',
] as const;

// ---- Gates and seals --------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const DROWNED_TEMPLE_GATES: DungeonGateDef[] = [
  {
    id: 'choir_veil',
    name: 'Choir Veil',
    kind: 'water_veil',
    x: 0,
    z: -33,
    hw: 6.6,
    rot: 0,
    packs: ['g1', 'g2', 'g3', 'pa', 'g4', 'g5'],
    sealWhileEngaged: 'choirmother_selthe',
    openText: 'The curtain of falling water over the Choir Stair parts.',
  },
  {
    id: 'court_stair_west',
    name: 'West Court Stair',
    kind: 'warded_arch',
    x: -27.5,
    z: 12,
    hw: 5.6,
    rot: across(-16, 5.5),
    bosses: ['choirmother_selthe'],
    openText: 'The choir falls silent. The Court Stairs unward.',
  },
  {
    id: 'court_stair_east',
    name: 'East Court Stair',
    kind: 'warded_arch',
    x: 27.5,
    z: 12,
    hw: 5.6,
    rot: across(16, 5.5),
    bosses: ['choirmother_selthe'],
  },
  {
    id: 'prism_stair_rise',
    name: 'Sunken Prism Stair',
    kind: 'sunken_stair',
    x: 18.7,
    z: 114.3,
    hw: 5.6,
    rot: across(0.73, 0.68),
    packs: ['g6', 'g7', 'g8', 'g9', 'pb', 'hydra'],
    openText: 'The moon pool drains with a roar. The Prism Stair rises from the lagoon.',
  },
  {
    id: 'prism_ward',
    name: 'Prism Ward',
    kind: 'warded_arch',
    x: 78,
    z: 177,
    hw: 5.6,
    rot: across(4, 9),
    packs: ['g10', 'g11', 'pc'],
    sealWhileEngaged: 'tideglass_colossus',
    openText: 'The ward on the Prism Terrace fades.',
  },
  {
    id: 'moonbridge',
    name: 'The Moonbridge',
    kind: 'light_bridge',
    x: 62.5,
    z: 208,
    hw: 5,
    rot: across(-1, 0),
    bosses: ['tideglass_colossus'],
    openText: 'Moonlight gathers over the lagoon and hardens into a bridge.',
  },
  {
    id: 'altar_ward',
    name: 'Altar Ward',
    kind: 'rite_ward',
    x: 8,
    z: 206,
    hw: 6.2,
    rot: across(-1, 0),
    packs: ['g12', 'g13'],
    sealWhileEngaged: 'ysolei',
    openText: 'The rite ward before the Moon Altar breaks.',
  },
];

/** One inert ground object per gate: its template id carries the state. */
export const DROWNED_TEMPLE_GATE_OBJECTS: DungeonObjectSpawn[] = DROWNED_TEMPLE_GATES.map((g) => ({
  itemId: '',
  name: g.name,
  x: g.x,
  z: g.z,
  templateId: 'dungeon_gate_closed',
  dungeonId: 'drowned_temple',
  lootable: false,
}));
