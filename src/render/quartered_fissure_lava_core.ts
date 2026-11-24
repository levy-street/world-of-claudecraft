// The Cinderscar's molten fissures as plain numbers: a lava sheet laid in the
// shatter fissures and burnway beds of the Quartered Isle's fire quarter, so
// the cracks between the broken plates read as glowing rivers (the design's key art: red-brown
// rock with orange melt filling every crack and hollow). Three-free and
// DOM-free so a Vitest pins it; quartered_landmark_dressing.ts is the thin
// consumer that wraps each tile in one mesh.
//
// The shape is read from the sim leaf (quartered_landmarks.ts
// quarteredFissureDepth and quarteredBurnwayDepth, the exact cuts the terrain
// makes) and the shared
// quarter field (quarterWeightsAt), so the melt moves with the fissures.
// The lava vents' pools (the generated vent props, content/quartered_spires.ts)
// are discs of the same melt. Cosmetic only: nothing here feeds a collider or
// the sim.
//
// How a level-ish melt sits in a V-shaped crack without floating: the sheet is
// a grid sampled every LAVA_GRID_STEP yards. A WET node (deep enough, in the
// fire quarter) stands at the lowest ground round it (a small window, so the
// melt is level across the crack instead of draping its walls) plus a lift;
// the walls rise above that and hide the sheet's flanks. A cell with any wet
// corner is emitted, and its dry corners dive BELOW the melt beside them (and
// below their own ground), never up to it: a dry corner on a heaved plate
// stands far above the melt, and pinning the rim to that ground once stood
// the sheet up as a wall of lava. The rim always dives into the rock. Where
// the fire weight fades the lift fades with it and the melt sinks under the
// floor, so the lava thins out across the quarter seam instead of stopping
// on a line.

import { quarteredBurnwayDepth, quarteredFissureDepth } from '../sim/quartered_landmarks';
import { quarterWeightsAt } from '../sim/quartered_quarters';
import { ISLE_SHATTER } from '../sim/quartered_shatter';

type GroundAt = (x: number, z: number) => number;
type FieldAt = (x: number, z: number) => number;

/** The sampling grid's spacing, yards. A fissure's floor is 3 to 5yd across,
 *  so this keeps two or three wet nodes across every crack. */
export const LAVA_GRID_STEP = 2;
/** A node is wet once the fissure is cut at least this deep there. */
export const LAVA_MIN_DEPTH = 2.5;
/** The fire weight band the melt fades in across. */
export const LAVA_FIRE_LO = 0.42;
export const LAVA_FIRE_HI = 0.62;
/** How far the melt stands over the crack's floor at full fire. */
export const LAVA_LIFT = 0.8;
/** How far under its floor the melt sinks where the fire weight is gone. */
export const LAVA_SINK = 0.6;
/** How far under its own ground a dry rim node drops. */
export const LAVA_SKIRT = 0.5;
/** How far under the melt beside it a dry rim node drops (it never rises
 *  toward its own ground). */
export const LAVA_RIM_DROP = 1.2;
/** The floor window's half width, in grid nodes (2 is 4yd each way). */
const FLOOR_WINDOW = 2;
/** The sheet splits into square tiles this wide, one mesh each, so the
 *  zone-feature sweep can shed the far ones (one isle-wide footprint never
 *  culls). */
export const LAVA_TILE_SIZE = 128;

/** How much deeper than its cut a burnway's bed reads to the melt: the beds
 *  are 1.4yd deep, under LAVA_MIN_DEPTH, so this lifts their floor (and a hand
 *  of each bank) into the wet set and the burnways run with the same melt as
 *  the fissures. */
export const BURNWAY_MELT_GAIN = 2.2;

/** The Cinderscar's melt depth at (x, z): the deeper of the shatter fissure
 *  and the burnway bed (scaled by BURNWAY_MELT_GAIN). */
export function cinderscarMeltDepth(x: number, z: number): number {
  return Math.max(quarteredFissureDepth(x, z), quarteredBurnwayDepth(x, z) * BURNWAY_MELT_GAIN);
}

/** A lava vent's pool, as a share of the vent model's footprint (the pool
 *  inside its stone ring), and how far over the vent's ground it stands. */
export const VENT_POOL_SHARE = 0.21;
export const VENT_POOL_LIFT = 0.22;
const VENT_POOL_SEGMENTS = 20;

/** One flat disc of melt in every lava vent's ring, merged into one mesh.
 *  `w` is the vent's footprint at its placed scale, yards. */
export function planVentPools(
  groundAt: GroundAt,
  vents: readonly { x: number; z: number; w: number }[],
): { positions: Float32Array; indices: Uint32Array } {
  const per = VENT_POOL_SEGMENTS + 1;
  const positions = new Float32Array(vents.length * per * 3);
  const indices = new Uint32Array(vents.length * VENT_POOL_SEGMENTS * 3);
  vents.forEach((v, n) => {
    const r = v.w * VENT_POOL_SHARE;
    const y = groundAt(v.x, v.z) + VENT_POOL_LIFT;
    const base = n * per;
    positions.set([v.x, y, v.z], base * 3);
    for (let k = 0; k < VENT_POOL_SEGMENTS; k++) {
      const a = (k / VENT_POOL_SEGMENTS) * Math.PI * 2;
      positions.set([v.x + Math.cos(a) * r, y, v.z + Math.sin(a) * r], (base + 1 + k) * 3);
      // counter-clockwise from above, so the disc faces up
      indices.set(
        [base, base + 1 + ((k + 1) % VENT_POOL_SEGMENTS), base + 1 + k],
        (n * VENT_POOL_SEGMENTS + k) * 3,
      );
    }
  });
  return { positions, indices };
}

export interface FissureLavaTile {
  /** the tile's index on the LAVA_TILE_SIZE grid */
  ti: number;
  tj: number;
  /** xyz per vertex, world yards */
  positions: Float32Array;
  /** three per triangle */
  indices: Uint32Array;
}

export interface FissureLavaFields {
  groundAt: GroundAt;
  /** the melt's cut depth at (x, z), yards; defaults to the fissures and
   *  the burnway beds (cinderscarMeltDepth) */
  depthAt?: FieldAt;
  /** the fire quarter's weight at (x, z), 0..1 */
  fireAt?: FieldAt;
  /** the grid's extent; defaults to the shattering's own rect */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** How strongly the melt shows at a fire weight, 0..1. */
export function lavaFireShare(fire: number): number {
  return smoothstep(LAVA_FIRE_LO, LAVA_FIRE_HI, fire);
}

/**
 * Every lava tile over the isle's fire quarter. Deterministic (fixed grid, no
 * rng). `groundAt` is the finished terrain sampler (the caller passes
 * terrainHeight); the depth and fire fields default to the sim's own.
 */
export function planFissureLava(fields: FissureLavaFields): FissureLavaTile[] {
  const depthAt = fields.depthAt ?? cinderscarMeltDepth;
  const fireAt = fields.fireAt ?? ((x: number, z: number) => quarterWeightsAt(x, z).fire);
  const b = fields.bounds ?? ISLE_SHATTER;
  const step = LAVA_GRID_STEP;
  const nx = Math.floor((b.maxX - b.minX) / step) + 1;
  const nz = Math.floor((b.maxZ - b.minZ) / step) + 1;
  const n = nx * nz;
  const share = new Float32Array(n);
  const wet = new Uint8Array(n);
  for (let j = 0; j < nz; j++) {
    const z = b.minZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = b.minX + i * step;
      const f = lavaFireShare(fireAt(x, z));
      if (f <= 0) continue;
      share[j * nx + i] = f;
      if (depthAt(x, z) >= LAVA_MIN_DEPTH) wet[j * nx + i] = 1;
    }
  }

  // the ground, sampled lazily: only round the wet nodes
  const ground = new Float64Array(n).fill(Number.NaN);
  const groundOf = (i: number, j: number): number => {
    const k = j * nx + i;
    let g = ground[k];
    if (Number.isNaN(g)) {
      g = fields.groundAt(b.minX + i * step, b.minZ + j * step);
      ground[k] = g;
    }
    return g;
  };
  const wetSurfaceOf = (i: number, j: number): number => {
    let floor = Infinity;
    for (let dj = -FLOOR_WINDOW; dj <= FLOOR_WINDOW; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= nz) continue;
      for (let di = -FLOOR_WINDOW; di <= FLOOR_WINDOW; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= nx) continue;
        floor = Math.min(floor, groundOf(ii, jj));
      }
    }
    const f = share[j * nx + i];
    // never above the node's own ground plus the lift (a window min cannot
    // exceed it, but a fade must never raise the melt either)
    return Math.min(floor + (LAVA_LIFT + LAVA_SINK) * f - LAVA_SINK, groundOf(i, j) + LAVA_LIFT);
  };
  const surfaceOf = (i: number, j: number): number => {
    if (wet[j * nx + i]) return wetSurfaceOf(i, j);
    // a dry rim node: under the lowest melt beside it, and under its own ground
    let melt = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= nz) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= nx || !wet[jj * nx + ii]) continue;
        melt = Math.min(melt, wetSurfaceOf(ii, jj));
      }
    }
    return Math.min(groundOf(i, j) - LAVA_SKIRT, melt - LAVA_RIM_DROP);
  };

  // one vertex map and buffer set per tile
  interface Build {
    ti: number;
    tj: number;
    verts: number[];
    tris: number[];
    index: Map<number, number>;
  }
  const builds = new Map<number, Build>();
  const tileOf = (i: number, j: number): Build => {
    const ti = Math.floor((i * step) / LAVA_TILE_SIZE);
    const tj = Math.floor((j * step) / LAVA_TILE_SIZE);
    const key = tj * 4096 + ti;
    let t = builds.get(key);
    if (!t) {
      t = { ti, tj, verts: [], tris: [], index: new Map() };
      builds.set(key, t);
    }
    return t;
  };
  const vertexOf = (t: Build, i: number, j: number): number => {
    const k = j * nx + i;
    let v = t.index.get(k);
    if (v === undefined) {
      v = t.verts.length / 3;
      t.verts.push(b.minX + i * step, surfaceOf(i, j), b.minZ + j * step);
      t.index.set(k, v);
    }
    return v;
  };

  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const k = j * nx + i;
      if (!(wet[k] || wet[k + 1] || wet[k + nx] || wet[k + nx + 1])) continue;
      const t = tileOf(i, j);
      const a = vertexOf(t, i, j);
      const c = vertexOf(t, i + 1, j);
      const d = vertexOf(t, i, j + 1);
      const e = vertexOf(t, i + 1, j + 1);
      // counter-clockwise seen from above (+y up, x right, z toward the viewer)
      t.tris.push(a, d, c, c, d, e);
    }
  }

  return [...builds.values()]
    .sort((p, q) => p.tj - q.tj || p.ti - q.ti)
    .map((t) => ({
      ti: t.ti,
      tj: t.tj,
      positions: Float32Array.from(t.verts),
      indices: Uint32Array.from(t.tris),
    }));
}

/** Triangles across every tile (the budget pin). */
export function fissureLavaTriangles(tiles: readonly FissureLavaTile[]): number {
  return tiles.reduce((sum, t) => sum + t.indices.length / 3, 0);
}
