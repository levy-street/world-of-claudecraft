// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';
import {
  type AuthoredDecor,
  type AuthoredDoor,
  type AuthoredRoom,
  authoredColliders,
  authoredLiftAt,
} from './rift/authored';

export type { AuthoredDecor, AuthoredDoor, AuthoredRoom };

/**
 * The per-slot dressing roll for a wall-side obstacle: the ONE draw both the
 * renderer (which prop fills the slot) and the collider builder (how tall the
 * standable top is) consume, so mesh and physics can never disagree. Same
 * stable sine hash the renderer's prop jitter has always used.
 */
export function tombSlotRoll(x: number, z: number): number {
  const s = Math.sin(x * 3.7 * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Shared structural constants (instance-local coordinates, y up, z into the
// dungeon). Values are frozen gameplay contracts: mob spawns and pathing
// assume these exact footprints.
export const DUNGEON_WALL_X = 23; // side wall centreline (|x|)
export const DUNGEON_WALL_HW = 1; // wall half thickness
/** Walkable half-width inside side-wall colliders (instance-local x). */
export const DUNGEON_WALK_HALF_X = DUNGEON_WALL_X - DUNGEON_WALL_HW;
export const DUNGEON_END_WALL_HW = 24; // front/back wall half width
export const PILLAR_COLLIDER_R = 1.0; // centre-aisle pillar obstacle radius
export const TOMB_HW = 1.1; // wall-side obstacle (sarcophagus/cargo) half extents
export const TOMB_HD = 2.1;
export const DUNGEON_WALL_HEIGHT = 8; // visual module height (2x KayKit 4u walls)
/**
 * Boss dais height (yards): the foundation blocks the renderer stacks are 2u
 * pieces at 0.3 y-scale. The SIM treats this as real elevation (the interior
 * floor rises by it inside the dais radius, see `daisLiftAt`), so the boss
 * stands ON the stage instead of knee-deep in it, and a player strides up the
 * rim exactly like an open-world kerb (it sits inside MAX_STEP_HEIGHT).
 */
export const DAIS_HEIGHT = 0.6;

/**
 * Standable tops for the wall-side obstacle slots, measured from the shipped
 * dungeon-kit GLBs at the exact scales `render/dungeon.ts` places them
 * (gltf-transform dequantized bounds), so the surface a body lands on IS the
 * silhouette it sees. Per-slot variety keys off the SAME `hash2(x * 3.7, z)`
 * draw the renderer uses to pick the prop, so collider and mesh can never
 * disagree about which piece fills a slot.
 */
// Hollow Crypt / Nythraxis corners: coffin lids are HUMPS, not slabs. The
// plain coffin (1.322 native x 1.3 y-scale) crests 1.72 along its centre
// line and falls to a 1.10 plinth at the sides; the decorated one crests
// 1.17 over a 0.71 plinth. Ridge runs along the coffin's LENGTH (local z).
export const TOMB_COFFIN_PLAIN_TOP = 1.72;
export const TOMB_COFFIN_PLAIN_EAVE = 1.1;
export const TOMB_COFFIN_DECORATED_TOP = 1.17;
export const TOMB_COFFIN_DECORATED_EAVE = 0.71;
// Sunken Bastion cargo. The stacks are TWO TIERS, a natural staircase: a
// broad lower tier at stride-up height from the floor's jump, then a smaller
// top crate a stride above it (crates_stacked: 1.35 then 2.14 at 1.0 scale;
// box_stacked: 1.20 then 1.99 at 0.6). Tier offsets are the measured GLB
// top-crate centres. Rear casks: barrel_large 1.70 tall x 0.76 half-width at
// 0.85, keg 1.85 x 0.81 at 0.9 (radii trimmed slightly, as everywhere).
export const TOMB_CARGO_STACK_TOP = 2.14;
export const TOMB_CARGO_STACK_TIER = 1.35;
export const TOMB_CARGO_BOX_TOP = 1.99;
export const TOMB_CARGO_BOX_TIER = 1.2;
export const TOMB_CARGO_BARREL_TOP = 1.7;
export const TOMB_CARGO_KEG_TOP = 1.85;
export const TOMB_CARGO_STACK_HW = 1.0;
export const TOMB_CARGO_BARREL_R = 0.7;
export const TOMB_CARGO_KEG_R = 0.75;
/** Top-crate footprint and centre offset within each stack (GLB-measured,
 *  scaled): [dx, dz, halfW, halfD]. */
export const TOMB_CARGO_STACK_TIER2 = [-0.15, -0.38, 0.5, 0.33] as const;
export const TOMB_CARGO_BOX_TIER2 = [-0.48, -0.21, 0.21, 0.11] as const;

/**
 * How a dungeon dresses its wall-side obstacle slots, and therefore what the
 * matching colliders look like. `coffins` slots are a single standable lid;
 * `cargo` slots split into the crate stack and the cask the renderer actually
 * draws; absent, the slot stays the legacy full-height block (the temple's
 * candle shrines are altars, not furniture).
 */
export type TombDressing = 'coffins' | 'cargo';

export interface GridPoint {
  x: number;
  z: number;
}

export interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DungeonLayout {
  /** front wall centreline (entrance end) */
  zMin: number;
  /** back wall centreline (boss end) */
  zMax: number;
  /** side-wall collider slab: z CENTRELINE of the slab's run (matches the
   *  legacy hand-authored extents) */
  sideWallZ: number;
  /** side-wall collider slab: z half-DEPTH of the slab's run. Despite the
   *  similar name this is a z extent, not an x one: the slab's |x| position
   *  comes from wallX / DUNGEON_WALL_X. A room can grow its sideWallHd (a
   *  longer wall) while its wallX stays frozen. */
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
  /**
   * True when the renderer stacks the DAIS_HEIGHT foundation platform on the
   * dais: the sim's interior floor rises to match (`daisLiftAt`). Absent on
   * the flat fighting floors (arena, the Nythraxis raid).
   */
  daisRaised?: boolean;
  /** Optional room width override for oversized rooms. Defaults to the classic crypt width. */
  wallX?: number;
  endWallHw?: number;
  floorHalfX?: number;
  /** entrance archway z position; renderer places gate props here when set */
  doorZ?: number;
  /** floor scatter positions, renderer places props here AND collision circles back them */
  clutter?: GridPoint[];
  /** Illusion (fake) walls: rendered as solid wall panels but NOT backed by a
   * collider (deliberately excluded from layoutColliders), so the player walks
   * THROUGH them into a hidden pocket. Used by rifts to conceal off-path treasure. */
  illusionWalls?: WallStub[];
  /** Room shell outline (CCW, simple, star-shaped from `shellPole`), instance-local.
   * When present, render/collision derive the room's walls and floor mask from this
   * polygon instead of the rectangular wallX/zMin/zMax shell. */
  shellPolygon?: Array<{ x: number; z: number }>;
  /** Star-shaping pole paired with `shellPolygon` (see geometry2d.polygonIsStarShaped). */
  shellPole?: { x: number; z: number };
  /** AUTHORED room-graph floors (the hand-built set-piece rifts): a set of
   * axis-aligned rooms joined by `doors`, with `decor` props placed by hand. When
   * present it REPLACES the rectangular/polygon shell entirely: walls, collision,
   * and the rendered modules all derive from these three fields (see rift/authored.ts). */
  rooms?: AuthoredRoom[];
  doors?: AuthoredDoor[];
  decor?: AuthoredDecor[];
}

// The four hand-authored KayKit interior "kits" a procedural rift can build on.
// A rift floor picks one kit for its module geometry (wall/floor/prop mesh mix)
// and then RE-GRADES it with generated torch colour, fog, and material tints, so
// the same kit reads as a different environment each run. This mirrors how the
// Drowned Litany delve already re-tints the crypt kit into a marsh (marshMaterial
// in render/dungeon.ts); InteriorStyle just makes that tinting data-driven.
export type InteriorKit = 'crypt' | 'bastion' | 'sanctum' | 'temple';

/** A generated re-grade of one of the four KayKit interior kits. Sim-layer data
 * (no Three imports); the renderer reads it in DungeonInteriors.build and the fog
 * pass, and the colliders never look at it (geometry comes from the DungeonLayout).
 * All colour fields are 0xRRGGBB. When a field is omitted the renderer falls back
 * to the kit's hand-authored default, so an empty style renders as the base kit. */
export interface InteriorStyle {
  /** Which hand-authored kit supplies the wall/floor/prop mesh mix. */
  kit: InteriorKit;
  /** Torch flame / emissive / point-light colours (replaces TORCH_COLORS[kit]). */
  torch: { flame: number; emissive: number; light: number };
  /** Scene fog while inside this floor (replaces the renderer's fogState switch). */
  fog: { color: number; near: number; far: number };
  /** Multiplicative material tints, exactly like MARSH_WALL_TINT/MARSH_FLOOR_TINT.
   * Omit for the kit's untinted stone. */
  wallTint?: number;
  floorTint?: number;
  /** Whether the boss dais is a raised platform (as sanctum/temple) or flush. */
  daisRaised?: boolean;
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// The Hollow Crypt / Sunken Bastion room (both DungeonDef.interior 'crypt'):
// one long nave, z -19..112, pillar rows at +-14, sarcophagi at +-19.
export const CRYPT_LAYOUT: DungeonLayout = {
  zMin: -19,
  zMax: 112,
  sideWallZ: 47,
  sideWallHd: 66,
  pillars: grid(10, 100, 15, [-14, 14]),
  tombs: grid(16, 92, 19, [-19, 19]),
  stubs: [],
  dais: { x: 0, z: 96, r: 9.5 },
  daisRaised: true,
};

// Gravewyrm Sanctum: a stretched three-chamber crypt (z -19..158) with
// narrowed waists at z 67/115 leaving a ~10u centre passage at |x| <= 5.
export const SANCTUM_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 67, hw: 9, hd: 5 }); // Boneworks -> Korgath's Hall
    stubs.push({ x: sx, z: 115, hw: 9, hd: 3 }); // Ritual Vault -> Wyrm's Hollow
  }
  return {
    zMin: -19,
    zMax: 158,
    sideWallZ: 69.5,
    sideWallHd: 89,
    pillars,
    tombs: [],
    stubs,
    dais: { x: 0, z: 146, r: 11.5 },
    daisRaised: true,
  };
})();

// Nythraxis' Abandoned Crypt raid room: a long dark nave ending in one large
// fighting arena. It stays within the shared wall-width contract, but leaves the
// central floor open so ten players can spread, stack, and reach three wardstones.
export const NYTHRAXIS_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [18, 38, 60, 82, 106]) {
    for (const x of [-90, -45, 45, 90]) pillars.push({ x, z });
  }
  return {
    zMin: -19,
    zMax: 126,
    sideWallZ: 53.5,
    sideWallHd: 73,
    wallX: 230,
    endWallHw: 231,
    floorHalfX: 228,
    pillars,
    tombs: [
      { x: -210, z: 20 },
      { x: 210, z: 20 },
      { x: -210, z: 42 },
      { x: 210, z: 42 },
      { x: -210, z: 64 },
      { x: 210, z: 64 },
    ],
    stubs: [],
    dais: { x: 0, z: 96, r: 13.5 },
  };
})();

// The Drowned Temple (interior 'temple'): a two-part flooded temple — a long
// antechamber, a single chamber-waist arch at z 66 (10u centre passage), then
// the moon-sanctum with Ysolei's great altar dais. Side walls at |x|=23 like
// the crypt so the KayKit wall modules fit unchanged; wall-side slots carry
// drowned reliquary altars instead of sarcophagi.
export const TEMPLE_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 80, 95, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 66, hw: 9, hd: 4 }); // antechamber -> moon-sanctum
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 75.5,
    pillars,
    tombs: grid(18, 40, 22, [-19, 19]), // reliquary altars hugging the antechamber walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
    daisRaised: true,
  };
})();

// The Last Keep (interior 'lastkeep'): a zero-combat castle interior in the
// Drakelands, built on the AUTHORED room-graph path (rooms + doors + decor
// replace the rectangular shell entirely, exactly like the Infernal Citadel).
// A walkable set piece: no spawns, no loot, just the keep itself.
//
//   z increases NORTH. The player enters at the south end of the entrance hall.
//   THREE STORIES, expressed as adjacent room groups at three lift bands (the
//   lift field is single-valued, so stories are side-by-side in plan and the
//   stair rooms between them are the "staircases"). Negative lifts are
//   unsupported by the render relief path, so the undercroft sits at 0 and
//   everything above is raised:
//     STORY 0, the undercroft   lift 0    gaol + 3 cells, vaulted storeroom,
//                                          wine cellar (the only dungeon story)
//     gaol stair (half landing) lift 1.5  entrance hall -> gaol
//     STORY 1, the state floor  lift 3.0  entrance hall, guard room + armory,
//                                          great (feast) hall, walled throne
//                                          room, ballroom, kitchen + pantry,
//                                          steward's office, dining parlor,
//                                          council, treasury
//     throne dais               lift 4.2  (+1.2 over the throne room)
//     grand + servants' stairs  lift 4.5  two half landings, so story 2 loops
//     STORY 2, the residence    lift 6.0  long gallery, library, royal chamber,
//                                          three guest chambers, solar, chapel,
//                                          servants' quarters
//     tower stair, the lookout  lift 7.5 / 9.0  continuing above story 2
//   Every lift change happens across a door, so authoredLiftAt turns each one
//   into a stair ramp shared by sim and render. Each 1.5 step ramps over a 6yd
//   band (doorRampHalf), slope 0.25, far under PLAYER_MAX_CLIMB_SLOPE (1.5).
//
// Decor uses ONLY the keys the authored/rift decor renderer already handles
// (src/render/rift_decor.ts DECOR_MODELS + the procedural 'pentagram'/'rug').
// The cage/bone dressing is confined to the undercroft (the dungeon story);
// stories 1 and 2 carry braziers, statues, rugs, the throne, the treasury
// plinth, and the council crest, and the WARM furnishing (beds, tables,
// chairs, bookcases, buffet counters, candle rows, kegs, banners, mounted
// torches) is instanced by the renderer's lastkeep dressing pass
// (src/render/lastkeep_dressing.ts) from these same room rects. Collision
// radii are the footprints measured from the built GLBs (the same constants
// the Infernal Citadel uses), so colliders match models.

const KEEP_R_BRAZIER = 0.85;
const KEEP_R_STATUE = 0.75;
const KEEP_R_FORGE = 1.3;
const KEEP_R_CAULDRON = 0.7;
const KEEP_R_CAGE = 1.0;
const KEEP_R_BONES = 0.5;
const KEEP_R_THRONE = 0.83;
const KEEP_R_ALTAR = 1.0; // 0.8 base footprint x the 1.2 scale below

export const KEEP_STORY1_LIFT = 3.0; // the state floor
export const KEEP_STORY2_LIFT = 6.0; // the residence floor
const KEEP_STAIR_DOWN = 1.5; // half landing between story 1 and the undercroft
const KEEP_STAIR_UP = 4.5; // half landing between story 1 and story 2

const keepBrazier = (x: number, z: number): AuthoredDecor => ({
  key: 'infernal_brazier',
  x,
  z,
  yaw: 0,
  r: KEEP_R_BRAZIER,
});

export const LASTKEEP_ROOMS: readonly AuthoredRoom[] = [
  // STORY 1, the state floor (lift 3.0).
  { id: 'hall_entrance', x0: -10, x1: 12, z0: -16, z1: 8, lift: KEEP_STORY1_LIFT },
  // The garrison wing flanks the entrance: the guard room watches the door,
  // the armory behind it opens onto the ballroom's service side.
  { id: 'guard_room', x0: -24, x1: -10, z0: -14, z1: 4, lift: KEEP_STORY1_LIFT },
  { id: 'armory', x0: -24, x1: -14, z0: 4, z1: 18, lift: KEEP_STORY1_LIFT },
  { id: 'great_hall', x0: -14, x1: 14, z0: 8, z1: 40, lift: KEEP_STORY1_LIFT }, // the feast hall
  // The walled throne room north of the feast hall, its dais raised +1.2
  // behind a wide ceremonial stair.
  { id: 'throne_room', x0: -14, x1: 14, z0: 40, z1: 56, lift: KEEP_STORY1_LIFT },
  { id: 'throne_dais', x0: -7, x1: 7, z0: 56, z1: 62, lift: KEEP_STORY1_LIFT + 1.2 },
  { id: 'ballroom', x0: -38, x1: -14, z0: 18, z1: 44, lift: KEEP_STORY1_LIFT },
  { id: 'kitchen', x0: -38, x1: -24, z0: 44, z1: 58, lift: KEEP_STORY1_LIFT },
  { id: 'pantry', x0: -24, x1: -14, z0: 46, z1: 56, lift: KEEP_STORY1_LIFT },
  // The east service rooms off the feast hall: the steward's office and the
  // crown's private dining parlor.
  { id: 'steward_office', x0: 14, x1: 22, z0: 10, z1: 20, lift: KEEP_STORY1_LIFT },
  { id: 'dining_parlor', x0: 14, x1: 22, z0: 22, z1: 36, lift: KEEP_STORY1_LIFT },
  { id: 'council', x0: 14, x1: 32, z0: 42, z1: 56, lift: KEEP_STORY1_LIFT },
  { id: 'treasury', x0: 32, x1: 42, z0: 44, z1: 54, lift: KEEP_STORY1_LIFT },
  // STORY 2, the residence floor (lift 6.0), reached by TWO stair rooms (the
  // grand stair off the council and the servants' stair off the kitchen), so
  // the residence loops back to the state floor on both wings.
  { id: 'stair_grand', x0: 14, x1: 24, z0: 56, z1: 66, lift: KEEP_STAIR_UP },
  { id: 'stair_servants', x0: -34, x1: -24, z0: 58, z1: 68, lift: KEEP_STAIR_UP },
  { id: 'gallery', x0: -24, x1: 24, z0: 66, z1: 78, lift: KEEP_STORY2_LIFT }, // the long gallery
  { id: 'royal_chamber', x0: -42, x1: -24, z0: 68, z1: 84, lift: KEEP_STORY2_LIFT },
  // The bedrooms wing: three guest chambers off the gallery's north side, and
  // the servants' quarters tucked beside their stair.
  { id: 'guest_west', x0: -24, x1: -17, z0: 78, z1: 90, lift: KEEP_STORY2_LIFT },
  { id: 'guest_mid', x0: -17, x1: -10, z0: 78, z1: 90, lift: KEEP_STORY2_LIFT },
  { id: 'guest_east', x0: 8, x1: 24, z0: 78, z1: 90, lift: KEEP_STORY2_LIFT },
  { id: 'servants_quarters', x0: -42, x1: -34, z0: 58, z1: 68, lift: KEEP_STORY2_LIFT },
  { id: 'solar', x0: -8, x1: 8, z0: 78, z1: 90, lift: KEEP_STORY2_LIFT },
  // The keep's private chapel, north of the solar at the residence's far end.
  { id: 'chapel', x0: -8, x1: 8, z0: 90, z1: 100, lift: KEEP_STORY2_LIFT },
  { id: 'library', x0: 24, x1: 42, z0: 60, z1: 80, lift: KEEP_STORY2_LIFT },
  // The watch tower continues above the residence: stair turret, then the
  // open lookout at the keep's highest point.
  { id: 'tower_mid', x0: 28, x1: 38, z0: 80, z1: 90, lift: KEEP_STORY2_LIFT + 1.5 },
  { id: 'tower_lookout', x0: 28, x1: 38, z0: 90, z1: 100, lift: KEEP_STORY2_LIFT + 3.0 },
  // STORY 0, the undercroft: a half landing steps down off the entrance hall,
  // then the gaol corridor at the keep's lowest level with three cell alcoves
  // off its east wall, and the vaulted stores north of the gaol.
  { id: 'gaol_stair', x0: 12, x1: 22, z0: -10, z1: 0, lift: KEEP_STAIR_DOWN },
  { id: 'gaol', x0: 22, x1: 30, z0: -16, z1: 16 }, // lift 0: the bottom of the keep
  { id: 'cell_north', x0: 30, x1: 38, z0: 4, z1: 11 },
  { id: 'cell_mid', x0: 30, x1: 38, z0: -5, z1: 2 },
  { id: 'cell_south', x0: 30, x1: 38, z0: -14, z1: -7 },
  { id: 'storeroom', x0: 22, x1: 38, z0: 16, z1: 30 }, // the vaulted storeroom
  { id: 'wine_cellar', x0: 22, x1: 38, z0: 30, z1: 42 },
];

export const LASTKEEP_DOORS: readonly AuthoredDoor[] = [
  // The state floor.
  { x: 0, z: 8, hw: 3.5, hd: 1 }, // entrance hall -> great (feast) hall
  { x: -10, z: -5, hw: 1, hd: 1.4 }, // entrance hall -> guard room
  { x: -19, z: 4, hw: 2, hd: 1 }, // guard room -> armory
  { x: -19, z: 18, hw: 2, hd: 1 }, // armory -> ballroom (the garrison's service door)
  { x: -14, z: 31, hw: 1, hd: 3 }, // great hall -> ballroom
  { x: 0, z: 40, hw: 3.5, hd: 1 }, // great hall -> throne room (the processional arch)
  { x: 0, z: 56, hw: 4.5, hd: 1 }, // throne room -> throne dais (wide stair, +1.2)
  { x: 14, z: 15, hw: 1, hd: 1.4 }, // great hall -> steward's office
  { x: 14, z: 24, hw: 1, hd: 1.4 }, // great hall -> dining parlor
  { x: 14, z: 45, hw: 1, hd: 1.4 }, // throne room -> council chamber
  { x: -31, z: 44, hw: 2.5, hd: 1 }, // ballroom -> kitchen
  { x: -24, z: 51, hw: 1, hd: 2 }, // kitchen -> pantry
  { x: 32, z: 49, hw: 1, hd: 1.2 }, // council -> treasury (the narrow "locked" vault door)
  // Up to the residence: two separate stairs so story 2 loops.
  { x: 19, z: 56, hw: 2, hd: 1 }, // council -> grand stair (+1.5)
  { x: 19, z: 66, hw: 2, hd: 1 }, // grand stair -> gallery (+1.5)
  { x: -29, z: 58, hw: 2, hd: 1 }, // kitchen -> servants' stair (+1.5)
  { x: -29, z: 68, hw: 2, hd: 1 }, // servants' stair -> royal chamber (+1.5)
  { x: -34, z: 63, hw: 1, hd: 1.2 }, // servants' stair -> servants' quarters (+1.5)
  // The residence floor.
  { x: -24, z: 73, hw: 1, hd: 2 }, // royal chamber -> gallery
  { x: 0, z: 78, hw: 2.5, hd: 1 }, // gallery -> solar
  { x: 24, z: 72, hw: 1, hd: 2.5 }, // gallery -> library
  { x: -20.5, z: 78, hw: 1.2, hd: 1 }, // gallery -> west guest chamber
  { x: -13.5, z: 78, hw: 1.2, hd: 1 }, // gallery -> middle guest chamber
  { x: 16, z: 78, hw: 1.2, hd: 1 }, // gallery -> east guest chamber
  { x: 0, z: 90, hw: 1.5, hd: 1 }, // solar -> chapel
  // The watch tower above the residence.
  { x: 33, z: 80, hw: 2, hd: 1 }, // library -> tower stair (+1.5)
  { x: 33, z: 90, hw: 2, hd: 1 }, // tower stair -> lookout (+1.5)
  // Down to the undercroft.
  { x: 12, z: -5, hw: 1, hd: 1.5 }, // entrance hall -> gaol stair (down, -1.5)
  { x: 22, z: -5, hw: 1, hd: 1.5 }, // gaol stair -> gaol corridor (down, -1.5)
  { x: 30, z: 7.5, hw: 1, hd: 1.2 }, // gaol -> north cell
  { x: 30, z: -1.5, hw: 1, hd: 1.2 }, // gaol -> middle cell
  { x: 30, z: -10.5, hw: 1, hd: 1.2 }, // gaol -> south cell
  { x: 26, z: 16, hw: 2, hd: 1 }, // gaol -> vaulted storeroom
  { x: 30, z: 30, hw: 2.5, hd: 1 }, // storeroom -> wine cellar
];

export const LASTKEEP_DECOR: readonly AuthoredDecor[] = [
  // ---- STORY 1, the state floor (warm torchlight; the renderer's lastkeep
  // dressing adds the banners, mounted torches, and furniture) ----
  // Entrance hall: lit threshold, sentinel statues flanking the inner door.
  keepBrazier(-7, -13),
  keepBrazier(9, -13),
  { key: 'infernal_statue', x: -5, z: 6, yaw: Math.PI, r: KEEP_R_STATUE },
  { key: 'infernal_statue', x: 5, z: 6, yaw: Math.PI, r: KEEP_R_STATUE },
  // Guard room: watch-fire by the door, one in the bunk corner.
  keepBrazier(-22.5, -12.5),
  keepBrazier(-11.8, 2.4),
  // Armory: racks and crates come from the dressing pass; two work fires.
  keepBrazier(-16.2, 9.5),
  keepBrazier(-15.8, 16.3),
  // Great hall: a processional rug up the spine toward the throne room arch,
  // brazier colonnade lines down both long walls.
  { key: 'rug', x: 0, z: 26, yaw: 0 },
  keepBrazier(-11, 14),
  keepBrazier(11, 14),
  keepBrazier(-11, 26),
  keepBrazier(11, 26),
  keepBrazier(-11, 38),
  keepBrazier(11, 38),
  // Throne room: honor-guard statues inside the arch, corner braziers, and a
  // wide court carpet before the dais stair (the candle rows are dressing).
  { key: 'infernal_statue', x: -8, z: 43, yaw: Math.PI / 2, r: KEEP_R_STATUE },
  { key: 'infernal_statue', x: 8, z: 43, yaw: -Math.PI / 2, r: KEEP_R_STATUE },
  { key: 'rug', x: 0, z: 49, yaw: Math.PI / 2 },
  keepBrazier(-12, 42),
  keepBrazier(12, 42),
  keepBrazier(-12, 54),
  keepBrazier(12, 54),
  // Throne dais: the throne against the north wall, facing down the hall.
  { key: 'bone_throne', x: 0, z: 60.2, yaw: Math.PI, r: KEEP_R_THRONE },
  keepBrazier(-5, 60.6),
  keepBrazier(5, 60.6),
  // Ballroom: an open dance floor ringed by firelight and statuary (the
  // buffet counters, wall benches, and candle rows are dressing).
  keepBrazier(-35, 21),
  keepBrazier(-16.8, 23),
  keepBrazier(-35, 41),
  keepBrazier(-17, 41),
  { key: 'infernal_statue', x: -36.5, z: 20.2, yaw: Math.PI / 2, r: KEEP_R_STATUE },
  { key: 'infernal_statue', x: -26, z: 42, yaw: Math.PI, r: KEEP_R_STATUE },
  // Kitchen: the great hearth on the west wall, the cook's cauldron beside it.
  { key: 'hell_forge', x: -35.5, z: 51.5, yaw: Math.PI / 2, r: KEEP_R_FORGE },
  { key: 'slag_cauldron', x: -34, z: 48.5, yaw: 0.6, r: KEEP_R_CAULDRON },
  keepBrazier(-26, 45.5),
  // Pantry: the hanging larder cage among the stores.
  { key: 'hanging_cage', x: -17, z: 53, yaw: 0.4, r: KEEP_R_CAGE },
  keepBrazier(-16.5, 47.5),
  // Steward's office and the private dining parlor: quiet hearth-light.
  keepBrazier(16, 18.5),
  keepBrazier(20.8, 23.5),
  keepBrazier(15.5, 34.5),
  // Council chamber: the royal crest inlaid in the floor beneath the council
  // table, corner braziers.
  { key: 'pentagram', x: 23, z: 48, yaw: 0, scale: 4.5 },
  keepBrazier(16.5, 43),
  keepBrazier(30, 44),
  keepBrazier(16, 52),
  keepBrazier(30, 52),
  // Treasury: the vault plinth, lit; the renderer adds the gold chest.
  { key: 'infernal_altar', x: 37, z: 51, yaw: 0, scale: 1.2, r: KEEP_R_ALTAR },
  keepBrazier(34, 52.5),
  keepBrazier(40, 45.5),
  // ---- STORY 2, the residence floor ----
  keepBrazier(15.8, 61), // grand stair landing
  keepBrazier(-25.8, 63), // servants' stair landing
  // The long gallery: a runner rug, firelight, and ancestor statues.
  { key: 'rug', x: 0, z: 72, yaw: Math.PI / 2 },
  keepBrazier(-18, 68),
  keepBrazier(14, 68),
  keepBrazier(-18, 74.5),
  keepBrazier(14, 74.5),
  { key: 'infernal_statue', x: -9, z: 76.5, yaw: Math.PI, r: KEEP_R_STATUE },
  { key: 'infernal_statue', x: 8, z: 76.5, yaw: Math.PI, r: KEEP_R_STATUE },
  // Royal chamber, guest chambers, servants' quarters, solar, library:
  // hearth-light; the beds, shelves, and tables come from the dressing pass.
  // The chapel alone is candle-lit (its shrine and candle rows are dressing).
  keepBrazier(-40, 70),
  keepBrazier(-26, 82),
  keepBrazier(-20.5, 80.6),
  keepBrazier(-11.3, 84.5),
  keepBrazier(22.5, 88.5),
  keepBrazier(-36, 59.8),
  keepBrazier(-6, 88),
  keepBrazier(6, 88),
  keepBrazier(33, 62.5),
  // The watch tower: a light per landing; the lookout brazier is the beacon.
  keepBrazier(36.5, 88),
  keepBrazier(33, 97),
  // ---- STORY 0, the undercroft: the ONLY dungeon-flavored story (cages,
  // bones, cold light) ----
  keepBrazier(17, -8.5), // the gaol stair landing
  keepBrazier(24, -14),
  keepBrazier(29, 12),
  { key: 'hanging_cage', x: 26, z: -12, yaw: 0.3, r: KEEP_R_CAGE },
  { key: 'bone_pile', x: 23.5, z: 4, yaw: 2.8, r: KEEP_R_BONES },
  { key: 'bone_pile', x: 34, z: -10.5, yaw: 0.5, r: KEEP_R_BONES },
  { key: 'bone_pile', x: 34, z: -1, yaw: 1.7, r: KEEP_R_BONES },
  { key: 'bone_pile', x: 34, z: 7.5, yaw: 2.9, r: KEEP_R_BONES },
  // The vaulted storeroom and wine cellar (kegs and barrels come from the
  // renderer's dressing pass; the braziers keep the vaults readable).
  keepBrazier(36, 18),
  { key: 'bone_pile', x: 24, z: 27, yaw: 0.8, r: KEEP_R_BONES },
  keepBrazier(36, 40),
  keepBrazier(24, 32),
];

export const LASTKEEP_LAYOUT: DungeonLayout = {
  zMin: -16,
  zMax: 100,
  sideWallZ: 42,
  sideWallHd: 58,
  pillars: [],
  tombs: [],
  stubs: [],
  // The dais marker sits under the lifted throne-dais room: placeDais' platform
  // blocks and rim decor (drawn from y 0) are entirely buried inside the room's
  // solid riser, so the authored dais room IS the visible boss-stage geometry.
  dais: { x: 0, z: 59, r: 4 },
  wallX: 42,
  endWallHw: 43,
  floorHalfX: 42,
  rooms: LASTKEEP_ROOMS.map((r) => ({ ...r })),
  doors: LASTKEEP_DOORS.map((d) => ({ ...d })),
  decor: LASTKEEP_DECOR.map((d) => ({ ...d })),
};

/** Raised-floor height of The Last Keep at instance-local (x, z). The
 * groundHeight arm for interior 'lastkeep' (src/sim/world.ts) reads this, the
 * same per-interior relief idiom as orkadiaFieldHeight/wildheartFieldHeight, so
 * players stand on the same lifts the renderer builds risers and stairs for. */
export function lastKeepLiftAt(lx: number, lz: number): number {
  return authoredLiftAt(LASTKEEP_ROOMS, LASTKEEP_DOORS, lx, lz);
}

// The Ashen Coliseum (interior 'arena'): a fully-enclosed pit, no door, no
// aisle (combatants are teleported in by matchmaking). Side walls stay at
// |x|=23 like the crypt so the KayKit wall modules fit unchanged; the pit
// grows along z only, tuned for 1v1/2v2 (deliberately NOT large). The dais
// marker only drives the central floor glow (the renderer skips its platform
// for the arena), so the ring itself stays flat.
// Cover intent: an approach screen in front of each spawn breaks line of
// sight for caster openers, the centre diamond gives fighters a post to
// orbit around mid-bout, and the side-lane walls cover flanking runs. Every
// obstacle is mirror-symmetric about BOTH x=0 and z=2 so neither side is
// favoured; each approach screen's outer end is capped by a mid-field post
// (the sub-player gap between them is sealed, they read as one L-shaped
// cover piece).
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -24,
  zMax: 28,
  sideWallZ: 2,
  // z half-DEPTH of the side-wall slabs (26 spans zMin..zMax exactly); their
  // |x| stays the frozen DUNGEON_WALL_X = 23, a different axis entirely.
  sideWallHd: 26,
  pillars: [
    // corner pillars anchoring the four quadrants (every pillar mounts a torch)
    { x: -14, z: -14 },
    { x: 14, z: -14 },
    { x: -14, z: 18 },
    { x: 14, z: 18 },
    // mid-field posts capping the approach screens' outer ends
    { x: -9, z: -8 },
    { x: 9, z: -8 },
    { x: -9, z: 12 },
    { x: 9, z: 12 },
    // centre diamond around the dais glow, for centre orbiting
    { x: 0, z: -4 },
    { x: 0, z: 8 },
    { x: -6, z: 2 },
    { x: 6, z: 2 },
  ],
  tombs: [],
  stubs: [
    // narrow flanking cover walls along the side lanes, mirrored about z=2
    { x: -11, z: 2, hw: 0.6, hd: 5 },
    { x: 11, z: 2, hw: 0.6, hd: 5 },
    // approach screens: LoS breakers between each spawn and the centre
    { x: -5, z: -10, hw: 3, hd: 0.6 },
    { x: 5, z: -10, hw: 3, hd: 0.6 },
    { x: -5, z: 14, hw: 3, hd: 0.6 },
    { x: 5, z: 14, hw: 3, hd: 0.6 },
  ],
  dais: { x: 0, z: 2, r: 8 },
};

// The Drowned Court (interior 'arena', ODD slots): the second arena map, a
// flooded-temple counterpart to the Coliseum. Identical bounds and the same
// frozen |x|=23 walls, but a completely different cover grammar: two straight
// colonnades of five pillars each form a centre nave and two side aisles
// (lane-and-LoS chess, deliberately distinct from the Coliseum's scattered
// screens), with a reliquary block midway along each aisle as the only extra
// cover. No stubs; the dais is a smaller moonlit glow. Mirror-symmetric about
// BOTH x=0 and z=2, like the Coliseum.
export const DROWNED_COURT_LAYOUT: DungeonLayout = {
  zMin: -24,
  zMax: 28,
  sideWallZ: 2,
  sideWallHd: 26,
  // two colonnades at x=-8/8, z stepped by 8 and centred on the z=2 mirror
  pillars: grid(-14, 18, 8, [-8, 8]),
  // reliquary altars midway along each aisle, mirrored about both axes
  tombs: [
    { x: -16, z: -8 },
    { x: 16, z: -8 },
    { x: -16, z: 12 },
    { x: 16, z: 12 },
  ],
  stubs: [],
  dais: { x: 0, z: 2, r: 6 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other,
// each behind its team's approach screen with a clear zone around it.
export const ARENA_SPAWN_A = { x: 0, z: -18, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 22, facing: Math.PI }; // faces -z toward A

// 2v2: two fighters per side, spread along x.
export const ARENA_SPAWNS_A_2v2 = [
  { x: -7, z: -18, facing: 0 },
  { x: 7, z: -18, facing: 0 },
];
export const ARENA_SPAWNS_B_2v2 = [
  { x: -7, z: 22, facing: Math.PI },
  { x: 7, z: 22, facing: Math.PI },
];

// Longest wall-shell OBB segment along a polygon edge before it is split, so a
// long straight run still reads as a wall of DUNGEON_WALL_HW thickness (mirrors
// the delve litany's polygonShellColliders).
const SHELL_SEGMENT_MAX = 8;

/** Chain of rotated OBB wall segments tracing a simple polygon boundary. Each
 * edge is split into equal segments; the OBB's long (hw) axis is rotated along
 * the edge. Used for non-rectangular (`shellPolygon`) rooms so collision matches
 * the rendered walls exactly. */
export function polygonWallColliders(points: readonly { x: number; z: number }[]): Collider[] {
  const out: Collider[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const segCount = Math.max(1, Math.ceil(len / SHELL_SEGMENT_MAX));
    const segLen = len / segCount;
    const rot = Math.atan2(-dz, dx);
    for (let s = 0; s < segCount; s++) {
      const midT = (s + 0.5) / segCount;
      out.push({
        type: 'obb',
        x: a.x + dx * midT,
        z: a.z + dz * midT,
        hw: segLen / 2,
        hd: DUNGEON_WALL_HW,
        rot,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arena maps: each world arena slot hosts one FIXED map, selected by slot
// parity (EVEN slots = Ashen Coliseum, ODD slots = The Drowned Court). The
// mapping is static at boot: colliders and render geometry per slot never
// change, and no selection here ever touches rng. Spawns are plumbed per map
// (not shared constants) so future maps can place them differently.
// ---------------------------------------------------------------------------

export type ArenaMapId = 'coliseum' | 'drowned_court';

export interface ArenaSpawnPoint {
  x: number;
  z: number;
  facing: number;
}

export interface ArenaMapDef {
  id: ArenaMapId;
  layout: DungeonLayout;
  spawnA: ArenaSpawnPoint;
  spawnB: ArenaSpawnPoint;
  spawnsA2v2: ArenaSpawnPoint[];
  spawnsB2v2: ArenaSpawnPoint[];
}

// The Drowned Court's 2v2 spread is +-5 (narrower than the Coliseum's +-7):
// the colonnade pillars at (+-8, -14/18) sit closer to the spawn line, and
// +-5 keeps the 4yd spawn clear zone the layout tests pin.
const DROWNED_COURT_MAP: ArenaMapDef = {
  id: 'drowned_court',
  layout: DROWNED_COURT_LAYOUT,
  spawnA: { x: 0, z: -18, facing: 0 },
  spawnB: { x: 0, z: 22, facing: Math.PI },
  spawnsA2v2: [
    { x: -5, z: -18, facing: 0 },
    { x: 5, z: -18, facing: 0 },
  ],
  spawnsB2v2: [
    { x: -5, z: 22, facing: Math.PI },
    { x: 5, z: 22, facing: Math.PI },
  ],
};

const COLISEUM_MAP: ArenaMapDef = {
  id: 'coliseum',
  layout: ARENA_LAYOUT,
  spawnA: ARENA_SPAWN_A,
  spawnB: ARENA_SPAWN_B,
  spawnsA2v2: ARENA_SPAWNS_A_2v2,
  spawnsB2v2: ARENA_SPAWNS_B_2v2,
};

/** index = slot parity: even slots Coliseum, odd slots Drowned Court. */
export const ARENA_MAPS: readonly [ArenaMapDef, ArenaMapDef] = [COLISEUM_MAP, DROWNED_COURT_MAP];

export function arenaMapForSlot(slot: number): ArenaMapDef {
  return ARENA_MAPS[((slot % 2) + 2) % 2];
}

/**
 * The interior floor's rise above the flat room floor at an instance-local
 * point: DAIS_HEIGHT inside a raised boss dais, zero elsewhere. This is the
 * sim half of the platform the renderer stacks; `world.ts` groundHeight adds
 * it, so mobs, spawns, loot, landings, and the camera all stand on the stage.
 */
export function daisLiftAt(layout: DungeonLayout, lx: number, lz: number): number {
  if (!layout.daisRaised) return 0;
  const d = layout.dais;
  const dx = lx - d.x;
  const dz = lz - d.z;
  return dx * dx + dz * dz <= d.r * d.r ? DAIS_HEIGHT : 0;
}

/**
 * Interior collision set for a layout, in instance-local coordinates.
 * `dressing` describes what the renderer stands in the tomb slots for this
 * dungeon, and therefore what the slots' colliders are: coffins are one
 * standable lid (per-slot height from the same hash the renderer draws),
 * cargo splits into the crate stack and the cask, and no dressing keeps the
 * legacy full-height block. `floorY` absolutizes the standable tops (the
 * interior floor constant; instance-local props all sit on it).
 */
export function layoutColliders(
  layout: DungeonLayout,
  dressing?: TombDressing,
  floorY = 0,
): Collider[] {
  const out: Collider[] = [];
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
  if (layout.rooms) {
    // Authored room-graph floor: its rooms + doors ARE the shell, and its decor
    // carries the measured prop radii. Nothing else on the layout applies.
    return authoredColliders(layout.rooms, layout.doors ?? [], layout.decor ?? [], DUNGEON_WALL_HW);
  }
  if (layout.shellPolygon) {
    // Non-rectangular room: the polygon's own edges ARE the walls (front, back,
    // and both curved sides), so skip the rectangular shell.
    out.push(...polygonWallColliders(layout.shellPolygon));
  } else {
    // side walls
    for (const sx of [-wallX, wallX]) {
      out.push({
        type: 'obb',
        x: sx,
        z: layout.sideWallZ,
        hw: DUNGEON_WALL_HW,
        hd: layout.sideWallHd,
        rot: 0,
      });
    }
    // back wall, then front wall (entrance porch: chase cam fits inside)
    out.push({ type: 'obb', x: 0, z: layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
    out.push({ type: 'obb', x: 0, z: layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  }
  // chamber waists
  for (const s of layout.stubs)
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars)
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // Wall-side obstacle slots (the boss dais is walkable: no collider). The
  // per-slot draw is `tombSlotRoll`, the same roll the renderer picks the
  // prop with, so the collider always matches the piece filling the slot.
  for (const t of layout.tombs) {
    const r = tombSlotRoll(t.x, t.z);
    if (dressing === 'coffins') {
      // The lid is a hump ridging along the coffin's length: standing feet
      // ride the crest at the centre line and the plinth at the sides.
      const plain = r < 0.55;
      const top = plain ? TOMB_COFFIN_PLAIN_TOP : TOMB_COFFIN_DECORATED_TOP;
      const eave = plain ? TOMB_COFFIN_PLAIN_EAVE : TOMB_COFFIN_DECORATED_EAVE;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z,
        hw: TOMB_HW,
        hd: TOMB_HD,
        rot: 0,
        moveTopY: floorY + top,
        standable: true,
        topSlope: {
          kind: 'ridge',
          axis: 'z',
          pitch: (top - eave) / TOMB_HW,
          eaveY: floorY + eave,
        },
      });
    } else if (dressing === 'cargo') {
      // Front stack (two tiers, the measured natural staircase) and the rear
      // cask, at the offsets the renderer uses, with the walkable gap
      // between them the player can now see AND use.
      const crates = r < 0.5;
      const tierTop = crates ? TOMB_CARGO_STACK_TIER : TOMB_CARGO_BOX_TIER;
      const stackTop = crates ? TOMB_CARGO_STACK_TOP : TOMB_CARGO_BOX_TOP;
      const tier2 = crates ? TOMB_CARGO_STACK_TIER2 : TOMB_CARGO_BOX_TIER2;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z - 1.0,
        hw: TOMB_CARGO_STACK_HW,
        hd: TOMB_CARGO_STACK_HW,
        rot: 0,
        moveTopY: floorY + tierTop,
        standable: true,
      });
      out.push({
        type: 'obb',
        x: t.x + tier2[0],
        z: t.z - 1.0 + tier2[1],
        hw: tier2[2],
        hd: tier2[3],
        rot: 0,
        moveTopY: floorY + stackTop,
        standable: true,
      });
      out.push({
        type: 'circle',
        x: t.x + (crates ? 0.1 : -0.1),
        z: t.z + 1.3,
        r: crates ? TOMB_CARGO_BARREL_R : TOMB_CARGO_KEG_R,
        moveTopY: floorY + (crates ? TOMB_CARGO_BARREL_TOP : TOMB_CARGO_KEG_TOP),
        standable: true,
      });
    } else {
      out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
    }
  }
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
