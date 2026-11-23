// FORK: one carve interior TILE, marched from the field: the pure core both
// threads share. The main thread marches tiles synchronously for a live edit
// (a Dig stroke wants its wall now); the zone build worker marches them for
// camera-LOD ring changes and the bake, so a maker moving about a dug map
// never pays a march on the frame. No THREE here, no editor state: a job
// carries every input by value (postMessage clones it).

import { carveFieldAt } from '../sim/terrain_cuts';
import type { TerrainCut } from '../sim/types';
import { buildCavityMesh, type CavityMeshArrays, clusterCavityMesh } from './cut_cavity_core';
import { meshTerrainHeight } from './terrain_mesh_height';

/** World-aligned tile edge (yards). Divisible by every cell step. */
export const CAVITY_TILE = 16;
/** Lattice size for the tile decimation, as a fraction of the cell. */
export const CAVITY_CLUSTER_Q = 0.75;
/** Bounds pad so the mesh grid fully contains the field's zero set. */
export const CAVITY_PAD = 1;
/** Yards the interior rises past the ground surface at a mouth. The ground
 *  chunk clips its opening on ITS lattice (1.2 to 2.6 yd, coarser in the
 *  camera LOD rings) and the interior on this one, so the two edges never
 *  meet exactly: the interior overshoots and, drawn front-face only, the
 *  overshoot shows from inside the cave (closing the gap) and is culled from
 *  outside (its normals face the cavity). */
export const CAVITY_CLIP_RISE = 0.35;

export interface CavityTileJob {
  x0: number;
  y0: number;
  z0: number;
  cell: number;
  /** Neighbour cell ratios across [-x, +x, -z, +z] (1 = no stitching). */
  faceCoarse: readonly [number, number, number, number];
  /** The field solids this tile honours (already narrowed to the tile). */
  cuts: readonly TerrainCut[];
  patches?: readonly TerrainCut[];
  seed: number;
  /** The map's cave-brightness tint floor (cut_cavity_core caveDark); absent = shipped dark. */
  caveDark?: number;
}

// The terrain surface a tile clips against, on a 1-yd lattice with bilinear
// interpolation between the samples. The core asks for a height at every
// lattice column of the tile (65 x 65 at a quarter-yard cell) and the world's
// height function is the single most expensive call in a march (an authored
// map replays every sculpt edit per call); the ground mesh itself is linear
// between vertices 1.2 yd apart, so a 1-yd lattice is no coarser than the
// surface it must meet. Lattices anchor on tile corners, so neighbouring
// tiles share their border samples exactly.
const HEIGHT_LATTICE = 1;
export function tileHeightSampler(
  x0: number,
  z0: number,
  seed: number,
): (x: number, z: number) => number {
  const n = CAVITY_TILE / HEIGHT_LATTICE + 1;
  const h = new Float32Array(n * n);
  const have = new Uint8Array(n * n);
  const at = (i: number, k: number): number => {
    const id = k * n + i;
    if (!have[id]) {
      h[id] = meshTerrainHeight(x0 + i * HEIGHT_LATTICE, z0 + k * HEIGHT_LATTICE, seed);
      have[id] = 1;
    }
    return h[id];
  };
  return (x, z) => {
    const fx = Math.min(n - 1 - 1e-6, Math.max(0, (x - x0) / HEIGHT_LATTICE));
    const fz = Math.min(n - 1 - 1e-6, Math.max(0, (z - z0) / HEIGHT_LATTICE));
    const i = fx | 0;
    const k = fz | 0;
    const u = fx - i;
    const v = fz - k;
    return (
      at(i, k) * (1 - u) * (1 - v) +
      at(i + 1, k) * u * (1 - v) +
      at(i, k + 1) * (1 - u) * v +
      at(i + 1, k + 1) * u * v
    );
  };
}

/** March one tile and lighten it. Null when the field crosses nothing here. */
export function marchCavityTile(job: CavityTileJob): CavityMeshArrays | null {
  if (job.cuts.length === 0) return null;
  const n = Math.round(CAVITY_TILE / job.cell);
  const surface = tileHeightSampler(job.x0, job.z0, job.seed);
  const cuts = job.cuts;
  const patches = job.patches;
  let arrays = buildCavityMesh({
    x0: job.x0,
    y0: job.y0,
    z0: job.z0,
    cell: job.cell,
    nx: n,
    ny: n,
    nz: n,
    fieldAt: (x, y, z) => carveFieldAt(cuts, patches, x, y, z),
    heightAt: (x, z) => surface(x, z) + CAVITY_CLIP_RISE,
    faceCoarse: job.faceCoarse,
    caveDark: job.caveDark,
  });
  if (!arrays) return null;
  arrays = clusterCavityMesh(arrays, job.cell * CAVITY_CLUSTER_Q, {
    x0: job.x0,
    y0: job.y0,
    z0: job.z0,
    size: CAVITY_TILE,
  });
  if (arrays.indices.length === 0) return null;
  return arrays;
}

/** Every buffer a result carries, so postMessage moves them. */
export function cavityTransferList(a: CavityMeshArrays): Transferable[] {
  return [a.positions.buffer, a.normals.buffer, a.colors.buffer, a.uvs.buffer, a.indices.buffer];
}
