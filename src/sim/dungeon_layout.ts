// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

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
  /** Optional room width override for oversized rooms. Defaults to the classic crypt width. */
  wallX?: number;
  endWallHw?: number;
  floorHalfX?: number;
  /** entrance archway z position; renderer places gate props here when set */
  doorZ?: number;
  /** floor scatter positions, renderer places props here AND collision circles back them */
  clutter?: GridPoint[];
  /** Room shell outline (CCW, simple, star-shaped from `shellPole`), instance-local.
   * When present, render/collision derive the room's walls and floor mask from this
   * polygon instead of the rectangular wallX/zMin/zMax shell. */
  shellPolygon?: Array<{ x: number; z: number }>;
  /** Star-shaping pole paired with `shellPolygon` (see geometry2d.polygonIsStarShaped). */
  shellPole?: { x: number; z: number };
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
  };
})();

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

/** Interior collision set for a layout, in instance-local coordinates. */
export function layoutColliders(layout: DungeonLayout): Collider[] {
  const out: Collider[] = [];
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
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
  // chamber waists
  for (const s of layout.stubs)
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars)
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // wall-side obstacles (the boss dais is walkable: no collider)
  for (const t of layout.tombs)
    out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
