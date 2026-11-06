// The Smith's Heart (docs/design/raid/smith_heart.md): the raid's content.
// Mob templates with SKETCH kits (one or two readable mechanics each on the
// shared trash-kit engine, enough to walk the route and pull every fight), the
// spawn roster in route order, the gates and seals (instances/dungeon_gates.ts
// derives their states), the seal markers that carry the heart seal's colours
// and the portal's state (encounters/smith_heart/seal.ts, portal.ts), and the
// DungeonDef itself. The final boss fights in the Heart, a separate area of
// the same slot reached only through the seal's portal.
//
// EVERY mob here is a placeholder: its name is descriptive and provisional,
// its numbers are sketch numbers, and the body it draws is a borrowed model
// listed in render/characters/smith_heart_placeholder_looks.ts (the one list
// phase 2 replaces). Loot is deliberately not wired (design doc, "Loot hook").

import { THESSALY_POST } from '../encounters/smith_heart/breath_geometry';
import {
  BREATH_DIFFICULTY,
  BREATH_THESSALY_NPC,
  BREATH_TUNING,
  breathWindTemplate,
} from '../encounters/smith_heart/breath_ids';
import { ISLE_MOBS } from '../encounters/smith_heart/breath_isle_ids';
import { COUNCIL_TUNING } from '../encounters/smith_heart/council_ids';
import {
  FINAL_ADD_MOBS,
  FINAL_PHASE_NAMES,
  FINAL_PHASES,
} from '../encounters/smith_heart/final_phase_ids';
import {
  HEAT_GUARDIAN_SCALE,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_TUNING,
  wellTemplate,
} from '../encounters/smith_heart/heat_ids';
import { bladeTemplate, QUENCH_NAMES, QUENCH_TUNING } from '../encounters/smith_heart/quench_ids';
import type {
  DungeonDef,
  DungeonGateDef,
  DungeonObjectSpawn,
  DungeonSpawn,
  MobTemplate,
  NpcDef,
  TrashKitDef,
} from '../types';
import {
  BREATH,
  CLEFT,
  GALLERY_LANDINGS,
  HAMMER_PIT,
  HEART_BRIDGE_GATE,
  HEART_ROOM,
  HEART_TERRACE,
  HEARTH_WELL,
  QUARRY_PILLAR_SPOTS,
  QUENCH,
  QUENCH_BLADE_SPOTS,
  RING_PACK_DEGREES,
  ringPoint,
  SLAB,
  SMITH_HEART_ANCHORS,
  SMITH_HEART_BOSS_SPOTS,
  type SmithHeartVein,
} from './smith_heart_layout';

export const SMITH_HEART_DUNGEON = 'smith_heart';

/** False while the raid is a phase 1 blockout: no overworld door is built
 *  (no door entity, jambs, terrain pad or cleared ring in a live world, so
 *  the shipped world and its parity goldens stay untouched) and only dev
 *  builds may enter, through /dev heart (encounters/smith_heart/entry.ts).
 *  Flip it when the raid ships (design doc, "Shipping checklist"). */
export const SMITH_HEART_PLAYABLE = false;

/** The four guardians and the final boss (template ids). */
export const SMITH_HEART_GUARDIANS: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'heart_hammer_guardian',
  breath: 'heart_breath_guardian',
  quench: 'heart_quench_guardian',
  heat: 'heart_heat_guardian',
};
export const SMITH_HEART_FINAL_BOSS = 'heart_masterless_strength';

/** The sketch-kit cast ids (uninterruptible: none is in a kick table). */
export const SMITH_HEART_CASTS = {
  hammerWrath: 'heart_mountains_wrath',
  breathGust: 'heart_bellows_gust',
  breathLance: 'heart_storm_lance',
  quenchBreath: 'heart_quenching_breath',
  galeBolt: 'heart_gale_bolt',
  rimeBolt: 'heart_rime_bolt',
  emberBolt: 'heart_ember_bolt',
} as const;

// ---- templates ---------------------------------------------------------------------

/** A raid trash melee body: elite, level 20, one swing cleave. */
function warder(
  id: string,
  name: string,
  cleave: string,
  color: number,
  scale: number,
): MobTemplate {
  return {
    id,
    name,
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 250,
    hpPerLevel: 50,
    dmgBase: 20,
    dmgPerLevel: 4,
    attackSpeed: 2.4,
    armorPerLevel: 30,
    moveSpeed: 7.2,
    aggroRadius: 13,
    arcCleave: { every: 3, arcDeg: 100, range: 7, mult: 0.6, name: cleave },
    loot: [],
    scale,
    color,
  };
}

/** A raid trash caster: elite, level 20, one bolt on a cast bar. */
function caster(
  id: string,
  name: string,
  castId: string,
  boltName: string,
  school: 'nature' | 'frost' | 'fire',
  color: number,
): MobTemplate {
  return {
    id,
    name,
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 180,
    hpPerLevel: 40,
    dmgBase: 14,
    dmgPerLevel: 3,
    attackSpeed: 2.2,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 13,
    trashKit: {
      bolt: {
        castId,
        name: boltName,
        castTime: 2,
        every: 7,
        first: 3,
        school,
        range: 30,
        min: 110,
        max: 140,
      },
    },
    loot: [],
    scale: 1.3,
    color,
  };
}

/** A guardian or the final boss: a raid boss body at sketch numbers. */
function boss(id: string, name: string, hp: number, color: number, scale: number): MobTemplate {
  return {
    id,
    name,
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    boss: true,
    hpBase: hp,
    hpPerLevel: 0,
    dmgBase: 40,
    dmgPerLevel: 8,
    attackSpeed: 2.6,
    armorPerLevel: 40,
    moveSpeed: 7,
    aggroRadius: 16,
    loot: [],
    scale,
    color,
  };
}

const C = SMITH_HEART_CASTS;

/** A Splinter of the Masterless Strength (encounters/smith_heart/
 *  final_adds.ts): an intermission's add, tanked, never controlled or slowed
 *  (its own signature moves it), clearly bigger than a player. Its health is
 *  the encounter's per tier (FINAL_PHASE_DIFFICULTY), set as it rises; its
 *  kit is the encounter's (none of it raises another body). */
function splinter(id: string, name: string, color: number, scale: number): MobTemplate {
  return {
    id,
    name,
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 2000,
    hpPerLevel: 0,
    dmgBase: 34,
    dmgPerLevel: 6,
    attackSpeed: 2.2,
    armorPerLevel: 35,
    moveSpeed: 7,
    aggroRadius: 0,
    ccImmune: true,
    slowImmune: true,
    xpMult: 0,
    loot: [],
    scale,
    color,
  };
}

/** The Hammer Council's Mountain's Wrath declaration (encounter-driven: the
 *  council starts and lands it; the trash engine only reads its look). */
function councilWrath(
  castTime: number,
  min: number,
  max: number,
): NonNullable<TrashKitDef['nova']> {
  return {
    castId: C.hammerWrath,
    name: "Mountain's Wrath",
    castTime,
    every: 999,
    first: 999,
    school: 'physical',
    radius: COUNCIL_TUNING.wrathRadius,
    min,
    max,
    encounterDriven: true,
  };
}

export const SMITH_HEART_MOBS: Record<string, MobTemplate> = {
  // ---- trash -------------------------------------------------------------------
  heart_hammer_warder: warder(
    'heart_hammer_warder',
    'Hammer Vein Warder',
    'Stone Sweep',
    0x8a6430,
    1.7,
  ),
  heart_ring_warder: warder('heart_ring_warder', 'Ring Forge Warder', 'Forge Sweep', 0x6a6460, 1.8),
  heart_breath_warder: warder(
    'heart_breath_warder',
    'Breath Vein Warder',
    'Gale Sweep',
    0x3f7f9f,
    1.6,
  ),
  heart_breath_caller: caster(
    'heart_breath_caller',
    'Breath Vein Caller',
    C.galeBolt,
    'Gale Bolt',
    'nature',
    0x5ab8e8,
  ),
  // The Islands of the Wind's adds (encounters/smith_heart/breath_isles.ts):
  // a warden and a caster on each woken isle; their health is set as they
  // rise (ISLE_TUNING), the Mender's Mending Gale is encounter-driven.
  [ISLE_MOBS.sentinel]: {
    ...warder(ISLE_MOBS.sentinel, 'Gale Sentinel', 'Gale Sweep', 0x4f9fc8, 1.9),
    aggroRadius: 10,
    xpMult: 0,
  },
  [ISLE_MOBS.mender]: {
    ...caster(ISLE_MOBS.mender, 'Gale Mender', C.galeBolt, 'Gale Bolt', 'nature', 0x8fe0ff),
    aggroRadius: 10,
    xpMult: 0,
    scale: 1.6,
  },
  heart_quench_warder: warder(
    'heart_quench_warder',
    'Quench Vein Warder',
    'Rime Sweep',
    0x6aa8c8,
    1.7,
  ),
  heart_quench_caller: caster(
    'heart_quench_caller',
    'Quench Vein Caller',
    C.rimeBolt,
    'Rime Bolt',
    'frost',
    0x9ad8ff,
  ),
  heart_heat_warder: warder('heart_heat_warder', 'Heat Vein Warder', 'Ember Sweep', 0xc8a050, 1.7),
  heart_heat_caller: caster(
    'heart_heat_caller',
    'Heat Vein Caller',
    C.emberBolt,
    'Ember Bolt',
    'fire',
    0xffe6a0,
  ),
  // ---- the four guardians ------------------------------------------------------------
  // The Hammer Council (design doc 7.1, encounters/smith_heart/council.ts):
  // two stone beings sharing the Hammer's strength, one pull, one wipe, one
  // kill. Every number is a SKETCH (unmeasured): the pools split about 137,000
  // (after the elite factor) for a 4 to 5 minute fight at a planning raid DPS
  // of about 600 (the prototype's third member's share went to the two). Each carries the Wrath's declaration (`nova`,
  // encounter-driven: the council casts it, never the trash engine), so the
  // sight field draws for whichever of them holds the Wrath.
  // The Guardian of the Hammer: a stone titan half-fused with the floor, the
  // melee tank boss (energy, Mountain's Wrath, Hammer's Weight, Mountain's
  // Rush). Hammerfall, its
  // frontal arc, stays: it reads well and keeps the raid off the tank's side.
  heart_hammer_guardian: {
    ...boss('heart_hammer_guardian', 'Guardian of the Hammer', 54000, 0x8a6430, 3.2),
    ccImmune: true,
    slowImmune: true,
    arcCleave: { every: 3, arcDeg: 110, range: 9, mult: 0.7, name: 'Hammerfall' },
    trashKit: {
      nova: councilWrath(
        COUNCIL_TUNING.wrathCast,
        COUNCIL_TUNING.wrathMin,
        COUNCIL_TUNING.wrathMax,
      ),
    },
  },
  // The Seam Singer: tall and slender, ochre seam crystals; the caster (Seam
  // Bolt, Song of the Seam, Wake the Stone, Falling Rock). A light melee: her
  // pressure is her bars. She carries the heir's Wrath declaration (the
  // Guardian fallen, she takes the Wrath).
  heart_seam_singer: {
    ...boss('heart_seam_singer', 'The Seam Singer', 46000, 0xd8a24a, 2.0),
    ccImmune: true,
    slowImmune: true,
    dmgBase: 24,
    dmgPerLevel: 5,
    attackSpeed: 2.2,
    trashKit: {
      nova: councilWrath(
        COUNCIL_TUNING.heirWrathCast,
        COUNCIL_TUNING.heirWrathMin,
        COUNCIL_TUNING.heirWrathMax,
      ),
    },
  },
  // The Guardian of the Breath (design doc 7.2, encounters/smith_heart/
  // breath.ts): a living bellows of granite, crystal and storm. Phase 1 the
  // Wind (its blows across the Cornice, the gaps in the rim, Thessaly's
  // circles, the indrawn breath and the exhale), at half health the storm
  // breaks, phase 2 the Storm. Every number a SKETCH (bot-measured, never
  // with players): 80,000 base (about 184,000 after the elite factor) for a
  // 4 to 5 minute Normal fight; Heroic's own multiplier is its difficulty
  // row's (tier_health.ts). Bellows Gust is the exhale
  // now (encounter-driven: the fight casts it after the indrawn breath; its
  // record stays the look's numbers: the whole Cornice, the throw). Storm
  // Lance stays the trash kit's own line, on its own clock.
  heart_breath_guardian: {
    ...boss('heart_breath_guardian', 'Guardian of the Breath', 80000, 0x5ab8e8, 3.4),
    ccImmune: true,
    slowImmune: true,
    trashKit: {
      wingGust: {
        castId: C.breathGust,
        name: 'Summit Roar',
        castTime: BREATH_TUNING.gustCast,
        every: 999,
        first: 999,
        school: 'nature',
        radius: 60,
        knockback: BREATH_DIFFICULTY.normal.gustThrow,
        min: BREATH_TUNING.gustMin,
        max: BREATH_TUNING.gustMax,
        encounterDriven: true,
      },
      line: {
        castId: C.breathLance,
        name: 'Storm Lance',
        castTime: 2,
        every: 11,
        first: 5,
        school: 'nature',
        length: 34,
        halfWidth: 2.5,
        min: 240,
        max: 280,
      },
    },
  },
  // The Guardian of the Quench (design doc 7.3, encounters/smith_heart/
  // quench.ts): an ice guardian of living stone and the lake's cold, no
  // metal. "Together, but not for too long": the cold bar, the huddle's
  // warmth and the ice it breaks, at half health the Smith's four blades
  // awake and echo its attacks. Every number a SKETCH (bot-measured, never
  // with players): 62,000 base (about 143,000 after the elite factor) for a
  // 4 to 5 minute Normal fight; Heroic's own multiplier is its difficulty
  // row's (tier_health.ts). Tempering Strike stays its
  // swing cleave (the fight watches for it to raise the echoes); Quenching
  // Breath is encounter-driven (the fight starts and lands it on its own
  // clock; the record keeps the look's numbers).
  heart_quench_guardian: {
    ...boss('heart_quench_guardian', 'Guardian of the Quench', 62000, 0x9ad8ff, 3),
    ccImmune: true,
    slowImmune: true,
    arcCleave: {
      every: QUENCH_TUNING.strikeEvery,
      arcDeg: QUENCH_TUNING.strikeArcDeg,
      range: QUENCH_TUNING.strikeRange,
      mult: 0.6,
      name: 'Tempering Strike',
    },
    trashKit: {
      cone: {
        castId: C.quenchBreath,
        name: QUENCH_NAMES.breath,
        castTime: QUENCH_TUNING.breathCast,
        every: QUENCH_TUNING.breathEvery,
        first: QUENCH_TUNING.breathFirst,
        school: 'frost',
        range: QUENCH_TUNING.breathRange,
        arcDeg: QUENCH_TUNING.breathArcDeg,
        min: QUENCH_TUNING.breathMin,
        max: QUENCH_TUNING.breathMax,
        encounterDriven: true,
      },
    },
  },
  // The Guardian of the Heat (design doc 7.4, encounters/smith_heart/heat.ts):
  // a being of the first flame in crystal and basalt (the vein is the Hearth,
  // never a forge), half sunk in the first wellspring at the back of the
  // Hearth. "The well of the first flame": Basalt Fist and its Molten Swells,
  // Hearth Flare, two overflows, Hearthseeds, Wakefire and the Rolling
  // Cinders (heroic adds the overflows' adds and the Seedflames). Every number a
  // SKETCH (bot-measured, never with players): 64,000 base (about 147,000
  // after the elite factor) for a 4 to 5 minute Normal fight, like the other
  // guardians; Heroic's own multiplier is its difficulty row's. Its body reaches the wellspring's lip
  // (bodyRadius: melee strikes it from the shore); Cinder Grip is its own
  // stacking burn on every landed swing (the stackPoison seam), so the tanks
  // swap; every other mechanic is the encounter's.
  heart_heat_guardian: {
    ...boss('heart_heat_guardian', 'Guardian of the Heat', 64000, 0xffe6a0, HEAT_GUARDIAN_SCALE),
    ccImmune: true,
    slowImmune: true,
    bodyRadius: HEARTH_WELL.r,
    stackPoison: {
      chance: 1,
      perTick: HEAT_TUNING.gripPerTick,
      interval: 1,
      duration: HEAT_TUNING.gripSeconds,
      maxStacks: HEAT_TUNING.gripMaxStacks,
      name: HEAT_NAMES.grip,
      school: 'fire',
    },
  },
  // The Guardian of the Heat's own adds (encounters/smith_heart/heat*.ts).
  // The Wellspawn: heroic's children of the flame, walked to the wellspring
  // by the encounter (they never swing; every slow and control works on
  // them).
  [HEAT_MOBS.spawn]: {
    id: HEAT_MOBS.spawn,
    name: 'Wellspawn',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 200,
    hpPerLevel: 45,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 3,
    armorPerLevel: 10,
    moveSpeed: HEAT_TUNING.spawnSpeed,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.4,
    color: 0xffd27a,
  },
  // The Wellkeepers: heroic's second overflow, tanked (they cannot be
  // controlled); their Kindling Mark is the encounter's.
  [HEAT_MOBS.keeper]: {
    id: HEAT_MOBS.keeper,
    name: 'Wellkeeper',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 400,
    hpPerLevel: 100,
    dmgBase: 30,
    dmgPerLevel: 6,
    attackSpeed: 2.4,
    armorPerLevel: 35,
    moveSpeed: 6,
    aggroRadius: 0,
    ccImmune: true,
    slowImmune: true,
    xpMult: 0,
    loot: [],
    scale: 2.2,
    color: 0xffb04a,
  },
  // The Seedflames: heroic, hatched from a Hearthseed's burst, each hunting
  // one player; small and frail, burned down together.
  [HEAT_MOBS.seedflame]: {
    id: HEAT_MOBS.seedflame,
    name: 'Seedflame',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 100,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2,
    attackSpeed: 1.8,
    armorPerLevel: 8,
    moveSpeed: 5,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 0.9,
    color: 0xfff0b0,
  },
  // The Rolling Cinder: phase 3's great living fireball, walked by the
  // encounter after its quarry. A ward (a strike lands one point and knocks
  // it back, heat_cinder_ward.ts): it cannot be killed.
  [HEAT_MOBS.cinder]: {
    id: HEAT_MOBS.cinder,
    name: 'Rolling Cinder',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 2000,
    hpPerLevel: 0,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 3,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    ccImmune: true,
    slowImmune: true,
    xpMult: 0,
    loot: [],
    scale: 2.4,
    color: 0xfff2c0,
  },
  // ---- the final boss ------------------------------------------------------------
  // The strength without its master (design doc 7.5). Its fight is the
  // encounter's (encounters/smith_heart/final*.ts): the four quarters' rules
  // and kits. Its own swing cleave, Forge Fist, is its frontal (Mythic's Heat
  // quarter leaves fire where it strikes, the Quench's slows); the sketch's
  // Forge Wrath and Forge Pour are gone. Health a SKETCH: 72,000 base (about
  // 166,000 after the elite factor), the guardians' anchor scaled for the
  // raid's last fight. It cannot be controlled or slowed: only its own Taking
  // Root holds it.
  // Its Splinters (part 2, encounters/smith_heart/final_adds.ts): one rises
  // out of each awakened quarter as an intermission's call begins.
  [FINAL_ADD_MOBS.heat]: splinter(FINAL_ADD_MOBS.heat, FINAL_PHASE_NAMES.heat, 0xffd27a, 2.6),
  [FINAL_ADD_MOBS.quench]: splinter(FINAL_ADD_MOBS.quench, FINAL_PHASE_NAMES.quench, 0x9ad8ff, 2.5),
  [FINAL_ADD_MOBS.breath]: splinter(FINAL_ADD_MOBS.breath, FINAL_PHASE_NAMES.breath, 0x6ac8f0, 2.4),
  // The Hammer's: Mounting Weight rides the swing kernel's stacking poison
  // (its aura id MOUNTING_WEIGHT_AURA); the encounter makes its swing land
  // harder for every stack its target carries.
  [FINAL_ADD_MOBS.hammer]: {
    ...splinter(FINAL_ADD_MOBS.hammer, FINAL_PHASE_NAMES.hammer, 0xc8903c, 2.7),
    stackPoison: {
      chance: 1,
      perTick: FINAL_PHASES.weightPerTick,
      interval: 1,
      duration: FINAL_PHASES.weightSeconds,
      maxStacks: FINAL_PHASES.weightMaxStacks,
      name: FINAL_PHASE_NAMES.weight,
      school: 'physical',
    },
  },
  heart_masterless_strength: {
    ...boss('heart_masterless_strength', 'The Masterless Strength', 72000, 0xd8c8a0, 3.6),
    ccImmune: true,
    slowImmune: true,
    arcCleave: { every: 3, arcDeg: 110, range: 9, mult: 0.7, name: 'Forge Fist' },
  },
};

// ---- spawns --------------------------------------------------------------------------

/** A pack of `ids` round (cx, cz), held in formation until pulled, facing
 *  `facing` (sim convention: 0 = +z). */
function pack(
  packId: string,
  cx: number,
  cz: number,
  ids: readonly string[],
  facing: number,
): DungeonSpawn[] {
  return ids.map((mobId, i) => {
    const a = (i / ids.length) * Math.PI * 2;
    return {
      mobId,
      x: cx + Math.sin(a) * 3,
      z: cz + Math.cos(a) * 3,
      facing,
      packId,
      idleStationary: true,
    };
  });
}

/** Facing from (x, z) toward (tx, tz) (sim convention: 0 = +z). */
function toward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/** The Ring's eight pack angles: two between each pair of vein mouths (the
 *  layout's, where their cairns stand too). */
export { RING_PACK_DEGREES };

const RING_PACK_IDS = RING_PACK_DEGREES.map((_, i) => `r${i + 1}`);

const HAMMER_TRIO = ['heart_hammer_warder', 'heart_hammer_warder', 'heart_hammer_warder'];
const RING_TRIO = ['heart_ring_warder', 'heart_ring_warder', 'heart_ring_warder'];
const BREATH_TRIO = ['heart_breath_warder', 'heart_breath_caller', 'heart_breath_warder'];
const QUENCH_TRIO = ['heart_quench_warder', 'heart_quench_caller', 'heart_quench_warder'];
const HEAT_TRIO = ['heart_heat_warder', 'heart_heat_caller', 'heart_heat_warder'];

function guardian(mobId: string, at: { x: number; z: number }, facing: number): DungeonSpawn {
  return { mobId, x: at.x, z: at.z, facing, idleStationary: true };
}

/** The Hammer Council's two, facing the Pit Mouth, held as one pack. */
function councilSpawns(): DungeonSpawn[] {
  const facing = toward(HAMMER_PIT.x, HAMMER_PIT.z, -35, -179);
  return [
    { ...guardian(SMITH_HEART_GUARDIANS.hammer, SMITH_HEART_BOSS_SPOTS.hammer, facing) },
    { ...guardian('heart_seam_singer', SMITH_HEART_BOSS_SPOTS.seamSinger, facing) },
  ].map((sp) => ({ ...sp, packId: SMITH_HEART_COUNCIL_PACK }));
}

/** The council's authored pack id (no gate waits on it as a pack: the Slab
 *  waits on its two bosses). */
export const SMITH_HEART_COUNCIL_PACK = 'council';

/** The council's two, in role order (the Slab, the seal and every credit
 *  wait on both). */
export const SMITH_HEART_COUNCIL: readonly string[] = [
  'heart_hammer_guardian',
  'heart_seam_singer',
];

const G = GALLERY_LANDINGS;
const S = SMITH_HEART_BOSS_SPOTS;

export const SMITH_HEART_SPAWNS: DungeonSpawn[] = [
  // ---- The Hammer Gallery and the Quarry (always first) -----------------------------
  ...pack('h1', G.h1.x, G.h1.z, HAMMER_TRIO, toward(G.h1.x, G.h1.z, CLEFT.x, CLEFT.z)),
  ...pack('h2', G.h2.x, G.h2.z, HAMMER_TRIO, toward(G.h2.x, G.h2.z, G.h1.x, G.h1.z)),
  ...pack('h3', G.h3.x, G.h3.z, HAMMER_TRIO, toward(G.h3.x, G.h3.z, G.h2.x, G.h2.z)),
  // The Hammer Council: one authored pack, so pulling one pulls both.
  ...councilSpawns(),
  // ---- The Ring: two packs between each pair of vein mouths -------------------------
  ...RING_PACK_DEGREES.flatMap((deg, i) => {
    const p = ringPoint(deg);
    return pack(RING_PACK_IDS[i], p.x, p.z, RING_TRIO, toward(p.x, p.z, 0, 0));
  }),
  // ---- The Breath (north) ------------------------------------------------------------
  ...pack('b1', BREATH.b1.x, BREATH.b1.z, BREATH_TRIO, Math.PI),
  ...pack('b2', BREATH.b2.x, BREATH.b2.z, BREATH_TRIO, toward(-64, 112, 0, 104)),
  ...pack('b3', BREATH.b3.x, BREATH.b3.z, BREATH_TRIO, toward(-112, 170, -84, 140)),
  guardian(SMITH_HEART_GUARDIANS.breath, S.breath, toward(S.breath.x, S.breath.z, -42, 195)),
  // ---- The Quench (east) -------------------------------------------------------------
  ...pack('q1', QUENCH.q1.x, QUENCH.q1.z, QUENCH_TRIO, -Math.PI / 2),
  ...pack('q2', QUENCH.q2.x, QUENCH.q2.z, QUENCH_TRIO, toward(122, -48, 110, 0)),
  ...pack('q3', 160, -86, QUENCH_TRIO, toward(160, -86, 130, -60)),
  guardian(SMITH_HEART_GUARDIANS.quench, S.quench, toward(S.quench.x, S.quench.z, 190, -44)),
  // ---- The Heat (west) ---------------------------------------------------------------
  ...pack('f1', -104, 0, HEAT_TRIO, Math.PI / 2),
  ...pack('f2', -136, 20, HEAT_TRIO, Math.PI / 2),
  ...pack('f3', -136, -20, HEAT_TRIO, Math.PI / 2),
  guardian(SMITH_HEART_GUARDIANS.heat, S.heat, Math.PI / 2),
  // ---- The Heart (the separate final room) ---------------------------------------------
  guardian(
    SMITH_HEART_FINAL_BOSS,
    S.final,
    toward(HEART_ROOM.x, HEART_ROOM.z, HEART_TERRACE.x, HEART_TERRACE.z),
  ),
];

/** Every pack, in route order (the Ring's eight after the Hammer). */
export const SMITH_HEART_PACKS = {
  hammer: ['h1', 'h2', 'h3'],
  ring: RING_PACK_IDS,
  breath: ['b1', 'b2', 'b3'],
  quench: ['q1', 'q2', 'q3'],
  heat: ['f1', 'f2', 'f3'],
} as const;

// ---- gates and seals ----------------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const SMITH_HEART_GATES: DungeonGateDef[] = [
  {
    id: 'hammer_pit_mouth',
    name: 'Pit Mouth',
    kind: 'stone_slab',
    x: -50,
    z: -193.3,
    hw: 7.6,
    rot: across(19, 18),
    packs: [...SMITH_HEART_PACKS.hammer],
    sealWhileEngaged: SMITH_HEART_GUARDIANS.hammer,
    // The Hammer Council: sealed while either of the two fights.
    sealWithBodies: ['heart_seam_singer'],
  },
  {
    id: 'the_slab',
    name: 'The Slab',
    kind: 'stone_slab',
    x: SLAB.x,
    z: SLAB.z,
    hw: 7.6,
    rot: across(0, 1),
    bosses: [...SMITH_HEART_COUNCIL],
    openText:
      'The living stone splits from end to end. Beyond the Slab, the heart of the mountain lies open.',
  },
  {
    id: 'cornice_mouth',
    name: 'Cornice Mouth',
    kind: 'forge_seal',
    x: -70,
    z: 191,
    hw: 7.6,
    rot: across(40, 14),
    packs: [...SMITH_HEART_PACKS.breath],
    sealWhileEngaged: SMITH_HEART_GUARDIANS.breath,
  },
  {
    id: 'lake_mouth',
    name: 'Lake Mouth',
    kind: 'forge_seal',
    x: 181,
    z: -62,
    hw: 7.6,
    rot: across(13, 22),
    packs: [...SMITH_HEART_PACKS.quench],
    sealWhileEngaged: SMITH_HEART_GUARDIANS.quench,
  },
  {
    id: 'anvil_mouth',
    name: 'Hearth Mouth',
    kind: 'forge_seal',
    x: -169,
    z: 0,
    hw: 7.6,
    rot: across(-1, 0),
    packs: [...SMITH_HEART_PACKS.heat],
    sealWhileEngaged: SMITH_HEART_GUARDIANS.heat,
  },
  // The Heart's own seal: always open (nothing to wait on: the portal is the
  // way in), sealed behind the raid on the bridge while the final boss fights.
  {
    id: 'heart_bridge',
    name: 'Heart Bridge',
    kind: 'forge_seal',
    x: HEART_BRIDGE_GATE.x,
    z: HEART_BRIDGE_GATE.z,
    hw: 7.6,
    rot: across(HEART_BRIDGE_GATE.dx, HEART_BRIDGE_GATE.dz),
    sealWhileEngaged: SMITH_HEART_FINAL_BOSS,
  },
];

/** One inert ground object per gate: its template id carries the state. */
export const SMITH_HEART_GATE_OBJECTS: DungeonObjectSpawn[] = SMITH_HEART_GATES.map((g) => ({
  itemId: '',
  name: g.name,
  x: g.x,
  z: g.z,
  templateId: 'dungeon_gate_closed',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
}));

/** The heart seal's markers (encounters/smith_heart/seal.ts): inert anchors
 *  spread so every walkable point stands within the client's interest radius
 *  of at least one, carrying the seal's lit veins in their template id. */
export const SMITH_HEART_SEAL_MARKERS: readonly { x: number; z: number }[] = [
  // The Cleft and the Gallery.
  { x: -190, z: -214 },
  { x: -110, z: -228 },
  // The Quarry, the Slab and the Balcony.
  { x: 8, z: -170 },
  { x: 0, z: -96 },
  // The Ring and the Seal Dais.
  { x: 0, z: 0 },
  // The Breath, its bridge, the Cornice.
  { x: -40, z: 110 },
  { x: -100, z: 165 },
  { x: 0, z: 196 },
  // The Quench, the Singing Ice, the Basin.
  { x: 116, z: -26 },
  { x: 166, z: -76 },
  { x: 204, z: -2 },
  // The Heat, the casting floor, the Smith's Forge.
  { x: -110, z: 0 },
  { x: -214, z: 0 },
  // The Heart.
  { x: 176, z: 160 },
];

export const SMITH_HEART_SEAL_PREFIX = 'smith_heart_seal_';

export const SMITH_HEART_SEAL_OBJECTS: DungeonObjectSpawn[] = SMITH_HEART_SEAL_MARKERS.map((m) => ({
  itemId: '',
  name: 'The Heart Seal',
  x: m.x,
  z: m.z,
  templateId: `${SMITH_HEART_SEAL_PREFIX}0` as 'smith_heart_seal_0',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
}));

/** The Storm Cornice's wind (encounters/smith_heart/breath_gale.ts): one
 *  inert object at the plateau's middle whose template id carries the wind's
 *  phase, bearing and length; still until the guardian is pulled. */
export const SMITH_HEART_WIND_OBJECT: DungeonObjectSpawn = {
  itemId: '',
  name: 'Bellows Wind',
  x: BREATH.cornice.x,
  z: BREATH.cornice.z,
  templateId: breathWindTemplate('still', 0, 0) as 'sh_breath_wind_still_0_0',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
};

/** Captain Thessaly at the head of the Cornice climb (design doc 7.2): the
 *  Highwatch captain fights beside the raid against the Guardian of the
 *  Breath, out of its wind. A dynamic NPC (spawned with each claim, never on
 *  the overworld) with no quests, so the raid never offers Highwatch's. */
export const SMITH_HEART_NPCS: Record<string, NpcDef> = {
  [BREATH_THESSALY_NPC]: {
    id: BREATH_THESSALY_NPC,
    name: 'Captain Thessaly',
    title: 'Highwatch Captain',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x85929e,
    questIds: [],
    greeting:
      'Keep your feet, $C. When the bellows breathes, step into my calm and let the wind break on us.',
    dynamic: true,
  },
};

/** The quarry's five carved columns, the Hammer Council's starting pillars:
 *  spawned with the claim, their integrity in the template id, each a combat
 *  wall (encounters/smith_heart/council_pillars.ts). */
export const SMITH_HEART_PILLAR_OBJECTS: DungeonObjectSpawn[] = QUARRY_PILLAR_SPOTS.map((p) => ({
  itemId: '',
  name: 'Carved Column',
  x: p.x,
  z: p.z,
  templateId: 'sh_council_pillar_2',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
}));

/** The Smith's four great blades sunk in the Frozen Lake (design doc 7.3):
 *  spawned with the claim, their state in the template id, each a combat
 *  wall until it flies (encounters/smith_heart/quench_blades.ts). */
export const SMITH_HEART_BLADE_OBJECTS: DungeonObjectSpawn[] = QUENCH_BLADE_SPOTS.map((p) => ({
  itemId: '',
  name: QUENCH_NAMES.blade,
  x: p.x,
  z: p.z,
  templateId: bladeTemplate('sunk') as 'sh_quench_blade_sunk',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
}));

/** The first wellspring at the foot of the Hearth's altar-stone (design doc
 *  7.4): spawned with the claim, its state in the template id (calm, the
 *  Hearth overflowing); the Guardian of the
 *  Heat stands half sunk in it (encounters/smith_heart/heat.ts). */
export const SMITH_HEART_WELL_OBJECT: DungeonObjectSpawn = {
  itemId: '',
  name: HEAT_NAMES.well,
  x: HEARTH_WELL.x,
  z: HEARTH_WELL.z,
  templateId: wellTemplate('calm') as 'sh_heat_well_calm',
  dungeonId: SMITH_HEART_DUNGEON,
  lootable: false,
};

// ---- the dungeon -------------------------------------------------------------------

/** The world entrance: a cleft at the foot of the Stormcrag cliffs, past the
 *  Stormcrag road's end north-east of Highwatch (placeholder door visual). */
export const SMITH_HEART_DOOR_POS = { x: 138, z: 756 } as const;

export const SMITH_HEART_DUNGEON_DEFS: Record<string, DungeonDef> = {
  [SMITH_HEART_DUNGEON]: {
    id: SMITH_HEART_DUNGEON,
    name: "The Smith's Heart",
    // Overflow band, the first free index after the Last Keep's family.
    index: 15,
    doorPos: SMITH_HEART_DOOR_POS,
    overworldDoor: SMITH_HEART_PLAYABLE,
    // The cliff rises east of the door: leaving sets the raid down on the
    // slope to the west, facing Highwatch.
    leaveOffset: { x: -4.5, z: 0 },
    // Phase 1 blockout: dev builds only (encounters/smith_heart/entry.ts) and
    // out of the public Guide until the raid ships.
    guideVisible: false,
    entry: { x: SMITH_HEART_ANCHORS.entry.x, z: SMITH_HEART_ANCHORS.entry.z },
    exitOffset: { x: SMITH_HEART_ANCHORS.exit.x, z: SMITH_HEART_ANCHORS.exit.z },
    // The Heart is a separate area reached only through the seal's portal: a
    // second exit opens on the Anvil of the World once the final boss falls.
    bossExitPortal: { x: HEART_ROOM.x + 20, z: HEART_ROOM.z + 20 },
    spawns: SMITH_HEART_SPAWNS,
    objects: [
      ...SMITH_HEART_GATE_OBJECTS,
      ...SMITH_HEART_SEAL_OBJECTS,
      ...SMITH_HEART_PILLAR_OBJECTS,
      SMITH_HEART_WIND_OBJECT,
      ...SMITH_HEART_BLADE_OBJECTS,
      SMITH_HEART_WELL_OBJECT,
    ],
    // Captain Thessaly at her post on the Cornice's climb (breath_thessaly.ts),
    // facing the guardian.
    npcs: [
      {
        npcId: BREATH_THESSALY_NPC,
        x: THESSALY_POST.x,
        z: THESSALY_POST.z,
        facing: Math.atan2(BREATH.cornice.x - THESSALY_POST.x, BREATH.cornice.z - THESSALY_POST.z),
      },
    ],
    gates: SMITH_HEART_GATES,
    // No bossChainPull: a raid holds five bosses, and a guardian pull that woke
    // every mob of the claim would drag the whole mountain onto the Quarry.
    areaCastsPlant: true,
    interior: 'smith_heart',
    suggestedPlayers: 10,
    enterText: 'The mountain hums around you, like a forge banked for the night...',
    leaveText: 'You climb back out into the Stormcrag wind.',
  },
};
