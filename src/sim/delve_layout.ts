// Compact delve module layouts as plain numbers, mirrors dungeon_layout.ts for
// modular 10 to 20 minute instances (~40yd wide, ~80yd deep). Sim layer: no
// three.js imports.
import type { Collider } from './colliders';
import { type DungeonLayout, layoutColliders } from './dungeon_layout';

export type DelveModuleId =
  | 'reliquary_sunken_ossuary'
  | 'reliquary_bell_niche'
  | 'reliquary_saintless_hall'
  | 'reliquary_finale';

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

export const DELVE_MODULE_LAYOUTS: Record<DelveModuleId, DungeonLayout> = {
  reliquary_sunken_ossuary: RELIQUARY_SUNKEN_OSSUARY_LAYOUT,
  reliquary_bell_niche: RELIQUARY_BELL_NICHE_LAYOUT,
  reliquary_saintless_hall: RELIQUARY_SAINTLESS_HALL_LAYOUT,
  reliquary_finale: RELIQUARY_FINALE_LAYOUT,
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
