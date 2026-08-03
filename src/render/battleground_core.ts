// The battleground field's render manifest: a PURE projection of the authored
// Thornhollow map (src/sim/thornhollow_field.generated.ts) into the buckets the
// Three layer instances. No three.js, no DOM, so a Vitest pins the whole
// field's geometry headlessly.
//
// The field is authored art, not generated geometry: every wall, tree, crate
// and torch is a placement the compiler emitted alongside the collider it
// blocks with, so "what you see is what you collide with" holds by
// construction rather than by two code paths agreeing about a layout record.
// This module therefore does no layout work at all; it groups placements for
// instancing, plans the terrain chunks, and resolves the ground-paint tables.

import { bgFieldPaintCells } from '../sim/battleground_field';
import {
  TH_DECALS,
  TH_HALF_X,
  TH_HALF_Z,
  TH_HEIGHT_COLS,
  TH_HEIGHT_ROWS,
  TH_LIGHTS,
  TH_PAINT_CELL,
  TH_PAINT_COLS,
  TH_PAINT_ORIGIN_X,
  TH_PAINT_ORIGIN_Z,
  TH_PAINT_ROWS,
  TH_PAINT_SWATCHES,
  TH_PLACEMENTS,
  type ThFieldPlacement,
} from '../sim/thornhollow_field.generated';

export type { ThFieldPlacement };

/** Ground textures live beside the map that painted them. */
export const BG_TEXTURE_DIR = 'textures/battleground';

/** Field-local extents, restated so consumers need one import. */
export const BG_FIELD_HALF_X = TH_HALF_X;
export const BG_FIELD_HALF_Z = TH_HALF_Z;

/**
 * How far the out-of-play SLOPE DRESSING reaches beyond the field rect.
 *
 * The hollow's wooded lip is authored outside the walls, on detached anchors
 * that climb away from the ramparts, so what shows over a rampart top is forest
 * rather than the edge of the world. None of it collides and none of it is
 * reachable (the enceinte stands between it and the field), which is why the
 * COLLIDER set is pinned to the field rect while the placement set is pinned
 * here: art may frame the hollow, but nothing that blocks may leave it.
 */
export const BG_DRESSING_HALF_X = 106;
export const BG_DRESSING_HALF_Z = 196;

/** Lift for flat ground decoration (rune discs, decals) so it never z-fights
 *  the terrain it lies on. */
export const BG_FLOOR_Y = 0.06;
/** Height of a torch's additive glow above its own seat. */
export const BG_TORCH_GLOW_H = 2.6;

/** Terrain mesh chunking: one draw call and one frustum-cull unit per chunk.
 *  32yd chunks put the whole field at 8 x 15 chunks, small enough that a keep
 *  or a ridge culls independently and large enough to stay cheap. */
export const BG_TERRAIN_CHUNK = 32;
/** Terrain mesh resolution: matches the baked heightfield's 1yd cells, so the
 *  drawn surface interpolates exactly what the sim walks on. */
export const BG_TERRAIN_CELL = 1;

export interface BgTerrainChunk {
  /** Field-local bounds of the chunk (the max edge is the shared seam). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The terrain chunk plan: contiguous, seam-sharing, covering the whole rect. */
export function bgTerrainChunks(): BgTerrainChunk[] {
  const out: BgTerrainChunk[] = [];
  for (let x = -TH_HALF_X; x < TH_HALF_X; x += BG_TERRAIN_CHUNK) {
    for (let z = -TH_HALF_Z; z < TH_HALF_Z; z += BG_TERRAIN_CHUNK) {
      out.push({
        minX: x,
        minZ: z,
        maxX: Math.min(TH_HALF_X, x + BG_TERRAIN_CHUNK),
        maxZ: Math.min(TH_HALF_Z, z + BG_TERRAIN_CHUNK),
      });
    }
  }
  return out;
}

/** One instancing bucket: every placement of a single catalogue asset. */
export interface BgAssetGroup {
  assetId: string;
  /** Model path the loader fetches. */
  path: string;
  placements: readonly ThFieldPlacement[];
}

/** Grass tufts are procedural (hue/lum/clump), never a GLB. */
export const BG_GRASS_ASSET = 'grass/patch';

/**
 * Every GLB-backed placement, grouped by asset so the Three layer emits one
 * InstancedMesh set per model. Sorted by asset id so the draw order (and the
 * manifest a test reads) is stable.
 */
export function bgAssetGroups(): BgAssetGroup[] {
  const byAsset = new Map<string, ThFieldPlacement[]>();
  for (const p of TH_PLACEMENTS) {
    if (p.assetId === BG_GRASS_ASSET) continue;
    const bucket = byAsset.get(p.assetId);
    if (bucket) bucket.push(p);
    else byAsset.set(p.assetId, [p]);
  }
  return [...byAsset.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([assetId, placements]) => ({ assetId, path: `/models/${assetId}.glb`, placements }));
}

/** The procedural grass tufts, in placement order. */
export function bgGrassPatches(): readonly ThFieldPlacement[] {
  return TH_PLACEMENTS.filter((p) => p.assetId === BG_GRASS_ASSET);
}

/** Point lights the map authored (braziers, torch clusters, the flag shrines). */
export function bgFieldLights(): typeof TH_LIGHTS {
  return TH_LIGHTS;
}

/** Ground decals the map authored (the Fightpit's blood). */
export function bgFieldDecals(): typeof TH_DECALS {
  return TH_DECALS;
}

// ---------------------------------------------------------------------------
// Ground paint
// ---------------------------------------------------------------------------

export interface BgPaintSwatch {
  id: number;
  texture: string;
  tileSize: number;
  light: number;
}

export interface BgPaintLookup {
  /** Row-major swatch LAYER INDEX per cell; 255 = unpainted. */
  ids: Uint8Array<ArrayBuffer>;
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originZ: number;
  /** Swatch table in layer order, aligned with the texture array. */
  swatches: readonly BgPaintSwatch[];
}

let paintCache: BgPaintLookup | null = null;

/**
 * Decode the run-length ground paint into a dense index grid.
 *
 * The map stores swatch IDS (200..217); the renderer wants LAYER INDICES into
 * a texture array, so the decode remaps through the swatch table once here
 * rather than per fragment. Unpainted cells stay 255 and read as bare ground.
 *
 * The run-length WALK itself is shared with the M-map atlas plate, which wants
 * the same cells resolved to a different per-cell value: it lives once in
 * `bgFieldPaintCells` (src/sim/battleground_field.ts) and takes the remap as an
 * argument, so neither consumer copies it or retains the other's grid.
 */
export function bgPaintLookup(): BgPaintLookup {
  if (paintCache) return paintCache;
  const swatches = TH_PAINT_SWATCHES;
  const indexById = new Map<number, number>();
  for (let i = 0; i < swatches.length; i++) indexById.set(swatches[i].id, i);
  const ids = bgFieldPaintCells((id) => indexById.get(id));
  paintCache = {
    ids,
    cols: TH_PAINT_COLS,
    rows: TH_PAINT_ROWS,
    cell: TH_PAINT_CELL,
    originX: TH_PAINT_ORIGIN_X,
    originZ: TH_PAINT_ORIGIN_Z,
    swatches,
  };
  return paintCache;
}

/** Distinct ground textures, in texture-array layer order. */
export function bgPaintTextureFiles(): string[] {
  return TH_PAINT_SWATCHES.map((s) => `${BG_TEXTURE_DIR}/${s.texture}.jpg`);
}

/** Heightfield dimensions, for the terrain builder's vertex loops. */
export const BG_HEIGHT_COLS = TH_HEIGHT_COLS;
export const BG_HEIGHT_ROWS = TH_HEIGHT_ROWS;
