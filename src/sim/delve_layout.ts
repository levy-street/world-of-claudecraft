// Compact delve module layouts as plain numbers, mirrors dungeon_layout.ts for
// modular 10 to 20 minute instances (~40yd wide, ~80yd deep). Sim layer: no
// three.js imports.
import type { Collider } from './colliders';
import { type DungeonLayout, layoutColliders } from './dungeon_layout';

export type DelveModuleId =
  | 'reliquary_sunken_ossuary'
  | 'reliquary_bell_niche'
  | 'reliquary_saintless_hall'
  | 'reliquary_finale'
  // The Drowned Litany (Mirefen Marsh, delve index 1). Each module is an
  // irregular marsh-ruin shape carved from the shared rectangular footprint by
  // interior obstacles only (stubs/pillars/tombs/clutter): crescent,
  // island_cluster, ring, sinkhole, fan, y_split, asymmetric_apse.
  | 'litany_sluice'
  | 'litany_ledger'
  | 'litany_ring'
  | 'litany_baptistry'
  | 'litany_choir_loft'
  | 'litany_causeway'
  | 'litany_apse';

interface GridPoint {
  x: number;
  z: number;
}

interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// Shared footprint: side walls at |x|=25 (delve-local, wider than base crypt kit),
// z -19..91 (110u deep, 37% larger than the legacy 80u rooms).
const Z_MIN = -19;
const Z_MAX = 91;
const SIDE_Z = 36; // side-slab centre (midpoint of extended wall run)
const SIDE_HD = 55; // half-depth covers the full 110u room
const WALL_X = 25; // delve-specific side wall centre (vs crypt/dungeon 23)
const DOOR_Z = Z_MIN + 2; // -17: entrance archway sits just inside the porch

// Aisle clutter scatter (instance-local). Positions follow the sine-sweep
// formula used by the renderer (x = sin(i*2.4)*14, z = 12 + i*9.5) so the
// collision circles match the visual props exactly. Bell Niche skips z=31 and
// z=59.5 which land inside its alcove stubs; Finale stops south of z=45 so
// the boss fighting ring stays free.
const AISLE_CLUTTER: GridPoint[] = [
  { x: 0.0, z: 12 },
  { x: 9.5, z: 21.5 },
  { x: -14, z: 31 },
  { x: 9.2, z: 40.5 },
  { x: -13, z: 50 },
  { x: 7.5, z: 59.5 },
  { x: -14, z: 69 },
  { x: 11, z: 78.5 },
];

const BELL_NICHE_CLUTTER: GridPoint[] = [
  { x: 0.0, z: 12 },
  { x: 9.5, z: 21.5 },
  { x: 9.2, z: 40.5 },
  { x: -13, z: 50 },
  { x: -14, z: 69 },
  { x: 11, z: 78.5 },
];

const FINALE_CLUTTER: GridPoint[] = [
  { x: 0.0, z: 12 },
  { x: 9.5, z: 21.5 },
  { x: -14, z: 31 },
  { x: 9.2, z: 40.5 },
];

/** The Sunken Ossuary, burial shelves along the walls, three pillar rows. */
export const RELIQUARY_SUNKEN_OSSUARY_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  // No doorZ on module 0: players enter from the overworld through Brother Halven's door.
  pillars: grid(14, 66, 26, [-14, 14]), // z = 14, 40, 66
  tombs: grid(18, 68, 25, [-19, 19]), // z = 18, 43, 68
  stubs: [],
  dais: { x: 0, z: 80, r: 9 },
  clutter: AISLE_CLUTTER,
};

/** The Bell Niche, two pairs of deep alcoves for handbells, open centre passage. */
export const RELIQUARY_BELL_NICHE_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  pillars: grid(16, 66, 25, [-14, 14]), // z = 16, 41, 66
  tombs: [],
  stubs: [
    { x: -15, z: 32, hw: 10, hd: 5 },
    { x: 15, z: 32, hw: 10, hd: 5 },
    { x: -15, z: 62, hw: 10, hd: 5 },
    { x: 15, z: 62, hw: 10, hd: 5 },
  ],
  dais: { x: 0, z: 80, r: 8 },
  clutter: BELL_NICHE_CLUTTER,
};

/** The Saintless Hall, defaced saint-statue alcoves and three colonnade rows. */
export const RELIQUARY_SAINTLESS_HALL_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  pillars: grid(14, 66, 26, [-14, 14]), // z = 14, 40, 66
  tombs: grid(20, 68, 24, [-19, 19]), // z = 20, 44, 68
  stubs: [],
  dais: { x: 0, z: 80, r: 8 },
  clutter: AISLE_CLUTTER,
};

/** The Bell-Buried Chamber, boss arena; clutter south, cleared fighting ring north. */
export const RELIQUARY_FINALE_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  pillars: [
    { x: -14, z: 12 },
    { x: 14, z: 12 },
    { x: -14, z: 28 },
    { x: 14, z: 28 },
  ],
  // Two tomb rows in the south half; north fighting ring stays clear.
  tombs: grid(16, 28, 12, [-19, 19]),
  stubs: [],
  // Wider dais (r=12) so Deacon Varric's 8yd Bell Toll stomp fits without
  // the boss immediately stepping off the platform.
  dais: { x: 0, z: 80, r: 12 },
  clutter: FINALE_CLUTTER,
};

// ---------------------------------------------------------------------------
// The Drowned Litany (Mirefen Marsh): 7 irregular marsh-ruin shapes.
//
// All seven keep the SHARED outer footprint (Z_MIN..Z_MAX, SIDE_Z/SIDE_HD,
// WALL_X) and carry doorZ: DOOR_Z. The non-rectangular FEEL comes entirely from
// interior obstacles: stub walls (OBB) are the primary shaping tool, pillars are
// dotted obstacles (r=1), tombs are wall-side blocks (1.1 x 2.1), clutter is
// decorative (r=0.8). Every layout keeps the entry aisle (x in [-3,3], z near
// -11) clear and leaves a continuous >=4u-wide walkable path from the entry to
// the dais at the high-z end.
// ---------------------------------------------------------------------------

/** Litany Sluice, CRESCENT: a curved arc of stub-walls + tombs sweeps from the
 * south-west to the north-east, forcing the player to trace a banked channel
 * around the convex (impassable) inner edge rather than walk straight up. */
export const LITANY_SLUICE_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // The convex inner bank of the crescent: a run of stubs whose centre x sweeps
  // from west (-12) to east (+12) as z climbs, leaving an open arc on the
  // OUTSIDE of the curve. Each gap to the side wall (|x|=24 walkable) stays well
  // over 4u so the channel is traversable the whole way up.
  stubs: [
    { x: -12, z: 6, hw: 7, hd: 3 },
    { x: -8, z: 20, hw: 7, hd: 3 },
    { x: 0, z: 33, hw: 8, hd: 3 },
    { x: 9, z: 47, hw: 7, hd: 3 },
    { x: 13, z: 61, hw: 6, hd: 3 },
  ],
  // Pillars dot the concave (walkable) side of the bank as sluice-gate posts.
  pillars: [
    { x: 13, z: 6 },
    { x: 16, z: 20 },
    { x: -16, z: 47 },
    { x: -16, z: 61 },
    { x: -10, z: 73 },
  ],
  tombs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: 18, z: 33 },
    { x: -18, z: 33 },
    { x: 6, z: 73 },
  ],
};

/** Litany Ledger, ISLAND_CLUSTER: several blocky raised "islands" (tomb +
 * pillar groups) scatter across the room with navigable channels of open water
 * weaving between them; no single island spans the width, so the player threads
 * a zig-zag of >=4u channels to the dais. */
export const LITANY_LEDGER_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // Each island is a tight tomb pair the renderer reads as a raised ledge.
  tombs: [
    // west island near the entrance (kept clear of the x in [-3,3] aisle)
    { x: -13, z: 10 },
    { x: -16, z: 14 },
    // east mid island
    { x: 14, z: 28 },
    { x: 17, z: 24 },
    // central island (offset east so the west channel stays open)
    { x: 6, z: 44 },
    { x: 9, z: 48 },
    // west far island
    { x: -14, z: 58 },
    { x: -17, z: 62 },
  ],
  // A few lone rocks pepper the channels without blocking them.
  pillars: [
    { x: 13, z: 52 },
    { x: -8, z: 30 },
    { x: 0, z: 70 },
  ],
  stubs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: -19, z: 10 },
    { x: 19, z: 28 },
    { x: 12, z: 44 },
    { x: -19, z: 58 },
  ],
};

/** Litany Ring, RING: a dense central mass (tomb + pillar cluster around the
 * room centre) the player cannot cross; an unbroken walkway loops around it on
 * all sides, rejoining toward the dais. */
export const LITANY_RING_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // The impassable central island: a 4-stub box around (0,40) with tomb corners,
  // ~+-13 in x and z 28..52, leaving ~11u walkway lanes on each side (|x| 13..24)
  // and clear bands south (z<24) and north (z>54).
  stubs: [
    { x: 0, z: 28, hw: 11, hd: 2 }, // south face of the ring
    { x: 0, z: 52, hw: 11, hd: 2 }, // north face of the ring
    { x: -11, z: 40, hw: 2, hd: 10 }, // west face
    { x: 11, z: 40, hw: 2, hd: 10 }, // east face
  ],
  pillars: [
    { x: 0, z: 40 }, // dead centre, inside the sealed ring
    { x: -7, z: 40 },
    { x: 7, z: 40 },
  ],
  tombs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: 18, z: 40 },
    { x: -18, z: 40 },
    { x: 0, z: 16 },
    { x: 0, z: 66 },
  ],
};

/** Litany Baptistry, SINKHOLE: a circular pit obstacle dead-centre ringed by a
 * walkable perimeter. The pit is a ring of pillars (a flooded font) the player
 * orbits; the central pillar marks the drowned font itself. */
export const LITANY_BAPTISTRY_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // The pit rim: a ring of pillars about (0,40) at radius ~8, dense enough to
  // read as a continuous lip, with a central font pillar. The walkway around it
  // (|x| 9..24, and clear z bands south/north) stays well over 4u wide.
  pillars: [
    { x: 0, z: 32 },
    { x: 6, z: 34 },
    { x: 8, z: 40 },
    { x: 6, z: 46 },
    { x: 0, z: 48 },
    { x: -6, z: 46 },
    { x: -8, z: 40 },
    { x: -6, z: 34 },
    { x: 0, z: 40 }, // the drowned font at the pit centre
  ],
  // Two short kerb stubs flank the pit east/west as a raised walkway edge,
  // leaving a generous outer lane to the side walls.
  stubs: [
    { x: 15, z: 40, hw: 2, hd: 6 },
    { x: -15, z: 40, hw: 2, hd: 6 },
  ],
  tombs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: 20, z: 24 },
    { x: -20, z: 24 },
    { x: 20, z: 56 },
    { x: -20, z: 56 },
  ],
};

/** Litany Choir Loft, FAN: obstacles fan outward from the entrance in widening
 * diagonal rows (choir-stall pews), so the room opens like a fan; the player
 * weaves between the spreading ranks toward the dais. */
export const LITANY_CHOIR_LOFT_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // Each rank is a pillar pair whose x-spread grows with z (fanning out from the
  // narrow entrance). Gaps between the pair (>=4u) and to the walls stay open.
  pillars: [
    // rank 1 (narrow, just past the clear entry aisle)
    { x: -5, z: 12 },
    { x: 5, z: 12 },
    // rank 2
    { x: -10, z: 26 },
    { x: 10, z: 26 },
    // rank 3
    { x: -15, z: 40 },
    { x: 15, z: 40 },
    // rank 4 (widest, hugging the walls)
    { x: -19, z: 54 },
    { x: 19, z: 54 },
  ],
  // A second, intermediate fan of tombs offset half a step so the ranks
  // interleave and the player must slalom rather than walk a straight centre.
  tombs: [
    { x: 0, z: 19 },
    { x: -8, z: 33 },
    { x: 8, z: 33 },
    { x: -12, z: 47 },
    { x: 12, z: 47 },
  ],
  stubs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: 0, z: 64 },
    { x: -16, z: 68 },
    { x: 16, z: 68 },
  ],
};

/** Litany Causeway, Y_SPLIT: a central longitudinal spine of stubs splits the
 * room into two lanes; the spine has a gap at the south end (entry) and the
 * north end (before the dais) so the two lanes diverge then rejoin (a Y at each
 * end). */
export const LITANY_CAUSEWAY_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // The spine: a run of centred stubs from z~12 to z~62, leaving open mouths
  // south (z<8, the entry confluence) and north (z>66, before the dais) so the
  // two ~11u side lanes (|x| up to 24) split and rejoin. hw=2 keeps each lane
  // comfortably over 4u.
  stubs: [
    { x: 0, z: 14, hw: 2, hd: 4 },
    { x: 0, z: 26, hw: 2, hd: 4 },
    { x: 0, z: 38, hw: 2, hd: 4 },
    { x: 0, z: 50, hw: 2, hd: 4 },
    { x: 0, z: 62, hw: 2, hd: 4 },
  ],
  // Lane-edge marker posts (one per lane) emphasise the two parallel causeways.
  pillars: [
    { x: -13, z: 26 },
    { x: 13, z: 38 },
    { x: -13, z: 50 },
  ],
  tombs: [],
  dais: { x: 0, z: 82, r: 9 },
  clutter: [
    { x: 0, z: 8 }, // south confluence cobbles (clear of spawn at z=-11)
    { x: 0, z: 72 }, // north confluence
  ],
};

/** Litany Apse, ASYMMETRIC_APSE (BOSS): a clear central fighting ring with a
 * wide dais (r=12). Cover sits ONLY in the south half (z < ~46) and is
 * deliberately asymmetric, favouring the WEST side (more, deeper cover west than
 * east), with NO obstacle within ~14u of the dais centre. Modelled on
 * RELIQUARY_FINALE_LAYOUT but offset/lopsided to read as a ruined apse. */
export const LITANY_APSE_LAYOUT: DungeonLayout = {
  zMin: Z_MIN,
  zMax: Z_MAX,
  sideWallZ: SIDE_Z,
  sideWallHd: SIDE_HD,
  wallX: WALL_X,
  doorZ: DOOR_Z,
  // West-heavy cover in the south half: a deep west colonnade plus one lighter
  // east post. All at z <= 30, far outside the dais stomp ring at z=80,r=12.
  pillars: [
    { x: -16, z: 10 },
    { x: -16, z: 22 },
    { x: -10, z: 16 },
    { x: -10, z: 30 },
    { x: 14, z: 14 }, // lone east post (asymmetry: east is sparse)
  ],
  // A short broken apse-wall stub favouring the west, plus its smaller east
  // counterpart, both well south of the fighting ring.
  stubs: [
    { x: -18, z: 38, hw: 5, hd: 2 },
    { x: 16, z: 40, hw: 3, hd: 2 },
  ],
  // Wall-side rubble blocks in the deep south, west side weighted.
  tombs: [
    { x: -20, z: 10 },
    { x: -20, z: 26 },
    { x: 20, z: 22 },
  ],
  // Wider dais (r=12) so Sister Nhalia's stomp ring fits without stepping off.
  dais: { x: 0, z: 80, r: 12 },
  clutter: [
    { x: -8, z: 42 },
    { x: 10, z: 28 },
    { x: 0, z: 16 },
  ],
};

export const DELVE_MODULE_LAYOUTS: Record<DelveModuleId, DungeonLayout> = {
  reliquary_sunken_ossuary: RELIQUARY_SUNKEN_OSSUARY_LAYOUT,
  reliquary_bell_niche: RELIQUARY_BELL_NICHE_LAYOUT,
  reliquary_saintless_hall: RELIQUARY_SAINTLESS_HALL_LAYOUT,
  reliquary_finale: RELIQUARY_FINALE_LAYOUT,
  // The Drowned Litany (Mirefen Marsh): distinct irregular marsh-ruin shapes.
  litany_sluice: LITANY_SLUICE_LAYOUT, // crescent: curved banked channel
  litany_ledger: LITANY_LEDGER_LAYOUT, // island_cluster: scattered ledges + channels
  litany_ring: LITANY_RING_LAYOUT, // ring: sealed central mass, loop around it
  litany_baptistry: LITANY_BAPTISTRY_LAYOUT, // sinkhole: central pit + walkway rim
  litany_choir_loft: LITANY_CHOIR_LOFT_LAYOUT, // fan: ranks fanning from the entrance
  litany_causeway: LITANY_CAUSEWAY_LAYOUT, // y_split: central spine, two lanes rejoin
  litany_apse: LITANY_APSE_LAYOUT, // asymmetric_apse: boss ring, west-heavy cover
};

/** Interior collision set for a delve module, in instance-local coordinates. */
export function delveModuleColliders(moduleId: DelveModuleId): Collider[] {
  return layoutColliders(DELVE_MODULE_LAYOUTS[moduleId]);
}

/** Centre-aisle spawn just inside the entrance porch (instance-local). */
export function delveModuleEntry(layout: DungeonLayout): { x: number; z: number } {
  return { x: 0, z: layout.zMin + 8 };
}

/** Walkable depth of a module, matches KayKit floor/wall placement (zMin..zMax). */
export function delveModuleSpan(moduleId: DelveModuleId): number {
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  return layout.zMax - layout.zMin;
}
