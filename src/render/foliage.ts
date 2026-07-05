import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CAMPS,
  DUNGEON_X_THRESHOLD,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import type { BiomeId } from '../sim/types';
import type { Decoration } from '../sim/world';
import {
  biomeAt,
  generateDecorations,
  roadDistance,
  terrainHeight,
  waterLevel,
  zoneBiomeAt,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { configureMaskedDoubleSidedVegetationMaterial, GFX, sharedUniforms } from './gfx';
import { grassTuftTexture } from './textures';

// Vegetation: trees, rocks, ground dressing and the grass ring.
//
// Models come from the Quaternius Stylized Nature MegaKit (CC0), shipped via
// scripts/assets/specs/foliage.json -> public/models/foliage/*.glb and
// preloaded at module import (main.ts awaits assetsReady() before the
// Renderer is constructed, so buildFoliage can read the cache synchronously).
//
// - Placement still comes from the deterministic generateDecorations(seed)
//   field (sim untouched): kind 'tree' = pine, 'tree2' = oak (marsh: swamp
//   trees split between twisted + dead models), 'rock' = boulders.
// - Trees/rocks stay InstancedMeshes bucketed per (2 x-halves x 200u z-band)
//   so frustum/fog culling drops whole off-screen forests. Each bucket picks
//   a small deterministic subset of the model variants (hash of the bucket
//   coords) so variety stays high without exploding draw calls.
// - glTF node transforms are baked into extracted BufferGeometries once;
//   attributes are converted to float32 because the shipped GLBs are
//   meshopt-quantized (writing world-space values back into normalized int16
//   attributes would clip).
// - Per-instance tints ride instanceColor but are softened toward white —
//   the models are textured, and strong tints read as dirt.
// - High tier: leaf materials sway in the wind via onBeforeCompile on the
//   shared uTime clock; trunks stay planted (sway weight ramps with local y).
// - Shadow policy: canopies cast (alpha-cutout shadows; r165 depth material
//   inherits map+alphaTest), trunks/rocks/dressing don't — matches the old
//   budget where the canopy owns the tree's shadow. Dead trees have no
//   canopy, so their bark casts instead.
// - Ground dressing (bushes/ferns/mushrooms) is a new deterministic hash-grid
//   scatter, walk-through by design (no colliders, like grass).
// - Grass is streamed in deterministic chunks around the player. The old
//   player-centered ring rebuilt O(radius^2) instances in one frame whenever
//   the player moved far enough; chunking keeps both CPU generation and GPU
//   instance-buffer uploads bounded.

const GRASS_CHUNK_SIZE = 48;
const GRASS_CHUNK_BUILD_BUDGET_MS = 2.2;
const GRASS_CHUNK_MAX_BUILDS_PER_FRAME = 1;
const GRASS_DENSITY_LOW = 0.38;
const GRASS_DENSITY_HIGH = 0.5;
const GRASS_CHUNK_CACHE_LIMIT_LOW = 96;
const GRASS_CHUNK_CACHE_LIMIT_HIGH = 128;
const TREE_WIND_STRENGTH = 0.06;
const GRASS_WIND_STRENGTH = 0.08;
// two x-halves x 240u z-bands: bucket count x variants-per-bucket is the
// foliage draw budget — see the perBucket caps in the species specs
const BUCKET_DEPTH = 240;

const MODEL_DIR = 'models/foliage/';
const FOLIAGE_MODEL_URLS_HIGH = {
  // pine_3 is shipped but unused: its 462-tri canopy reads as a dead pole
  pine: [1, 2, 4, 5].map((i) => `${MODEL_DIR}pine_${i}.glb`),
  oak: [1, 2, 3, 4, 5].map((i) => `${MODEL_DIR}oak_${i}.glb`),
  twisted: [1, 2, 3].map((i) => `${MODEL_DIR}twisted_${i}.glb`),
  dead: [1, 2, 3].map((i) => `${MODEL_DIR}dead_${i}.glb`),
  rock: [1, 2, 3].map((i) => `${MODEL_DIR}rock_${i}.glb`),
  bush: [`${MODEL_DIR}bush.glb`],
  bushFlowers: [`${MODEL_DIR}bush_flowers.glb`],
  fern: [`${MODEL_DIR}fern.glb`],
  mushroom: [`${MODEL_DIR}mushroom.glb`],
};
const FOLIAGE_MODEL_URLS_LOW = {
  pine: [1].map((i) => `${MODEL_DIR}pine_${i}.glb`),
  oak: [1].map((i) => `${MODEL_DIR}oak_${i}.glb`),
  twisted: [1].map((i) => `${MODEL_DIR}twisted_${i}.glb`),
  dead: [1].map((i) => `${MODEL_DIR}dead_${i}.glb`),
  rock: [1].map((i) => `${MODEL_DIR}rock_${i}.glb`),
  bush: [`${MODEL_DIR}bush.glb`],
  bushFlowers: [`${MODEL_DIR}bush_flowers.glb`],
  fern: [`${MODEL_DIR}fern.glb`],
  mushroom: [`${MODEL_DIR}mushroom.glb`],
};
const MODEL_URLS = GFX.leanFoliage ? FOLIAGE_MODEL_URLS_LOW : FOLIAGE_MODEL_URLS_HIGH;

// kick off fetches at import; buildFoliage assumes the cache is populated
const loadedModels = new Map<string, GLTF>();
for (const urls of Object.values(MODEL_URLS)) {
  for (const url of urls) {
    registerPreload(
      loadGltf(url).then((g) => {
        loadedModels.set(url, g);
      }),
    );
  }
}

// Desaturated biome tints riding instanceColor. The textured models carry
// their own hue, so tints are lerped most of the way to white before use
// (raw tints multiply into the albedo and read as grime).
const PINE_TINT: Record<BiomeId, number> = {
  vale: 0x9bb48d,
  marsh: 0x87966b,
  peaks: 0x6f8a7a,
  beach: 0xa8b878,
  desert: 0xa8a468,
  volcano: 0x6a5f52,
  cave: 0x77837a,
};
const OAK_TINT: Record<BiomeId, number> = {
  vale: 0xa7b886,
  marsh: 0x8d9865,
  peaks: 0x92a37f,
  beach: 0xb2bd7e,
  desert: 0xb0a468,
  volcano: 0x74624f,
  cave: 0x84907f,
};
const ROCK_TINT: Record<BiomeId, number> = {
  vale: 0x8d8d85,
  marsh: 0x565c4e,
  peaks: 0x878e99,
  beach: 0xb0a894,
  desert: 0xb08d6a,
  volcano: 0x4a4038,
  cave: 0x6a6a66,
};
const TRUNK_TINT: Record<BiomeId, number> = {
  vale: 0xffffff,
  marsh: 0xd2d8bc,
  peaks: 0xd9dde4,
  beach: 0xf2e4c8,
  desert: 0xe6d2ac,
  volcano: 0xb8a394,
  cave: 0xc4c8c2,
};
const GRASS_TINT: Record<BiomeId, number> = {
  vale: 0xdde4c0,
  marsh: 0xbfc492,
  peaks: 0xc2cec8,
  beach: 0xe8e2b0,
  desert: 0xdcc890,
  volcano: 0x8a7a68,
  cave: 0xa2a89c,
};
const SWAMP_CANOPY_TINT = 0x7e8b58;
const DRESS_TINT: Record<BiomeId, number> = {
  vale: 0xaebf8e,
  marsh: 0x8d9865,
  peaks: 0x93a78f,
  beach: 0xc2c188,
  desert: 0xc0aa74,
  volcano: 0x7a6a58,
  cave: 0x8a948a,
};
// how far tints collapse toward white (1 = no tint at all)
const LEAF_TINT_SOFTEN = 0.6;
const BARK_TINT_SOFTEN = 0.85;
const ROCK_TINT_SOFTEN = 0.45;
const DRESS_TINT_SOFTEN = 0.65;

// rocks only pick up the snow-dust colorway above the terrain snowline —
// low-altitude peaks-biome foothills stay mossy/bare (white rocks on green
// grass read as scattered eggs)
const ROCK_SNOWLINE_Y = 34; // terrain snow tint starts at h~34 (terrain.ts)
// grass/dressing refuse cliff faces (mirrors ROCK_SLOPE_START in terrain.ts)
const GRASS_MAX_SLOPE = 0.62;
const GRASS_SLOPE_EPS = 1.2;

export interface FoliageView {
  group: THREE.Group;
  /** per-frame: grass fade + ring rebuild, fog culling of far tree buckets */
  update(
    px: number,
    pz: number,
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
  ): void;
  setGrassQuality(level: number): void;
  setModelQuality(level: number): void;
  perfStats(): FoliagePerfStats;
}

export interface FoliagePerfStats {
  modelQuality: number;
  modelBuckets: number;
  modelVisibleBuckets: number;
  modelBucketsByLod: Record<string, number>;
  modelVisibleByLod: Record<string, number>;
  modelDraws: number;
  modelVisibleDraws: number;
  modelDrawsByLod: Record<string, number>;
  modelVisibleDrawsByLod: Record<string, number>;
  modelTriangles: number;
  modelVisibleTriangles: number;
  modelTrianglesByLod: Record<string, number>;
  modelVisibleTrianglesByLod: Record<string, number>;
  grassEnabled: boolean;
  grassQuality: number;
  grassActiveRadius: number;
  grassChunks: number;
  grassReadyChunks: number;
  grassVisibleChunks: number;
  grassQueuedChunks: number;
  grassTufts: number;
  grassVisibleTufts: number;
  grassBuiltChunks: number;
  grassDisposedChunks: number;
  grassLastBuildMs: number;
  grassBuildMs: number;
  grassCacheLimit: number;
}

// deterministic 0..1 hash on integer grid cells / world coords
function hashAt(a: number, b: number, k: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

// fog-cullable handle for one instanced bucket mesh; optional distance window
// (bucket-center based) drives the cheap far-LOD swaps
interface BucketMesh {
  mesh: THREE.InstancedMesh;
  x: number;
  z: number;
  radius: number;
  minDist?: number;
  maxDist?: number;
  lod: 'core' | 'near-fill' | 'shadow' | 'proxy' | 'impostor' | 'rock' | 'dressing';
  draws: number;
  triangles: number;
}

function drawCountFor(
  material: THREE.Material | THREE.Material[],
  geometry?: THREE.BufferGeometry,
): number {
  if (Array.isArray(material))
    return Math.max(1, geometry?.groups.length ? geometry.groups.length : material.length);
  return Math.max(
    1,
    geometry?.groups.length && geometry.groups.length > 0 ? geometry.groups.length : 1,
  );
}

function triangleCountFor(geometry?: THREE.BufferGeometry): number {
  if (!geometry) return 0;
  const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.max(0, Math.floor(drawCount / 3));
}

function bucketMeshCost(mesh: THREE.InstancedMesh): Pick<BucketMesh, 'draws' | 'triangles'> {
  return {
    draws: drawCountFor(mesh.material, mesh.geometry),
    triangles: triangleCountFor(mesh.geometry) * Math.max(0, mesh.count),
  };
}

interface TreeHidePart {
  mesh: THREE.InstancedMesh;
  index: number;
  visibleMatrix: THREE.Matrix4;
  hiddenMatrix: THREE.Matrix4;
}

interface TreeHideable {
  x: number;
  z: number;
  r: number;
  topY: number;
  hidden: boolean;
  parts: TreeHidePart[];
}

// distance caps for the LOD windows. The dense sculpted barks are ~70% of a
// tree's triangles but read as a thin pole beyond the fog midpoint — hide
// them there (oaks swap to a cheap cylinder; pine canopies reach low enough
// to cover the gap). Dressing/rocks are sub-pixel long before the fog wall.
// The low tier (software GL / weak iGPU) pulls everything much closer — it
// has no shadows or fog-flattering post, and raw triangle rate is its limit.
interface LodDists {
  barkFar: number;
  treeDetailFar: number;
  dressFar: number;
  rockFar: number;
  treeFillFar: number;
}
const LOD_HIGH: LodDists = {
  barkFar: 330,
  treeDetailFar: 300,
  dressFar: 200,
  rockFar: 360,
  treeFillFar: 310,
};
// low caps must clear the worst camera-to-bucket-CENTRE distance (~158u for a
// 2-column x 240u-band bucket) or nearby dressing vanishes and trunks pop at
// bucket boundaries — the windows test bucket centres, not instances
const LOD_LOW: LodDists = {
  barkFar: 170,
  treeDetailFar: 250,
  dressFar: 185,
  rockFar: 190,
  treeFillFar: 245,
};
function lodDists(): LodDists {
  return GFX.leanFoliage ? LOD_LOW : LOD_HIGH;
}

// Wind sway injection for foliage materials (canopies, bushes, grass cards).
// Phase comes from the instance's world origin so neighbouring trees
// desynchronise; weight ramps by local height so bases stay planted.
function addWind(mat: THREE.Material, strength: number): void {
  if (!GFX.windSway) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uWindStrength = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float windPhase = instanceMatrix[3][0] * 0.15 + instanceMatrix[3][2] * 0.17;
        #else
          float windPhase = 0.0;
        #endif
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * uWindStrength * smoothstep(0.0, 1.0, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`,
      );
  };
}

// ---------------------------------------------------------------------------
// glTF extraction
// ---------------------------------------------------------------------------

// material names -> render policy (everything else is rigid/front-side)
interface MatPolicy {
  leaf: boolean; // double-sided alpha cutout that sways in the wind
  windMul: number;
  roughness: number;
}
const MAT_POLICY: Record<string, MatPolicy> = {
  Leaves_NormalTree: { leaf: true, windMul: 1, roughness: 0.9 },
  Leaves_Pine: { leaf: true, windMul: 1, roughness: 0.9 },
  Leaves_TwistedTree: { leaf: true, windMul: 1, roughness: 0.9 },
  Leaves: { leaf: true, windMul: 1.2, roughness: 0.95 },
  Flowers: { leaf: true, windMul: 1, roughness: 0.9 },
  Bark_NormalTree: { leaf: false, windMul: 0, roughness: 0.95 },
  Bark_TwistedTree: { leaf: false, windMul: 0, roughness: 0.95 },
  Bark_DeadTree: { leaf: false, windMul: 0, roughness: 0.95 },
  Rocks: { leaf: false, windMul: 0, roughness: 1.0 },
  Mushrooms: { leaf: false, windMul: 0, roughness: 0.9 },
};
const DEFAULT_POLICY: MatPolicy = { leaf: false, windMul: 0, roughness: 0.95 };
const LEAF_ALPHA_TEST = 0.4;

interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  isLeaf: boolean;
}

// one shared material per source-material name (dedupes textures across the
// 5 pine / 5 oak files which all reference the same bark + leaf sheets)
const materialCache = new Map<string, THREE.Material>();

function foliageMaterial(src: THREE.Material, hasVertexColors: boolean): THREE.Material {
  const cached = materialCache.get(src.name);
  if (cached) return cached;
  const std = src as THREE.MeshStandardMaterial;
  const pol = MAT_POLICY[src.name] ?? DEFAULT_POLICY;
  const common = {
    map: std.map,
    color: std.color.clone(), // baseColorFactor — some kit sheets rely on it
    vertexColors: hasVertexColors,
    alphaTest: pol.leaf ? LEAF_ALPHA_TEST : 0,
    side: pol.leaf ? THREE.DoubleSide : THREE.FrontSide,
  };
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...common,
        normalMap: std.normalMap,
        roughness: pol.roughness,
        metalness: 0,
      })
    : new THREE.MeshLambertMaterial(common);
  if (pol.windMul > 0) addWind(mat, TREE_WIND_STRENGTH * pol.windMul);
  materialCache.set(src.name, mat);
  return mat;
}

// The shipped GLBs are meshopt-quantized: positions/normals/colors live in
// normalized integer attributes with a dequantization node transform. Bake
// everything to float32 + world space once so geometries can be shared by
// InstancedMeshes and merged into clusters without overflow.
function toFloatAttribute(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let j = 0; j < attr.itemSize; j++) out[i * attr.itemSize + j] = attr.getComponent(i, j);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

function bakeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attr = src.getAttribute(name);
    if (attr) out.setAttribute(name, toFloatAttribute(attr));
  }
  if (src.index) out.setIndex(src.index.clone());
  out.applyMatrix4(mesh.matrixWorld);
  return out;
}

function extractParts(url: string): ModelPart[] {
  const gltf = loadedModels.get(url);
  if (!gltf) throw new Error(`foliage model not preloaded: ${url}`);
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const srcMat = mesh.material as THREE.Material;
    const geometry = bakeGeometry(mesh);
    parts.push({
      geometry,
      material: foliageMaterial(srcMat, geometry.getAttribute('color') !== undefined),
      isLeaf: (MAT_POLICY[srcMat.name] ?? DEFAULT_POLICY).leaf,
    });
  });
  if (parts.length === 0) throw new Error(`foliage model has no meshes: ${url}`);
  // draw barks before leaves: opaque first is kinder to early-z
  return parts.sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf));
}

// Upward-facing rock vertices blend toward `tint` (moss or snow dust) and the
// underside picks up baked AO; both multiply the texture + per-instance gray.
function bakeTopTint(geo: THREE.BufferGeometry, tint: THREE.Color): THREE.BufferGeometry {
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const arr = new Float32Array(nrm.count * 3);
  for (let i = 0; i < nrm.count; i++) {
    const upness = nrm.getY(i);
    const t = THREE.MathUtils.smoothstep(upness, 0.25, 0.85);
    const ao = 1 + Math.min(0, upness) * 0.25;
    arr[i * 3] = (1 + (tint.r - 1) * t) * ao;
    arr[i * 3 + 1] = (1 + (tint.g - 1) * t) * ao;
    arr[i * 3 + 2] = (1 + (tint.b - 1) * t) * ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// biome tint lerped toward white + per-instance HSL jitter, deterministic
// from world position
const tmpWhite = new THREE.Color(1, 1, 1);
function softTint(
  x: number,
  z: number,
  hex: number,
  out: THREE.Color,
  soften: number,
  jitter = 1,
): THREE.Color {
  out.setHex(hex).lerp(tmpWhite, soften);
  out.offsetHSL(
    (hashAt(x, z, 1) - 0.5) * 0.05 * jitter,
    (hashAt(x, z, 2) - 0.5) * 0.12 * jitter,
    (hashAt(x, z, 3) - 0.5) * 0.1 * jitter,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Trees & rocks
// ---------------------------------------------------------------------------

// deterministic per-bucket subset of model variants: rotating start + stride
// (variant counts are 3/5, both coprime with every stride < count)
function variantSubset(
  count: number,
  total: number,
  band: number,
  col: number,
  salt: number,
): number[] {
  const n = Math.min(count, total);
  const start = Math.floor(hashAt(band, col, salt) * total);
  const stride = total <= n ? 1 : 1 + Math.floor(hashAt(band, col, salt + 1) * (total - 1));
  return Array.from({ length: n }, (_, i) => (start + i * stride) % total);
}

interface SpeciesSpec {
  sets: ModelPart[][]; // parts per model variant
  perBucket: number; // variant cap per bucket
  salt: number;
  baseScale: number;
  sink: number; // x instance scale, beyond the model's own below-ground roots
  leafTint: Record<BiomeId, number> | number;
  castBarkShadow: boolean;
  proxyShape: 'pine' | 'round' | 'twisted' | 'dead';
  /** hide the heavy bark mesh beyond BARK_FAR (needs a canopy that covers) */
  cullBarkFar?: boolean;
  /** beyond BARK_FAR swap the bark for a cheap cylinder (straight trunks) */
  farTrunkProxy?: boolean;
}

const farTreeProxyGeoCache = new Map<SpeciesSpec['proxyShape'], THREE.BufferGeometry>();
const farTreeProxyMatCache = new Map<string, THREE.Material>();

function withWhiteVertexColors(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geo.getAttribute('position')?.count ?? 0;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geo;
}

function farTreeProxyGeo(shape: SpeciesSpec['proxyShape']): THREE.BufferGeometry {
  const cached = farTreeProxyGeoCache.get(shape);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  if (shape === 'pine') {
    geo = new THREE.ConeGeometry(2.2, 7.2, 7, 2);
    geo.translate(0, 3.6, 0);
  } else if (shape === 'dead') {
    geo = new THREE.CylinderGeometry(0.18, 0.42, 6.4, 7, 2, true);
    geo.translate(0, 3.2, 0);
  } else if (shape === 'twisted') {
    geo = new THREE.ConeGeometry(2.6, 5.6, 8, 2);
    geo.scale(1.15, 1, 0.75);
    geo.translate(0, 2.8, 0);
  } else {
    geo = new THREE.SphereGeometry(2.35, 8, 5);
    geo.scale(1.15, 0.9, 1.15);
    geo.translate(0, 4.4, 0);
  }
  geo = withWhiteVertexColors(geo);
  farTreeProxyGeoCache.set(shape, geo);
  return geo;
}

function farTreeProxyMaterial(shape: SpeciesSpec['proxyShape']): THREE.Material {
  const cached = farTreeProxyMatCache.get(shape);
  if (cached) return cached;
  const fallback =
    shape === 'dead'
      ? 0xbca784
      : shape === 'pine'
        ? 0xb8d7a5
        : shape === 'twisted'
          ? 0xb7cda0
          : 0xc0d8a8;
  const mat = new THREE.MeshLambertMaterial({
    color: fallback,
    vertexColors: true,
    fog: true,
  });
  mat.name = `foliage:far-${shape}`;
  farTreeProxyMatCache.set(shape, mat);
  return mat;
}

// Compile every foliage shader program up front. The renderer streams its tree /
// rock buckets in as the player moves, so a species (or its far-impostor) whose
// buckets are not near spawn otherwise links its shader the first time you walk
// into it: the open-world travel hitch. We instantiate one mesh per distinct
// foliage material using the REAL extracted geometry and the same per-mesh state
// the live buckets use, so compileAsync links the exact program by cache key.
// Three pitfalls matter, all learned from real-GPU freeze logging:
//   - real geometry, not a dummy plane: the program key depends on the geometry's
//     attributes (a normal-mapped ultra material needs TANGENTS; a dummy plane has
//     none, so its program differs and the live bucket recompiles);
//   - instanceColor: every live bucket tints per instance (setColorAt ->
//     USE_INSTANCING_COLOR);
//   - castShadow: ultra renders a shadow pass, so the depth/shadow program variant
//     must compile too.
// Caller adds the group to the scene before the compile pass and removes it after.
// (Grass compiles at spawn via the player-centred ring, so it is not duplicated.)
export function buildFoliageMaterialPrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'foliage-material-prewarm';
  group.position.set(0, -1000, 0); // off-screen; compileAsync ignores position
  const identity = new THREE.Matrix4();
  const white = new THREE.Color(1, 1, 1);
  const seen = new Set<THREE.Material>();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material): void => {
    if (seen.has(mat)) return;
    seen.add(mat);
    const im = new THREE.InstancedMesh(geo, mat, 1);
    im.setMatrixAt(0, identity);
    im.setColorAt(0, white);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  };
  // One mesh per material, keyed on the real per-species extracted parts so the
  // geometry attributes (uv / normal / tangent / color) match the live buckets.
  const speciesUrls = [
    ...MODEL_URLS.pine,
    ...MODEL_URLS.oak,
    ...MODEL_URLS.twisted,
    ...MODEL_URLS.dead,
    ...MODEL_URLS.rock,
    MODEL_URLS.bush[0],
    MODEL_URLS.bushFlowers[0],
    MODEL_URLS.fern[0],
    MODEL_URLS.mushroom[0],
  ];
  for (const url of speciesUrls) {
    for (const part of extractParts(url)) add(part.geometry, part.material);
  }
  // Far-tree impostors (gated exactly like the live tree builder).
  if (GFX.standardMaterials && !GFX.leanFoliage) {
    for (const shape of ['pine', 'round', 'twisted', 'dead'] as const) {
      add(farTreeProxyGeo(shape), farTreeProxyMaterial(shape));
    }
  }
  return group;
}

// far-LOD stand-in for a straight trunk: an open tapered cylinder sized from
// the bark's bounding box, drawn with the same bark material (the atlas
// smears, but at 300+u in fog it reads as bark)
const farTrunkCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
function farTrunkGeo(barkGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = farTrunkCache.get(barkGeo);
  if (cached) return cached;
  barkGeo.computeBoundingBox();
  const h = barkGeo.boundingBox!.max.y * 0.8;
  const geo = new THREE.CylinderGeometry(0.2, 0.42, h, 5, 1, true);
  geo.translate(0, h / 2, 0);
  // the bark material has vertexColors:true (source GLBs ship COLOR_0); a
  // proxy without the attribute samples the GL default (0,0,0) — black poles.
  // Match the bark's VEC4 colors with constant white instead.
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4));
  farTrunkCache.set(barkGeo, geo);
  return geo;
}

// second InstancedMesh sharing another's instance matrices/colors
function cloneInstancedTo(
  src: THREE.InstancedMesh,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.InstancedMesh {
  const out = new THREE.InstancedMesh(geometry, material, src.count);
  (out.instanceMatrix.array as Float32Array).set(src.instanceMatrix.array as Float32Array);
  out.instanceMatrix.needsUpdate = true;
  if (src.instanceColor) {
    out.instanceColor = new THREE.InstancedBufferAttribute(
      (src.instanceColor.array as Float32Array).slice(),
      3,
    );
    out.instanceColor.needsUpdate = true;
  }
  return out;
}

interface Bucket {
  band: number;
  col: number;
  items: Decoration[];
}

// scratch objects shared by every placement loop
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const up = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const sv = new THREE.Vector3();
const c = new THREE.Color();
const zeroScale = new THREE.Vector3(0, 0, 0);
const shadowOnlyMaterialCache = new WeakMap<THREE.Material, THREE.Material>();

function makeShadowOnlyMaterial(src: THREE.Material): THREE.Material {
  const cached = shadowOnlyMaterialCache.get(src);
  if (cached) return cached;
  const mat = src.clone();
  mat.colorWrite = false;
  mat.depthWrite = false;
  shadowOnlyMaterialCache.set(src, mat);
  return mat;
}

function placeSpecies(
  parent: THREE.Group,
  seed: number,
  bucket: Bucket,
  items: Decoration[],
  spec: SpeciesSpec,
  register: (
    mesh: THREE.InstancedMesh,
    lod: BucketMesh['lod'],
    minDist?: number,
    maxDist?: number,
  ) => void,
  hideRegistry: TreeHideable[],
): void {
  if (items.length === 0) return;
  const subset = variantSubset(
    spec.perBucket,
    spec.sets.length,
    bucket.band,
    bucket.col,
    spec.salt,
  );
  const groups: Decoration[][] = subset.map(() => []);
  for (const d of items) {
    const pick =
      (d.variant + Math.floor(hashAt(d.x, d.z, spec.salt + 2) * subset.length)) % subset.length;
    groups[pick].push(d);
  }
  groups.forEach((list, gi) => {
    if (list.length === 0) return;
    const { treeDetailFar, treeFillFar } = lodDists();
    const coreItems: Decoration[] = [];
    const nearFillItems: Decoration[] = [];
    const coreRatio = GFX.leanFoliage ? 0.42 : 0.5;
    for (const d of list) {
      if (list.length < 4 || hashAt(d.x, d.z, spec.salt + 91) < coreRatio) coreItems.push(d);
      else nearFillItems.push(d);
    }
    const lodGroups = [
      { lod: 'core' as const, items: coreItems, maxDist: undefined },
      { lod: 'near-fill' as const, items: nearFillItems, maxDist: treeFillFar },
    ].filter((g) => g.items.length > 0);
    const handlesByLod = lodGroups.map((g) => {
      const handles: TreeHideable[] = g.items.map((d) => ({
        x: d.x,
        z: d.z,
        r: 0.55 * d.scale,
        topY: terrainHeight(d.x, d.z, seed) + 7.5 * d.scale,
        hidden: false,
        parts: [],
      }));
      hideRegistry.push(...handles);
      return { ...g, handles };
    });
    if (GFX.standardMaterials && !GFX.leanFoliage) {
      for (const group of handlesByLod) {
        if (group.maxDist !== undefined && group.maxDist <= treeDetailFar) continue;
        const proxy = new THREE.InstancedMesh(
          farTreeProxyGeo(spec.proxyShape),
          farTreeProxyMaterial(spec.proxyShape),
          group.items.length,
        );
        group.items.forEach((d, i) => {
          const y = terrainHeight(d.x, d.z, seed);
          const s = d.scale * spec.baseScale;
          q.setFromAxisAngle(up, d.variant * 2.1 + hashAt(d.x, d.z, 11) * Math.PI * 2);
          m.compose(v.set(d.x, y - spec.sink * s, d.z), q, sv.set(s, s, s));
          proxy.setMatrixAt(i, m);
          const tintHex =
            spec.proxyShape === 'dead'
              ? TRUNK_TINT[d.biome]
              : typeof spec.leafTint === 'number'
                ? spec.leafTint
                : spec.leafTint[d.biome];
          proxy.setColorAt(
            i,
            softTint(
              d.x,
              d.z,
              tintHex,
              c,
              spec.proxyShape === 'dead' ? BARK_TINT_SOFTEN : LEAF_TINT_SOFTEN,
            ),
          );
        });
        if (proxy.instanceColor) proxy.instanceColor.needsUpdate = true;
        proxy.receiveShadow = true;
        parent.add(proxy);
        register(proxy, 'impostor', treeDetailFar, group.maxDist);
      }
    }
    for (const part of spec.sets[subset[gi]]) {
      const { barkFar } = lodDists();
      for (const group of handlesByLod) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, group.items.length);
        group.items.forEach((d, i) => {
          const y = terrainHeight(d.x, d.z, seed);
          const s = d.scale * spec.baseScale;
          const heightJitter = 1 + (hashAt(d.x, d.z, 31) - 0.5) * 0.18;
          q.setFromAxisAngle(up, d.variant * 2.1 + hashAt(d.x, d.z, 11) * Math.PI * 2);
          m.compose(v.set(d.x, y - spec.sink * s, d.z), q, sv.set(s, s * heightJitter, s));
          im.setMatrixAt(i, m);
          const visibleMatrix = new THREE.Matrix4().copy(m);
          const hiddenMatrix = new THREE.Matrix4().copy(m).scale(zeroScale);
          group.handles[i].parts.push({ mesh: im, index: i, visibleMatrix, hiddenMatrix });
          if (part.isLeaf) {
            const hex = typeof spec.leafTint === 'number' ? spec.leafTint : spec.leafTint[d.biome];
            im.setColorAt(i, softTint(d.x, d.z, hex, c, LEAF_TINT_SOFTEN));
          } else {
            im.setColorAt(i, softTint(d.x, d.z, TRUNK_TINT[d.biome], c, BARK_TINT_SOFTEN, 0.5));
          }
        });
        // canopy owns the tree shadow; bark casts only when there is no canopy
        const castsShadow = part.isLeaf || spec.castBarkShadow;
        im.castShadow = false;
        im.receiveShadow = true;
        parent.add(im);
        const cullBark =
          GFX.standardMaterials && !part.isLeaf && (spec.cullBarkFar || spec.farTrunkProxy);
        const detailMaxDist =
          group.maxDist === undefined ? treeDetailFar : Math.min(group.maxDist, treeDetailFar);
        const maxDist = cullBark ? Math.min(detailMaxDist, barkFar) : detailMaxDist;
        register(im, group.lod, undefined, maxDist === Infinity ? undefined : maxDist);
        if (GFX.standardMaterials && !GFX.leanFoliage && castsShadow) {
          const shadow = cloneInstancedTo(im, part.geometry, makeShadowOnlyMaterial(part.material));
          shadow.castShadow = true;
          shadow.receiveShadow = false;
          parent.add(shadow);
          register(shadow, 'shadow', undefined, maxDist === Infinity ? undefined : maxDist);
        }
        if (
          GFX.standardMaterials &&
          !part.isLeaf &&
          spec.farTrunkProxy &&
          detailMaxDist > barkFar
        ) {
          const proxy = cloneInstancedTo(im, farTrunkGeo(part.geometry), part.material);
          proxy.receiveShadow = true;
          for (let i = 0; i < group.items.length; i++) {
            const source = group.handles[i].parts[group.handles[i].parts.length - 1];
            group.handles[i].parts.push({
              mesh: proxy,
              index: i,
              visibleMatrix: source.visibleMatrix,
              hiddenMatrix: source.hiddenMatrix,
            });
          }
          parent.add(proxy);
          register(proxy, 'proxy', barkFar, detailMaxDist);
        }
      }
    }
  });
}

function buildTrees(
  parent: THREE.Group,
  seed: number,
  registry: BucketMesh[],
  hideRegistry: TreeHideable[],
): void {
  const decos = generateDecorations(seed);
  const sourceDecos = !GFX.leanFoliage
    ? decos
    : decos.filter((d) => {
        const keep = GFX.standardMaterials
          ? d.kind === 'rock'
            ? 0.74
            : 0.68
          : d.kind === 'rock'
            ? 0.55
            : 0.46;
        return hashAt(d.x, d.z, 83) < keep;
      });
  const buckets = new Map<string, Bucket>();
  for (const d of sourceDecos) {
    const col = d.x < 0 ? 0 : 1;
    const band = Math.floor((d.z - WORLD_MIN_Z) / BUCKET_DEPTH);
    const key = `${band}:${col}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { band, col, items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push(d);
  }

  // low tier: one variant per species per bucket — it ran one procedural
  // shape per species before, and software GL pays per triangle
  const treeVariants = GFX.leanFoliage ? 1 : 2;
  const pineSpec: SpeciesSpec = {
    sets: MODEL_URLS.pine.map(extractParts),
    perBucket: treeVariants,
    salt: 51,
    baseScale: 1.1,
    sink: 0.05,
    leafTint: PINE_TINT,
    castBarkShadow: false,
    proxyShape: 'pine',
    cullBarkFar: true, // pine canopies start ~2u up: no proxy needed in fog
  };
  const oakSpec: SpeciesSpec = {
    sets: MODEL_URLS.oak.map(extractParts),
    perBucket: treeVariants,
    salt: 54,
    baseScale: 1.15,
    sink: 0.05,
    leafTint: OAK_TINT,
    castBarkShadow: false,
    proxyShape: 'round',
    farTrunkProxy: true, // oak crowns float without a trunk stand-in
  };
  const twistedSpec: SpeciesSpec = {
    sets: MODEL_URLS.twisted.map(extractParts),
    perBucket: treeVariants,
    salt: 57,
    baseScale: 0.5,
    sink: 0.05,
    // twisted trunks sprawl sideways — no cheap proxy fits, keep them whole
    leafTint: SWAMP_CANOPY_TINT,
    castBarkShadow: false,
    proxyShape: 'twisted',
  };
  const deadSpec: SpeciesSpec = {
    sets: MODEL_URLS.dead.map(extractParts),
    perBucket: 1,
    salt: 60,
    baseScale: 0.7,
    sink: 0.05,
    // dead trees have no canopy — the bark must cast or they go shadowless
    leafTint: TRUNK_TINT.marsh,
    castBarkShadow: true,
    proxyShape: 'dead',
  };

  // rocks: 3 single variants + a merged 3-boulder cluster, each in a mossy-top
  // and a snow-dusted colorway (baked vertex colors over the rock texture)
  const rockParts = MODEL_URLS.rock.map(extractParts);
  // source rock GLBs ship no COLOR_0, so the cached material resolves with
  // vertexColors:false — but every rock geometry below goes through
  // bakeTopTint (moss/snow vertex colors). Clone with vertexColors on, or
  // the colorways are inert. (Safe to clone: rocks take no wind hook.)
  const rockMat = (rockParts[0][0].material as THREE.MeshStandardMaterial).clone();
  rockMat.vertexColors = true;
  const colorway = (tint: THREE.Color): THREE.BufferGeometry[] => {
    const singles = rockParts.map((parts) => bakeTopTint(parts[0].geometry.clone(), tint));
    const member = (
      gi: number,
      x: number,
      y: number,
      z: number,
      ry: number,
      s: number,
    ): THREE.BufferGeometry =>
      singles[gi % singles.length]
        .clone()
        .applyMatrix4(m.compose(v.set(x, y, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s)));
    const cluster = mergeGeometries([
      member(0, -0.55, 0, 0.15, 0.3, 0.85),
      member(1, 0.95, -0.12, 0.45, 1.4, 0.62),
      member(2, 0.2, 0.6, -0.35, 2.4, 0.48),
    ]);
    return [...singles, cluster]; // [single x3, cluster]
  };
  const mossRocks = colorway(new THREE.Color(0.62, 0.82, 0.45));
  const snowRocks = colorway(new THREE.Color(1.5, 1.55, 1.65));

  for (const bucket of buckets.values()) {
    const { items } = bucket;
    const pines = items.filter((d) => d.kind === 'tree');
    const oaks = items.filter((d) => d.kind === 'tree2' && d.biome !== 'marsh');
    const swamps = items.filter((d) => d.kind === 'tree2' && d.biome === 'marsh');
    // marsh swamp trees split between twisted (mossy) and dead (bare) models
    const twisteds = swamps.filter((d) => hashAt(d.x, d.z, 19) >= 0.35);
    const deads = swamps.filter((d) => hashAt(d.x, d.z, 19) < 0.35);
    const rocks = items.filter((d) => d.kind === 'rock');

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const d of items) {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      minZ = Math.min(minZ, d.z);
      maxZ = Math.max(maxZ, d.z);
    }
    const bx = (minX + maxX) / 2,
      bz = (minZ + maxZ) / 2;
    const bRadius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 18; // canopy margin
    const register = (
      mesh: THREE.InstancedMesh,
      lod: BucketMesh['lod'],
      minDist?: number,
      maxDist?: number,
    ): void => {
      registry.push({
        mesh,
        x: bx,
        z: bz,
        radius: bRadius,
        minDist,
        maxDist,
        lod,
        ...bucketMeshCost(mesh),
      });
    };

    placeSpecies(parent, seed, bucket, pines, pineSpec, register, hideRegistry);
    placeSpecies(parent, seed, bucket, oaks, oakSpec, register, hideRegistry);
    placeSpecies(parent, seed, bucket, twisteds, twistedSpec, register, hideRegistry);
    placeSpecies(parent, seed, bucket, deads, deadSpec, register, hideRegistry);

    if (rocks.length > 0) {
      const isCluster = (r: Decoration): boolean => hashAt(r.x, r.z, 7) > 0.72;
      const isSnowy = (r: Decoration): boolean =>
        r.biome === 'peaks' && terrainHeight(r.x, r.z, seed) > ROCK_SNOWLINE_Y;
      // 1 of the 3 single variants per bucket + the cluster archetype
      const singleSubset = variantSubset(1, 3, bucket.band, bucket.col, 71);
      const groupGeo = (r: Decoration): THREE.BufferGeometry => {
        const set = isSnowy(r) ? snowRocks : mossRocks;
        if (isCluster(r)) return set[3];
        return set[singleSubset[Math.floor(hashAt(r.x, r.z, 72) * singleSubset.length)]];
      };
      const groups = new Map<THREE.BufferGeometry, Decoration[]>();
      for (const r of rocks) {
        const geo = groupGeo(r);
        const list = groups.get(geo);
        if (list) list.push(r);
        else groups.set(geo, [r]);
      }
      for (const [geo, list] of groups) {
        const rockMesh = new THREE.InstancedMesh(geo, rockMat, list.length);
        list.forEach((r, i) => {
          const y = terrainHeight(r.x, r.z, seed);
          const h1 = hashAt(r.x, r.z, 8),
            h2 = hashAt(r.x, r.z, 9),
            h3 = hashAt(r.x, r.z, 10);
          // slight tilt + non-uniform scale: one geometry reads as round
          // boulders, low slabs and tall stones depending on the draw
          const sxz1 = r.scale * 0.62 * (0.85 + h2 * 0.5);
          const sxz2 = r.scale * 0.62 * (0.85 + h1 * 0.45);
          const maxH = Math.max(sxz1, sxz2);
          const sy = Math.max(r.scale * 0.45 * (0.75 + h3 * 0.5), 0.55 * maxH);
          const tiltAmp = maxH > 0.8 ? 0.12 : 0.26;
          q.setFromEuler(
            e.set((h1 - 0.5) * tiltAmp, r.variant * 1.7 + h3 * 2.0, (h2 - 0.5) * tiltAmp),
          );
          // sink so undersides bury on slopes (geometry base is near y=0)
          m.compose(v.set(r.x, y - 0.3 * sy, r.z), q, sv.set(sxz1, sy, sxz2));
          rockMesh.setMatrixAt(i, m);
          // low-altitude peaks rocks drop the icy blue-gray for a warm field
          // stone — pale rocks on green foothill grass read as eggs
          const rockHex = r.biome === 'peaks' && !isSnowy(r) ? 0x6f6e62 : ROCK_TINT[r.biome];
          rockMesh.setColorAt(i, softTint(r.x, r.z, rockHex, c, ROCK_TINT_SOFTEN));
        });
        // no rock shadows cast: sub-pixel at typical camera range, real draw cost
        rockMesh.receiveShadow = true;
        parent.add(rockMesh);
        register(rockMesh, 'rock', undefined, lodDists().rockFar);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ground dressing: bushes, ferns, mushrooms on a deterministic hash grid
// ---------------------------------------------------------------------------

type DressKind = 'bush' | 'bushFlowers' | 'fern' | 'mushroom';

interface DressingSpot {
  x: number;
  z: number;
  kind: DressKind;
  scale: number;
}

const DRESS_STEP_HIGH = 12;
const DRESS_STEP_LOW = 10;
const DRESS_DENSITY: Record<BiomeId, number> = {
  vale: 0.26,
  marsh: 0.26,
  peaks: 0.15,
  beach: 0.1,
  desert: 0.07,
  volcano: 0.05,
  cave: 0.08,
};
const DRESS_DENSITY_LOW_SCALE = 1.24;
const DRESS_LOW_SCALE_BOOST = 1.08;
const DRESS_TINT_SOFTEN_LOW = 0.56;

function dressStep(): number {
  return GFX.leanFoliage ? DRESS_STEP_LOW : DRESS_STEP_HIGH;
}

function dressKindFor(biome: BiomeId, r: number): DressKind {
  if (biome === 'vale') {
    if (r < 0.36) return 'bush';
    if (r < 0.46) return 'bushFlowers';
    if (r < 0.8) return 'fern';
    return 'mushroom';
  }
  if (biome === 'marsh') {
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'fern';
    return 'mushroom';
  }
  if (biome === 'beach' || biome === 'desert') return 'bush';
  if (biome === 'cave') return r < 0.5 ? 'mushroom' : 'fern';
  if (biome === 'volcano') return 'bush';
  return r < 0.62 ? 'bush' : 'fern';
}

const DRESS_SCALE: Record<DressKind, [number, number]> = {
  bush: [0.9, 0.7],
  bushFlowers: [0.9, 0.7],
  fern: [0.85, 0.6],
  mushroom: [0.9, 0.8],
};

function tooSteep(x: number, z: number, seed: number): boolean {
  const hx =
    terrainHeight(x + GRASS_SLOPE_EPS, z, seed) - terrainHeight(x - GRASS_SLOPE_EPS, z, seed);
  const hz =
    terrainHeight(x, z + GRASS_SLOPE_EPS, seed) - terrainHeight(x, z - GRASS_SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * GRASS_SLOPE_EPS) > GRASS_MAX_SLOPE;
}

function generateDressing(seed: number): DressingSpot[] {
  const out: DressingSpot[] = [];
  const xHalf = WORLD_MAX_X - 16;
  const step = dressStep();
  const scaleBoost = GFX.leanFoliage ? DRESS_LOW_SCALE_BOOST : 1;
  for (let gx = -xHalf; gx < xHalf; gx += step) {
    for (let gz = WORLD_MIN_Z + 16; gz < WORLD_MAX_Z - 16; gz += step) {
      const r = hashAt(gx, gz, 41);
      const biome = zoneBiomeAt(gz);
      const density = DRESS_DENSITY[biome] * (GFX.leanFoliage ? DRESS_DENSITY_LOW_SCALE : 1);
      if (r > density) continue;
      const x = gx + (hashAt(gx, gz, 42) - 0.5) * step;
      const z = gz + (hashAt(gx, gz, 43) - 0.5) * step;
      let blocked = false;
      for (const zone of ZONES) {
        if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < zone.hub.radius + 4) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const camp of CAMPS) {
        if (Math.hypot(x - camp.center.x, z - camp.center.z) < camp.radius + 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (roadDistance(x, z) < 4) continue;
      if (terrainHeight(x, z, seed) < waterLevel() + 1.2) continue;
      if (tooSteep(x, z, seed)) continue;
      const kind = dressKindFor(biome, hashAt(gx, gz, 44));
      const [sMin, sRange] = DRESS_SCALE[kind];
      out.push({ x, z, kind, scale: (sMin + hashAt(gx, gz, 45) * sRange) * scaleBoost });
    }
  }
  return out;
}

function buildDressing(parent: THREE.Group, seed: number, registry: BucketMesh[]): void {
  const kindParts: Record<DressKind, ModelPart[]> = {
    bush: extractParts(MODEL_URLS.bush[0]),
    bushFlowers: extractParts(MODEL_URLS.bushFlowers[0]),
    fern: extractParts(MODEL_URLS.fern[0]),
    mushroom: extractParts(MODEL_URLS.mushroom[0]),
  };
  const buckets = new Map<string, DressingSpot[]>();
  for (const spot of generateDressing(seed)) {
    const key = `${Math.floor((spot.z - WORLD_MIN_Z) / BUCKET_DEPTH)}:${spot.x < 0 ? 0 : 1}`;
    const list = buckets.get(key);
    if (list) list.push(spot);
    else buckets.set(key, [spot]);
  }

  for (const spots of buckets.values()) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const s of spots) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const bx = (minX + maxX) / 2,
      bz = (minZ + maxZ) / 2;
    const bRadius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 6;

    const byKind = new Map<DressKind, DressingSpot[]>();
    for (const s of spots) {
      const list = byKind.get(s.kind);
      if (list) list.push(s);
      else byKind.set(s.kind, [s]);
    }
    // Keep all four low-cost dressing kinds. Recent low-tier telemetry has
    // dressing well below both call and triangle budgets, so variety here is
    // higher ROI than adding more far canopy or post-processing work.
    const maxKinds = 4;
    const kept = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, maxKinds);
    for (const [kind, list] of kept) {
      for (const part of kindParts[kind]) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((s, i) => {
          const y = terrainHeight(s.x, s.z, seed);
          q.setFromAxisAngle(up, hashAt(s.x, s.z, 46) * Math.PI * 2);
          m.compose(v.set(s.x, y - 0.04 * s.scale, s.z), q, sv.set(s.scale, s.scale, s.scale));
          im.setMatrixAt(i, m);
          if (kind === 'mushroom') {
            // mushrooms keep their painted cap colors — brightness jitter only
            im.setColorAt(i, c.setScalar(0.85 + hashAt(s.x, s.z, 47) * 0.3));
          } else {
            im.setColorAt(
              i,
              softTint(
                s.x,
                s.z,
                DRESS_TINT[zoneBiomeAt(s.z)],
                c,
                GFX.leanFoliage ? DRESS_TINT_SOFTEN_LOW : DRESS_TINT_SOFTEN,
              ),
            );
          }
        });
        im.receiveShadow = true; // dressing casts nothing: too small to matter
        parent.add(im);
        registry.push({
          mesh: im,
          x: bx,
          z: bz,
          radius: bRadius,
          maxDist: lodDists().dressFar,
          lod: 'dressing',
          ...bucketMeshCost(im),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grass ring
// ---------------------------------------------------------------------------

interface GrassRing {
  update(px: number, pz: number): void;
  setQuality(level: number): void;
  perfStats(): FoliagePerfStats;
}

interface GrassChunk {
  key: string;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  ready: boolean;
  queued: boolean;
  lastSeen: number;
  lastUsed: number;
  prioritySq: number;
  mesh?: THREE.InstancedMesh;
}

// wind sway + masked edge fade for the grass tufts; the fade keys off the
// tuft's instance origin so alphaTest thins whole tufts without blending
function applyGrassShader(
  mat: THREE.Material,
  uniforms: { uPlayerPos: { value: THREE.Vector2 }; uFadeFar: { value: number } },
): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uniforms.uPlayerPos;
    sh.uniforms.uFadeFar = uniforms.uFadeFar;
    const wind = GFX.windSway
      ? `
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * ${GRASS_WIND_STRENGTH.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`
      : '';
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec2 vTuftWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tuftBase = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 tuftBase = vec2(0.0);
        #endif
        ${wind}
        vTuftWorld = tuftBase;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vTuftWorld;
        uniform vec2 uPlayerPos;
        uniform float uFadeFar;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.a *= 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, distance(vTuftWorld, uPlayerPos));`,
      );
  };
}

function loopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function localGrassDisabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  if (!loopbackHostname(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return (
    params.get('grass') === '0' || params.get('grass') === 'off' || params.get('noGrass') === '1'
  );
}

function emptyGrassStats(enabled: boolean, cacheLimit = 0): FoliagePerfStats {
  return {
    modelQuality: 1,
    modelBuckets: 0,
    modelVisibleBuckets: 0,
    modelBucketsByLod: {},
    modelVisibleByLod: {},
    modelDraws: 0,
    modelVisibleDraws: 0,
    modelDrawsByLod: {},
    modelVisibleDrawsByLod: {},
    modelTriangles: 0,
    modelVisibleTriangles: 0,
    modelTrianglesByLod: {},
    modelVisibleTrianglesByLod: {},
    grassEnabled: enabled,
    grassQuality: enabled ? 1 : 0,
    grassActiveRadius: 0,
    grassChunks: 0,
    grassReadyChunks: 0,
    grassVisibleChunks: 0,
    grassQueuedChunks: 0,
    grassTufts: 0,
    grassVisibleTufts: 0,
    grassBuiltChunks: 0,
    grassDisposedChunks: 0,
    grassLastBuildMs: 0,
    grassBuildMs: 0,
    grassCacheLimit: cacheLimit,
  };
}

function buildGrassRing(parent: THREE.Group, seed: number): GrassRing {
  const baseRadius = GFX.grassRadius;
  const step = GFX.grassStep;
  const chunkCells = Math.ceil(GRASS_CHUNK_SIZE / step) + 3;
  const maxChunkCount = Math.ceil(chunkCells * chunkCells * 0.5);
  const chunkHalfDiag = Math.SQRT2 * GRASS_CHUNK_SIZE * 0.5;
  const buildBudgetMs = GRASS_CHUNK_BUILD_BUDGET_MS;
  const cacheLimit = GFX.leanFoliage ? GRASS_CHUNK_CACHE_LIMIT_LOW : GRASS_CHUNK_CACHE_LIMIT_HIGH;

  // high tier reads as a lush meadow: wider tufts with more blades; low keeps
  // the legacy sprite size
  const lush = !GFX.leanFoliage;
  const lowPlusGrassScale = GFX.lowPlus ? 1.08 : 1;
  const quad = new THREE.PlaneGeometry(
    lush ? 1.45 : 1.1 * lowPlusGrassScale,
    lush ? 0.9 : 0.7 * lowPlusGrassScale,
  );
  quad.translate(0, lush ? 0.42 : 0.35 * lowPlusGrassScale, 0);
  const quad2 = quad.clone().rotateY(Math.PI / 2);
  const geo = mergeGeometries([quad, quad2]);

  const tuftTex = grassTuftTexture(lush ? 30 : 18);
  let quality = 1;
  const minRadiusScale = lush ? 0.58 : 0.48;
  const activeRadius = (): number =>
    Math.round(baseRadius * Math.max(minRadiusScale, quality) * 10) / 10;
  const uniforms = {
    uPlayerPos: { value: new THREE.Vector2(1e6, 1e6) },
    uFadeFar: { value: activeRadius() },
  };
  const mat = configureMaskedDoubleSidedVegetationMaterial(
    lush
      ? new THREE.MeshStandardMaterial({
          map: tuftTex,
          alphaTest: 0.3,
          roughness: 0.9,
        })
      : new THREE.MeshLambertMaterial({
          map: tuftTex,
          alphaTest: 0.35,
        }),
  );
  applyGrassShader(mat, uniforms);

  const chunks = new Map<string, GrassChunk>();
  const buildQueue: GrassChunk[] = [];
  let generation = 0;
  let builtChunks = 0;
  let disposedChunks = 0;
  let buildMs = 0;
  let lastBuildMs = 0;

  const chunkKey = (cx: number, cz: number): string => `${cx}:${cz}`;
  const chunkCenter = (cidx: number): number => (cidx + 0.5) * GRASS_CHUNK_SIZE;

  const createChunk = (cx: number, cz: number): GrassChunk => {
    const chunk: GrassChunk = {
      key: chunkKey(cx, cz),
      cx,
      cz,
      centerX: chunkCenter(cx),
      centerZ: chunkCenter(cz),
      ready: false,
      queued: false,
      lastSeen: -1,
      lastUsed: -1,
      prioritySq: Infinity,
    };
    chunks.set(chunk.key, chunk);
    return chunk;
  };

  const queueChunk = (chunk: GrassChunk): void => {
    if (chunk.ready || chunk.queued) return;
    chunk.queued = true;
    buildQueue.push(chunk);
  };

  const buildChunk = (chunk: GrassChunk): void => {
    const started = performance.now();
    let n = 0;
    const im = new THREE.InstancedMesh(geo, mat, maxChunkCount);
    im.userData.renderCategory = 'grass';
    im.frustumCulled = true;
    im.receiveShadow = true; // tufts must darken inside canopy shade, not glow through it
    im.count = 0;

    const minX = chunk.cx * GRASS_CHUNK_SIZE;
    const maxX = minX + GRASS_CHUNK_SIZE;
    const minZ = chunk.cz * GRASS_CHUNK_SIZE;
    const maxZ = minZ + GRASS_CHUNK_SIZE;
    const i0 = Math.floor(minX / step) - 1;
    const i1 = Math.ceil(maxX / step) + 1;
    const j0 = Math.floor(minZ / step) - 1;
    const j1 = Math.ceil(maxZ / step) + 1;

    for (let i = i0; i <= i1 && n < maxChunkCount; i++) {
      for (let j = j0; j <= j1 && n < maxChunkCount; j++) {
        const r = hashAt(i, j, 0);
        if (r > (lush ? GRASS_DENSITY_HIGH : GRASS_DENSITY_LOW)) continue;
        const x = i * step + (hashAt(i, j, 1) - 0.5) * step * 1.4;
        const z = j * step + (hashAt(i, j, 2) - 0.5) * step * 1.4;
        if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
        if (Math.abs(x) > WORLD_MAX_X - 16 || z < WORLD_MIN_Z + 16 || z > WORLD_MAX_Z - 16)
          continue;
        const h = terrainHeight(x, z, seed);
        if (h < waterLevel() + 1.6) continue;
        // no blades pasted onto cliff faces
        if (tooSteep(x, z, seed)) continue;
        let nearHub = false;
        for (const zn of ZONES) {
          if (Math.hypot(x - zn.hub.x, z - zn.hub.z) < 15) {
            nearHub = true;
            break;
          }
        }
        if (nearHub) continue;
        if (roadDistance(x, z) < 3.2) continue;
        const s = (lush ? 0.55 : 0.45) + r * (lush ? 1.1 : 1);
        q.setFromAxisAngle(up, r * 12.4);
        m.compose(v.set(x, h, z), q, sv.set(s, s, s));
        im.setMatrixAt(n, m);
        c.setHex(GRASS_TINT[biomeAt(x, z)]);
        c.offsetHSL(
          (hashAt(i, j, 3) - 0.5) * 0.05,
          (hashAt(i, j, 4) - 0.5) * 0.12,
          (hashAt(i, j, 5) - 0.5) * 0.1,
        );
        im.setColorAt(n, c);
        n++;
      }
    }
    if (n > 0) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.visible = chunk.lastSeen === generation;
      chunk.mesh = im;
      parent.add(im);
    }
    chunk.ready = true;
    builtChunks++;
    lastBuildMs = Math.round((performance.now() - started) * 100) / 100;
    buildMs = Math.round((buildMs + lastBuildMs) * 100) / 100;
  };

  const disposeChunk = (chunk: GrassChunk): void => {
    if (chunk.mesh) {
      parent.remove(chunk.mesh);
      chunk.mesh.dispose();
    }
    disposedChunks++;
    chunks.delete(chunk.key);
  };

  const retireStaleChunks = (): void => {
    if (chunks.size <= cacheLimit) return;
    const stale = [...chunks.values()]
      .filter((chunk) => chunk.lastSeen !== generation)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const chunk of stale) {
      if (chunks.size <= cacheLimit) break;
      disposeChunk(chunk);
    }
  };

  const buildQueuedChunks = (): void => {
    if (buildQueue.length === 0) return;
    buildQueue.sort((a, b) => a.prioritySq - b.prioritySq || a.key.localeCompare(b.key));
    const deadline = performance.now() + buildBudgetMs;
    let built = 0;
    while (buildQueue.length > 0 && built < GRASS_CHUNK_MAX_BUILDS_PER_FRAME) {
      const chunk = buildQueue.shift()!;
      chunk.queued = false;
      if (chunks.get(chunk.key) !== chunk || chunk.ready || chunk.lastSeen !== generation) continue;
      buildChunk(chunk);
      built++;
      if (performance.now() >= deadline) break;
    }
  };

  return {
    setQuality(level: number): void {
      quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
      uniforms.uFadeFar.value = activeRadius();
    },
    update(px: number, pz: number): void {
      uniforms.uPlayerPos.value.set(px, pz);
      uniforms.uFadeFar.value = activeRadius();
      if (px > DUNGEON_X_THRESHOLD) {
        // dungeon instances live far outside the strip — no meadow indoors
        if (parent.visible) parent.visible = false;
        return;
      }
      if (!parent.visible) parent.visible = true;

      generation++;
      const coverRadius = activeRadius() + chunkHalfDiag;
      const c0 = Math.floor((px - coverRadius) / GRASS_CHUNK_SIZE);
      const c1 = Math.floor((px + coverRadius) / GRASS_CHUNK_SIZE);
      const z0 = Math.floor((pz - coverRadius) / GRASS_CHUNK_SIZE);
      const z1 = Math.floor((pz + coverRadius) / GRASS_CHUNK_SIZE);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const centerX = chunkCenter(cx);
          const centerZ = chunkCenter(cz);
          const dx = centerX - px;
          const dz = centerZ - pz;
          const prioritySq = dx * dx + dz * dz;
          if (prioritySq > coverRadius * coverRadius) continue;
          const key = chunkKey(cx, cz);
          const chunk = chunks.get(key) ?? createChunk(cx, cz);
          chunk.lastSeen = generation;
          chunk.lastUsed = generation;
          chunk.prioritySq = prioritySq;
          if (chunk.mesh) chunk.mesh.visible = true;
          queueChunk(chunk);
        }
      }

      for (const chunk of chunks.values()) {
        if (chunk.lastSeen === generation) continue;
        if (chunk.mesh?.visible) chunk.mesh.visible = false;
      }
      buildQueuedChunks();
      retireStaleChunks();
    },
    perfStats(): FoliagePerfStats {
      const stats = emptyGrassStats(true, cacheLimit);
      stats.grassQuality = Math.round(quality * 100) / 100;
      stats.grassActiveRadius = activeRadius();
      stats.grassChunks = chunks.size;
      stats.grassQueuedChunks = buildQueue.length;
      stats.grassBuiltChunks = builtChunks;
      stats.grassDisposedChunks = disposedChunks;
      stats.grassLastBuildMs = lastBuildMs;
      stats.grassBuildMs = buildMs;
      for (const chunk of chunks.values()) {
        if (chunk.ready) stats.grassReadyChunks++;
        const tuftCount = chunk.mesh?.count ?? 0;
        stats.grassTufts += tuftCount;
        if (chunk.mesh?.visible) {
          stats.grassVisibleChunks++;
          stats.grassVisibleTufts += tuftCount;
        }
      }
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function pointInsideTree(t: TreeHideable, x: number, z: number): boolean {
  const dx = x - t.x,
    dz = z - t.z;
  return dx * dx + dz * dz < t.r * t.r;
}

function segmentCircleEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx,
    fz = az - cz;
  const c0 = fx * fx + fz * fz - r * r;
  if (c0 < 0) return 0;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c0;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

function cameraSegmentHitsTree(
  t: TreeHideable,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < t.topY && pointInsideTree(t, eyeX, eyeZ)) ||
    (camY < t.topY && pointInsideTree(t, camX, camZ))
  ) {
    return true;
  }
  const hitT = segmentCircleEntry(eyeX, eyeZ, camX, camZ, t.x, t.z, t.r);
  if (hitT < 0 || hitT > 1) return false;
  return eyeY + (camY - eyeY) * hitT < t.topY;
}

function updateTreeHides(
  trees: TreeHideable[],
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): void {
  for (const t of trees) {
    const hide = cameraSegmentHitsTree(t, eyeX, eyeY, eyeZ, camX, camY, camZ);
    if (hide === t.hidden) continue;
    t.hidden = hide;
    for (const part of t.parts) {
      part.mesh.setMatrixAt(part.index, hide ? part.hiddenMatrix : part.visibleMatrix);
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export function buildFoliage(seed: number): FoliageView {
  const group = new THREE.Group();
  group.name = 'foliage';
  const bucketMeshes: BucketMesh[] = [];
  const treeHideables: TreeHideable[] = [];
  let modelQuality = GFX.bucketBaselines.foliage;
  let modelVisibleBuckets = 0;
  let modelVisibleDraws = 0;
  let modelVisibleTriangles = 0;
  const modelBucketsByLod: Record<string, number> = {};
  const modelDrawsByLod: Record<string, number> = {};
  const modelTrianglesByLod: Record<string, number> = {};
  let modelVisibleByLod: Record<string, number> = {};
  let modelVisibleDrawsByLod: Record<string, number> = {};
  let modelVisibleTrianglesByLod: Record<string, number> = {};
  let modelDraws = 0;
  let modelTriangles = 0;
  buildTrees(group, seed, bucketMeshes, treeHideables);
  buildDressing(group, seed, bucketMeshes);
  for (const b of bucketMeshes) {
    modelBucketsByLod[b.lod] = (modelBucketsByLod[b.lod] ?? 0) + 1;
    modelDraws += b.draws;
    modelTriangles += b.triangles;
    modelDrawsByLod[b.lod] = (modelDrawsByLod[b.lod] ?? 0) + b.draws;
    modelTrianglesByLod[b.lod] = (modelTrianglesByLod[b.lod] ?? 0) + b.triangles;
  }
  const grass = localGrassDisabled()
    ? {
        update(): void {},
        setQuality(): void {},
        perfStats(): FoliagePerfStats {
          return emptyGrassStats(false);
        },
      }
    : buildGrassRing(group, seed);
  return {
    group,
    setGrassQuality(level: number): void {
      grass.setQuality(level);
    },
    setModelQuality(level: number): void {
      modelQuality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    },
    update(
      px: number,
      pz: number,
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
    ): void {
      grass.update(px, pz);
      updateTreeHides(treeHideables, eyeX, eyeY, eyeZ, camX, camY, camZ);
      // buckets fully behind the fog wall are pure overdraw; the optional
      // [minDist, maxDist) window uses the bucket-CENTER distance so a bark
      // mesh and its far-trunk proxy are never drawn together
      const distanceScale = !GFX.leanFoliage
        ? 0.72 + 0.28 * modelQuality
        : 0.56 + 0.44 * modelQuality;
      const fogLimit = fogFar * (0.78 + 0.22 * modelQuality);
      modelVisibleBuckets = 0;
      modelVisibleDraws = 0;
      modelVisibleTriangles = 0;
      modelVisibleByLod = {};
      modelVisibleDrawsByLod = {};
      modelVisibleTrianglesByLod = {};
      for (const b of bucketMeshes) {
        const d = Math.hypot(b.x - camX, b.z - camZ);
        const minDist = (b.minDist ?? 0) * distanceScale;
        const revealScale =
          GFX.leanFoliage && (b.lod === 'core' || b.lod === 'near-fill')
            ? 0.94 + hashAt(b.x, b.z, 109) * 0.06
            : 1;
        const maxDist =
          b.maxDist === undefined ? Infinity : b.maxDist * distanceScale * revealScale;
        b.mesh.visible = d >= minDist && d < maxDist && d - b.radius < fogLimit;
        if (b.mesh.visible) {
          modelVisibleBuckets++;
          modelVisibleDraws += b.draws;
          modelVisibleTriangles += b.triangles;
          modelVisibleByLod[b.lod] = (modelVisibleByLod[b.lod] ?? 0) + 1;
          modelVisibleDrawsByLod[b.lod] = (modelVisibleDrawsByLod[b.lod] ?? 0) + b.draws;
          modelVisibleTrianglesByLod[b.lod] =
            (modelVisibleTrianglesByLod[b.lod] ?? 0) + b.triangles;
        }
      }
    },
    perfStats(): FoliagePerfStats {
      const stats = grass.perfStats();
      stats.modelQuality = Math.round(modelQuality * 100) / 100;
      stats.modelBuckets = bucketMeshes.length;
      stats.modelVisibleBuckets = modelVisibleBuckets;
      stats.modelBucketsByLod = { ...modelBucketsByLod };
      stats.modelVisibleByLod = { ...modelVisibleByLod };
      stats.modelDraws = modelDraws;
      stats.modelVisibleDraws = modelVisibleDraws;
      stats.modelDrawsByLod = { ...modelDrawsByLod };
      stats.modelVisibleDrawsByLod = { ...modelVisibleDrawsByLod };
      stats.modelTriangles = modelTriangles;
      stats.modelVisibleTriangles = modelVisibleTriangles;
      stats.modelTrianglesByLod = { ...modelTrianglesByLod };
      stats.modelVisibleTrianglesByLod = { ...modelVisibleTrianglesByLod };
      return stats;
    },
  };
}
