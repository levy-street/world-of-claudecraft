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
import { getActiveWorldContent } from '../sim/data';
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
import { buildCavityMesh, clusterCavityMesh } from './cut_cavity_core';
import { meshTerrainHeight } from './terrain_mesh_height';
import { MAX_PAINT_SLOTS, paintLayerRuntime, textureSlotSwatch } from './terrain_paint_layers';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';
import { applyTriplanarMaps } from './triplanar_maps';

export const CAVITY_GROUP_NAME = 'cutCavities';

// World-aligned tile edge (yards). Divisible by every cell step below.
const TILE = 16;
// Cell steps as divisors of TILE, finest first, the SAME power-of-two chain
// the mixed-resolution stitching needs, so a base cell and a remesh region
// always have an integer ratio. 0.25yd resolves a fist-sized bump; 2yd is the
// coarse floor for huge caverns.
const CELL_STEPS = [0.25, 0.5, 1.0, 2.0, 4.0] as const;
// FORK: camera-distance LOD for the interiors. A column within LOD_NEAR yards
// of the camera meshes at its requested cell; past LOD_NEAR it doubles, past
// LOD_FAR it quadruples (capped at the coarsest step: a 16-yd tile at 4-yd
// cells is a handful of triangles, "a super low poly mesh" for the far
// hillside). Rings are wider than a tile so ring neighbours always differ by
// one chain step, which the face stitching already handles.
const LOD_NEAR = 56;
const LOD_FAR = 140;
let lodCam: { x: number; z: number } | null = null;
/** Coarsen a column's cell by its distance to the LOD camera. */
function lodCell(cell: number, tx: number, tz: number): number {
  if (!lodCam) return cell;
  const minX = tx * TILE;
  const minZ = tz * TILE;
  const dx = Math.max(minX - lodCam.x, 0, lodCam.x - (minX + TILE));
  const dz = Math.max(minZ - lodCam.z, 0, lodCam.z - (minZ + TILE));
  const d = Math.hypot(dx, dz);
  const f = d < LOD_NEAR ? 1 : d < LOD_FAR ? 2 : 4;
  if (f === 1) return cell;
  return chainSnapNearest(Math.min(CELL_STEPS[CELL_STEPS.length - 1], cell * f));
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
const CLUSTER_Q = 0.75;
// Extraction budget per CLUSTER (total grid cells across its volume). At 8
// bytes of transient state per cell this holds a rebuild in the tens of
// milliseconds; the picker coarsens the cell until the volume fits.
const CLUSTER_CELL_BUDGET = 2_200_000;
// One texture repeat per this many yards of rock.
const UV_SCALE = 1 / 4;
// Bounds pad so the mesh grid fully contains the field's zero set.
const PAD = 1;

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
  cavityPaintState.on = rt.field && rt.tiles ? rt.on : { value: 0 };
}

const CAVITY_PAINT_FRAG = `
        vec3 wocCavPaintCol = vec3(0.0);
        vec3 wocCavEmis = vec3(0.0);
        float wocCavPaintW = 0.0;
        if (uPaintOn > 0.5) {
          vec2 wocCavXZ = vTriPos.xz;
          vec2 wocC = (wocCavXZ - uPaintGrid.xy) * uPaintGrid.z - 0.5;
          vec2 wocI = floor(wocC);
          vec2 wocFr = smoothstep(0.0, 1.0, fract(wocC));
          // Explicit gradients: the array taps sit inside branches.
          vec3 wocDx = dFdx(vTriPos);
          vec3 wocDy = dFdy(vTriPos);
          vec3 wocTriW = pow(abs(normalize(vTriN)), vec3(4.0));
          wocTriW /= (wocTriW.x + wocTriW.y + wocTriW.z);
          float wocPaintN = 0.0;
          vec3 wocDepthShade = vColor.rgb;
          vec2 wocC0uv = (wocCavXZ - uPaintGrid.xy) * uPaintGrid.z / uPaintDims;
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
              vec2 wocIJ = wocI + vec2(wpi < 2 ? 0.0 : 1.0, (wpi == 0 || wpi == 2) ? 0.0 : 1.0);
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
    side: THREE.DoubleSide,
    // A whisper of self-light so an unlit interior reads as rock, not void,     // a touch above the cave tubes' 0.55: carve rooms are wider, so their
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
  /** Neighbour cell ratios across [-x, +x, -z, +z] (1 = no stitching). */
  faceCoarse: [number, number, number, number];
  cluster: CavityCluster;
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
          for (const cut of cl.cuts) {
            const b = cutBounds(cut);
            const v = cutVerticalBounds(cut);
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
  // region far from the camera still coarsens with distance).
  for (const [col, cell] of columnCell) {
    const [tx, tz] = col.split(',').map(Number);
    columnCell.set(col, lodCell(cell, tx, tz));
  }
  // Pass 2: face ratios against coarser standing x/z neighbours; the key
  // carries everything a rebuild must react to (cell, texture, stitching).
  const out = new Map<string, TileJob>();
  for (const t of tiles.values()) {
    const cell = columnCell.get(`${t.tx},${t.tz}`) ?? baseCell();
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
    const key =
      `cav:${cell}:${cl.tex}:${cl.texTile}:${faceCoarse.join('')}:` + `${t.tx},${t.ty},${t.tz}`;
    out.set(key, { key, tx: t.tx, ty: t.ty, tz: t.tz, cell, faceCoarse, cluster: cl });
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

function buildTileMesh(job: TileJob, seed: number): THREE.Mesh | null {
  const content = getActiveWorldContent();
  const effective = effectiveTerrainCuts(content.caves, content.holes);
  const cuts = tileFieldCuts(job, effective);
  if (cuts.length === 0) return null;
  const patches = content.holePatches;
  const n = Math.round(TILE / job.cell);
  let arrays = buildCavityMesh({
    x0: job.tx * TILE,
    y0: job.ty * TILE,
    z0: job.tz * TILE,
    cell: job.cell,
    nx: n,
    ny: n,
    nz: n,
    fieldAt: (x, y, z) => carveFieldAt(cuts, patches, x, y, z),
    heightAt: (x, z) => meshTerrainHeight(x, z, seed),
    faceCoarse: job.faceCoarse,
  });
  if (!arrays) return null;
  // FORK: lighten the tile (tile-border vertices stay exact, so the stitched
  // seams hold).
  arrays = clusterCavityMesh(arrays, job.cell * CLUSTER_Q, {
    x0: job.tx * TILE,
    y0: job.ty * TILE,
    z0: job.tz * TILE,
    size: TILE,
  });
  if (arrays.indices.length === 0) return null;
  // The base tint rides the vertex colours: neutral granite where unpainted,
  // the painted swatch's cave-dark colour where the Paint tool touched the
  // ground above, the same rule the cave tubes follow, so paint works inside
  // carves too. Where the cluster's texture CAME from the paint, the swatch's
  // colour is already in the texture: multiplying it in again would colourize
  // the texture with itself, so those vertices keep the plain depth shade.
  const lookup = caveInteriorPaintLookup();
  const colors = arrays.colors;
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
  geo.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  const uvs = arrays.uvs;
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

/** The carve interior meshes for the ACTIVE world content. An empty group on
 *  any map without carves, so the shipped world pays one scene node. */
export function buildCutCavityMeshes(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = CAVITY_GROUP_NAME;
  refreshCutCavityMeshes(group, seed, null);
  return group;
}

/**
 * Region-scoped refresh: rebuild only the tiles whose box touches the edited
 * rect (null = everything), drop tiles the document no longer needs, add the
 * new ones. Mutates the group in place, same lifecycle as refreshCaveMeshes.
 */
export function refreshCutCavityMeshes(
  group: THREE.Group,
  seed: number,
  region: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
  maxBuilds = Number.POSITIVE_INFINITY,
): number {
  const content = getActiveWorldContent();
  const effective = effectiveTerrainCuts(content.caves, content.holes);
  const clusters = buildClusters(effective, content.holePatches ?? [], content.detailRegions, seed);
  const desired = desiredTiles(clusters, content.detailRegions);
  const touchesRegion = (job: { tx: number; tz: number }): boolean => {
    if (!region) return true;
    const minX = job.tx * TILE - PAD;
    const maxX = (job.tx + 1) * TILE + PAD;
    const minZ = job.tz * TILE - PAD;
    const maxZ = (job.tz + 1) * TILE + PAD;
    return minX <= region.maxX && maxX >= region.minX && minZ <= region.maxZ && maxZ >= region.minZ;
  };
  // Drop meshes the document no longer needs (or whose cell changed, the
  // cell is in the key), plus every kept tile inside the edited region, which
  // the build loop below then re-extracts fresh.
  const coordOf = (key: string): string => key.slice(key.lastIndexOf(':') + 1);
  const desiredCoords = new Set<string>();
  for (const job of desired.values()) desiredCoords.add(`${job.tx},${job.ty},${job.tz}`);
  // A standing tile whose column merely changed LOD (same coord, new key)
  // stays up until its replacement is built below, so a budgeted pass never
  // flashes a hole in the hillside; a tile no document cut needs goes now.
  const stale = new Map<string, THREE.Object3D>();
  for (const child of [...group.children]) {
    const job = desired.get(child.name);
    // A standing tile whose key still matches is current: its key carries
    // cell, texture and stitching, and the field under it only changes
    // through an edit, which always comes with a region. Outside that region
    // (or on a whole-map LOD pass) it stays up.
    if (job && (!region || !touchesRegion(job))) continue;
    const coord = coordOf(child.name);
    if (!job && !region && desiredCoords.has(coord) && !stale.has(coord)) {
      stale.set(coord, child);
      continue;
    }
    group.remove(child);
    (child as THREE.Mesh).geometry?.dispose();
  }
  // Build every desired tile that is not standing: the ones just dropped in
  // the region, and any brand-new ones (a new cut, an undo re-add, map load).
  const existing = new Set(group.children.map((c) => c.name));
  let built = 0;
  let remaining = 0;
  // Nearest-first, so a budgeted LOD pass fills in what the maker is looking
  // at before the far hillside.
  const jobs = [...desired.values()].filter((j) => !existing.has(j.key));
  if (lodCam && jobs.length > maxBuilds) {
    const cam = lodCam;
    const d2 = (j: TileJob): number => {
      const cx = (j.tx + 0.5) * TILE - cam.x;
      const cz = (j.tz + 0.5) * TILE - cam.z;
      return cx * cx + cz * cz;
    };
    jobs.sort((a, b) => d2(a) - d2(b));
  }
  for (const job of jobs) {
    if (built >= maxBuilds) {
      remaining++;
      continue;
    }
    built++;
    const mesh = buildTileMesh(job, seed);
    const old = stale.get(`${job.tx},${job.ty},${job.tz}`);
    if (old) {
      stale.delete(`${job.tx},${job.ty},${job.tz}`);
      group.remove(old);
      (old as THREE.Mesh).geometry?.dispose();
    }
    if (mesh) group.add(mesh);
    else {
      // A tile that marches to nothing (a thin cave at a coarse LOD cell, a
      // grid corner) still STANDS, as an empty node under its key: otherwise
      // the budgeted LOD pass rebuilt it every tick, nearest-first, and the
      // far tiles behind it never got their turn.
      const empty = new THREE.Group();
      empty.name = job.key;
      group.add(empty);
    }
  }
  // Release custom interior textures nothing references anymore (a retextured
  // or deleted room). Cheap: a handful of map entries per refresh.
  const used = new Set<string>();
  for (const cl of clusters) {
    if (cl.tex) used.add(cl.tex);
  }
  disposeUnusedCavityMats(used);
  return remaining;
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
  maxBuilds = 3,
): number {
  if (group.children.length === 0 && !lodApplied) {
    // Nothing standing: still record the camera so the first refresh (a new
    // dig, a map load) already meshes with the rings.
    lodCam = { x: camX, z: camZ };
    return 0;
  }
  const moved = !lodApplied || Math.hypot(camX - lodApplied.x, camZ - lodApplied.z) > 6;
  if (!moved && lodPending === 0) return 0;
  lodCam = { x: camX, z: camZ };
  lodApplied = { x: camX, z: camZ };
  lodPending = refreshCutCavityMeshes(group, seed, null, maxBuilds);
  return lodPending;
}
