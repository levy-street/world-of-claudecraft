// Dawnhaven Isle - the starter-tutorial map.
//
// A small, self-contained island the client boots as an OFFLINE Sim (never the
// authoritative world): the player washes ashore on the south beach, walks up to
// the Warden on the north knoll, and works through the tutorial stations (the
// practice yard to the east, the wolf hollow to the west).
//
// This is data-as-code, exactly like a zone module, with one difference: the isle
// is NOT spread into the built-in world. It ships as its own `WorldContent`
// bundle (`DAWNHAVEN_WORLD`), which the Sim ctor reads through `SimConfig.world`
// and the terrain/renderer read through `setActiveWorldContent`. The live world's
// `CAMPS` / `ZONES` / `PROPS` arrays are untouched, so its rng draw order is
// unchanged (`tests/starter_tutorial_isolation.test.ts` pins that).
//
// Geometry: the zone declares one big "lake" (the sea) that carves the whole
// basin below the waterline; the terrain edits then raise the island back out of
// it, so the landmass is a dome ~45yd in radius with a sand shelf where the
// player lands. A ring of invisible blockers in the shallows keeps the player on
// the isle.

import type {
  BlockerDef,
  CampDef,
  GroundObjectDef,
  HeightStamp,
  MobTemplate,
  NpcDef,
  PlacedAsset,
  QuestDef,
  WorldContent,
  ZoneDef,
} from '../../types';
import { emptyZoneProps } from '../../types';

// The one seed the tutorial Sim always runs on: the isle must look and play the
// same for every player, every time (the terrain noise under the edits, the
// decoration scatter, and the wolf spawn positions all key off it).
export const DAWNHAVEN_SEED = 24601;

// Station anchors. Every placement, camp and NPC position below is authored
// relative to these, so moving a station moves its whole set piece.
export const DAWNHAVEN_LANDING = { x: 0, z: 40 }; // south beach: where the player wakes up
export const DAWNHAVEN_KNOLL = { x: 0, z: -26 }; // north: the Warden's shrine
export const DAWNHAVEN_YARD = { x: 26, z: 6 }; // east: the practice yard (dummies)
export const DAWNHAVEN_HOLLOW = { x: -26, z: 8 }; // west: the wolf hollow

// The invisible shoreline ring: blockers sit just past the sand, in ankle-deep
// water, so a player can walk the whole beach and wade a step without swimming
// off the map. 24 segments keeps each chord well under the sanitizer's length cap.
const SHORE_RADIUS = 52;
const SHORE_SEGMENTS = 24;

function shoreRing(): BlockerDef[] {
  const out: BlockerDef[] = [];
  for (let i = 0; i < SHORE_SEGMENTS; i++) {
    const a0 = (i / SHORE_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SHORE_SEGMENTS) * Math.PI * 2;
    out.push({
      x1: Math.cos(a0) * SHORE_RADIUS,
      z1: Math.sin(a0) * SHORE_RADIUS,
      x2: Math.cos(a1) * SHORE_RADIUS,
      z2: Math.sin(a1) * SHORE_RADIUS,
    });
  }
  return out;
}

export const DAWNHAVEN_BLOCKERS: BlockerDef[] = shoreRing();

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

// The "lake" IS the sea. Its job is the WATER SURFACE, and the size below is set by
// one hard constraint: the water shader clips to the DECLARED radius (not to the
// 1.65x blend footprint the sim's isInWaterBody uses), so this is literally how far
// out the ocean is drawn. It has to reach past the vale fog's far plane (340, see
// Renderer.BIOME_FOG) or the player sees the water simply stop, with bare seabed
// beyond it. 360 clears that with margin, and the horizon is haze.
const DAWNHAVEN_SEA = { x: 0, z: 0, radius: 360 };

// The floor of that ocean. Below the waterline (-4.5) by enough that the shallows
// read as shallows and the deep reads as deep.
const SEABED_Y = -9;

// How far out the seabed is levelled: far enough that NO natural terrain is ever
// drawable. This is deliberately way past the fog plane rather than just past it.
// The terrain view's cull is generous (whole chunks, not a hard radius), so a
// levelling radius merely a little beyond the fog still left the rim wall standing
// as a pale fogged silhouette on the horizon: fog fades geometry toward the fog
// COLOR, it does not remove it, so a "far enough to be fogged" wall is still a wall
// across the sky. The only fix is for the mountain not to exist within any distance
// the renderer will build a chunk for.
const SEA_RADIUS = 1000;

export const DAWNHAVEN_ZONE: ZoneDef = {
  id: 'dawnhaven_isle',
  name: 'Dawnhaven Isle',
  // A full-width band: the world rim (which keys off the band edges) then rises
  // far out in the water, reading as distant sea cliffs on the horizon rather
  // than a wall at the player's back.
  zMin: -180,
  zMax: 180,
  levelRange: [1, 3],
  biome: 'vale',
  hub: { x: 0, z: 0, radius: 22, name: 'Dawnhaven' },
  graveyard: { x: 0, z: 16 }, // the meadow: a tutorial death walks you back in seconds
  lakes: [DAWNHAVEN_SEA],
  pois: [
    { x: 0, z: 40, label: 'The Landing', id: 'dawnhaven_landing' },
    { x: 0, z: -26, label: "Warden's Rest", id: 'dawnhaven_knoll' },
    { x: 26, z: 6, label: 'The Practice Yard', id: 'dawnhaven_yard' },
    { x: -26, z: 8, label: 'Wolf Hollow', id: 'dawnhaven_hollow' },
  ],
  welcome: 'Warden Locke is waiting up the path.',
};

// ---------------------------------------------------------------------------
// Terrain: carve the island back out of the sea basin
// ---------------------------------------------------------------------------

export const DAWNHAVEN_TERRAIN: HeightStamp[] = [
  // OPEN SEA FIRST. The edit layer is applied LAST inside terrainHeight (after the
  // base noise, after the lake carve, and crucially after the world RIM), so one
  // flat level stamp here is what turns the surround into actual open water.
  //
  // Without it the isle is not an island: the built-in world's rim wall rises out
  // of the sea at |x| > 150 (the rim keys off the module-wide WORLD_MAX_X, not the
  // zone band, so a custom map cannot move it), and the terrain outside the lake's
  // footprint stays dry land. The player ends up in a pond ringed by a dark wall of
  // mountains and a far forest shore, about 100yd out. Levelling a wide disc to the
  // seabed deletes both. `flat` (full weight to the edge) rather than `smooth`
  // because a smooth taper would leave half a mountain standing at the rim; the
  // cliff that `flat` leaves at its own edge is parked past the fog (SEA_RADIUS).
  { x: 0, z: 0, radius: SEA_RADIUS, delta: SEABED_Y, falloff: 'flat', mode: 'level' },
  // The island dome. Levels the drowned basin up to +2.8 at the centre and eases
  // back down to the seabed by 82yd, which puts the waterline (and so the beach)
  // at roughly 45yd out.
  { x: 0, z: 0, radius: 82, delta: 2.8, falloff: 'smooth', mode: 'level' },
  // The central meadow: a gentle plateau so the hub reads as flat ground.
  { x: 0, z: 2, radius: 30, delta: 3.0, falloff: 'smooth', mode: 'level' },
  // The Warden's knoll: a rise you climb toward the shrine.
  { x: 0, z: -26, radius: 15, delta: 6.2, falloff: 'smooth', mode: 'level' },
  // The practice yard and the wolf hollow: flat enough to fight on.
  { x: 26, z: 6, radius: 13, delta: 2.9, falloff: 'smooth', mode: 'level' },
  { x: -26, z: 8, radius: 13, delta: 2.9, falloff: 'smooth', mode: 'level' },
  // The landing: a low sand shelf, still above the waterline, that slopes up into
  // the meadow (well inside the movement climb limit).
  { x: 0, z: 40, radius: 16, delta: -2.6, falloff: 'smooth', mode: 'level' },
  // Two crags that frame the knoll and stop the isle reading as a pudding bowl.
  { x: -36, z: -26, radius: 10, delta: 8, falloff: 'smooth', mode: 'add' },
  { x: 36, z: -24, radius: 9, delta: 7, falloff: 'smooth', mode: 'add' },
];

// ---------------------------------------------------------------------------
// NPC: the Warden
//
// `dynamic: true` means "registered, never surface-placed": the Sim's spawn loop
// skips her, which does double duty here.
//   1. It is what keeps her out of the LIVE world. `data.ts` merges this record
//      into the global `NPCS` table (so entity-name resolution and the quest
//      lookups find her by id), and the built-in world would otherwise spawn every
//      NPC in that table. This is the same device the Spirit Healer uses.
//   2. It is what lets the tutorial REVEAL her. She is staged in on cue by the
//      `wardenReveal` scene (src/game/tutorial_scenes.ts) when the player climbs
//      the knoll: the camera pushes in on the empty shrine and she materializes.
//
// So the isle's own WorldContent and the global registry share one record.
// ---------------------------------------------------------------------------

export const DAWNHAVEN_WARDEN_POS = { x: 0, z: -21 };

const WARDEN: NpcDef = {
  id: 'dawnhaven_warden',
  name: 'Warden Fenna Locke',
  title: 'Keeper of Dawnhaven',
  pos: DAWNHAVEN_WARDEN_POS,
  facing: Math.PI / 2, // looking south, down the path the player walks up
  color: 0xc8a24a,
  questIds: ['q_dawnhaven_wolves'],
  greeting: 'Up and breathing, $C? Good. The isle is patient, but the wolves are not.',
  dynamic: true,
};

export const DAWNHAVEN_NPCS: Record<string, NpcDef> = {
  dawnhaven_warden: WARDEN,
};

export const DAWNHAVEN_NPC_REGISTRY: Record<string, NpcDef> = DAWNHAVEN_NPCS;

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const DAWNHAVEN_MOBS: Record<string, MobTemplate> = {
  // The practice dummy the class challenges are fought against: inert, level 1
  // (so a fresh character's hit table against it is the normal one, not the
  // high-level miss wall), and far too much health to actually fell. `dummy: true`
  // spawns it WITHOUT drawing rng, which is what keeps the isle's spawn set
  // seed-stable no matter how many dummies the yard holds.
  dawnhaven_dummy: {
    id: 'dawnhaven_dummy',
    name: 'Practice Dummy',
    minLevel: 1,
    maxLevel: 1,
    family: 'humanoid',
    hpBase: 5000,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.0,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    // Player-sized, deliberately: a dummy that towers over a fresh level 1 reads as
    // a boss, not as a practice target.
    scale: 0.95,
    color: 0xb8924a,
    dummy: true,
    respawnSeconds: 10,
    xpMult: 0,
  },
  // The isle's one real enemy: a level 1-2 beast (it renders on the shared wolf
  // model through the `beast` family fallback, so it needs no new art). Loot is
  // deliberately a copper drop PLUS a common item, so the loot window has both
  // rows to teach.
  dawnhaven_strandwolf: {
    id: 'dawnhaven_strandwolf',
    name: 'Strand Wolf',
    minLevel: 1,
    maxLevel: 2,
    family: 'beast',
    hpBase: 34,
    hpPerLevel: 10,
    dmgBase: 2,
    dmgPerLevel: 1,
    attackSpeed: 2.0,
    armorPerLevel: 6,
    moveSpeed: 7,
    aggroRadius: 9,
    loot: [
      { copper: 12, chance: 1 },
      { itemId: 'wolf_fang', chance: 1 },
    ],
    scale: 0.9,
    color: 0x8a7a68,
    componentTags: ['hide', 'fang'],
  },
};

// ---------------------------------------------------------------------------
// Quest: the one real quest, so the tutorial teaches the actual accept ->
// kill -> turn-in loop against the shipping quest system rather than a mock.
// ---------------------------------------------------------------------------

export const DAWNHAVEN_QUESTS: Record<string, QuestDef> = {
  q_dawnhaven_wolves: {
    id: 'q_dawnhaven_wolves',
    name: "The Warden's Test",
    giverNpcId: 'dawnhaven_warden',
    turnInNpcId: 'dawnhaven_warden',
    text: 'Three strand wolves came in with the tide and they have been eyeing my goats ever since. Take the west path down into the hollow, $N, and show me what you learned in the yard.',
    completionText: 'Cleanly done. You are ready for a bigger island than mine.',
    objectives: [
      { type: 'kill', targetMobId: 'dawnhaven_strandwolf', count: 3, label: 'Strand Wolf slain' },
    ],
    xpReward: 120,
    copperReward: 60,
    itemRewards: {},
  },
};

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------

// Where the first wolf bursts out at the player. The `wolfReveal` scene stages a
// strand wolf HERE (not from a camp), on the near lip of the hollow, so the
// player's first real enemy arrives as a scripted moment rather than as something
// already standing in a field. The brush it explodes out of is placed at the same
// spot below.
// It sits on the meadow side of the hollow rather than inside it, far enough from
// the pack that no camp wolf is within its own aggro radius of the player while
// the reveal is playing (pinned by tests/starter_tutorial_isle.test.ts).
export const DAWNHAVEN_AMBUSH = { x: -14, z: 9 };

export const DAWNHAVEN_CAMPS: CampDef[] = [
  // The practice yard: three dummies in a row. Zero rng (see `dummy` above), so
  // their positions are exact and the class challenges always find a target.
  { mobId: 'dawnhaven_dummy', center: { x: 22, z: 2 }, radius: 0, count: 1 },
  { mobId: 'dawnhaven_dummy', center: { x: 26, z: 6 }, radius: 0, count: 1 },
  { mobId: 'dawnhaven_dummy', center: { x: 30, z: 10 }, radius: 0, count: 1 },
  // The wolf pack, set DEEP in the hollow (well past the ambush spot and past
  // their own 9yd aggro radius) so nothing wanders out and mugs the player during
  // the reveal cinematic. Four of them, so the 3-kill objective never dead-ends on
  // a respawn timer, and they are what respawns if the staged ambusher is missed.
  { mobId: 'dawnhaven_strandwolf', center: { x: -34, z: 10 }, radius: 7, count: 4 },
];

export const DAWNHAVEN_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Decoration: freely placed GLBs from the shipped asset catalogue.
//
// Rendered by the placed-asset instancer and (where `collideRadius` is set) fed
// to the sim's static colliders from the SAME record, so what you see is what you
// bump into. Paths are the catalogue's `/models/<category>/<name>.glb` form.
// ---------------------------------------------------------------------------

const M = '/models';

// Authoring sizes, and why this table has to exist.
//
// The placed-asset instancer (src/render/placed_assets.ts) normalizes every
// catalogue GLB by its LARGEST dimension: `norm = TARGET_HEIGHT / maxDim` with
// TARGET_HEIGHT = 2.2yd, and the record's `scale` multiplies THAT. So `scale: 1`
// does not mean "actual size", it means "2.2 yards along its longest axis", whatever
// the object is. Authored raw, an oak and a bedroll come out the same size.
//
// Worse, normalizing by the longest axis (not by height) means a wide, flat prop
// normalizes off its WIDTH, so height alone cannot give you a scale: a fern that is
// 0.84 tall and 2.83 wide needs a completely different multiplier than a column that
// is 1.0 tall and 0.3 wide, for the same finished height.
//
// So nothing here is authored in scale units. `place()` takes the height the prop
// should really stand, in yards, and inverts the instancer's math to get there,
// which needs both the source height and the source maxDim. Both are measured from
// the shipped GLBs and recorded below (they are meshopt-compressed, so they cannot
// be measured at test time without a GL context; `tests/starter_tutorial_isle.test.ts`
// instead pins that every placed path HAS an entry and that every finished height is
// in a sane band, which is what catches a stale row).
const PLACED_NORM_HEIGHT = 2.2;

interface AssetSize {
  /** Source-unit height of the GLB's bounding box. */
  h: number;
  /** Source-unit LONGEST axis, which is what the instancer normalizes by. */
  max: number;
}

const ASSET_SIZE: Record<string, AssetSize> = {
  'biome/beach_anchor': { h: 0.09, max: 0.95 },
  'biome/beach_barrel': { h: 0.66, max: 0.71 },
  'biome/beach_bone': { h: 3.43, max: 6.62 },
  'biome/beach_chest': { h: 0.88, max: 1.39 },
  'biome/beach_dock': { h: 3.01, max: 3.01 },
  'biome/beach_palm_1': { h: 2.69, max: 2.69 },
  'biome/beach_palm_2': { h: 2.69, max: 2.86 },
  'biome/beach_palm_3': { h: 3.59, max: 3.59 },
  'biome/beach_rock_sand_a': { h: 0.39, max: 0.56 },
  'biome/beach_rock_sand_b': { h: 0.45, max: 0.8 },
  'biome/beach_rock_sand_c': { h: 0.51, max: 0.78 },
  'biome/beach_rocks_1': { h: 0.41, max: 0.41 },
  'biome/beach_rocks_2': { h: 6.91, max: 8.0 },
  'biome/beach_ship': { h: 1.99, max: 5.15 },
  'biome/camp_bedroll': { h: 0.12, max: 0.61 },
  'biome/camp_fire_pit': { h: 0.11, max: 0.28 },
  'biome/camp_fishing_stand': { h: 0.28, max: 0.39 },
  'biome/camp_signpost': { h: 0.46, max: 0.46 },
  'biome/camp_tent': { h: 0.49, max: 0.56 },
  'biome/camp_tent_canvas': { h: 0.49, max: 0.56 },
  'biome/city_fence_wood': { h: 0.84, max: 2.06 },
  'biome/dungeon_banner': { h: 0.66, max: 0.66 },
  'biome/sea_rowboat_large': { h: 0.85, max: 2.85 },
  'foliage/bush': { h: 1.57, max: 1.7 },
  'foliage/bush_flowers': { h: 1.57, max: 1.9 },
  'foliage/fern': { h: 0.84, max: 2.83 },
  'foliage/mushroom': { h: 0.46, max: 0.78 },
  'foliage/oak_1': { h: 7.26, max: 7.26 },
  'foliage/oak_2': { h: 7.64, max: 7.64 },
  'foliage/oak_3': { h: 9.43, max: 9.43 },
  'foliage/oak_4': { h: 9.44, max: 9.44 },
  'foliage/oak_5': { h: 7.01, max: 7.01 },
  'foliage/pine_1': { h: 7.32, max: 7.32 },
  'foliage/pine_2': { h: 7.38, max: 7.38 },
  'foliage/pine_3': { h: 7.39, max: 7.39 },
  'foliage/pine_4': { h: 10.24, max: 10.24 },
  'foliage/pine_5': { h: 8.72, max: 8.72 },
  'foliage/rock_1': { h: 2.26, max: 3.23 },
  'foliage/rock_2': { h: 1.9, max: 3.05 },
  'foliage/rock_3': { h: 2.32, max: 3.48 },
  'props/anvil': { h: 0.56, max: 1.08 },
  'props/barrel': { h: 0.9, max: 0.9 },
  'props/bonfire': { h: 0.11, max: 0.41 },
  'props/cart': { h: 0.8, max: 0.93 },
  'props/column': { h: 1.0, max: 1.0 },
  'props/column_broken': { h: 0.7, max: 0.7 },
  'props/crate_wooden': { h: 0.93, max: 0.93 },
  'props/lantern_wall': { h: 1.34, max: 1.34 },
  'props/mushroom_red': { h: 0.2, max: 0.2 },
  'props/mushroom_tan': { h: 0.15, max: 0.22 },
  'props/rock_large_d': { h: 0.57, max: 1.07 },
  'props/rock_large_f': { h: 0.48, max: 1.1 },
  'props/rock_tall_a': { h: 1.0, max: 1.0 },
  'props/rock_tall_h': { h: 0.71, max: 0.71 },
  'props/statue_block': { h: 0.4, max: 0.4 },
  'props/timber_pillar': { h: 1.0, max: 1.0 },
  'props/weapon_stand': { h: 1.11, max: 1.39 },
  'props/well': { h: 1.25, max: 1.25 },
  'resources/containers_crate_medium_wood': { h: 0.45, max: 1.71 },
  'resources/food_barrel_fish': { h: 1.71, max: 1.71 },
  'resources/wood_log_stack': { h: 1.5, max: 1.68 },
  'resources/wood_planks_stack_medium': { h: 0.62, max: 1.67 },
  'tutorial/training_post': { h: 1.9, max: 1.9 },
};

/** Every asset the isle places, so a test can pin the table against the records. */
export const DAWNHAVEN_ASSET_SIZES: Readonly<Record<string, AssetSize>> = ASSET_SIZE;

function place(
  /** Catalogue id, e.g. "props/well". The `/models/...glb` path is derived. */
  id: string,
  x: number,
  z: number,
  rotY: number,
  /** How tall this prop should really stand, in yards. A player is about 1.8. */
  heightYd: number,
  collideRadius?: number,
): PlacedAsset {
  const size = ASSET_SIZE[id];
  if (!size) throw new Error(`Dawnhaven: no measured size for asset "${id}"`);
  // Invert the instancer: rendered height = h * (TARGET/max) * scale.
  const scale = (heightYd * size.max) / (PLACED_NORM_HEIGHT * size.h);
  const path = `${M}/${id}.glb`;
  return collideRadius === undefined
    ? { path, x, z, rotY, scale }
    : { path, x, z, rotY, scale, collideRadius };
}

/** The finished, in-world height of a placement record. The test asserts these all
 *  land in a believable band, which is what makes a stale ASSET_SIZE row fail. */
export function placedHeightYd(p: PlacedAsset): number {
  const id = p.path.replace(`${M}/`, '').replace('.glb', '');
  const size = ASSET_SIZE[id];
  if (!size) return Number.NaN;
  return (size.h * (PLACED_NORM_HEIGHT / size.max) * p.scale * 1000) / 1000;
}

// A ring of scattered props: `count` copies of the given paths stepped around a
// circle at a fixed angular offset. Pure trigonometry, no rng, so the layout is
// identical on every host.
function ring(
  paths: string[],
  radius: number,
  count: number,
  offset: number,
  heightYd: number,
  collideRadius?: number,
): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    out.push(
      place(
        paths[i % paths.length],
        Math.cos(a) * radius,
        Math.sin(a) * radius,
        a + Math.PI,
        heightYd,
        collideRadius,
      ),
    );
  }
  return out;
}

export const DAWNHAVEN_PLACEMENTS: PlacedAsset[] = [
  // --- The Landing (south beach): a wreck, a jetty, and the sign that points up
  // the path. This is the first thing the player sees on spawn.
  place('biome/beach_dock', 11, 44, Math.PI / 2, 3.2),
  place('biome/sea_rowboat_large', 17, 49, 2.4, 1.0),
  place('biome/beach_ship', -44, 62, 0.7, 4.0),
  place('biome/beach_anchor', -7, 43, 1.1, 0.25),
  place('biome/beach_barrel', -10, 41, 0.4, 1.0),
  place('biome/beach_chest', 5, 42, -0.6, 0.9),
  place('biome/beach_bone', -15, 45, 2, 1.6),
  place('biome/camp_signpost', 2.5, 31, Math.PI, 2.2, 0.4),
  place('biome/beach_rock_sand_a', 20, 40, 0.3, 0.8, 1.1),
  place('biome/beach_rock_sand_b', -20, 38, 1.9, 0.9, 1.5),
  place('biome/beach_rock_sand_c', 26, 33, 2.7, 0.8, 1.2),
  place('biome/beach_rocks_1', -26, 32, 0.8, 1.0, 1.0),
  place('biome/beach_rocks_2', 31, 26, 1.4, 2.6, 2.8),

  // Palms fringing the whole shoreline.
  ...ring(
    ['biome/beach_palm_1', 'biome/beach_palm_2', 'biome/beach_palm_3'],
    43,
    14,
    0.22,
    5.2,
    0.5,
  ),

  // --- The path up from the beach: lantern posts leading to the meadow.
  place('props/timber_pillar', -3.5, 26, 0, 2.6, 0.3),
  place('props/timber_pillar', 3.5, 26, 0, 2.6, 0.3),
  place('props/lantern_wall', -3.2, 26, 0, 1.1),
  place('props/lantern_wall', 3.2, 26, 0, 1.1),
  place('props/timber_pillar', -3.5, 16, 0, 2.6, 0.3),
  place('props/timber_pillar', 3.5, 16, 0, 2.6, 0.3),

  // --- The central meadow: the little camp the Warden keeps.
  place('props/well', -7, 3, 0, 1.9, 1.0),
  place('props/bonfire', 5, 5, 0, 0.5),
  place('biome/camp_tent', 10, -1, -0.9, 2.1, 1.2),
  place('biome/camp_tent_canvas', -12, -3, 1.2, 2.1, 1.2),
  place('biome/camp_bedroll', 7, 8, 0.5, 0.25),
  place('biome/camp_fire_pit', -4, 9, 0, 0.35),
  place('biome/camp_fishing_stand', -14, 12, 2.2, 1.2),
  place('resources/wood_log_stack', 12, 6, 0.8, 1.0, 0.6),
  place('resources/containers_crate_medium_wood', -9, -8, 0.3, 0.6, 0.7),
  place('resources/food_barrel_fish', -11, 13, 1.5, 1.1, 0.4),
  place('props/cart', 14, 12, 2.6, 1.5, 0.8),

  // --- The Warden's knoll: columns, banners, a shrine stone. (No stone arch: the
  // catalogue's city_arch is 0.06 source units deep, i.e. a flat billboard, and it
  // reads as a black rectangle stood on the grass from any angle but head-on.)
  place('props/column', -6, -19, 0, 3.0, 0.5),
  place('props/column', 6, -19, 0, 3.0, 0.5),
  place('props/column_broken', -8, -27, 0.4, 2.0, 0.5),
  place('props/column_broken', 8, -27, -0.4, 2.0, 0.5),
  place('biome/dungeon_banner', -4.5, -23, 0, 2.2),
  place('biome/dungeon_banner', 4.5, -23, 0, 2.2),
  place('props/statue_block', 0, -31, Math.PI, 1.8, 0.9),
  place('props/weapon_stand', -3, -19.5, 0.6, 1.2, 0.5),
  place('props/lantern_wall', -5.7, -19, 0, 1.1),
  place('props/lantern_wall', 5.7, -19, 0, 1.1),

  // --- The Practice Yard (east): fenced, with our generated straw posts standing
  // alongside the three dummy mobs. The posts sit clear of the mob positions
  // (22,2) / (26,6) / (30,10) so nothing renders inside a dummy.
  place('tutorial/training_post', 19, 6, 0.4, 1.9, 0.4),
  place('tutorial/training_post', 24, 11, -0.5, 1.9, 0.4),
  place('tutorial/training_post', 31, 4, 1.2, 1.9, 0.4),
  place('props/weapon_stand', 20, -1, 1.1, 1.2, 0.5),
  place('props/anvil', 33, 1, 0.2, 0.8, 0.6),
  place('props/crate_wooden', 34, 13, 0.9, 0.9, 0.5),
  place('props/barrel', 18, 12, 0, 1.0, 0.4),
  place('resources/wood_planks_stack_medium', 32, 16, 2.1, 0.5, 0.7),
  place('biome/city_fence_wood', 26, -3, 0, 1.1, 0.3),
  place('biome/city_fence_wood', 32, -1, 0.5, 1.1, 0.3),
  place('biome/city_fence_wood', 36, 7, Math.PI / 2, 1.1, 0.3),
  place('biome/city_fence_wood', 35, 15, Math.PI / 2, 1.1, 0.3),

  // --- The ambush brush: the thicket the first strand wolf explodes out of in the
  // `wolfReveal` scene. Deliberately collider-free (the wolf spawns inside it and
  // the player walks up to it) and flanked by ferns so the spot reads as cover.
  place('foliage/bush', DAWNHAVEN_AMBUSH.x, DAWNHAVEN_AMBUSH.z, 0.5, 1.9),
  place('foliage/fern', DAWNHAVEN_AMBUSH.x - 1.8, DAWNHAVEN_AMBUSH.z + 0.9, 1.7, 0.7),
  place('foliage/fern', DAWNHAVEN_AMBUSH.x + 1.6, DAWNHAVEN_AMBUSH.z - 1.1, 0.2, 0.7),
  place('foliage/bush_flowers', DAWNHAVEN_AMBUSH.x + 0.4, DAWNHAVEN_AMBUSH.z + 2.2, 2.5, 1.4),

  // --- Wolf Hollow (west): a little wood for the wolves to come out of.
  place('foliage/oak_1', -33, 2, 0.3, 8.0, 0.8),
  place('foliage/oak_2', -21, 0, 1.4, 7.5, 0.8),
  place('foliage/oak_3', -35, 14, 2.2, 9.0, 0.8),
  place('foliage/oak_4', -20, 17, 0.9, 8.5, 0.8),
  place('foliage/pine_1', -29, -6, 0, 8.5, 0.7),
  place('foliage/pine_2', -16, 8, 1.1, 7.5, 0.7),
  place('foliage/pine_3', -38, 6, 2.5, 8.0, 0.7),
  place('foliage/bush_flowers', -24, 12, 0.4, 1.4),
  place('foliage/bush', -30, 9, 1.8, 1.4),
  place('foliage/fern', -22, 5, 0.7, 0.7),
  place('foliage/fern', -28, 16, 2.9, 0.7),
  place('foliage/mushroom', -25, 3, 0, 0.5),
  place('props/mushroom_red', -31, 17, 1.2, 0.5),
  place('props/mushroom_tan', -18, 13, 2.4, 0.4),
  place('foliage/rock_1', -37, -2, 0.6, 1.8, 1.3),
  place('foliage/rock_2', -15, 18, 1.9, 1.6, 1.2),

  // --- The crags framing the knoll.
  place('props/rock_large_d', -36, -26, 0.5, 3.0, 2.6),
  place('props/rock_large_f', 36, -24, 2.1, 2.8, 2.6),
  place('props/rock_tall_a', -31, -33, 1.2, 3.4, 1.4),
  place('props/rock_tall_h', 30, -32, 2.8, 3.0, 1.2),

  // --- Trees and rocks scattered around the isle's rim, tying the stations into
  // one landmass and hiding the shoreline blockers behind something to look at.
  ...ring(
    ['foliage/oak_5', 'foliage/pine_4', 'foliage/oak_1', 'foliage/pine_5'],
    35,
    10,
    1.15,
    8.0,
    0.8,
  ),
  ...ring(['foliage/rock_3', 'foliage/rock_1', 'foliage/rock_2'], 39, 9, 0.55, 1.8, 1.3),
];

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

export const DAWNHAVEN_WORLD: WorldContent = {
  zones: [DAWNHAVEN_ZONE],
  camps: DAWNHAVEN_CAMPS,
  npcs: DAWNHAVEN_NPCS,
  groundObjects: DAWNHAVEN_OBJECTS,
  roads: [],
  props: emptyZoneProps(),
  playerStart: DAWNHAVEN_LANDING,
  terrainEdits: DAWNHAVEN_TERRAIN,
  placements: DAWNHAVEN_PLACEMENTS,
  blockers: DAWNHAVEN_BLOCKERS,
};
