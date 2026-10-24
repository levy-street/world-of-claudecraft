// The visible interior of every boolean CARVE: rooms, tunnels and pits meshed
// from the same carve field the sim stands on (sim/terrain_cuts.ts
// carveFieldAt), clipped to below the terrain surface. Legacy (non-carve)
// holes draw nothing here, they keep their v1 look, a rim skirt over a void.
//
// Layout: carve cuts cluster by overlapping padded bounds (a chain of blended
// solids is one cave), each cluster meshes at ONE cell size, and the volume is
// split into world-aligned TILES so an edit re-extracts only the tiles it
// touches. Same cell + same world alignment = identical crossings on shared
// tile faces, so tile borders cannot crack (pinned in tests/cut_cavity_core).
//
// Cell size: per cluster, the finest step whose total cell count fits the
// extraction budget. A remesh detail region (the Remesh brush) refines ONLY
// the tiles its disc touches, not the whole cluster: mixed-cell tile borders
// are stitched by linearizing the finer tile's shared-face samples onto the
// coarse neighbour's own face triangles (cut_cavity_core faceCoarse), so the
// crossings agree and the border cannot crack. Mixed cells are restricted to
// the power-of-two chain {0.25, 0.5, 1.0} for exactly that stitching.

import * as THREE from 'three';
import { BUILTIN_WORLD, getActiveWorldContent, getContentGeneration } from '../sim/data';
import { effectiveTerrainCuts } from '../sim/ground_sheets';
import {
  type CutBounds,
  carveFieldAt,
  cutBounds,
  cutVerticalBounds,
  voxelTouches,
} from '../sim/terrain_cuts';
import type { DetailRegion, TerrainCut } from '../sim/types';
import { paintedCellIdAt } from '../sim/world';
import { acquireTexture, loadTexture } from './assets/loader';
import { caveInteriorPaintLookup, caveInteriorTintAt, type PaintLookup } from './cave_mesh';
import {
  cavityBakeActive,
  cavityBakeGet,
  cavityBakeHas,
  cavityBakeInvalidate,
  cavityBakeStore,
} from './cut_cavity_bake';
import type { CavityMeshArrays } from './cut_cavity_core';
import { CAVITY_CLUSTER_Q, CAVITY_PAD, CAVITY_TILE, marchCavityTile } from './cut_cavity_tile_core';
import { meshTerrainHeight } from './terrain_mesh_height';
import {
  MAX_PAINT_SLOTS,
  PAINT_EDGE_WARP_GLSL,
  paintLayerRuntime,
  textureSlotSwatch,
} from './terrain_paint_layers';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';
import { applyTriplanarMaps } from './triplanar_maps';
import { zoneBuildPool } from './zone_build_pool';

export const CAVITY_GROUP_NAME = 'cutCavities';

// World-aligned tile edge (yards). Divisible by every cell step below.
const TILE = CAVITY_TILE;
// Cell steps as divisors of TILE, finest first, the SAME power-of-two chain
// the mixed-resolution stitching needs, so a base cell and a remesh region
// always have an integer ratio. 0.25yd resolves a fist-sized bump; 2yd is the
// coarse floor for huge caverns.
const CELL_STEPS = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0] as const;
const MAX_CELL: number = CELL_STEPS[CELL_STEPS.length - 1];
type RegionXZ = { minX: number; minZ: number; maxX: number; maxZ: number };
// FORK: camera-distance LOD rings for the interiors (SPACEY, 2026-09-12: "make
// the lod at 100 yds super low, 20x less polys at 100 yds; at 500 yds don't
// even render it"). A column meshes at its requested cell inside the first
// ring; each further ring MULTIPLIES the cell and also FLOORS it, so a finely
// dug cave still drops to a handful of triangles per tile out there (a
// surface mesh's triangle count falls with the square of the cell: x4 is
// about 16x fewer, x8 about 64x). Past the last ring a column is not meshed
// at all, the fog wall stands at 450-500 yd in play. Ring neighbours differ
// by a chain step the face stitching handles.
export interface CavityLodRing {
  /** Columns closer than this (yards, xz, to the tile's nearest edge). */
  dist: number;
  /** Cell multiplier inside the ring. */
  factor: number;
  /** Smallest cell inside the ring, whatever the base. */
  floor: number;
}
export const CAVITY_LOD_RINGS: readonly CavityLodRing[] = [
  { dist: 40, factor: 1, floor: 0 },
  { dist: 100, factor: 2, floor: 0 },
  { dist: 200, factor: 4, floor: 2 },
  { dist: 500, factor: 8, floor: 4 },
];
/** Past this distance a carve interior is not meshed at all. */
export const CAVITY_LOD_CULL = CAVITY_LOD_RINGS[CAVITY_LOD_RINGS.length - 1].dist;
/** From this distance on, a dark CAP lies just under each cluster's opening,
 *  so the extremely low-poly interior (or, past the cull, nothing at all)
 *  never shows the underside of the map through the hole. */
export const CAVITY_CAP_DIST = 200;
let lodCam: { x: number; z: number } | null = null;
/** The bake pass meshes every ring in turn: a fixed ring stands in for the
 *  camera while it enumerates a ring's tiles. */
let lodOverride: CavityLodRing | null = null;
function ringCell(cell: number, ring: CavityLodRing): number {
  return chainSnapNearest(Math.min(MAX_CELL, Math.max(cell * ring.factor, ring.floor)));
}
/** The cell a column of base `cell` meshes at `dist` yards from the camera;
 *  null past the last ring (not meshed). Pure, for the tests. */
export function cavityLodCell(cell: number, dist: number): number | null {
  for (const ring of CAVITY_LOD_RINGS) {
    if (dist < ring.dist) return ringCell(cell, ring);
  }
  return null;
}
/** Coarsen a column's cell by its distance to the LOD camera; null = culled. */
function lodCell(cell: number, tx: number, tz: number): number | null {
  if (lodOverride) return ringCell(cell, lodOverride);
  if (!lodCam) return cell;
  const minX = tx * TILE;
  const minZ = tz * TILE;
  const dx = Math.max(minX - lodCam.x, 0, lodCam.x - (minX + TILE));
  const dz = Math.max(minZ - lodCam.z, 0, lodCam.z - (minZ + TILE));
  return cavityLodCell(cell, Math.hypot(dx, dz));
}
// FORK: while a Dig, Fill or Smooth stroke is in progress the tiles under it
// mesh at twice their cell (fine cells only): a stroke refreshes every 140 ms
// and a 16-yd tile at a quarter-yard cell is 275k field samples, most of
// which the maker never sees before the next stamp lands. The stroke's end
// refreshes its region at full detail (the key carries the cell, so the
// preview tiles are simply replaced).
let previewCoarsen: { factor: number; region: RegionXZ } | null = null;
export function setCavityPreviewCoarsen(factor: number, region: RegionXZ | null): void {
  previewCoarsen = factor > 1 && region ? { factor, region } : null;
}
function columnTouches(tx: number, tz: number, region: RegionXZ): boolean {
  return (
    tx * TILE - PAD <= region.maxX &&
    (tx + 1) * TILE + PAD >= region.minX &&
    tz * TILE - PAD <= region.maxZ &&
    (tz + 1) * TILE + PAD >= region.minZ
  );
}
// Default target detail with no remesh regions painted. 1yd matches the
// heightfield's own near-band vertex spacing (terrain.ts bands, 1.2yd), so a
// carve is no denser than the ground it is cut out of; the Remesh brush
// refines (or coarsens) from there.
const DEFAULT_CELL = 1.0;
/** FORK: the document-wide base cell (the Remesh panel's "Cave mesh detail",
 *  WorldContent.caveMeshCell), snapped to the tile chain; DEFAULT_CELL when
 *  the map never set one. */
function baseCell(): number {
  const v = getActiveWorldContent().caveMeshCell;
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_CELL;
  return chainSnapNearest(Math.max(CELL_STEPS[0], Math.min(CELL_STEPS[CELL_STEPS.length - 1], v)));
}
/** FORK: the finest cell a cluster should be marched at: never finer than
 *  its dug volume's own voxel cell (there is no detail below it to show). */
function clusterFloorCell(cuts: readonly TerrainCut[]): number {
  let floor = 0;
  for (const c of cuts) if (c.shape === 'voxel' && c.cell) floor = Math.max(floor, c.cell);
  return floor;
}
/** FORK: lattice size for the tile decimation, as a fraction of the cell. */
const CLUSTER_Q = CAVITY_CLUSTER_Q;
// Extraction budget per CLUSTER (total grid cells across its volume). At 8
// bytes of transient state per cell this holds a rebuild in the tens of
// milliseconds; the picker coarsens the cell until the volume fits.
const CLUSTER_CELL_BUDGET = 2_200_000;
// One texture repeat per this many yards of rock.
const UV_SCALE = 1 / 4;
// Bounds pad so the mesh grid fully contains the field's zero set.
const PAD = CAVITY_PAD;

interface CavityCluster {
  cuts: TerrainCut[];
  bounds: CutBounds;
  minY: number;
  maxY: number;
  cell: number;
  /** Interior texture-set key + tiling period: the first carve of the cluster
   *  carrying one dresses the whole interior; with none authored, the Paint
   *  tool's dominant texture over the opening does ('' = default granite). */
  tex: string;
  texTile: number;
  /** True when tex came from the Paint tool rather than the carve panel: the
   *  per-vertex paint tint then stands down where it would double-apply. */
  texFromPaint: boolean;
}

function boundsOverlap(a: CutBounds, b: CutBounds, pad: number): boolean {
  return (
    a.minX - pad <= b.maxX &&
    a.maxX + pad >= b.minX &&
    a.minZ - pad <= b.maxZ &&
    a.maxZ + pad >= b.minZ
  );
}

/** The Paint tool's texture over a ground cell, when the cavity can wear it:
 *  a swatch whose texture resolves to a built-in set (imported shas have no
 *  cavity material path yet and keep the tint fallback). */
function paintedTextureAt(
  x: number,
  z: number,
  lookup: PaintLookup,
): { key: string; tile: number } | null {
  const id = paintedCellIdAt(x, z);
  if (id === null) return null;
  const sw = lookup.swatches.get(id);
  if (!sw) return null;
  const key = textureSlotSwatch(sw);
  if (!key || !terrainTextureSet(key)) return null;
  return { key, tile: sw.tileSize ?? 8 };
}

/** Union-find clustering of the carve cuts by padded footprint overlap. */
function buildClusters(
  cuts: readonly TerrainCut[],
  patches: readonly TerrainCut[],
  detail: readonly DetailRegion[] | undefined,
  seed: number,
): CavityCluster[] {
  const carves = cuts.filter((c) => c.carve === true);
  if (carves.length === 0) return [];
  const bounds = carves.map((c) => cutBounds(c));
  const parent = carves.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < carves.length; i++) {
    for (let j = i + 1; j < carves.length; j++) {
      if (boundsOverlap(bounds[i], bounds[j], PAD)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  const byRoot = new Map<number, CavityCluster>();
  for (let i = 0; i < carves.length; i++) {
    const root = find(i);
    let cl = byRoot.get(root);
    const v = cutVerticalBounds(carves[i]);
    if (!cl) {
      cl = {
        cuts: [carves[i]],
        bounds: { ...bounds[i] },
        minY: v.minY,
        maxY: v.maxY,
        cell: DEFAULT_CELL,
        tex: '',
        texTile: 0,
        texFromPaint: false,
      };
      byRoot.set(root, cl);
      continue;
    }
    cl.cuts.push(carves[i]);
    cl.bounds.minX = Math.min(cl.bounds.minX, bounds[i].minX);
    cl.bounds.maxX = Math.max(cl.bounds.maxX, bounds[i].maxX);
    cl.bounds.minZ = Math.min(cl.bounds.minZ, bounds[i].minZ);
    cl.bounds.maxZ = Math.max(cl.bounds.maxZ, bounds[i].maxZ);
    cl.minY = Math.min(cl.minY, v.minY);
    cl.maxY = Math.max(cl.maxY, v.maxY);
  }
  const clusters = [...byRoot.values()];
  const lookup = caveInteriorPaintLookup();
  for (const cl of clusters) {
    // Interior texture: first authored one wins, so a brush-dug extension of
    // a textured room inherits its rock instead of resetting it to granite.
    for (const cut of cl.cuts) {
      if (cut.tex && terrainTextureSet(cut.tex)) {
        cl.tex = cut.tex;
        cl.texTile = cut.texTile ?? 0;
        break;
      }
    }
    // No authored texture: the Paint tool dresses the interior instead. Only
    // paint over the OPENING counts (the surface point must fall inside the
    // carve), so painting the village ground above an intact cave ceiling
    // does not re-floor the cave; the majority texture over the opening wins.
    if (!cl.tex) {
      const counts = new Map<string, { n: number; tile: number }>();
      const ex = cl.bounds.maxX - cl.bounds.minX;
      const ez = cl.bounds.maxZ - cl.bounds.minZ;
      const step = Math.max(1.5, Math.max(ex, ez) / 12);
      for (let z = cl.bounds.minZ; z <= cl.bounds.maxZ + 1e-6; z += step) {
        for (let x = cl.bounds.minX; x <= cl.bounds.maxX + 1e-6; x += step) {
          const h = meshTerrainHeight(x, z, seed);
          if (carveFieldAt(cl.cuts, patches, x, h, z) >= 0) continue;
          const p = paintedTextureAt(x, z, lookup);
          if (!p) continue;
          const c = counts.get(p.key);
          if (c) c.n++;
          else counts.set(p.key, { n: 1, tile: p.tile });
        }
      }
      let best: { key: string; n: number; tile: number } | null = null;
      for (const [key, c] of counts) {
        if (!best || c.n > best.n) best = { key, n: c.n, tile: c.tile };
      }
      if (best) {
        cl.tex = best.key;
        cl.texTile = best.tile;
        cl.texFromPaint = true;
      }
    }
    // The BASE cell: the finest step whose volume fits the budget. Detail
    // regions no longer touch it, they re-cell individual tiles instead.
    const ex2 = cl.bounds.maxX - cl.bounds.minX + PAD * 2;
    const ey2 = cl.maxY - cl.minY + PAD * 2;
    const ez2 = cl.bounds.maxZ - cl.bounds.minZ + PAD * 2;
    cl.cell = CELL_STEPS[CELL_STEPS.length - 1];
    const minCell = Math.max(baseCell(), clusterFloorCell(cl.cuts));
    for (const step of CELL_STEPS) {
      if (step < minCell - 1e-9) continue;
      const cells = (ex2 / step) * (ey2 / step) * (ez2 / step);
      if (cells <= CLUSTER_CELL_BUDGET) {
        cl.cell = step;
        break;
      }
    }
  }
  return clusters;
}

// The mixed-resolution cell chain: every step divides the next, so a border
// between two of them always has an integer ratio for the face stitching.
// Identical to CELL_STEPS on purpose, every base cell is already on it.
const CELL_CHAIN = CELL_STEPS;

/** Nearest chain step, by log distance (0.4 -> 0.5, not 0.25): an off-chain
 *  region cell, the slider is continuous, and old documents carry 0.4, must
 *  not silently mesh a whole cluster at the finest step. */
function chainSnapNearest(cell: number): number {
  let best: number = CELL_CHAIN[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const step of CELL_CHAIN) {
    const d = Math.abs(Math.log(step / cell));
    if (d < bestD) {
      bestD = d;
      best = step;
    }
  }
  return best;
}

// One material per interior texture set ('' = the default granite), matching
// the cave tube interiors so a carve melting into a bore reads as one rock.
// The base tint (granite grey, or the painted swatch colour) rides the VERTEX
// colours (caveInteriorTintAt times the depth shade), so the material colour
// stays white and a re-textured or painted cavity needs no material rebuild.
// Cache key: `<setKey>@<tilePeriod>`, the triplanar re-projection bakes the
// tiling period into a per-material uniform, so two clusters tiling the same
// set differently need distinct material instances (one shared program).
const cavityMaterials = new Map<string, THREE.MeshStandardMaterial>();
// Texture release handles per custom-set material (see disposeUnusedCavityMats).
const cavityMatReleases = new Map<string, (() => void)[]>();

// FORK: the Paint tool's TEXTURE field, sampled per fragment on the cavity
// walls exactly as the ground does it (terrain_paint_layers.ts): paint on a
// cave floor or wall lands where the brush touched instead of re-dressing
// the whole cluster with the majority swatch over its opening. Every cavity
// material shares ONE uniform set, bound by reference, so a paint stroke
// (field bytes rewritten in place), a grown grid or a new textured swatch
// (refreshCavityPaint swaps the runtime) reach every interior with no
// material rebuild. The path is always compiled in, carve interiors only
// exist on authored maps, and stands down on `uPaintOn` while the map has
// no textured paint; the placeholders keep the samplers bound meanwhile.
const paintPlaceholderField = new THREE.DataTexture(new Uint8Array([255, 128, 128, 128]), 1, 1);
paintPlaceholderField.needsUpdate = true;
const paintPlaceholderTiles = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
paintPlaceholderTiles.needsUpdate = true;
const cavityPaintState = { on: { value: 0 } as { value: number } };
const cavityPaintUniforms = {
  uPaintField: { value: paintPlaceholderField as THREE.Texture },
  uPaintTiles: { value: paintPlaceholderTiles as THREE.Texture },
  uPaintGrid: { value: new THREE.Vector4(0, 0, 0, 0) },
  uPaintDims: { value: new THREE.Vector2(1, 1) },
  uPaintTileSizes: { value: new Float32Array(MAX_PAINT_SLOTS) as Float32Array },
  uPaintEdge: { value: new THREE.Vector2(0, 1) },
  uPaintOn: {
    get value() {
      return cavityPaintState.on.value;
    },
  },
};

/** Bind the active content's paint runtime to the cavity materials. Called
 *  beside TerrainView.refreshPaint whenever the ground's paint runtime may
 *  have changed identity (the terrain owns disposal of the old textures). */
export function refreshCavityPaint(): void {
  const rt = paintLayerRuntime();
  const u = cavityPaintUniforms;
  u.uPaintField.value = rt.field ?? paintPlaceholderField;
  u.uPaintTiles.value = rt.tiles ?? paintPlaceholderTiles;
  u.uPaintGrid.value = rt.grid;
  u.uPaintDims.value = rt.dims;
  u.uPaintTileSizes.value = rt.tileSizes;
  u.uPaintEdge.value = rt.edge;
  cavityPaintState.on = rt.field && rt.tiles ? rt.on : { value: 0 };
}

const CAVITY_PAINT_FRAG = `
        vec3 wocCavPaintCol = vec3(0.0);
        vec3 wocCavEmis = vec3(0.0);
        float wocCavPaintW = 0.0;
        if (uPaintOn > 0.5) {
          // Same warp + kernel width as the ground splat: a carve interior is
          // painted from the SAME field, so a boundary that runs across a cave
          // mouth has to meet itself on both surfaces.
          vec2 wocCavXZ = vTriPos.xz + wocEdgeWarp(vTriPos.xz) * uPaintEdge.x;
          float wocSp = max(uPaintEdge.y, 1.0);
          vec2 wocQ = (wocCavXZ - uPaintGrid.xy) * uPaintGrid.z;
          vec2 wocCs = (wocQ - 0.5 * wocSp) / wocSp;
          vec2 wocI = floor(wocCs);
          vec2 wocFr = smoothstep(0.0, 1.0, fract(wocCs));
          // Explicit gradients: the array taps sit inside branches.
          vec3 wocDx = dFdx(vTriPos);
          vec3 wocDy = dFdy(vTriPos);
          vec3 wocTriW = pow(abs(normalize(vTriN)), vec3(4.0));
          wocTriW /= (wocTriW.x + wocTriW.y + wocTriW.z);
          float wocPaintN = 0.0;
          vec3 wocDepthShade = vColor.rgb;
          vec2 wocC0uv = wocQ / uPaintDims;
          vec4 wocF0 = texture2D(uPaintField, wocC0uv);
          float wocRaw0 = floor(wocF0.r * 255.0 + 0.5);
          bool wocIn0 =
            wocC0uv.x >= 0.0 && wocC0uv.x < 1.0 && wocC0uv.y >= 0.0 && wocC0uv.y < 1.0;
          bool wocPainted0 = wocIn0 && wocRaw0 < 250.0;
          bool wocInterior0 = wocPainted0 && wocRaw0 >= 128.0;
          if (wocInterior0) {
            float wocSlot0 = wocRaw0 - 128.0 * step(128.0, wocRaw0);
            float wocPeriod0 = uPaintTileSizes[int(min(wocSlot0, ${(MAX_PAINT_SLOTS - 1).toFixed(1)}))];
            vec4 wocTexel0 =
              textureGrad(uPaintTiles, vec3(vTriPos.zy / wocPeriod0, wocSlot0),
                wocDx.zy / wocPeriod0, wocDy.zy / wocPeriod0) * wocTriW.x +
              textureGrad(uPaintTiles, vec3(vTriPos.xz / wocPeriod0, wocSlot0),
                wocDx.xz / wocPeriod0, wocDy.xz / wocPeriod0) * wocTriW.y +
              textureGrad(uPaintTiles, vec3(vTriPos.xy / wocPeriod0, wocSlot0),
                wocDx.xy / wocPeriod0, wocDy.xy / wocPeriod0) * wocTriW.z;
            vec3 wocTint0 = wocF0.gba * 2.0;
            wocCavPaintCol = wocTexel0.rgb * wocTint0;
            wocCavEmis = wocTexel0.rgb * (wocTexel0.a * 1.7) * wocTint0;
            wocPaintN = 1.0;
          } else {
            vec3 wocAcc = vec3(0.0);
            vec3 wocEmisAcc = vec3(0.0);
            for (int wpi = 0; wpi < 4; wpi++) {
              vec2 wocIJ = floor(
                (wocI + vec2(wpi < 2 ? 0.0 : 1.0, (wpi == 0 || wpi == 2) ? 0.0 : 1.0)) * wocSp +
                  0.5 * wocSp);
              float wocBW = (wpi < 2 ? 1.0 - wocFr.x : wocFr.x) *
                ((wpi == 0 || wpi == 2) ? 1.0 - wocFr.y : wocFr.y);
              vec2 wocCuv = (wocIJ + 0.5) / uPaintDims;
              float wocInRange =
                step(0.0, wocCuv.x) * step(wocCuv.x, 0.999999) *
                step(0.0, wocCuv.y) * step(wocCuv.y, 0.999999);
              vec4 wocF = texture2D(uPaintField, wocCuv);
              float wocRaw = floor(wocF.r * 255.0 + 0.5);
              wocBW *= wocInRange * step(wocRaw, 249.0);
              if (wocBW > 0.001) {
                float wocSlot = min(wocRaw - 128.0 * step(128.0, wocRaw), ${(MAX_PAINT_SLOTS - 1).toFixed(1)});
                float wocPeriod = uPaintTileSizes[int(wocSlot)];
                vec4 wocTexel =
                  textureGrad(uPaintTiles, vec3(vTriPos.zy / wocPeriod, wocSlot),
                    wocDx.zy / wocPeriod, wocDy.zy / wocPeriod) * wocTriW.x +
                  textureGrad(uPaintTiles, vec3(vTriPos.xz / wocPeriod, wocSlot),
                    wocDx.xz / wocPeriod, wocDy.xz / wocPeriod) * wocTriW.y +
                  textureGrad(uPaintTiles, vec3(vTriPos.xy / wocPeriod, wocSlot),
                    wocDx.xy / wocPeriod, wocDy.xy / wocPeriod) * wocTriW.z;
                vec3 wocTint = wocF.gba * 2.0;
                wocAcc += wocTexel.rgb * wocTint * wocBW;
                wocEmisAcc += wocTexel.rgb * (wocTexel.a * 1.7) * wocTint * wocBW;
                wocPaintN += wocBW;
              }
            }
            if (wocPaintN > 0.001) {
              wocCavPaintCol = wocAcc / wocPaintN;
              wocCavEmis = wocEmisAcc / wocPaintN;
            }
          }
          wocCavPaintW = min(1.0, wocPaintN);
          // Interiors are unlit rock: the painted texture wears the same depth
          // shade the vertex colours carry, pulled toward cave dark.
          wocCavPaintCol *= wocDepthShade * 0.82;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, wocCavPaintCol, wocCavPaintW);`;

/** Layer the paint field onto a triplanar cavity material: runs after
 *  applyTriplanarMaps (whose vTriPos/vTriN varyings it reuses). */
function applyCavityPaint(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, cavityPaintUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'uniform float uTriScale;',
        `uniform float uTriScale;
        uniform sampler2D uPaintField;
        uniform sampler2DArray uPaintTiles;
        uniform vec4 uPaintGrid;
        uniform vec2 uPaintDims;
        uniform float uPaintTileSizes[${MAX_PAINT_SLOTS}];
        uniform vec2 uPaintEdge;
        ${PAINT_EDGE_WARP_GLSL}
        uniform float uPaintOn;`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>${CAVITY_PAINT_FRAG}`)
      .replace(
        '#include <lights_physical_fragment>',
        `totalEmissiveRadiance = mix(totalEmissiveRadiance, wocCavEmis, wocCavPaintW);
        #include <lights_physical_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'woc-triplanar-maps-paint';
}

function material(texKey: string | undefined, tilePeriod: number): THREE.MeshStandardMaterial {
  const set = texKey ? terrainTextureSet(texKey) : null;
  const key = `${set ? set.key : ''}@${tilePeriod}`;
  let m = cavityMaterials.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    // FORK: front faces only. The interior's normals face the cavity, so
    // from outside a mouth the wall's overshoot above the ground (see
    // CAVITY_CLIP_RISE) is culled instead of standing as a lip round the
    // opening, while from inside it closes the seam against the ground
    // chunk's own clip edge.
    side: THREE.FrontSide,
    // A whisper of self-light so an unlit interior reads as rock, not void ,
    // a touch above the cave tubes' 0.55: carve rooms are wider, so their
    // far walls sit further from any mouth light.
    emissive: 0x201c17,
    emissiveIntensity: 0.7,
  });
  cavityMaterials.set(key, m);
  applyTriplanarMaps(m, tilePeriod);
  applyCavityPaint(m);
  refreshCavityPaint();
  const mat = m;
  if (set) {
    // A custom interior set: reference-counted so the GC can free its VRAM
    // when no carve uses it anymore.
    const releases: (() => void)[] = [];
    const color = acquireTexture(`/${terrainTexturePath(set.key, 'color')}`, {
      srgb: true,
      repeat: true,
    });
    releases.push(color.release);
    void color.texture
      .then((tex) => {
        mat.map = tex;
        mat.needsUpdate = true;
      })
      .catch(() => {});
    const normalPath = terrainTexturePath(set.key, 'normal');
    if (normalPath) {
      const normal = acquireTexture(`/${normalPath}`, { repeat: true });
      releases.push(normal.release);
      void normal.texture
        .then((tex) => {
          mat.normalMap = tex;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    // A glowing set (lava): its Emission map lights the molten veins. The
    // emissive colour flips to white ONLY once the map lands, white with no
    // map would floodlight the whole interior. Emissive ignores the vertex
    // depth tint on purpose: lava glows hardest where the cave is darkest.
    const emissionPath = terrainTexturePath(set.key, 'emission');
    if (emissionPath) {
      const emission = acquireTexture(`/${emissionPath}`, { srgb: true, repeat: true });
      releases.push(emission.release);
      void emission.texture
        .then((tex) => {
          mat.emissiveMap = tex;
          mat.emissive = new THREE.Color(0xffffff);
          mat.emissiveIntensity = 1.35;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    cavityMatReleases.set(key, releases);
  } else {
    // Default granite (Rock051, shared with the base splat): pin it forever.
    void loadTexture('/textures/terrain/Rock051_Color.jpg', { srgb: true, repeat: true })
      .then((tex) => {
        mat.map = tex;
        mat.needsUpdate = true;
      })
      .catch(() => {});
  }
  return m;
}

/** Free the textures of every custom-set cavity material the active document
 *  no longer references. The default granite ('' key) is pinned. */
function disposeUnusedCavityMats(usedKeys: ReadonlySet<string>): void {
  for (const [key, mat] of [...cavityMaterials]) {
    const setKey = key.slice(0, key.lastIndexOf('@'));
    if (setKey === '' || usedKeys.has(setKey)) continue;
    for (const release of cavityMatReleases.get(key) ?? []) release();
    cavityMatReleases.delete(key);
    mat.map = null;
    mat.normalMap = null;
    mat.dispose();
    cavityMaterials.delete(key);
  }
}

interface TileJob {
  key: string;
  tx: number;
  ty: number;
  tz: number;
  cell: number;
  /** The column's cell before the camera LOD (the bake enumerates rings). */
  base: number;
  /** Neighbour cell ratios across [-x, +x, -z, +z] (1 = no stitching). */
  faceCoarse: [number, number, number, number];
  cluster: CavityCluster;
}
function tileKey(
  cell: number,
  cl: CavityCluster,
  faceCoarse: readonly [number, number, number, number],
  t: { tx: number; ty: number; tz: number },
): string {
  return `cav:${cell}:${cl.tex}:${cl.texTile}:${faceCoarse.join('')}:${t.tx},${t.ty},${t.tz}`;
}

/**
 * Every tile the current document's carves need, keyed for reuse. The cell is
 * per COLUMN (tx, tz): the finest of every claiming cluster's base cell and
 * every Remesh detail region touching the column's rect, so the Remesh brush
 * refines exactly the tiles under its disc, and vertically stacked tiles can
 * never disagree (y-faces need no stitching). Face ratios against coarser
 * x/z neighbours drive the core's watertight face linearization.
 */
function desiredTiles(
  clusters: readonly CavityCluster[],
  detail: readonly DetailRegion[] | undefined,
): Map<string, TileJob> {
  // Pass 1: which tiles exist, which cluster claims them, and each column's
  // finest requested cell.
  const tiles = new Map<string, { tx: number; ty: number; tz: number; cluster: CavityCluster }>();
  const columnCell = new Map<string, number>();
  for (const cl of clusters) {
    const tx0 = Math.floor((cl.bounds.minX - PAD) / TILE);
    const tx1 = Math.floor((cl.bounds.maxX + PAD) / TILE);
    const ty0 = Math.floor((cl.minY - PAD) / TILE);
    const ty1 = Math.floor((cl.maxY + PAD) / TILE);
    const tz0 = Math.floor((cl.bounds.minZ - PAD) / TILE);
    const tz1 = Math.floor((cl.bounds.maxZ + PAD) / TILE);
    // Each cut's bounds once per pass, not once per tile per cut: on a
    // 32-cut mine the tile loops below visited them hundreds of times over.
    const cutBoxes = cl.cuts.map((cut) => ({ b: cutBounds(cut), v: cutVerticalBounds(cut) }));
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let tz = tz0; tz <= tz1; tz++) {
        const minX = tx * TILE;
        const minZ = tz * TILE;
        // The column's cell: any detail region whose disc reaches this
        // column's rect SETS it, finer OR coarser than the cluster base, so
        // the Remesh brush turns detail down as well as up (snapped onto the
        // chain so a mixed border always has an integer ratio). Overlapping
        // regions resolve to the finest of them.
        let cell = cl.cell;
        if (detail) {
          let regionCell = Number.POSITIVE_INFINITY;
          for (const r of detail) {
            const dx = Math.max(minX - r.x, 0, r.x - (minX + TILE));
            const dz = Math.max(minZ - r.z, 0, r.z - (minZ + TILE));
            if (dx * dx + dz * dz > r.radius * r.radius) continue;
            regionCell = Math.min(regionCell, chainSnapNearest(r.cell));
          }
          if (Number.isFinite(regionCell)) cell = regionCell;
        }
        let claimedColumn = false;
        for (let ty = ty0; ty <= ty1; ty++) {
          // Skip tiles no cut of this cluster can reach.
          const minY = ty * TILE;
          let touched = false;
          for (const { b, v } of cutBoxes) {
            if (
              b.minX <= minX + TILE &&
              b.maxX >= minX &&
              b.minZ <= minZ + TILE &&
              b.maxZ >= minZ &&
              v.minY <= minY + TILE &&
              v.maxY >= minY
            ) {
              touched = true;
              break;
            }
          }
          if (!touched) continue;
          claimedColumn = true;
          const coord = `${tx},${ty},${tz}`;
          if (!tiles.has(coord)) tiles.set(coord, { tx, ty, tz, cluster: cl });
        }
        if (claimedColumn) {
          const col = `${tx},${tz}`;
          const prev = columnCell.get(col);
          if (prev === undefined || cell < prev) columnCell.set(col, cell);
        }
      }
    }
  }
  // FORK: camera LOD on every column (after the detail regions, so a remesh
  // region far from the camera still coarsens with distance). A column past
  // the last ring is culled: its tiles are not desired at all. A column under
  // a stroke in progress previews at a coarser cell.
  const columnBase = new Map(columnCell);
  const culled = new Set<string>();
  for (const [col, cell] of columnCell) {
    const [tx, tz] = col.split(',').map(Number);
    let c = lodCell(cell, tx, tz);
    if (c === null) {
      culled.add(col);
      columnCell.delete(col);
      continue;
    }
    if (previewCoarsen && c < 1 && columnTouches(tx, tz, previewCoarsen.region)) {
      c = chainSnapNearest(Math.min(MAX_CELL, c * previewCoarsen.factor));
    }
    columnCell.set(col, c);
  }
  // Pass 2: face ratios against coarser standing x/z neighbours; the key
  // carries everything a rebuild must react to (cell, texture, stitching).
  const out = new Map<string, TileJob>();
  for (const t of tiles.values()) {
    const col = `${t.tx},${t.tz}`;
    if (culled.has(col)) continue;
    const cell = columnCell.get(col) ?? baseCell();
    const base = columnBase.get(col) ?? cell;
    const ratio = (dx: number, dz: number): number => {
      if (!tiles.has(`${t.tx + dx},${t.ty},${t.tz + dz}`)) return 1;
      const n = columnCell.get(`${t.tx + dx},${t.tz + dz}`);
      if (n === undefined || n <= cell + 1e-9) return 1;
      return Math.max(1, Math.round(n / cell));
    };
    const faceCoarse: [number, number, number, number] = [
      ratio(-1, 0),
      ratio(1, 0),
      ratio(0, -1),
      ratio(0, 1),
    ];
    const cl = t.cluster;
    const key = tileKey(cell, cl, faceCoarse, t);
    out.set(key, { key, tx: t.tx, ty: t.ty, tz: t.tz, cell, base, faceCoarse, cluster: cl });
  }
  return out;
}

/** The field solids a tile must honour: the cluster's carves plus any cave
 *  BORE cuts crossing the tile, so a carve that breaks into a tunnel opens
 *  into it instead of drawing a wall across the doorway. */
function tileFieldCuts(job: TileJob, effective: readonly TerrainCut[]): TerrainCut[] {
  const minX = job.tx * TILE - PAD;
  const maxX = (job.tx + 1) * TILE + PAD;
  const minZ = job.tz * TILE - PAD;
  const maxZ = (job.tz + 1) * TILE + PAD;
  const out: TerrainCut[] = [];
  for (const cut of effective) {
    if (cut.carve !== true && cut.bore !== true) continue;
    const b = cutBounds(cut);
    if (b.minX > maxX || b.maxX < minX || b.minZ > maxZ || b.maxZ < minZ) continue;
    // A dug volume's touched box can span a whole hill: only the tiles whose
    // cells a brush actually reached carry the field (the rest is rock and
    // would march to nothing at full cost).
    if (
      cut.shape === 'voxel' &&
      !voxelTouches(cut, {
        minX,
        maxX,
        minZ,
        maxZ,
        minY: job.ty * TILE - PAD,
        maxY: (job.ty + 1) * TILE + PAD,
      })
    ) {
      continue;
    }
    out.push(cut);
  }
  return out;
}

const EMPTY_ARRAYS: CavityMeshArrays = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint32Array(0),
  collarVertexStart: 0,
};
function tileOrigin(job: TileJob): { x0: number; y0: number; z0: number } {
  return { x0: job.tx * TILE, y0: job.ty * TILE, z0: job.tz * TILE };
}

/** The inputs of one tile's march, narrowed to the tile. Null when no cut
 *  reaches it. */
function tileJobInputs(
  job: TileJob,
): { cuts: TerrainCut[]; patches: readonly TerrainCut[] | undefined } | null {
  const content = getActiveWorldContent();
  const effective = effectiveTerrainCuts(content.caves, content.holes);
  const cuts = tileFieldCuts(job, effective);
  if (cuts.length === 0) return null;
  return { cuts, patches: content.holePatches };
}

/** March one tile from the field and lighten it, on this thread: the live
 *  edit path (a stroke wants its wall on the next frame). */
// The map's cave brightness (MapLighting.caveLight, 0..1) lifts the vertex
// tint floor from the shipped cave dark toward plain rock, so a maker's big
// caverns read instead of vanishing into black. Baked into the vertices, so a
// change re-marches (renderer.setEditorLighting).
const SHIPPED_CAVE_DARK = 0.46;
function caveDarkFloor(): number {
  const light = getActiveWorldContent().lighting?.caveLight ?? 0;
  return SHIPPED_CAVE_DARK + (1 - SHIPPED_CAVE_DARK) * Math.min(1, Math.max(0, light));
}

function marchTile(job: TileJob, seed: number): CavityMeshArrays | null {
  const inputs = tileJobInputs(job);
  if (!inputs) return null;
  return marchCavityTile({
    ...tileOrigin(job),
    cell: job.cell,
    faceCoarse: job.faceCoarse,
    cuts: inputs.cuts,
    patches: inputs.patches,
    seed,
    caveDark: caveDarkFloor(),
  });
}

/** FORK: march one tile in the zone build worker (the camera-LOD passes and
 *  the bake), so the frame never pays for it. Falls back to this thread
 *  when there is no pool or the worker failed. The worker meshes the active
 *  content it was handed (setContent), and the cuts ride the job by value. */
async function marchTileAsync(job: TileJob, seed: number): Promise<CavityMeshArrays | null> {
  const inputs = tileJobInputs(job);
  if (!inputs) return null;
  const pool = zoneBuildPool();
  if (!pool?.buildCavity) return marchTile(job, seed);
  const content = getActiveWorldContent();
  pool.setContent?.(getContentGeneration(), content === BUILTIN_WORLD ? null : content);
  const res = await pool.buildCavity({
    ...tileOrigin(job),
    cell: job.cell,
    faceCoarse: job.faceCoarse,
    cuts: inputs.cuts,
    patches: inputs.patches,
    seed,
    caveDark: caveDarkFloor(),
  });
  if (res === null) return marchTile(job, seed);
  return res.arrays;
}

/** A tile's geometry: from the bake cache when it holds the key (the common
 *  case on a baked map: a ring change costs no marching), else marched, and
 *  stored, once the map is baked, so a tile an edit re-marched heals its own
 *  cache instead of marching on every later ring change. Empty tiles are
 *  cached too (as EMPTY_ARRAYS): a march that finds nothing still samples
 *  the whole grid. */
function tileArrays(job: TileJob, seed: number): CavityMeshArrays | null {
  const cached = cavityBakeGet(job.key);
  if (cached) return cached.indices.length > 0 ? cached : null;
  const arrays = marchTile(job, seed);
  if (cavityBakeActive()) cavityBakeStore(job.key, tileOrigin(job), arrays ?? EMPTY_ARRAYS);
  return arrays;
}

function buildTileMesh(job: TileJob, arrays: CavityMeshArrays): THREE.Mesh | null {
  // The base tint rides the vertex colours: neutral granite where unpainted,
  // the painted swatch's cave-dark colour where the Paint tool touched the
  // ground above, the same rule the cave tubes follow, so paint works inside
  // carves too. Where the cluster's texture CAME from the paint, the swatch's
  // colour is already in the texture: multiplying it in again would colourize
  // the texture with itself, so those vertices keep the plain depth shade.
  // Colours and UVs are COPIED: the arrays may belong to the bake cache.
  const lookup = caveInteriorPaintLookup();
  const colors = new Float32Array(arrays.colors);
  for (let v = 0; v < colors.length / 3; v++) {
    const px = arrays.positions[v * 3];
    const pz = arrays.positions[v * 3 + 2];
    // A TEXTURED swatch is drawn per fragment by the material's paint path,
    // which applies the depth shade itself: baking the swatch colour in here
    // too would colourize the texture with itself. Colour-only swatches
    // still ride the vertex tint.
    if (paintedTextureAt(px, pz, lookup)) continue;
    const tint = caveInteriorTintAt(px, pz, lookup);
    colors[v * 3] *= tint.r;
    colors[v * 3 + 1] *= tint.g;
    colors[v * 3 + 2] *= tint.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uvs = new Float32Array(arrays.uvs);
  const uvScale = job.cluster.texTile > 0 ? 1 / job.cluster.texTile : UV_SCALE;
  for (let i = 0; i < uvs.length; i++) uvs[i] *= uvScale;
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  const mesh = new THREE.Mesh(
    geo,
    material(job.cluster.tex || undefined, job.cluster.texTile > 0 ? job.cluster.texTile : 4),
  );
  mesh.name = job.key;
  mesh.receiveShadow = true;
  // Interiors are their own light world: the sun shadow map over the ground
  // above them would just stripe the floor through the heightfield.
  mesh.castShadow = false;
  return mesh;
}

// FORK: the cluster set survives between camera-LOD passes. Clustering walks
// every carve, and an untextured cluster samples the surface paint over its
// whole opening (terrain heights included); none of that changes until an
// edit, which always arrives with a region.
let clusterCache: {
  clusters: CavityCluster[];
  holes: unknown;
  patches: unknown;
  detail: unknown;
  cell: unknown;
  seed: number;
} | null = null;
function clustersFor(
  content: ReturnType<typeof getActiveWorldContent>,
  seed: number,
  fresh: boolean,
): CavityCluster[] {
  const c = clusterCache;
  if (
    !fresh &&
    c &&
    c.holes === content.holes &&
    c.patches === content.holePatches &&
    c.detail === content.detailRegions &&
    c.cell === content.caveMeshCell &&
    c.seed === seed
  ) {
    return c.clusters;
  }
  const effective = effectiveTerrainCuts(content.caves, content.holes);
  const clusters = buildClusters(effective, content.holePatches ?? [], content.detailRegions, seed);
  clusterCache = {
    clusters,
    holes: content.holes,
    patches: content.holePatches,
    detail: content.detailRegions,
    cell: content.caveMeshCell,
    seed,
  };
  return clusters;
}

/** The carve interior meshes for the ACTIVE world content. An empty group on
 *  any map without carves, so the shipped world pays one scene node. */
export function buildCutCavityMeshes(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = CAVITY_GROUP_NAME;
  // Tiles and caps are world-space geometry under an identity group that
  // never moves: nothing here needs the per-frame matrix recompose (633 nodes
  // at the city were paying it, see static_matrix.ts).
  group.matrixAutoUpdate = false;
  clusterCache = null;
  refreshCutCavityMeshes(group, seed, null);
  return group;
}

/** Put a tile's geometry (or its empty placeholder) in the group under its
 *  key, retiring whatever stood at that coordinate under an older key. */
function placeTile(group: THREE.Group, job: TileJob, arrays: CavityMeshArrays | null): void {
  const coord = `${job.tx},${job.ty},${job.tz}`;
  for (const child of [...group.children]) {
    if (child.name !== job.key && coordOf(child.name) === coord) {
      group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
  }
  if (group.children.some((c) => c.name === job.key)) return;
  const mesh = arrays ? buildTileMesh(job, arrays) : null;
  if (mesh) {
    // world-space vertices, identity transform, never moves
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  } else {
    // A tile that marches to nothing (a thin cave at a coarse LOD cell, a
    // grid corner) still STANDS, as an empty node under its key: otherwise
    // the budgeted LOD pass rebuilt it every tick, nearest-first, and the
    // far tiles behind it never got their turn.
    const empty = new THREE.Group();
    empty.name = job.key;
    empty.matrixAutoUpdate = false;
    group.add(empty);
  }
}
const coordOf = (key: string): string => key.slice(key.lastIndexOf(':') + 1);
/** The tile set of the latest refresh, so a worker result that lands after
 *  the camera moved on is dropped; and the field generation, bumped by every
 *  edit, so a result marched from the field BEFORE an edit is dropped too
 *  (its key would still match). */
let lastDesired: Map<string, TileJob> = new Map();
let fieldGen = 0;
const inflight = new Set<string>();
/** A worker result landed (or was dropped) since the last LOD pass: the
 *  tick re-derives the tile set only then, or when the camera moved. */
let landedSince = false;

/**
 * Region-scoped refresh: rebuild only the tiles whose box touches the edited
 * rect (null = everything), drop tiles the document no longer needs, add the
 * new ones. Mutates the group in place, same lifecycle as refreshCaveMeshes.
 * With `async` the missing tiles march in the zone build worker and land on
 * later frames (the tile that stood at a coordinate stays up meanwhile);
 * without it (an edit) they march here, now. Returns how many desired tiles
 * are not standing yet.
 */
export function refreshCutCavityMeshes(
  group: THREE.Group,
  seed: number,
  region: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
  maxBuilds = Number.POSITIVE_INFINITY,
  async = false,
): number {
  const content = getActiveWorldContent();
  // An edit: the baked tiles and the caps under it are stale, and the
  // clusters may have changed shape.
  if (region) {
    cavityBakeInvalidate(region, TILE, PAD);
    capCache.clear();
    fieldGen++;
  }
  const clusters = clustersFor(content, seed, region !== null);
  const desired = desiredTiles(clusters, content.detailRegions);
  lastDesired = desired;
  const touchesRegion = (job: { tx: number; tz: number }): boolean => {
    if (!region) return true;
    return columnTouches(job.tx, job.tz, region);
  };
  // Drop meshes the document no longer needs (or whose cell changed, the
  // cell is in the key), plus every kept tile inside the edited region, which
  // the build loop below then re-extracts fresh.
  const desiredCoords = new Set<string>();
  for (const job of desired.values()) desiredCoords.add(`${job.tx},${job.ty},${job.tz}`);
  // A standing tile whose column merely changed LOD (same coord, new key)
  // stays up until its replacement is built, so a budgeted pass never
  // flashes a hole in the hillside; a tile no document cut needs goes now.
  const stale = new Set<string>();
  for (const child of [...group.children]) {
    if (child.name.startsWith('cap:')) continue;
    const job = desired.get(child.name);
    if (job && (!region || !touchesRegion(job))) continue;
    const coord = coordOf(child.name);
    if (!job && !region && desiredCoords.has(coord) && !stale.has(coord)) {
      stale.add(coord);
      continue;
    }
    group.remove(child);
    (child as THREE.Mesh).geometry?.dispose();
  }
  // Build every desired tile that is not standing (nor on its way): the ones
  // just dropped in the region, and any brand-new ones (a new cut, an undo
  // re-add, map load, a ring change).
  const jobs = pendingJobs(group, desired, maxBuilds);
  let built = 0;
  let remaining = 0;
  for (const job of jobs) {
    if (built >= maxBuilds) {
      remaining++;
      continue;
    }
    built++;
    if (async) {
      dispatchTileAsync(group, job, seed);
      continue;
    }
    placeTile(group, job, tileArrays(job, seed));
  }
  // Caps only on the LOD tick: an edit clears them and the next tick puts
  // the far ones back, one per tick, so a stroke never pays for a cap.
  if (async) refreshCaps(group, clusters, seed);
  // Release custom interior textures nothing references anymore (a retextured
  // or deleted room). Cheap: a handful of map entries per refresh.
  const used = new Set<string>();
  for (const cl of clusters) {
    if (cl.tex) used.add(cl.tex);
  }
  disposeUnusedCavityMats(used);
  return remaining + (async ? inflight.size : 0);
}

// FORK: the dark cap under a far cluster's opening (SPACEY, 2026-09-12: "once
// you reach that 500 yard just make the cave have an impostor that fills the
// gap which is just a dark texture so you can't see under the map"). One
// flat mesh per cluster, sunk CAP_SINK under the surface over every cell of
// its opening, shown from CAVITY_CAP_DIST (where the interior is extremely
// low-poly) and past the cull (where it is the only thing drawn). Built
// lazily, once per cluster, on the main thread; an edit clears the cache.
const CAP_SINK = 0.6;
const CAP_SAMPLES = 32;
const capMaterial = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.DoubleSide });
const capCache = new Map<string, THREE.BufferGeometry | null>();
function capSignature(cl: CavityCluster, index: number): string {
  const b = cl.bounds;
  return `cap:${index}:${b.minX.toFixed(1)},${b.maxX.toFixed(1)},${b.minZ.toFixed(1)},${b.maxZ.toFixed(1)}:${cl.cuts.length}`;
}
function buildCapGeometry(
  cl: CavityCluster,
  patches: readonly TerrainCut[] | undefined,
  seed: number,
): THREE.BufferGeometry | null {
  const b = cl.bounds;
  const ex = b.maxX - b.minX;
  const ez = b.maxZ - b.minZ;
  if (ex <= 0 || ez <= 0) return null;
  const step = Math.max(2, Math.max(ex, ez) / CAP_SAMPLES);
  const nx = Math.ceil(ex / step);
  const nz = Math.ceil(ez / step);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  const have = new Uint8Array((nx + 1) * (nz + 1));
  const hAt = (i: number, k: number): number => {
    const id = k * (nx + 1) + i;
    if (!have[id]) {
      heights[id] = meshTerrainHeight(b.minX + i * step, b.minZ + k * step, seed) - CAP_SINK;
      have[id] = 1;
    }
    return heights[id];
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const vertOf = new Map<number, number>();
  const vert = (i: number, k: number): number => {
    const id = k * (nx + 1) + i;
    let v = vertOf.get(id);
    if (v === undefined) {
      v = positions.length / 3;
      vertOf.set(id, v);
      positions.push(b.minX + i * step, hAt(i, k), b.minZ + k * step);
    }
    return v;
  };
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = b.minX + (i + 0.5) * step;
      const z = b.minZ + (k + 0.5) * step;
      const h = meshTerrainHeight(x, z, seed);
      if (carveFieldAt(cl.cuts, patches, x, h - 0.1, z) >= 0) continue;
      const a = vert(i, k);
      const c = vert(i + 1, k);
      const d = vert(i, k + 1);
      const e = vert(i + 1, k + 1);
      indices.push(a, d, c, c, d, e);
    }
  }
  if (indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}
function clusterDistance(cl: CavityCluster): number {
  if (!lodCam) return 0;
  const b = cl.bounds;
  const dx = Math.max(b.minX - lodCam.x, 0, lodCam.x - b.maxX);
  const dz = Math.max(b.minZ - lodCam.z, 0, lodCam.z - b.maxZ);
  return Math.hypot(dx, dz);
}
function refreshCaps(group: THREE.Group, clusters: readonly CavityCluster[], seed: number): void {
  const content = getActiveWorldContent();
  const want = new Set<string>();
  let builtOne = false;
  clusters.forEach((cl, index) => {
    if (clusterDistance(cl) < CAVITY_CAP_DIST) return;
    const key = capSignature(cl, index);
    want.add(key);
    if (group.children.some((c) => c.name === key)) return;
    let geo = capCache.get(key);
    if (geo === undefined) {
      if (builtOne) return;
      builtOne = true;
      geo = buildCapGeometry(cl, content.holePatches, seed);
      capCache.set(key, geo);
    }
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, capMaterial);
    mesh.name = key;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
  for (const child of [...group.children]) {
    if (child.name.startsWith('cap:') && !want.has(child.name)) group.remove(child);
  }
}

/** The desired tiles not standing nor in flight, nearest the LOD camera
 *  first when there are more than the budget (so a budgeted pass fills in
 *  what the maker is looking at before the far hillside). */
function pendingJobs(
  group: THREE.Group,
  desired: ReadonlyMap<string, TileJob>,
  maxBuilds: number,
): TileJob[] {
  const existing = new Set(group.children.map((c) => c.name));
  const jobs = [...desired.values()].filter((j) => !existing.has(j.key) && !inflight.has(j.key));
  if (lodCam && jobs.length > maxBuilds) {
    const cam = lodCam;
    const d2 = (j: TileJob): number => {
      const cx = (j.tx + 0.5) * TILE - cam.x;
      const cz = (j.tz + 0.5) * TILE - cam.z;
      return cx * cx + cz * cz;
    };
    jobs.sort((a, b) => d2(a) - d2(b));
  }
  return jobs;
}

/** Place a tile from the bake cache, else march it in the worker and place
 *  the result when it lands (unless the camera or an edit moved on). */
function dispatchTileAsync(group: THREE.Group, job: TileJob, seed: number): void {
  const cached = cavityBakeGet(job.key);
  if (cached) {
    placeTile(group, job, cached.indices.length > 0 ? cached : null);
    return;
  }
  inflight.add(job.key);
  const gen = fieldGen;
  void marchTileAsync(job, seed).then(
    (arrays) => {
      inflight.delete(job.key);
      landedSince = true;
      // Landed too late: the camera moved on, or an edit changed the
      // field under it. The next tick asks again if it is still wanted.
      if (!lastDesired.has(job.key) || gen !== fieldGen || !group.parent) return;
      if (cavityBakeActive()) cavityBakeStore(job.key, tileOrigin(job), arrays ?? EMPTY_ARRAYS);
      placeTile(group, job, arrays);
    },
    () => {
      inflight.delete(job.key);
      landedSince = true;
    },
  );
}

/** A landing-only tick: the camera has not moved and nothing was edited, so
 *  the desired set of the last pass still holds. Dispatch the next builds
 *  from it (and the next cap) WITHOUT re-clustering and re-enumerating every
 *  tile of every cluster (desiredTiles), which was running on every landing
 *  frame after a long move and cost a tenth of the city frame for seconds. */
function resumeCutCavityBuilds(group: THREE.Group, seed: number, maxBuilds: number): number {
  const jobs = pendingJobs(group, lastDesired, maxBuilds);
  let built = 0;
  let remaining = 0;
  for (const job of jobs) {
    if (built >= maxBuilds) {
      remaining++;
      continue;
    }
    built++;
    dispatchTileAsync(group, job, seed);
  }
  refreshCaps(group, clustersFor(getActiveWorldContent(), seed, false), seed);
  return remaining + inflight.size;
}

/** FORK: per-frame LOD tick. Moves the LOD camera and, when it crossed far
 *  enough (or a previous pass left tiles unbuilt), re-derives the tile set
 *  with a build budget so approaching a cave never spends a whole frame on
 *  fine tiles. Returns how many tiles still wait for a later tick. */
let lodApplied: { x: number; z: number } | null = null;
let lodPending = 0;
export function updateCutCavityLod(
  group: THREE.Group,
  seed: number,
  camX: number,
  camZ: number,
  maxBuilds = 6,
): number {
  if (group.children.length === 0 && !lodApplied) {
    // START from empty instead of waiting to be started. This used to record
    // the camera and return, on the assumption that some other caller does
    // the first refresh, but `buildCutCavityMeshes` runs at renderer
    // construction, before the editor has swapped the custom map in, so it
    // sees the built-in world's zero carves and builds nothing. After that
    // the group was empty AND `lodApplied` was null forever, so this guard
    // returned 0 on every frame and the interiors of every carve on the map
    // never meshed at all: 0 children, measured, parked at a mine mouth for
    // 15 s. The sim still had its cavity floors and carve walls, so the
    // player walked on invisible ground and bumped invisible rock, SPACEY,
    // 2026-09-20: "in the cave ... the player is getting stuck on invis
    // collision from the terrain".
    //
    // Doing the first pass HERE also keeps it budgeted (maxBuilds per frame,
    // nearest first). Forcing a full refresh instead costs 27 s in one stall
    // on this map, which is the hitch the retired Bake caves tool existed to
    // paper over.
    lodCam = { x: camX, z: camZ };
    lodApplied = { x: camX, z: camZ };
    lodPending = refreshCutCavityMeshes(group, seed, null, maxBuilds, true);
    return lodPending;
  }
  const moved = !lodApplied || Math.hypot(camX - lodApplied.x, camZ - lodApplied.z) > 6;
  if (!moved && (lodPending === 0 || !landedSince)) return lodPending;
  landedSince = false;
  lodCam = { x: camX, z: camZ };
  lodApplied = { x: camX, z: camZ };
  // Missing tiles march in the worker; the tick only assembles geometry.
  // Same camera, results landed: keep building from the standing tile set.
  lodPending = moved
    ? refreshCutCavityMeshes(group, seed, null, maxBuilds, true)
    : resumeCutCavityBuilds(group, seed, maxBuilds);
  return lodPending;
}

/** FORK: the bake (the Caves panel's "Bake caves"). Every tile of every
 *  cluster at every LOD ring, plus the one-coarse-face variants a tile wears
 *  where a ring boundary crosses it, marched once and stored in the bake
 *  cache (which the editor mirrors into MapDoc.caveBake). Yields to the
 *  event loop between batches so the progress toast and the frame keep
 *  moving. Tiles already cached are skipped, so a re-bake after an edit
 *  costs only the tiles the edit touched. */
export interface CavityBakeProgress {
  done: number;
  total: number;
}
export async function bakeCutCavities(
  seed: number,
  onProgress?: (p: CavityBakeProgress) => void,
): Promise<{ tiles: number; built: number; ms: number }> {
  const t0 = performance.now();
  const content = getActiveWorldContent();
  const clusters = clustersFor(content, seed, true);
  const jobs: TileJob[] = [];
  const seen = new Set<string>();
  const push = (j: TileJob): void => {
    if (seen.has(j.key)) return;
    seen.add(j.key);
    jobs.push(j);
  };
  const sides: readonly [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let r = 0; r < CAVITY_LOD_RINGS.length; r++) {
    lodOverride = CAVITY_LOD_RINGS[r];
    let desired: Map<string, TileJob>;
    try {
      desired = desiredTiles(clusters, content.detailRegions);
    } finally {
      lodOverride = null;
    }
    const coords = new Set<string>();
    for (const job of desired.values()) coords.add(`${job.tx},${job.ty},${job.tz}`);
    const next = CAVITY_LOD_RINGS[r + 1];
    for (const job of desired.values()) {
      push(job);
      if (!next) continue;
      // At the boundary with the next ring the column's neighbours are one
      // ring coarser on one side: that tile stitches to them with a face
      // ratio, and its key differs. Pre-bake the four single-side variants.
      const ratio = Math.round(ringCell(job.base, next) / job.cell);
      if (ratio <= 1) continue;
      for (let side = 0; side < 4; side++) {
        const [dx, dz] = sides[side];
        if (!coords.has(`${job.tx + dx},${job.ty},${job.tz + dz}`)) continue;
        const fc: [number, number, number, number] = [1, 1, 1, 1];
        fc[side] = ratio;
        push({ ...job, faceCoarse: fc, key: tileKey(job.cell, job.cluster, fc, job) });
      }
    }
  }
  // March in the zone build workers, one lane per worker; without a pool,
  // here, yielding between tiles so the toast and the frame keep moving.
  let built = 0;
  let next = 0;
  const pool = zoneBuildPool();
  const lanes = Math.max(1, pool?.buildCavity ? pool.size : 1);
  let last = performance.now();
  const lane = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (!cavityBakeHas(job.key)) {
        const arrays = pool?.buildCavity ? await marchTileAsync(job, seed) : marchTile(job, seed);
        cavityBakeStore(job.key, tileOrigin(job), arrays ?? EMPTY_ARRAYS);
        built++;
      }
      if (performance.now() - last > 40) {
        onProgress?.({ done: next, total: jobs.length });
        last = performance.now();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  onProgress?.({ done: jobs.length, total: jobs.length });
  return { tiles: jobs.length, built, ms: performance.now() - t0 };
}
