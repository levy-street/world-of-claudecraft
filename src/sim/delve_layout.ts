// Compact delve module layouts as plain numbers, mirrors dungeon_layout.ts for
// modular 10 to 20 minute instances (~40yd wide, ~80yd deep). Sim layer: no
// three.js imports.
import type { Collider } from './colliders';
import {
  isLitanyModuleId,
  type LitanyModuleId,
  litanyModuleColliders,
  litanyModuleLayout,
} from './delve_litany_layout';
import { type DungeonLayout, layoutColliders } from './dungeon_layout';

export type DelveModuleId =
  | 'reliquary_sunken_ossuary'
  | 'reliquary_bell_niche'
  | 'reliquary_saintless_hall'
  | 'reliquary_finale'
  // The Source Cave (delve index 5, see src/sim/source_cave/): one square arena
  // room, not a stacked module chain. See SOURCE_CAVE_ARENA_LAYOUT below.
  | 'source_cave_arena'
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

/** Evenly spaced points on a circle of `radius`, for decorative ring dressing. */
function ring(radius: number, count: number, phase = 0): GridPoint[] {
  const out: GridPoint[] = [];
  for (let i = 0; i < count; i++) {
    const theta = phase + (i * 2 * Math.PI) / count;
    out.push({ x: radius * Math.cos(theta), z: radius * Math.sin(theta) });
  }
  return out;
}

// The Source Cave arena: one square room, boss at dead centre. Contributor mobs
// are NOT part of this static layout - src/sim/source_cave/spec.ts places them in
// concentric rings around (0, 0) at runtime, from the roster. The entrance and
// exit are WALL-ANCHORED (sourceCaveEntryZ/ExitZ are fixed insets from zMin,
// user decision: the door hugs the wall, no roster-scaled empty walk-in).
//
// This layout's size is the SMALLEST value provably safe for the worst-case
// roster, since the walls are one static shape shared by every instance: at
// roster 60 (59 non-boss, SOURCE_CAVE_ROSTER_MAX in server/main.ts), the ring
// math (spec.ts: RING_INNER_RADIUS 14, RING_RADIAL_STEP/RING_ARC_SPACING 8)
// fills rings at radius 14/22/30/38 (capacity 10/17/23/29, cumulative
// 10/27/50/79), so the outermost ring sits at radius 38 and needs
// `sourceCaveArenaUsableRadius` (half minus the 5u wall clearance) >= 38, hence
// half >= 43. The south side adds the wall-anchored spawn inset (6): half 48
// leaves a 4u gap between the spawn and the worst-case outer ring.
// `buildSourceCaveSpec` asserts that gap at spec-build time (throws rather
// than silently clipping) so a future change to any of these constants fails
// loudly, not silently. Shrunk from 70 when the empty entry buffer was removed.
// Square: wallX matches the zMin..zMax half-span (unlike every other
// DungeonLayout here, which is a long nave).
const SOURCE_CAVE_ARENA_HALF = 48;
export const SOURCE_CAVE_ARENA_LAYOUT: DungeonLayout = {
  zMin: -SOURCE_CAVE_ARENA_HALF,
  zMax: SOURCE_CAVE_ARENA_HALF,
  sideWallZ: 0,
  sideWallHd: SOURCE_CAVE_ARENA_HALF,
  wallX: SOURCE_CAVE_ARENA_HALF,
  endWallHw: SOURCE_CAVE_ARENA_HALF + 1,
  floorHalfX: SOURCE_CAVE_ARENA_HALF - 2,
  doorZ: -SOURCE_CAVE_ARENA_HALF + 2,
  // Purely decorative pillar rings (torches mount on these, per the pillars doc
  // comment on DungeonLayout); they do not correlate with mob placement. The
  // phases keep every pillar OFF the x=0 door lane (the old phases put one
  // pillar dead-centre in front of the entrance): the inner ring's
  // southernmost pair flanks at x ~ +-9, the outer ring's at x ~ +-13.
  pillars: [...ring(24, 8, Math.PI / 8), ...ring(42, 10)],
  tombs: [],
  stubs: [],
  // The boss's own fighting dais at dead centre, same radius as the old reliquary
  // finale room's dais (RELIQUARY_FINALE_LAYOUT.dais.r) - contributor mobs ring
  // outward from here.
  dais: { x: 0, z: 0, r: 12 },
  clutter: [],
};

// ---------------------------------------------------------------------------
// The Drowned Litany (Mirefen Marsh): compatibility layouts only.
// Real room shape lives in delve_litany_layout.ts.
// ---------------------------------------------------------------------------

function litanyCompatLayout(moduleId: LitanyModuleId): DungeonLayout {
  const layout = litanyModuleLayout(moduleId);
  if (!layout) throw new Error(`Expected Litany geometry for ${moduleId}`);
  return { ...layout, litanyModuleId: moduleId } as DungeonLayout & { litanyModuleId: string };
}

export const LITANY_SLUICE_LAYOUT = litanyCompatLayout('litany_sluice');
export const LITANY_LEDGER_LAYOUT = litanyCompatLayout('litany_ledger');
export const LITANY_RING_LAYOUT = litanyCompatLayout('litany_ring');
export const LITANY_BAPTISTRY_LAYOUT = litanyCompatLayout('litany_baptistry');
export const LITANY_CHOIR_LOFT_LAYOUT = litanyCompatLayout('litany_choir_loft');
export const LITANY_CAUSEWAY_LAYOUT = litanyCompatLayout('litany_causeway');
export const LITANY_APSE_LAYOUT = litanyCompatLayout('litany_apse');

export const DELVE_MODULE_LAYOUTS: Record<DelveModuleId, DungeonLayout> = {
  reliquary_sunken_ossuary: RELIQUARY_SUNKEN_OSSUARY_LAYOUT,
  reliquary_bell_niche: RELIQUARY_BELL_NICHE_LAYOUT,
  reliquary_saintless_hall: RELIQUARY_SAINTLESS_HALL_LAYOUT,
  reliquary_finale: RELIQUARY_FINALE_LAYOUT,
  source_cave_arena: SOURCE_CAVE_ARENA_LAYOUT,
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
  if (isLitanyModuleId(moduleId)) return litanyModuleColliders(moduleId);
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
