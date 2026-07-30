import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRAKELANDS_FLOWER_MEADOWS } from '../sim/content/drakelands';
import { GALECREST_FLOWER_MEADOWS } from '../sim/content/galecrest';
import { STABLE_PADDOCK } from '../sim/content/mounts';
import { REALM_FLOWER_MEADOWS } from '../sim/content/realm';
import {
  BUILTIN_WORLD,
  DUNGEON_X_THRESHOLD,
  getActiveWorldContent,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
} from '../sim/data';
import { ROCK_SINK_UNITS, rockHeightOf } from '../sim/decoration_dims';
import { galeDeckSurface } from '../sim/gale_harbor';
import type { BiomeId } from '../sim/types';
import { isInSowfieldShell } from '../sim/vale_cup_layout';
import type { Decoration } from '../sim/world';
import {
  generateDecorations,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
  zoneBiomeAt,
} from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import {
  applyInstanceCollapse,
  type CollapseRole,
  updateCollapseUniforms,
} from './foliage_collapse';
import {
  eastbrookGrassExclusions,
  insideDressingExclusion,
  insideEastbrookGrassExclusion,
  insideGrassHubExclusion,
} from './foliage_core';
import {
  type BucketWindowInput,
  bucketVisible,
  foliageDistanceScale,
  foliageFogLimit,
  type InstanceCullWindows,
  instanceCullWindowsInto,
  type LodDists,
  lodDistsFor,
  treeDetailDistance,
} from './foliage_lod';
import {
  gardenLushGrassAt,
  gardenMeadowTintAt,
  inParterrePlot,
  parterreBushSpots,
  parterreFlowerTintAt,
} from './garden_parterre_core';
import { configureMaskedDoubleSidedVegetationMaterial, GFX, sharedUniforms } from './gfx';
import { type FlowerKind, flowerTuftTexture, grassTuftTexture } from './textures';

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
// Per-biome grass density multipliers over the base above. The Reach is bare
// snow (no blades, and with them no ground flowers); the Wraithwood's floor is
// deep grass instead of flowers, so its forest reads lush, not decorated.
const GRASS_BIOME_DENSITY: Partial<Record<BiomeId, number>> = {
  frost: 0,
  ember: 0, // the Drakelands are scorched waste: no blades in the cinders
  haunt: 1.55,
  // the Evergarden is mown lawn: no wild tufts, its flowers grow in the
  // authored parterre beds instead (garden_parterre_core.ts)
  garden: 0,
};
const GRASS_DENSITY_MULT_MAX = Math.max(1, ...Object.values(GRASS_BIOME_DENSITY));
// Ground flowers never grow in these biomes (the Reach loses them with its
// grass anchors; the Wraithwood keeps grass but blooms nothing).
const FLOWERLESS_BIOMES: ReadonlySet<BiomeId> = new Set(['frost', 'haunt']);
// Field biomes bloom in coarse drifts (the dusk realm's original treatment,
// extended to the flower-field realms): dense hash-cell fields instead of the
// sparse one-in-nine anchor blooms.
const FIELD_BIOMES: ReadonlySet<BiomeId> = new Set(['dusk', 'amber', 'night', 'garden', 'fen']);
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

// Which per-instance collapse window a model's materials take: tree species
// end at the real-model/impostor swap; everything else (rocks, dressing) runs
// to the fog cull. Keyed by source URL so a future kit reusing one material
// name across a tree and a bush still gets each usage its own window.
const TREE_MODEL_URLS: ReadonlySet<string> = new Set([
  ...MODEL_URLS.pine,
  ...MODEL_URLS.oak,
  ...MODEL_URLS.twisted,
  ...MODEL_URLS.dead,
]);
const collapseRoleForUrl = (url: string): CollapseRole =>
  TREE_MODEL_URLS.has(url) ? 'tree' : 'plain';

// kick off fetches at import; buildFoliage assumes the cache is populated
const loadedModels = new Map<string, GLTF>();
const extractedParts = new Map<string, ModelPart[]>();
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
  dusk: 0x7f93ab,
  ember: 0x93a06b,
  frost: 0x7e99a2, // frosted but dark: pines hold their shape at distance
  amber: 0xb89a52, // autumn-burnished pines
  fen: 0x8fae7e,
  night: 0x8040e0, // dream-violet boughs (saturated: soften + green albedo wash it out)
  haunt: 0x36443a, // dead dark needles
  jungle: 0x3f9450, // deep tropical green
  garden: 0x4a8a4e, // clipped evergreen
  gale: 0x5a8a58, // wind-hardened scrub
};
const OAK_TINT: Record<BiomeId, number> = {
  vale: 0xa7b886,
  marsh: 0x8d9865,
  peaks: 0x92a37f,
  beach: 0xb2bd7e,
  desert: 0xb0a468,
  volcano: 0x74624f,
  cave: 0x84907f,
  dusk: 0x9c92b4,
  ember: 0xa8a060,
  frost: 0x84989e,
  amber: 0xd8852f, // fire-orange canopy
  fen: 0x9dc47e, // lush wetland green
  night: 0xb03cf0, // vivid orchid canopy (soften + green albedo wash it out)
  haunt: 0x424c38, // gnarled grey-green canopy
  jungle: 0x46b04e, // lush broadleaf canopy
  garden: 0x55a655, // specimen-tree green
  gale: 0x669660, // stunted wind-bent crowns
};
const ROCK_TINT: Record<BiomeId, number> = {
  vale: 0x8d8d85,
  marsh: 0x565c4e,
  peaks: 0x878e99,
  beach: 0xb0a894,
  desert: 0xb08d6a,
  volcano: 0x4a4038,
  cave: 0x6a6a66,
  dusk: 0x8f88a6,
  ember: 0x9a7a62,
  frost: 0x9aa8b8,
  amber: 0x9a8a70,
  fen: 0x7e8a76,
  night: 0xa094c8,
  haunt: 0x565a50,
  jungle: 0x7e8a6a,
  garden: 0x9a9a92, // marble and pale stone
  gale: 0x8a8e90, // salt-grey sea rock
};
const TRUNK_TINT: Record<BiomeId, number> = {
  vale: 0xffffff,
  marsh: 0xd2d8bc,
  peaks: 0xd9dde4,
  beach: 0xf2e4c8,
  desert: 0xe6d2ac,
  volcano: 0xb8a394,
  cave: 0xc4c8c2,
  dusk: 0xd0c8e0,
  ember: 0xe0cfa8,
  frost: 0xe4e9f0,
  amber: 0xd8c0a0,
  fen: 0xc8cfae,
  night: 0xe0d4ec,
  haunt: 0x9a948a, // grey weathered bark
  jungle: 0xd8c4a0,
  garden: 0xcfc4b0,
  gale: 0x9a8a74,
};
const GRASS_TINT: Record<BiomeId, number> = {
  vale: 0xdde4c0,
  marsh: 0xbfc492,
  peaks: 0xc2cec8,
  beach: 0xe8e2b0,
  desert: 0xdcc890,
  volcano: 0x8a7a68,
  cave: 0xa2a89c,
  dusk: 0xccc3da,
  ember: 0xd8c890,
  frost: 0xdde8f2,
  amber: 0xe8cf8a,
  fen: 0xcfe4b0,
  night: 0xe598ff, // orchid dream grass (green blade albedo mutes it)
  haunt: 0x99a382, // sickly pale grass
  jungle: 0xc4ec96, // bright wet tropical grass
  garden: 0xd0eeb0, // mown lawn
  gale: 0xb8d09a, // wind-silvered grass
};
const SWAMP_CANOPY_TINT = 0x7e8b58;
// Flowering-bush bloom colorways for the dusk realm (picked per instance).
const DUSK_BLOOM_TINTS = [0x9e94ba, 0xd88fb0, 0xe8d8a0, 0x8fb8d8, 0xc88fd8];
// the fen blooms brighter: rose, butter, white, sky, coral
const FEN_BLOOM_TINTS = [0xf2a8c8, 0xf2e0a0, 0xffffff, 0xa8d8f2, 0xf2a88f];
// the Amberfall blooms white: snow-white to warm cream against the gold
const AMBER_BLOOM_TINTS = [0xffffff, 0xfaf6ec, 0xf4eedd];
// the Nightbloom's namesake flowers: pale luminous petals that read as
// glowing under the moon (ice-blue, star-white, violet, mint)
const NIGHT_BLOOM_TINTS = [0x9fdcff, 0xffffff, 0xc8a8ff, 0xa0ffd8];
// the Evergarden blooms roses in the full bed wheel: crimson, blush, white,
// tea, gold, violet, and coral (parterre roses carry their bed's tint; this
// list backs any garden bush without an authored tint)
const GARDEN_BLOOM_TINTS = [0xe84a6a, 0xf2a8c8, 0xffffff, 0xf2d0a0, 0xf2c94c, 0xb07bd8, 0xf27b62];
// the Galecrest blooms sea thrift and campion: pink, white, pale violet
const GALE_BLOOM_TINTS = [0xf29ab0, 0xffffff, 0xd8b0f2];
const DRESS_TINT: Record<BiomeId, number> = {
  vale: 0xaebf8e,
  marsh: 0x8d9865,
  peaks: 0x93a78f,
  beach: 0xc2c188,
  desert: 0xc0aa74,
  volcano: 0x7a6a58,
  cave: 0x8a948a,
  dusk: 0x9e94ba,
  ember: 0xb8a878,
  frost: 0xc8d8e0,
  amber: 0xd8a860,
  fen: 0xa8c48e,
  night: 0xc078f2,
  haunt: 0x707a5e,
  jungle: 0x6cc064,
  garden: 0x8cc27a,
  gale: 0x84a878,
};
// how far tints collapse toward white (1 = no tint at all)
const LEAF_TINT_SOFTEN = 0.6;
// The night realm's exception: soften(violet) x green albedo can only land
// on green, so its canopies take the orchid tint nearly raw and multiply
// down to dark dream-plum instead
const LEAF_TINT_SOFTEN_NIGHT = 0.15;
const leafSoften = (biome: BiomeId): number =>
  biome === 'night' ? LEAF_TINT_SOFTEN_NIGHT : LEAF_TINT_SOFTEN;
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
const GRASS_BUILDING_PADDING = 0.35;

export interface FoliageView {
  group: THREE.Group;
  /**
   * Per-frame: grass fade + ring rebuild, fog culling of far tree buckets.
   * `fogNear`/`fogFar` are the LIVE fog (residency-clamped): they drive the
   * cull. `atmosFogNear`/`atmosFogFar` are the atmospheric fog (authored
   * preset x day-night scale, pre-clamp): they drive the real-model/impostor
   * swap, so a streaming fog wall never drags impostor cones toward the
   * camera (see treeDetailDistance's input contract in foliage_lod.ts).
   */
  update(
    px: number,
    pz: number,
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogNear: number,
    fogFar: number,
    atmosFogNear: number,
    atmosFogFar: number,
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
// Model-space height of a rock geometry, cached per geometry: the renderer
// solves each variant's vertical scale from it so every rock lands at exactly
// the height the sim publishes (src/sim/decoration_dims.ts), whichever GLB
// variant it draws.
const rockNativeHeights = new WeakMap<THREE.BufferGeometry, number>();
function rockNativeHeight(geo: THREE.BufferGeometry | undefined): number {
  if (!geo) return 1; // fail soft: a missing variant must never break world entry
  const cached = rockNativeHeights.get(geo);
  if (cached !== undefined) return cached;
  geo.computeBoundingBox();
  // bb.max.y, NOT the box height: the instance is seated at the terrain minus
  // the sink, so top-above-ground is (max.y - sink) * scale. The merged
  // cluster archetype has a member below zero, so using the full height there
  // would render clusters short of the collider top the sim publishes.
  const h = geo.boundingBox ? geo.boundingBox.max.y : 1;
  rockNativeHeights.set(geo, h);
  return h;
}

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
  // The real model ends, and the impostor begins, at the RUNTIME tree-detail
  // distance (it tracks fog, so it is unknown when the bucket is built). These
  // compose with the numeric caps above rather than replacing them: near-fill
  // trees cull at treeFillFar OR at the swap, whichever comes first.
  minAtDetail?: boolean;
  maxAtDetail?: boolean;
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
// The tables and the window arithmetic live in foliage_lod.ts (pure, Node-tested).
// The tree-detail boundary is NOT a constant: it follows the zone's fog, so an
// impostor can never be caught standing in clear air. See that module's header.
function lodDists(): LodDists {
  return lodDistsFor(GFX.leanFoliage);
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

// one shared material per (collapse role, source-material name): dedupes
// textures across the 5 pine / 5 oak files which all reference the same bark +
// leaf sheets, while a tree material can never share an instance (and so a
// collapse window) with a dressing one
const materialCache = new Map<string, THREE.Material>();

function foliageMaterial(
  src: THREE.Material,
  hasVertexColors: boolean,
  role: CollapseRole,
): THREE.Material {
  const key = `${role}:${src.name}`;
  const cached = materialCache.get(key);
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
  applyInstanceCollapse(mat, role);
  materialCache.set(key, mat);
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
  const cached = extractedParts.get(url);
  if (cached) return cached;
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
      material: foliageMaterial(
        srcMat,
        geometry.getAttribute('color') !== undefined,
        collapseRoleForUrl(url),
      ),
      isLeaf: (MAT_POLICY[srcMat.name] ?? DEFAULT_POLICY).leaf,
    });
  });
  if (parts.length === 0) throw new Error(`foliage model has no meshes: ${url}`);
  // draw barks before leaves: opaque first is kinder to early-z
  parts.sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf));
  // The baked float geometry and converted materials are the renderer-owned
  // representation. Drop both references to the original parsed scene so its
  // duplicate source buffers can be collected; future extraction reuses this cache.
  extractedParts.set(url, parts);
  loadedModels.delete(url);
  releaseGltf(url);
  return parts;
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
  applyInstanceCollapse(mat, 'impostor');
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
    atDetail?: { min?: boolean; max?: boolean },
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
              spec.proxyShape === 'dead' ? BARK_TINT_SOFTEN : leafSoften(d.biome),
            ),
          );
        });
        if (proxy.instanceColor) proxy.instanceColor.needsUpdate = true;
        proxy.receiveShadow = true;
        parent.add(proxy);
        register(proxy, 'impostor', undefined, group.maxDist, { min: true });
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
            im.setColorAt(i, softTint(d.x, d.z, hex, c, leafSoften(d.biome)));
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
        // Numeric caps that are NOT the detail swap: the near-fill density cull
        // and (for species whose canopy covers the trunk) the early bark cull.
        // The swap itself is symbolic: it follows fog, so only update() knows it.
        const numericCaps: number[] = [];
        if (group.maxDist !== undefined) numericCaps.push(group.maxDist);
        if (cullBark) numericCaps.push(barkFar);
        const maxDist = numericCaps.length > 0 ? Math.min(...numericCaps) : undefined;
        register(im, group.lod, undefined, maxDist, { max: true });
        if (GFX.standardMaterials && !GFX.leanFoliage && castsShadow) {
          const shadow = cloneInstancedTo(im, part.geometry, makeShadowOnlyMaterial(part.material));
          shadow.castShadow = true;
          shadow.receiveShadow = false;
          parent.add(shadow);
          // The shadow pass does NOT follow the fog-EXTENDED detail distance: a
          // tree's shadow past the old radius contributes nothing the eye can
          // resolve, and re-drawing that geometry for the depth pass is what the
          // extension would cost most. Keep it on the build-time radius, but DO
          // follow a fog-SHORTENED swap (maxAtDetail): the instance collapse
          // cannot reach three's shadow depth material, so past-the-swap slabs
          // must drop here or invisible trees keep casting.
          const shadowMax =
            maxDist === undefined ? treeDetailFar : Math.min(maxDist, treeDetailFar);
          register(shadow, 'shadow', undefined, shadowMax, { max: true });
        }
        if (GFX.standardMaterials && !part.isLeaf && spec.farTrunkProxy) {
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
          register(proxy, 'proxy', barkFar, group.maxDist, { max: true });
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
  // The Evergarden curates its trees: no random trees or boulders inside a
  // parterre bed, and NO wild pines anywhere on the lawns (kind 'tree' is
  // the pine; the realm keeps its oaks, topiary, and specimen elders)
  const decos = generateDecorations(seed).filter(
    (d) =>
      !inParterrePlot(d.x, d.z, 6) && !(d.kind === 'tree' && zoneBiomeAt(d.x, d.z) === 'garden'),
  );
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
  // clone() drops shader hooks, so the clone re-takes its collapse window
  applyInstanceCollapse(rockMat, 'plain');
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
    const gnarled = (d: Decoration) => d.biome === 'marsh' || d.biome === 'dusk';
    const oaks = items.filter((d) => d.kind === 'tree2' && !gnarled(d));
    const swamps = items.filter((d) => d.kind === 'tree2' && gnarled(d));
    // marsh swamp trees split between twisted (mossy) and dead (bare) models;
    // the dusk realm's tree2 elders are all twisted, never dead: the Hollow
    // is ancient, not rotting
    const twisteds = swamps.filter((d) => d.biome === 'dusk' || hashAt(d.x, d.z, 19) >= 0.35);
    const deads = swamps.filter((d) => d.biome !== 'dusk' && hashAt(d.x, d.z, 19) < 0.35);
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
      atDetail?: { min?: boolean; max?: boolean },
    ): void => {
      registry.push({
        mesh,
        x: bx,
        z: bz,
        radius: bRadius,
        minDist,
        maxDist,
        minAtDetail: atDetail?.min,
        maxAtDetail: atDetail?.max,
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
      // Index against the set's ACTUAL length: the colorway is
      // [singles..., cluster], and the low-tier model list ships fewer single
      // variants than the high tier, so a hardcoded index (set[3]) resolved to
      // undefined there and handed an undefined geometry to the instancer.
      const groupGeo = (r: Decoration): THREE.BufferGeometry => {
        const set = isSnowy(r) ? snowRocks : mossRocks;
        const singles = Math.max(1, set.length - 1); // last entry is the cluster
        if (isCluster(r)) return set[set.length - 1];
        const pick = singleSubset[Math.floor(hashAt(r.x, r.z, 72) * singleSubset.length)];
        return set[Math.min(pick, singles - 1)];
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
          // Vertical scale is DERIVED from the sim's rock height so the stone
          // you see is exactly the stone you collide with and stand on: solve
          // for the sy that puts the model's top (its own height, less the
          // 0.3 sink below) at rockHeight() above the terrain. The geometry is
          // seated base-near-zero, so top-above-ground = (nativeH - 0.3) * sy.
          const nativeTop = rockNativeHeight(geo);
          const sy = rockHeightOf(r, seed) / Math.max(0.1, nativeTop - ROCK_SINK_UNITS);
          const tiltAmp = Math.max(sxz1, sxz2) > 0.8 ? 0.12 : 0.26;
          q.setFromEuler(
            e.set((h1 - 0.5) * tiltAmp, r.variant * 1.7 + h3 * 2.0, (h2 - 0.5) * tiltAmp),
          );
          // sink so undersides bury on slopes (geometry base is near y=0)
          m.compose(v.set(r.x, y - ROCK_SINK_UNITS * sy, r.z), q, sv.set(sxz1, sy, sxz2));
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
  /** authored bloom tint (parterre roses); unset spots pick by biome hash */
  bloomTint?: number;
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
  dusk: 0.24,
  ember: 0.18,
  frost: 0.08,
  amber: 0.34,
  fen: 0.8,
  night: 0.32,
  haunt: 0.3,
  jungle: 0.5,
  garden: 0.4,
  gale: 0.32,
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
  if (biome === 'dusk') {
    // glade floor: ferns and flowering bushes carry the ground cover. No
    // dressing mushrooms here: the biome tint turned them neon pink and they
    // clashed with the realm_flora glow mushrooms (user pass, 2026-07).
    if (r < 0.16) return 'bush';
    if (r < 0.4) return 'bushFlowers';
    return 'fern';
  }
  if (biome === 'fen') {
    // the fen floor blooms: flowering hedges everywhere, mushrooms thick in
    // the damp, plain bushes almost absent
    if (r < 0.08) return 'bush';
    if (r < 0.48) return 'bushFlowers';
    if (r < 0.72) return 'fern';
    return 'mushroom';
  }
  if (biome === 'amber') {
    // the gold meadows flower white: bloom hedges lead, ferns fill
    if (r < 0.1) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.86) return 'fern';
    return 'mushroom';
  }
  if (biome === 'night') {
    // the realm's namesake: luminous bloom hedges dominate the moon meadows,
    // mushrooms fill the dark corners
    if (r < 0.08) return 'bush';
    if (r < 0.56) return 'bushFlowers';
    if (r < 0.76) return 'fern';
    return 'mushroom';
  }
  if (biome === 'haunt') {
    // nothing flowers here: brambles, ferns, and mushrooms in the leaf rot
    if (r < 0.24) return 'bush';
    if (r < 0.6) return 'fern';
    return 'mushroom';
  }
  if (biome === 'jungle') {
    // the understory is the realm: ferns wall the paths, blooms burst
    // through, mushrooms keep to the deep shade
    if (r < 0.16) return 'bush';
    if (r < 0.38) return 'bushFlowers';
    if (r < 0.88) return 'fern';
    return 'mushroom';
  }
  if (biome === 'garden') {
    // rose beds everywhere the gardener's hand once reached
    if (r < 0.12) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.82) return 'fern';
    return 'mushroom';
  }
  if (biome === 'gale') {
    // wind-flattened scrub and thrift clinging to the downs
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'bushFlowers';
    if (r < 0.9) return 'fern';
    return 'mushroom';
  }
  return r < 0.62 ? 'bush' : 'fern';
}

const DRESS_SCALE: Record<DressKind, [number, number]> = {
  bush: [0.9, 0.7],
  bushFlowers: [0.9, 0.7],
  fern: [0.85, 0.6],
  mushroom: [0.9, 0.8],
};

// The Galecrest stable paddock is a worked dirt yard: no grass, flowers, or
// scrub inside the fences, while the downs immediately around it bloom hard
// (the flower fields ringing the yard).
function inStableYard(x: number, z: number): boolean {
  return (
    x > STABLE_PADDOCK.x1 - 1.5 &&
    x < STABLE_PADDOCK.x2 + 1.5 &&
    z > STABLE_PADDOCK.z1 - 1.5 &&
    z < STABLE_PADDOCK.z2 + 1.5
  );
}

function stableMeadowBand(x: number, z: number): boolean {
  const dx = Math.max(STABLE_PADDOCK.x1 - x, 0, x - STABLE_PADDOCK.x2);
  const dz = Math.max(STABLE_PADDOCK.z1 - z, 0, z - STABLE_PADDOCK.z2);
  const dist = Math.hypot(dx, dz);
  return dist > 1.5 && dist <= 18;
}

// nothing sprouts up through Wickharbor's boardwalk and pier planks
function onHarborDeck(x: number, z: number, seed: number): boolean {
  return galeDeckSurface(x, z, (sx, sz) => terrainHeight(sx, sz, seed), WATER_LEVEL) !== -Infinity;
}

function tooSteep(x: number, z: number, seed: number): boolean {
  const hx =
    terrainHeight(x + GRASS_SLOPE_EPS, z, seed) - terrainHeight(x - GRASS_SLOPE_EPS, z, seed);
  const hz =
    terrainHeight(x, z + GRASS_SLOPE_EPS, seed) - terrainHeight(x, z - GRASS_SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * GRASS_SLOPE_EPS) > GRASS_MAX_SLOPE;
}

function generateDressing(seed: number): DressingSpot[] {
  const out: DressingSpot[] = [];
  const activeContent = getActiveWorldContent();
  const xHalf = WORLD_MAX_X - 16;
  const step = dressStep();
  const scaleBoost = GFX.leanFoliage ? DRESS_LOW_SCALE_BOOST : 1;
  for (let gx = -xHalf; gx < xHalf; gx += step) {
    for (let gz = WORLD_MIN_Z + 16; gz < WORLD_MAX_Z - 16; gz += step) {
      const r = hashAt(gx, gz, 41);
      const biome = zoneBiomeAt(gx, gz);
      // the Evergarden takes NO random dressing: every bush there belongs to
      // an authored parterre arrangement (appended after this scatter loop)
      if (biome === 'garden') continue;
      const density = DRESS_DENSITY[biome] * (GFX.leanFoliage ? DRESS_DENSITY_LOW_SCALE : 1);
      if (r > density) continue;
      const x = gx + (hashAt(gx, gz, 42) - 0.5) * step;
      const z = gz + (hashAt(gx, gz, 43) - 0.5) * step;
      if (insideDressingExclusion(activeContent.zones, activeContent.camps, x, z)) continue;
      if (roadDistance(x, z) < 4) continue;
      if (terrainHeight(x, z, seed) < WATER_LEVEL + 1.2) continue;
      if (tooSteep(x, z, seed)) continue;
      if (isInSowfieldShell(x, z)) continue; // keep bushes/plants off the football ground
      // no scrub in the worked stable yard or up through the harbor decks
      if (biome === 'gale' && (inStableYard(x, z) || onHarborDeck(x, z, seed))) continue;
      // the fen's floor dressing grows in CLUMPED patches, not an even
      // scatter: a coarse cell gate keeps most cells bare and the density
      // boost below packs the surviving patches tight
      if (biome === 'fen' && hashAt(Math.floor(x / 16), Math.floor(z / 16), 97) > 0.4) continue;
      const kind = dressKindFor(biome, hashAt(gx, gz, 44));
      const [sMin, sRange] = DRESS_SCALE[kind];
      out.push({ x, z, kind, scale: (sMin + hashAt(gx, gz, 45) * sRange) * scaleBoost });
    }
  }
  // the Evergarden's clipped hedges and rose centerpieces, laid out by the
  // parterre plan instead of the hash scatter above
  out.push(...parterreBushSpots(seed));
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
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'amber') {
            const tint =
              AMBER_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * AMBER_BLOOM_TINTS.length)];
            im.setColorAt(i, c.set(tint));
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'fen') {
            const tint = FEN_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * FEN_BLOOM_TINTS.length)];
            im.setColorAt(i, c.set(tint));
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'night') {
            // the nightblooms take their tint raw: pale petals must pop
            // against the dark ground, not soften toward it
            const tint =
              NIGHT_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * NIGHT_BLOOM_TINTS.length)];
            im.setColorAt(i, c.set(tint));
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'garden') {
            // the roses take their tint raw too: a rose bed should read red.
            // Parterre roses carry their bed's authored color.
            const tint =
              s.bloomTint ??
              GARDEN_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * GARDEN_BLOOM_TINTS.length)];
            im.setColorAt(i, c.set(tint));
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'gale') {
            // sea thrift takes its tint raw: pink heads over silver grass
            const tint =
              GALE_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * GALE_BLOOM_TINTS.length)];
            im.setColorAt(i, c.set(tint));
          } else if (kind === 'bushFlowers' && zoneBiomeAt(s.x, s.z) === 'dusk') {
            // the Hollow's flowering bushes bloom in several colors, not one
            const tint =
              DUSK_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * DUSK_BLOOM_TINTS.length)];
            im.setColorAt(
              i,
              softTint(
                s.x,
                s.z,
                tint,
                c,
                GFX.leanFoliage ? DRESS_TINT_SOFTEN_LOW : DRESS_TINT_SOFTEN,
              ),
            );
          } else {
            im.setColorAt(
              i,
              softTint(
                s.x,
                s.z,
                DRESS_TINT[zoneBiomeAt(s.x, s.z)],
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
  flowerMesh?: THREE.InstancedMesh;
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
  // Snapshot the active world's town exclusions once. The canonical Eastbrook
  // layout is included only for the built-in world; editor/custom maps never
  // inherit its fixed coordinates.
  const activeContent = getActiveWorldContent();
  const townExclusions = eastbrookGrassExclusions(
    activeContent.props.buildings,
    activeContent === BUILTIN_WORLD,
    activeContent.services?.noticeboards ?? [],
  );

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

  // ground-cover flowers: a sparse companion set in the same chunks, sharing
  // the sway/fade shader so they move and thin exactly like the grass.
  // Each biome gets its own petal palette (chunk-level pick), and the dusk
  // realm grows dense flower-field drifts.
  const fquad = new THREE.PlaneGeometry(0.95, 0.8);
  fquad.translate(0, 0.38, 0);
  const fquad2 = fquad.clone().rotateY(Math.PI / 2);
  const flowerGeo = mergeGeometries([fquad, fquad2]);
  const FLOWER_PALETTES: Partial<Record<BiomeId, FlowerKind[]>> = {
    // the Veiled Hollow: pinks, purples, whites
    dusk: [
      { p: [238, 150, 190], c: [180, 90, 40] },
      { p: [190, 150, 235], c: [240, 220, 120] },
      { p: [246, 242, 250], c: [244, 200, 70] },
    ],
    // Drakelands: bright firebloom reds and oranges (the authored meadow
    // fields around Wyrmwatch read as drifts of flame)
    ember: [
      { p: [244, 70, 48], c: [130, 28, 16] },
      { p: [250, 142, 46], c: [150, 72, 20] },
      { p: [238, 96, 60], c: [125, 40, 22] },
    ],
    // Amberfall: oranges, yellows, whites
    amber: [
      { p: [245, 150, 50], c: [150, 80, 20] },
      { p: [248, 205, 70], c: [160, 100, 25] },
      { p: [248, 244, 235], c: [230, 170, 60] },
    ],
    // Nightbloom: the namesake pale luminous petals, whites and moon violets
    night: [
      { p: [235, 225, 255], c: [190, 160, 240] },
      { p: [210, 180, 250], c: [245, 240, 200] },
      { p: [250, 240, 250], c: [230, 200, 255] },
    ],
    // Evergarden: near-white petals on the card; the parterre beds paint
    // each instance with its bed color (a colored texture would multiply
    // against the tint and muddy every hue)
    garden: [{ p: [244, 242, 240], c: [252, 226, 140] }],
    // Willowfen: wetland wildflower fields in mixed colours; its card is
    // built in balanced mode (flowerMatFor below), cycling this list so
    // the blue and orange heads are guaranteed a place among the pastels
    fen: [
      { p: [130, 160, 235], c: [230, 236, 250] },
      { p: [250, 245, 210], c: [210, 170, 60] },
      { p: [242, 150, 110], c: [180, 90, 50] },
      { p: [200, 170, 230], c: [160, 120, 200] },
      { p: [245, 250, 255], c: [220, 220, 150] },
      { p: [244, 168, 200], c: [200, 110, 150] },
    ],
    // the Palmreach: tropical blooms, hibiscus orange and morning-glory
    // blue leading the mix over plumeria white and jungle pink
    jungle: [
      { p: [245, 120, 60], c: [200, 70, 30] },
      { p: [100, 150, 240], c: [225, 235, 252] },
      { p: [245, 120, 60], c: [200, 70, 30] },
      { p: [100, 150, 240], c: [225, 235, 252] },
      { p: [250, 248, 240], c: [245, 200, 80] },
      { p: [240, 130, 170], c: [200, 80, 120] },
    ],
    // Galecrest: harebells lean into the wind among the daisies and
    // buttercups; the list is weighted so blue heads edge out each of the
    // white and gold (4 blue to 3 white to 3 gold)
    gale: [
      { p: [116, 148, 235], c: [235, 240, 252] }, // harebell blue
      { p: [116, 148, 235], c: [235, 240, 252] },
      { p: [96, 126, 220], c: [225, 232, 250] }, // deeper cornflower
      { p: [96, 126, 220], c: [225, 232, 250] },
      { p: [246, 246, 250], c: [244, 200, 70] }, // daisy white
      { p: [246, 246, 250], c: [244, 200, 70] },
      { p: [246, 246, 250], c: [244, 200, 70] },
      { p: [245, 195, 60], c: [150, 90, 20] }, // buttercup gold
      { p: [245, 195, 60], c: [150, 90, 20] },
      { p: [245, 195, 60], c: [150, 90, 20] },
    ],
  };
  const flowerMatCache = new Map<string, THREE.Material>();
  const flowerMatFor = (biome: BiomeId): THREE.Material => {
    const key = FLOWER_PALETTES[biome] ? biome : 'default';
    let fmMat = flowerMatCache.get(key);
    if (!fmMat) {
      const tex = flowerTuftTexture(FLOWER_PALETTES[biome], biome === 'fen');
      fmMat = configureMaskedDoubleSidedVegetationMaterial(
        lush
          ? new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.3, roughness: 0.85 })
          : new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.35 }),
      );
      applyGrassShader(fmMat, uniforms);
      flowerMatCache.set(key, fmMat);
    }
    return fmMat;
  };
  // build every palette texture up front: a first-visit texture generation
  // plus shader compile mid-walk reads as a lag spike
  for (const b of [
    'vale',
    'dusk',
    'ember',
    'amber',
    'night',
    'garden',
    'fen',
    'gale',
    'jungle',
  ] as BiomeId[]) {
    flowerMatFor(b);
  }

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
    const chunkBiome = zoneBiomeAt(chunk.centerX, chunk.centerZ);
    // dense-grass biomes get a matching buffer so the extra tufts are never
    // clipped by the base cap (allocation is per chunk, biome known here)
    const chunkCap = Math.ceil(maxChunkCount * Math.max(1, GRASS_BIOME_DENSITY[chunkBiome] ?? 1));
    const im = new THREE.InstancedMesh(geo, mat, chunkCap);
    im.userData.renderCategory = 'grass';
    im.frustumCulled = true;
    im.receiveShadow = true; // tufts must darken inside canopy shade, not glow through it
    im.count = 0;
    const fieldChunk = FIELD_BIOMES.has(chunkBiome);
    // a gale chunk that reaches the stable paddock's bloom band needs a
    // field-sized buffer, or the band's drifts hit the cap and vanish
    const dxs = Math.max(STABLE_PADDOCK.x1 - chunk.centerX, 0, chunk.centerX - STABLE_PADDOCK.x2);
    const dzs = Math.max(STABLE_PADDOCK.z1 - chunk.centerZ, 0, chunk.centerZ - STABLE_PADDOCK.z2);
    const stableBandChunk = chunkBiome === 'gale' && Math.hypot(dxs, dzs) < 18 + chunkHalfDiag;
    // the Evergarden's parterre beds are dense solid plantings edge to edge,
    // plus meadow drifts, so its chunks carry the largest flower buffer
    // the Willowfen floor is all flower field (its grass is suppressed
    // below), so its chunks carry a near-garden flower buffer
    // the Drakelands' authored firebloom fields bloom on near-bare ground
    // (ember grass density is 0), so their chunks need a field-sized buffer
    const flowerCap = Math.max(
      8,
      Math.floor(
        maxChunkCount *
          (chunkBiome === 'garden'
            ? 1.2
            : chunkBiome === 'fen'
              ? 0.8
              : fieldChunk || stableBandChunk || chunkBiome === 'ember'
                ? 0.45
                : 0.14),
      ),
    );
    const fm = new THREE.InstancedMesh(flowerGeo, flowerMatFor(chunkBiome), flowerCap);
    fm.userData.renderCategory = 'grass';
    fm.frustumCulled = true;
    fm.receiveShadow = true;
    fm.count = 0;
    let fn = 0;

    const minX = chunk.cx * GRASS_CHUNK_SIZE;
    const maxX = minX + GRASS_CHUNK_SIZE;
    const minZ = chunk.cz * GRASS_CHUNK_SIZE;
    const maxZ = minZ + GRASS_CHUNK_SIZE;
    const i0 = Math.floor(minX / step) - 1;
    const i1 = Math.ceil(maxX / step) + 1;
    const j0 = Math.floor(minZ / step) - 1;
    const j1 = Math.ceil(maxZ / step) + 1;
    // authored flower meadows overlapping this chunk (the dusk realm's
    // meadow bowls, the Galecrest's house gardens + tarn shore rings, and
    // the Drakelands' firebloom fields around Wyrmwatch)
    const meadowSource =
      chunkBiome === 'dusk'
        ? REALM_FLOWER_MEADOWS
        : chunkBiome === 'gale'
          ? GALECREST_FLOWER_MEADOWS
          : chunkBiome === 'ember'
            ? DRAKELANDS_FLOWER_MEADOWS
            : null;
    const meadowsInChunk = meadowSource
      ? meadowSource.filter(
          (mw) =>
            mw.x + mw.r > minX && mw.x - mw.r < maxX && mw.z + mw.r > minZ && mw.z - mw.r < maxZ,
        )
      : [];

    for (let i = i0; i <= i1 && n < chunkCap; i++) {
      for (let j = j0; j <= j1 && n < chunkCap; j++) {
        const r = hashAt(i, j, 0);
        // biome-scaled density: the anchor position decides its biome, so the
        // Reach stays bare and the Wraithwood thickens right up to its border
        if (r > (lush ? GRASS_DENSITY_HIGH : GRASS_DENSITY_LOW) * GRASS_DENSITY_MULT_MAX) continue;
        const x = i * step + (hashAt(i, j, 1) - 0.5) * step * 1.4;
        const z = j * step + (hashAt(i, j, 2) - 0.5) * step * 1.4;
        if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
        if (Math.abs(x) > WORLD_MAX_X - 16 || z < WORLD_MIN_Z + 16 || z > WORLD_MAX_Z - 16)
          continue;
        const tuftBiome = zoneBiomeAt(x, z);
        // the Evergarden lawn is mown bare, but around the plantings grass
        // grows back the way a real bed does: through every parterre bed
        // and slightly past its hedge line, and across the meadow patches a
        // little beyond where the flowers stop
        const gardenBedTuft = tuftBiome === 'garden' && gardenLushGrassAt(x, z);
        const density =
          (lush ? GRASS_DENSITY_HIGH : GRASS_DENSITY_LOW) *
          (gardenBedTuft ? 0.9 : (GRASS_BIOME_DENSITY[tuftBiome] ?? 1));
        if (r > density) continue;
        const h = terrainHeight(x, z, seed);
        if (h < WATER_LEVEL + 1.6) continue;
        // no blades pasted onto cliff faces
        if (tooSteep(x, z, seed)) continue;
        if (insideGrassHubExclusion(activeContent.zones, x, z)) continue;
        if (roadDistance(x, z) < 3.2) continue;
        if (insideEastbrookGrassExclusion(townExclusions, x, z, GRASS_BUILDING_PADDING)) continue;
        if (isInSowfieldShell(x, z)) continue; // the Sowfield is a mown pitch, not meadow
        // the stable yard is worked dirt; deck planks grow nothing through
        if (tuftBiome === 'gale' && (inStableYard(x, z) || onHarborDeck(x, z, seed))) continue;
        // the Willowfen grows no grass blades: each would-be tuft stays an
        // unseen flower anchor (the bloom pass below), so the fen floor
        // reads as open flower fields instead (density 0 would kill the
        // anchors too, the frost/garden idiom, which is not what fen wants)
        const fenTuft = tuftBiome === 'fen';
        if (!fenTuft) {
          const s = (lush ? 0.55 : 0.45) + r * (lush ? 1.1 : 1);
          q.setFromAxisAngle(up, r * 12.4);
          m.compose(v.set(x, h, z), q, sv.set(s, s, s));
          im.setMatrixAt(n, m);
          c.setHex(GRASS_TINT[tuftBiome]);
          c.offsetHSL(
            (hashAt(i, j, 3) - 0.5) * 0.05,
            (hashAt(i, j, 4) - 0.5) * 0.12,
            (hashAt(i, j, 5) - 0.5) * 0.1,
          );
          im.setColorAt(n, c);
          n++;
        }
        if (FLOWERLESS_BIOMES.has(tuftBiome)) continue;
        // roughly one tuft in nine sprouts a flower cluster beside it; in
        // the field realms, coarse field cells bloom into dense drifts, and
        // the authored meadow circles (REALM_FLOWER_MEADOWS) always bloom
        const fieldCell = fieldChunk ? hashAt(Math.floor(x / 22), Math.floor(z / 22), 13) : 1;
        const inMeadow = meadowsInChunk.some((mw) => {
          const mdx = x - mw.x;
          const mdz = z - mw.z;
          return mdx * mdx + mdz * mdz < mw.r * mw.r;
        });
        // meadows bloom harder than hash fields: their ground carries fewer
        // grass tufts (each tuft is a flower anchor), so density compensates
        // the fen's field cells run broader and bloom harder: with its grass
        // gone, the flowers alone carry the ground cover
        const inField = fieldChunk && fieldCell < (fenTuft ? 0.68 : 0.42);
        // the downs ringing the stable paddock bloom into full flower fields
        const stableBloom = tuftBiome === 'gale' && stableMeadowBand(x, z);
        const flowerChance = inMeadow
          ? 0.9
          : stableBloom
            ? 0.65
            : inField
              ? fenTuft
                ? 0.85
                : 0.6
              : fieldChunk
                ? fenTuft
                  ? 0.32
                  : 0.05
                : tuftBiome === 'jungle'
                  ? 0.2
                  : 0.11;
        const reps = inMeadow ? 4 : stableBloom ? 3 : inField ? (fenTuft ? 4 : 3) : 1;
        if (hashAt(i, j, 6) < flowerChance) {
          for (let rep = 0; rep < reps && fn < flowerCap; rep++) {
            const fx = x + (hashAt(i + rep, j, 7) - 0.5) * (1.4 + rep * 1.3);
            const fz = z + (hashAt(i, j + rep, 8) - 0.5) * (1.4 + rep * 1.3);
            const fh = terrainHeight(fx, fz, seed);
            if (fh < WATER_LEVEL + 1.6 || tooSteep(fx, fz, seed) || roadDistance(fx, fz) < 3.2) {
              continue;
            }
            // a band-edge bloom must not stray into the worked yard
            if (tuftBiome === 'gale' && inStableYard(fx, fz)) continue;
            const fs = 0.55 + hashAt(i + rep, j + rep, 9) * 0.5;
            q.setFromAxisAngle(up, hashAt(i, j, 10 + rep) * 12.4);
            m.compose(v.set(fx, fh, fz), q, sv.set(fs, fs, fs));
            fm.setMatrixAt(fn, m);
            // flowers keep their own petal colors: light jitter only
            c.setHex(0xffffff);
            c.offsetHSL((hashAt(i, j, 11) - 0.5) * 0.04, 0, (hashAt(i, j, 12) - 0.5) * 0.12);
            fm.setColorAt(fn, c);
            fn++;
          }
        }
      }
    }

    // Authored meadows also bloom independent of grass anchors: the scrubby
    // basin shore carries few tufts (each tuft is a flower anchor above), so
    // a direct grid pass keeps the drifts solid on bare ground too. The
    // Drakelands' fields take a second jittered sample per cell: with the
    // ember ground bare of grass, one sample reads gappy, not a field.
    const meadowReps = chunkBiome === 'ember' ? 2 : 1;
    for (const mw of meadowsInChunk) {
      for (let i = i0; i <= i1 && fn < flowerCap; i++) {
        for (let j = j0; j <= j1 && fn < flowerCap; j++) {
          for (let rep = 0; rep < meadowReps && fn < flowerCap; rep++) {
            if (hashAt(i + rep * 41, j, 14) > 0.5) continue;
            const fx = i * step + (hashAt(i + rep * 41, j, 15) - 0.5) * step * 1.6;
            const fz = j * step + (hashAt(i, j + rep * 41, 16) - 0.5) * step * 1.6;
            if (fx < minX || fx >= maxX || fz < minZ || fz >= maxZ) continue;
            const mdx = fx - mw.x;
            const mdz = fz - mw.z;
            if (mdx * mdx + mdz * mdz >= mw.r * mw.r) continue;
            const fh = terrainHeight(fx, fz, seed);
            if (fh < WATER_LEVEL + 1.6 || tooSteep(fx, fz, seed) || roadDistance(fx, fz) < 3.2) {
              continue;
            }
            const fs = 0.55 + hashAt(i + rep, j, 17) * 0.5;
            q.setFromAxisAngle(up, hashAt(i, j + rep, 18) * 12.4);
            m.compose(v.set(fx, fh, fz), q, sv.set(fs, fs, fs));
            fm.setMatrixAt(fn, m);
            c.setHex(0xffffff);
            c.offsetHSL((hashAt(i, j, 19) - 0.5) * 0.04, 0, (hashAt(j, i, 19) - 0.5) * 0.12);
            fm.setColorAt(fn, c);
            fn++;
          }
        }
      }
    }
    // The Evergarden: no grass anchors exist (mown lawn), so the parterre
    // beds and walk ribbons plant directly from the authored plan. Beds get
    // a third jittered sample per grid cell so the compact plantings read
    // lush and full; meadows stay at two (airy by design).
    if (chunkBiome === 'garden') {
      for (let i = i0; i <= i1 && fn < flowerCap; i++) {
        for (let j = j0; j <= j1 && fn < flowerCap; j++) {
          for (let rep = 0; rep < 3 && fn < flowerCap; rep++) {
            const fx = i * step + (hashAt(i + rep * 37, j, 15) - 0.5) * step * 1.5;
            const fz = j * step + (hashAt(i, j + rep * 37, 16) - 0.5) * step * 1.5;
            if (fx < minX || fx >= maxX || fz < minZ || fz >= maxZ) continue;
            // beds and walk ribbons first, then the open-lawn meadow drifts
            let tint = parterreFlowerTintAt(fx, fz);
            if (tint < 0 && rep < 2) tint = gardenMeadowTintAt(fx, fz);
            if (tint < 0) continue;
            const fh = terrainHeight(fx, fz, seed);
            if (fh < WATER_LEVEL + 1.6 || tooSteep(fx, fz, seed)) continue;
            const fs = 0.6 + hashAt(i + rep, j, 17) * 0.4;
            q.setFromAxisAngle(up, hashAt(i, j, 18 + rep) * 12.4);
            m.compose(v.set(fx, fh, fz), q, sv.set(fs, fs, fs));
            fm.setMatrixAt(fn, m);
            // the bed color rides the tint over the near-white petal card
            c.setHex(tint);
            c.offsetHSL(0, 0, (hashAt(j + rep, i, 19) - 0.5) * 0.08);
            fm.setColorAt(fn, c);
            fn++;
          }
        }
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
    if (fn > 0) {
      fm.count = fn;
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
      fm.computeBoundingSphere();
      fm.visible = chunk.lastSeen === generation;
      chunk.flowerMesh = fm;
      parent.add(fm);
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
    if (chunk.flowerMesh) {
      parent.remove(chunk.flowerMesh);
      chunk.flowerMesh.dispose();
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
          if (chunk.flowerMesh) chunk.flowerMesh.visible = true;
          queueChunk(chunk);
        }
      }

      for (const chunk of chunks.values()) {
        if (chunk.lastSeen === generation) continue;
        if (chunk.mesh?.visible) chunk.mesh.visible = false;
        if (chunk.flowerMesh?.visible) chunk.flowerMesh.visible = false;
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
  // This scans every world tree each frame (3k+ in the shipped field). An
  // indexed loop avoids one iterator result allocation per tree per frame.
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const hide = cameraSegmentHitsTree(t, eyeX, eyeY, eyeZ, camX, camY, camZ);
    if (hide === t.hidden) continue;
    t.hidden = hide;
    for (let j = 0; j < t.parts.length; j++) {
      const part = t.parts[j];
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
  // Reused by the per-frame bucket cull below. Allocating this input inside the
  // loop generated one short-lived object per foliage bucket per frame (well
  // over 100 MB of garbage in a 12-second gameplay sample).
  const bucketWindow: BucketWindowInput = {
    centerDist: 0,
    radius: 0,
    minDist: undefined,
    maxDist: undefined,
    minAtDetail: undefined,
    maxAtDetail: undefined,
    distanceScale: 1,
    detailFar: 0,
    revealScale: 1,
    fogLimit: 0,
  };
  // Reused per frame for the same reason as bucketWindow above.
  const collapseWindows: InstanceCullWindows = { treeMax: 0, impostorMin: 0, fogCull: 0 };
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
      fogNear: number,
      fogFar: number,
      atmosFogNear: number,
      atmosFogFar: number,
    ): void {
      grass.update(px, pz);
      updateTreeHides(treeHideables, eyeX, eyeY, eyeZ, camX, camY, camZ);
      // Buckets fully behind the fog wall are pure overdraw. The windows
      // themselves, including the real-model -> impostor swap (which follows the
      // zone's fog rather than a build-time constant, so a cone is never caught
      // standing in clear air), are decided in foliage_lod.ts and unit-tested
      // there. The cull tracks the LIVE fog; the swap tracks the ATMOSPHERE
      // (see the update() doc above).
      const distanceScale = foliageDistanceScale(modelQuality, GFX.leanFoliage);
      const fogLimit = foliageFogLimit(fogFar, modelQuality);
      const detailFar = treeDetailDistance(
        lodDists().treeDetailFar,
        atmosFogNear,
        atmosFogFar,
        distanceScale,
        fogLimit,
      );
      // The vertex shaders enforce these same boundaries per INSTANCE, so a
      // surviving slab no longer drags its whole tree population along with it
      // (foliage_collapse.ts; the windows themselves are instanceCullWindows).
      updateCollapseUniforms(instanceCullWindowsInto(detailFar, fogLimit, collapseWindows));
      modelVisibleBuckets = 0;
      modelVisibleDraws = 0;
      modelVisibleTriangles = 0;
      modelVisibleByLod = {};
      modelVisibleDrawsByLod = {};
      modelVisibleTrianglesByLod = {};
      // This walks 1k+ buckets every frame. Keep it indexed: the iterator/result
      // churn from `for...of` remained the dominant foliage allocation after the
      // cull input itself became reusable.
      for (let i = 0; i < bucketMeshes.length; i++) {
        const b = bucketMeshes[i];
        const revealScale =
          GFX.leanFoliage && (b.lod === 'core' || b.lod === 'near-fill')
            ? 0.94 + hashAt(b.x, b.z, 109) * 0.06
            : 1;
        const dx = b.x - camX;
        const dz = b.z - camZ;
        bucketWindow.centerDist = Math.sqrt(dx * dx + dz * dz);
        bucketWindow.radius = b.radius;
        bucketWindow.minDist = b.minDist;
        bucketWindow.maxDist = b.maxDist;
        bucketWindow.minAtDetail = b.minAtDetail;
        bucketWindow.maxAtDetail = b.maxAtDetail;
        bucketWindow.distanceScale = distanceScale;
        bucketWindow.detailFar = detailFar;
        bucketWindow.revealScale = revealScale;
        bucketWindow.fogLimit = fogLimit;
        b.mesh.visible = bucketVisible(bucketWindow);
        // "Visible" counts SUBMITTED instances: shader-collapsed ones still
        // count here (the collapse saves raster work, not submission).
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
