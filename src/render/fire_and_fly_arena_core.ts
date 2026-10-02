// The Fire and Fly arena's render plan, pure: every placement and paint weight
// the arena painter (fire_and_fly_arena.ts) draws, derived from the sim's own
// field leaf (src/sim/fire_and_fly_field.ts) so the trees, rocks and ground
// you see are the ones the thrown bodies bounce off. Coordinates are
// instance-local with the tower at the origin. Every scatter hashes its cell:
// no rng, no clock, the same arena in every slot and every session.
//
// Past the forest the painter raises a ring of forested hills the sim never
// reads (nobody stands there): it closes the horizon so the clearing reads as
// a glade in a wooded valley rather than a disc floating in the sky.

import { dungeonAt } from '../sim/data';
import {
  FIRE_AND_FLY_CLEARING_RADIUS,
  FIRE_AND_FLY_FOREST_RADIUS,
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TREE_ROWS,
  type FireAndFlyRock,
  type FireAndFlyTree,
  fireAndFlyFieldHeight,
} from '../sim/fire_and_fly_field';
import type { GfxTier } from './gfx';

/** The interior id the sim's arena dungeon carries. */
export const FIRE_AND_FLY_INTERIOR = 'fire_and_fly';

/** True when a world x lies in the Fire and Fly arena's instance band. */
export function isFireAndFlyArenaAt(x: number): boolean {
  return dungeonAt(x)?.interior === FIRE_AND_FLY_INTERIOR;
}

/** Where the painted ground ends: far enough out that the hill crest closes
 *  every sightline from the tower roof at the widest camera boom. */
export const FIRE_AND_FLY_GROUND_RADIUS = 236;
const HILL_START = FIRE_AND_FLY_FOREST_RADIUS + 4;
const HILL_CREST = 205;

// Late afternoon: the sun low over the tree line on the same azimuth as the
// sky HDRIs' baked sun (gfx.ts SUN_ANCHOR), so the dome's glow, the shadows
// and the warm rim on the trees all agree. About 21 degrees up.
const SUN = { x: 90, y: 40, z: 50 };
const SUN_LENGTH = Math.hypot(SUN.x, SUN.y, SUN.z);
export const FIRE_AND_FLY_SUN_DIRECTION = {
  x: SUN.x / SUN_LENGTH,
  y: SUN.y / SUN_LENGTH,
  z: SUN.z / SUN_LENGTH,
} as const;

/** The sky point the dome reads its HDRI from inside the arena: Amberfall,
 *  whose amber sunset sky matches the arena's fixed golden hour. Without it
 *  the dome would pick a different band's sky in each of the 24 slots. */
export const FIRE_AND_FLY_SKY_ANCHOR = { x: -340, z: 1945 } as const;

/** The dome grade the arena holds whatever the world clock says. */
export const FIRE_AND_FLY_SKY_HOLD = {
  dayNight: [1, 0.96, 0.9] as const,
  sunDirection: FIRE_AND_FLY_SUN_DIRECTION,
  duskWarm: 0.55,
  nightDesat: 0,
} as const;

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 hash of two numbers and a salt. */
export function arenaHash(a: number, b: number, salt: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number, salt: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const w = fz * fz * (3 - 2 * fz);
  const a = arenaHash(xi, zi, salt);
  const b = arenaHash(xi + 1, zi, salt);
  const c = arenaHash(xi, zi + 1, salt);
  const d = arenaHash(xi + 1, zi + 1, salt);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Three-octave value noise in 0..1. */
function fbm(x: number, z: number, salt: number): number {
  return (
    0.58 * valueNoise(x, z, salt) +
    0.28 * valueNoise(x * 2.07, z * 2.07, salt + 7) +
    0.14 * valueNoise(x * 4.31, z * 4.31, salt + 13)
  );
}

/**
 * The drawn ground: the sim's field everywhere a body can reach, plus the
 * wooded hills beyond the wall. The lift starts flat at the hill foot, so the
 * seam with the sim field has neither a step nor a crease.
 */
export function fireAndFlyRenderHeight(lx: number, lz: number): number {
  const base = fireAndFlyFieldHeight(lx, lz);
  const r = Math.hypot(lx, lz);
  if (r <= HILL_START) return base;
  const angle = Math.atan2(lx, lz);
  const crest = 7 + 2.5 * Math.sin(angle * 3 + 0.7) + 1.5 * Math.sin(angle * 7 - 1.3);
  const lift = smoothstep(HILL_START, HILL_CREST, r);
  return base + crest * lift * lift + 1.6 * lift * (fbm(lx * 0.03, lz * 0.03, 41) - 0.5);
}

/** Ring radii of the painted ground disc: fine where the camera looks down
 *  (the tower foot and the clearing), coarse on the far hills. */
export function fireAndFlyGroundRings(): number[] {
  const rings = [0];
  const bands: readonly (readonly [number, number])[] = [
    [8, 0.8],
    [64, 1.25],
    [108, 2],
    [170, 4],
    [FIRE_AND_FLY_GROUND_RADIUS, 6.6],
  ];
  let r = 0;
  for (const [end, step] of bands) {
    while (r + step < end - 1e-6) {
      r += step;
      rings.push(r);
    }
    r = end;
    rings.push(end);
  }
  return rings;
}

/** Around-the-ring segment count of the ground disc. */
export const FIRE_AND_FLY_GROUND_SEGMENTS = 192;

/** The per-vertex paint weights, each 0..1, filled into a caller-owned record. */
export interface ArenaGroundPaint {
  /** bare earth in place of grass (the trampled tower foot, worn patches, the forest floor) */
  dirt: number;
  /** sun-dried straw in the grass */
  dry: number;
  /** deep green lush grass */
  lush: number;
  /** canopy shade and leaf litter under the tree ring */
  shade: number;
}

export function createArenaGroundPaint(): ArenaGroundPaint {
  return { dirt: 0, dry: 0, lush: 0, shade: 0 };
}

const TOWER_APRON = { inner: 3.1, outer: 8.5 } as const;

/** Paint weights at an instance-local point. */
export function fireAndFlyGroundPaint(lx: number, lz: number, out: ArenaGroundPaint): void {
  const r = Math.hypot(lx, lz);
  // The tower foot is trampled bare, its edge ragged rather than a circle.
  const ragged = (fbm(lx * 0.35, lz * 0.35, 3) - 0.5) * 2.4;
  const apron = 1 - smoothstep(TOWER_APRON.inner, TOWER_APRON.outer, r + ragged);
  // A few worn patches across the clearing, where the grass gave up.
  const worn = smoothstep(0.68, 0.8, fbm(lx * 0.075 + 3.1, lz * 0.075 - 1.7, 11));
  // The forest floor: litter and needles under the ring, bare in the deep shade.
  const forest = smoothstep(FIRE_AND_FLY_CLEARING_RADIUS + 2, 70, r);
  let rockScuff = 0;
  for (const rock of FIRE_AND_FLY_ROCKS) {
    const d = Math.hypot(lx - rock.x, lz - rock.z) - rock.radius;
    if (d < 2.6) rockScuff = Math.max(rockScuff, 1 - smoothstep(0.2, 2.6, d));
  }
  out.dirt = Math.min(1, Math.max(apron, worn * 0.7, forest * 0.62, rockScuff * 0.7));
  const hue = fbm(lx * 0.028 - 5.3, lz * 0.028 + 2.9, 23);
  out.dry = smoothstep(0.52, 0.8, hue) * (1 - forest);
  out.lush = (1 - smoothstep(0.2, 0.46, hue)) * (1 - forest);
  out.shade = forest * (0.7 + 0.3 * fbm(lx * 0.08, lz * 0.08, 29));
}

function nearRock(x: number, z: number, margin: number): boolean {
  for (const rock of FIRE_AND_FLY_ROCKS) {
    if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + margin) return true;
  }
  return false;
}

// Trunk lookup for the scatters: cell-bucketed so a 9000-cell grass pass does
// not test every trunk, and keyed on the drawn trees so a tier that drops a
// tree leaves no bare ring of ground where its trunk would stand.
const TRUNK_CELL = 8;
type TrunkCells = Map<string, FireAndFlyTree[]>;
const trunkCellsByDensity = new Map<ArenaTreeDensity, TrunkCells>();

function trunkCells(density: ArenaTreeDensity): TrunkCells {
  const cached = trunkCellsByDensity.get(density);
  if (cached) return cached;
  const cells: TrunkCells = new Map();
  for (const tree of fireAndFlyDrawnTrees(density)) {
    const key = `${Math.floor(tree.x / TRUNK_CELL)}:${Math.floor(tree.z / TRUNK_CELL)}`;
    const list = cells.get(key);
    if (list) list.push(tree);
    else cells.set(key, [tree]);
  }
  trunkCellsByDensity.set(density, cells);
  return cells;
}

function nearTrunk(cells: TrunkCells, x: number, z: number, margin: number): boolean {
  const cx = Math.floor(x / TRUNK_CELL);
  const cz = Math.floor(z / TRUNK_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const list = cells.get(`${cx + i}:${cz + j}`);
      if (!list) continue;
      for (const tree of list) {
        if (Math.hypot(x - tree.x, z - tree.z) < 0.55 * tree.scale + margin) return true;
      }
    }
  }
  return false;
}

/** One card of ground cover. `h1`..`h3` are per-spot hashes for the tint jitter. */
export interface ArenaCoverSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  h1: number;
  h2: number;
  h3: number;
}

/** A grass tuft, with the ground paint under it so the painter tints it
 *  without painting the ground a second time. */
export interface ArenaGrassSpot extends ArenaCoverSpot {
  dry: number;
  lush: number;
}

/** The trampled-free radius around the tower's foot. */
export const FIRE_AND_FLY_BARE_FOOT = 3.4;
/** Clearing tufts stay short so a monster's ground marker is never buried. */
export const FIRE_AND_FLY_CLEARING_TUFT_MAX = 0.8;
const COVER_EDGE = 97;

const grassSpotsByKey = new Map<string, readonly ArenaGrassSpot[]>();
let flowerSpots: readonly ArenaCoverSpot[] | null = null;
const understoryByDensity = new Map<ArenaTreeDensity, readonly ArenaUnderstorySpot[]>();

/**
 * Grass tufts on a jittered grid of `step` yards: short and dense in the
 * clearing, thinned where the ground is worn, a taller lush fringe at the
 * forest edge, sparse under the trees, none inside a rock or a trunk the
 * density draws. The scatter is the same in every slot, so it is planned once
 * per step and density.
 */
export function fireAndFlyGrassSpots(
  step: number,
  density: ArenaTreeDensity = 'full',
): readonly ArenaGrassSpot[] {
  const key = `${step}:${density}`;
  const cached = grassSpotsByKey.get(key);
  if (cached) return cached;
  const trunks = trunkCells(density);
  const spots: ArenaGrassSpot[] = [];
  const paint = createArenaGroundPaint();
  const cells = Math.ceil(COVER_EDGE / step);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      const x = (i + (arenaHash(i, j, 101) - 0.5) * 1.3) * step;
      const z = (j + (arenaHash(i, j, 102) - 0.5) * 1.3) * step;
      const r = Math.hypot(x, z);
      if (r < FIRE_AND_FLY_BARE_FOOT || r > COVER_EDGE) continue;
      fireAndFlyGroundPaint(x, z, paint);
      const edge = smoothstep(FIRE_AND_FLY_CLEARING_RADIUS - 6, FIRE_AND_FLY_CLEARING_RADIUS, r);
      const under = smoothstep(63, 68, r);
      const density = under > 0 ? 0.62 - 0.3 * under : 0.9 * (1 - paint.dirt * 1.15) + 0.1 * edge;
      if (arenaHash(i, j, 103) > density) continue;
      if (nearRock(x, z, 0.25)) continue;
      if (nearTrunk(trunks, x, z, 0.5)) continue;
      const h1 = arenaHash(i, j, 104);
      const short = 0.5 + 0.3 * h1;
      const tall = 0.85 + 0.6 * h1;
      spots.push({
        x,
        y: fireAndFlyFieldHeight(x, z),
        z,
        yaw: arenaHash(i, j, 105) * Math.PI * 2,
        scale: short + (tall - short) * Math.max(edge * (1 - under * 0.5), under * 0.7),
        h1,
        h2: arenaHash(i, j, 106),
        h3: arenaHash(i, j, 107),
        dry: paint.dry,
        lush: paint.lush,
      });
    }
  }
  grassSpotsByKey.set(key, spots);
  return spots;
}

/** Wildflower drifts in the clearing: daisies, cosmos and buttercups in loose
 *  clumps, never on the worn earth. */
export function fireAndFlyFlowerSpots(): readonly ArenaCoverSpot[] {
  if (flowerSpots) return flowerSpots;
  const spots: ArenaCoverSpot[] = [];
  const paint = createArenaGroundPaint();
  const step = 2.3;
  const cells = Math.ceil(FIRE_AND_FLY_CLEARING_RADIUS / step);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      const x = (i + (arenaHash(i, j, 201) - 0.5)) * step;
      const z = (j + (arenaHash(i, j, 202) - 0.5)) * step;
      const r = Math.hypot(x, z);
      if (r < 9 || r > FIRE_AND_FLY_CLEARING_RADIUS + 1) continue;
      const drift = smoothstep(0.55, 0.72, fbm(x * 0.07 + 8.2, z * 0.07 - 4.4, 31));
      if (arenaHash(i, j, 203) > drift * 0.8) continue;
      fireAndFlyGroundPaint(x, z, paint);
      if (paint.dirt > 0.35 || nearRock(x, z, 0.4)) continue;
      const h1 = arenaHash(i, j, 204);
      spots.push({
        x,
        y: fireAndFlyFieldHeight(x, z),
        z,
        yaw: arenaHash(i, j, 205) * Math.PI * 2,
        scale: 0.5 + 0.3 * h1,
        h1,
        h2: arenaHash(i, j, 206),
        h3: arenaHash(i, j, 207),
      });
    }
  }
  flowerSpots = spots;
  return spots;
}

export interface ArenaUnderstorySpot extends ArenaCoverSpot {
  kind: 'fern' | 'bush';
}

/** Ferns and flowering bushes along the forest edge and under the ring, clear
 *  of the trunks the density draws. */
export function fireAndFlyUnderstorySpots(
  density: ArenaTreeDensity = 'full',
): readonly ArenaUnderstorySpot[] {
  const cached = understoryByDensity.get(density);
  if (cached) return cached;
  const trunks = trunkCells(density);
  const spots: ArenaUnderstorySpot[] = [];
  const ringStep = 3.4;
  for (let row = 0; row < 11; row++) {
    const radius = FIRE_AND_FLY_CLEARING_RADIUS + 2.5 + row * ringStep;
    const count = Math.round((2 * Math.PI * radius) / ringStep);
    for (let k = 0; k < count; k++) {
      const angle = ((k + arenaHash(row, k, 301)) * 2 * Math.PI) / count;
      const r = radius + (arenaHash(row, k, 302) - 0.5) * ringStep;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      const density = row < 2 ? 0.55 : 0.34;
      if (arenaHash(row, k, 303) > density) continue;
      if (nearRock(x, z, 0.6) || nearTrunk(trunks, x, z, 0.9)) continue;
      const h1 = arenaHash(row, k, 304);
      const bush = row < 3 && arenaHash(row, k, 305) < 0.22;
      spots.push({
        x,
        y: fireAndFlyFieldHeight(x, z),
        z,
        yaw: arenaHash(row, k, 306) * Math.PI * 2,
        scale: bush ? 0.8 + 0.5 * h1 : 0.75 + 0.7 * h1,
        h1,
        h2: arenaHash(row, k, 307),
        h3: arenaHash(row, k, 308),
        kind: bush ? 'bush' : 'fern',
      });
    }
  }
  understoryByDensity.set(density, spots);
  return spots;
}

/** One distant canopy mass on the hills beyond the forest. */
export interface ArenaBackdropCrown {
  x: number;
  /** foot of the crown (the ground under it, less a sink) */
  y: number;
  z: number;
  radius: number;
  height: number;
  conifer: boolean;
  /** 0..1 shade variation */
  tone: number;
  /** true for the nearer rows, which get the rounder mesh */
  near: boolean;
}

/**
 * The hills' forest: overlapping crowns (broadleaf domes and conifer spires)
 * from the forest out past the crest, dense enough that no gap shows the bare
 * hillside from the tower. Far rows are bigger and sparser; fog does the rest.
 */
export function fireAndFlyBackdropCrowns(): ArenaBackdropCrown[] {
  const crowns: ArenaBackdropCrown[] = [];
  let radius = FIRE_AND_FLY_FOREST_RADIUS + 3.5;
  let row = 0;
  while (radius < FIRE_AND_FLY_GROUND_RADIUS - 4) {
    const size = 3.4 + (radius - FIRE_AND_FLY_FOREST_RADIUS) * 0.055;
    const spacing = size * 1.3;
    const count = Math.round((2 * Math.PI * radius) / spacing);
    const offset = arenaHash(row, 0, 401) * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const angle = offset + ((k + (arenaHash(row, k, 402) - 0.5) * 0.7) * 2 * Math.PI) / count;
      const r = radius + (arenaHash(row, k, 403) - 0.5) * spacing * 0.8;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      const conifer = arenaHash(row, k, 404) < 0.22;
      const crownR = size * (0.8 + 0.45 * arenaHash(row, k, 405));
      crowns.push({
        x,
        y: fireAndFlyRenderHeight(x, z) - 0.6,
        z,
        radius: conifer ? crownR * 0.62 : crownR,
        height: conifer
          ? crownR * (2.2 + 0.5 * arenaHash(row, k, 406))
          : crownR * (1.05 + 0.35 * arenaHash(row, k, 408)),
        conifer,
        tone: arenaHash(row, k, 407),
        near: radius < 150,
      });
    }
    radius += size * 1.25;
    row++;
  }
  return crowns;
}

/** The render base scale per species, the open world's (foliage.ts buildTrees),
 *  so an arena oak is the size of the oaks the player just left. */
const TREE_BASE_SCALE = { oak: 1.15, pine: 1.1 } as const;
const TREE_SINK = 0.05;

export interface ArenaTreePlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  heightJitter: number;
}

/** Where and how big a sim tree is drawn (its trunk is the collider's circle). */
export function fireAndFlyTreePlacement(tree: FireAndFlyTree): ArenaTreePlacement {
  const scale = tree.scale * TREE_BASE_SCALE[tree.kind];
  return {
    x: tree.x,
    y: fireAndFlyFieldHeight(tree.x, tree.z) - TREE_SINK * scale,
    z: tree.z,
    yaw: tree.rot,
    scale,
    heightJitter: 1 + (arenaHash(tree.x, tree.z, 31) - 0.5) * 0.18,
  };
}

/** How much of the tree ring a tier draws, one keep fraction per row from the
 *  clearing outward: the inner row is always whole, the far rows thin first
 *  (the rows in front hide most of them from the tower). */
export const FIRE_AND_FLY_TREE_ROW_KEEP = {
  full: [1, 1, 1, 1, 1, 1],
  medium: [1, 0.85, 0.65, 0.5, 0.42, 0.38],
  low: [1, 0.55, 0.3, 0.2, 0.15, 0.12],
} as const;

export type ArenaTreeDensity = keyof typeof FIRE_AND_FLY_TREE_ROW_KEEP;

/** The static preset tier's ring density (never the FPS governor's level). */
export function fireAndFlyTreeDensity(tier: GfxTier): ArenaTreeDensity {
  return tier === 'low' ? 'low' : tier === 'medium' ? 'medium' : 'full';
}

const drawnTrees = new Map<ArenaTreeDensity, readonly FireAndFlyTree[]>();

/**
 * The trees a density draws. Fairness: the sim's wall stands just behind the
 * inner row, which every density keeps whole, so every trunk a thrown body can
 * reach is drawn on every tier; the rows behind the wall are scenery nobody
 * plays in, with no collider. Each row keeps its share spread evenly around the
 * circle (no bare arc), from a per-row phase so the gaps of neighbouring rows
 * do not line up.
 */
export function fireAndFlyDrawnTrees(density: ArenaTreeDensity): readonly FireAndFlyTree[] {
  const cached = drawnTrees.get(density);
  if (cached) return cached;
  const keep = FIRE_AND_FLY_TREE_ROW_KEEP[density];
  const kept: FireAndFlyTree[] = [];
  FIRE_AND_FLY_TREE_ROWS.forEach((row, k) => {
    const count = Math.round(row.length * keep[Math.min(k, keep.length - 1)]);
    const phase = arenaHash(k, 0, 611);
    for (let i = 0; i < count; i++) kept.push(row[Math.floor(((i + phase) * row.length) / count)]);
  });
  drawnTrees.set(density, kept);
  return kept;
}

/** True for a tree whose shadow the low sun throws into the clearing: the sun
 *  side of the ring, inner rows only (outer shadows fall on the forest floor
 *  under the other trees, where nobody looks). */
export function fireAndFlyTreeCastsIntoClearing(tree: FireAndFlyTree): boolean {
  const r = Math.hypot(tree.x, tree.z);
  if (r > 82) return false;
  const facing =
    (tree.x * FIRE_AND_FLY_SUN_DIRECTION.x + tree.z * FIRE_AND_FLY_SUN_DIRECTION.z) /
    Math.max(1e-6, r * Math.hypot(FIRE_AND_FLY_SUN_DIRECTION.x, FIRE_AND_FLY_SUN_DIRECTION.z));
  return facing > -0.15;
}

/** The leaf tint family of a tree: mostly summer green, a few oaks already
 *  touched with gold. */
export function fireAndFlyLeafTone(tree: FireAndFlyTree): 'pine' | 'oak' | 'goldenOak' {
  if (tree.kind === 'pine') return 'pine';
  return arenaHash(tree.x, tree.z, 37) < 0.09 ? 'goldenOak' : 'oak';
}

export interface ArenaRockPlacement {
  x: number;
  z: number;
  /** ground under the rock's center */
  ground: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  /** footprint scales across x and z, before the model's own size */
  sx: number;
  sz: number;
}

/** A sim rock's drawn pose: the open world's boulder rule (foliage.ts), whose
 *  vertical scale the painter solves from the sim height so the stone you see
 *  is the stone the bodies bounce off. */
export function fireAndFlyRockPlacement(rock: FireAndFlyRock): ArenaRockPlacement {
  const h1 = arenaHash(rock.x, rock.z, 8);
  const h2 = arenaHash(rock.x, rock.z, 9);
  const sx = rock.scale * 0.62 * (0.85 + h2 * 0.5);
  const sz = rock.scale * 0.62 * (0.85 + h1 * 0.45);
  const tilt = Math.max(sx, sz) > 0.8 ? 0.12 : 0.26;
  return {
    x: rock.x,
    z: rock.z,
    ground: fireAndFlyFieldHeight(rock.x, rock.z),
    yaw: rock.rot,
    tiltX: (h1 - 0.5) * tilt,
    tiltZ: (h2 - 0.5) * tilt,
    sx,
    sz,
  };
}

export interface ArenaMote {
  x: number;
  y: number;
  z: number;
}

/** Pollen and dust hanging in the low sun: thickest along the sunlit forest
 *  edge, thin over the clearing, clear of the tower. */
export function fireAndFlyMotes(count: number): ArenaMote[] {
  const motes: ArenaMote[] = [];
  for (let i = 0; i < count; i++) {
    const edge = arenaHash(i, 0, 501) < 0.55;
    const r = edge
      ? FIRE_AND_FLY_CLEARING_RADIUS - 8 + arenaHash(i, 1, 502) * 16
      : 7 + arenaHash(i, 2, 503) * (FIRE_AND_FLY_CLEARING_RADIUS - 12);
    const angle = arenaHash(i, 3, 504) * Math.PI * 2;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;
    motes.push({
      x,
      y: fireAndFlyFieldHeight(x, z) + 0.5 + arenaHash(i, 4, 505) * (edge ? 7.5 : 4.5),
      z,
    });
  }
  return motes;
}
