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
import { registerDeferredPreload } from './assets/preload';
import { applyCanopyDetail } from './canopy_detail';
import {
  applyInstanceCollapse,
  type CollapseRole,
  type CollapseWindowValues,
  updateCollapseUniforms,
} from './foliage_collapse';
import {
  eastbrookGrassExclusions,
  insideDressingExclusion,
  insideEastbrookGrassExclusion,
  insideGrassHubExclusion,
} from './foliage_core';
import {
  createImpostorSession,
  type ImpostorBucketHandle,
  type ImpostorCategory,
  type ImpostorSession,
  impostorPrewarmMeshes,
  impostorsActive,
} from './foliage_impostor';
import { IMPOSTOR_SWAP_FADE, spriteSwapDistance } from './foliage_impostor_core';
import {
  type BucketWindowInput,
  bucketVisible,
  foliageDistanceScale,
  foliageFogLimit,
  type LodDists,
  lodDistsFor,
  treeDetailDistance,
} from './foliage_lod';
import {
  patchConstantUpNormalVertexShader,
  patchGrassFragmentShader,
  reuseDiffuseMapSampleForEmissive,
} from './foliage_shader_core';
import {
  gardenLushGrassAt,
  gardenMeadowTintAt,
  inParterrePlot,
  parterreBushSpots,
  parterreFlowerTintAt,
} from './garden_parterre_core';
import {
  configureMaskedDoubleSidedVegetationMaterial,
  GFX,
  type GfxSettings,
  sharedUniforms,
} from './gfx';
import {
  type GrassCapCollapseBand,
  grassCapCollapseBand,
  grassCapCollapseShaderPatch,
} from './grass_cap_collapse_core';
import { type InstancedGhostHandle, InstancedOccluderGhosts } from './instanced_occluder_ghosts';
import { occluderFadeSettled, stepOccluderFade } from './occluder_fade_core';
import {
  advanceInstanceCountInto,
  farFieldDensityFractionForValues,
  projectedPixelSize,
  reorderInstanceDataByStableRank,
} from './perceptual_lod_core';
import { collectBuildingImpostors } from './props';
import { attachShadowPassOnlyGate } from './shadow_pass_gate_core';
import { freezeStaticMatrices } from './static_matrix';
import { groundGrassColorAt, groundLushnessAt } from './terrain_chunk_build';
import { type FlowerKind, flowerTuftTexture, grassTuftTexture } from './textures';
import { applySurfaceDetail, foliageWornFamilyFor } from './worn_stone';

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
// Exported: the near-field blade carpet (blade_grass.ts) follows the same
// per-biome bare/lush rules as the card tufts.
export const GRASS_BIOME_DENSITY: Partial<Record<BiomeId, number>> = {
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
const GRASS_RANK_SALT = 17;
const FLOWER_RANK_SALT = 53;
const GRASS_CARD_REFERENCE_HEIGHT_LOW = 0.72;
const GRASS_CARD_REFERENCE_HEIGHT_HIGH = 0.9;
const FLOWER_CARD_REFERENCE_HEIGHT = 0.82;
const FLOWER_FAR_DENSITY_FLOOR = 0.75;
const TREE_WIND_STRENGTH = 0.08;
const GRASS_WIND_STRENGTH = 0.16;
// how far leaf normals bend toward the canopy-sphere direction (see addWind);
// 0 keeps the raw card normals and their crushed-black backlit sides. The old
// straight-up bend at this strength pulled every leaf to the same near-peak
// N·L under a high sun and flattened whole canopies into one value; the
// sphere target keeps the shaded side lit through the sky term while giving
// the canopy a real lit side and shade side.
const LEAF_UP_NORMAL_BLEND = 0.7;
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
type FoliageModelUrls = typeof FOLIAGE_MODEL_URLS_HIGH;

function foliageModelUrlsFor(target: Pick<GfxSettings, 'leanFoliage'>): FoliageModelUrls {
  return target.leanFoliage ? FOLIAGE_MODEL_URLS_LOW : FOLIAGE_MODEL_URLS_HIGH;
}

const foliageModelUrls = (): FoliageModelUrls => foliageModelUrlsFor(GFX);

// Which per-instance collapse window a model's materials take: tree species
// end at the real-model/impostor swap; everything else (rocks, dressing) runs
// to the fog cull. Keyed by source URL so a future kit reusing one material
// name across a tree and a bush still gets each usage its own window.
const TREE_MODEL_URLS: ReadonlySet<string> = new Set([
  ...FOLIAGE_MODEL_URLS_HIGH.pine,
  ...FOLIAGE_MODEL_URLS_HIGH.oak,
  ...FOLIAGE_MODEL_URLS_HIGH.twisted,
  ...FOLIAGE_MODEL_URLS_HIGH.dead,
]);
// Bush kinds hand off to sprites at the dress swap on the sprite arm; ferns
// and mushrooms are sub-pixel long before their cull and stay plain.
const DRESS_SPRITE_URLS: ReadonlySet<string> = new Set([
  FOLIAGE_MODEL_URLS_HIGH.bush[0],
  FOLIAGE_MODEL_URLS_HIGH.bushFlowers[0],
]);
const collapseRoleForUrl = (url: string): CollapseRole =>
  TREE_MODEL_URLS.has(url)
    ? 'tree'
    : impostorsActive() && DRESS_SPRITE_URLS.has(url)
      ? 'dress'
      : 'plain';

// kick off fetches at import; buildFoliage assumes the cache is populated
const loadedModels = new Map<string, GLTF>();
const extractedParts = new Map<string, ModelPart[]>();
const foliageLoadTasks = new Map<string, Promise<void>>();

function prepareFoliageSource(url: string): Promise<void> {
  if (loadedModels.has(url)) return Promise.resolve();
  const existing = foliageLoadTasks.get(url);
  if (existing) return existing;
  const task = loadGltf(url)
    .then((gltf) => {
      loadedModels.set(url, gltf);
      foliageLoadTasks.delete(url);
    })
    .catch((err) => {
      foliageLoadTasks.delete(url);
      throw err;
    });
  foliageLoadTasks.set(url, task);
  return task;
}

/** Prepare the foliage source set selected by an explicit target profile. */
export function prepareFoliageProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  // Existing extracted URLs belong to the active renderer. Reload their
  // released source scenes before the coordinator clears derived caches, so
  // its old-profile rollback arm can still rebuild after a target failure.
  const urls = new Set([
    ...Object.values(foliageModelUrlsFor(target)).flat(),
    ...extractedParts.keys(),
  ]);
  return Promise.all([...urls].map(prepareFoliageSource)).then(() => undefined);
}

const ALL_FOLIAGE_MODEL_URLS = new Set([
  ...Object.values(FOLIAGE_MODEL_URLS_HIGH).flat(),
  ...Object.values(FOLIAGE_MODEL_URLS_LOW).flat(),
]);
let deferredFoliageModelUrls: ReadonlySet<string> | null = null;
function deferredFoliageUrlsForBoot(): ReadonlySet<string> {
  deferredFoliageModelUrls ??= new Set(Object.values(foliageModelUrlsFor(GFX)).flat());
  return deferredFoliageModelUrls;
}
for (const url of ALL_FOLIAGE_MODEL_URLS) {
  registerDeferredPreload(() => {
    // Read GFX when the deferred lane opens, after startup safety and device
    // defaults have settled. Non-target recipes stay cheap no-op tasks.
    if (!deferredFoliageUrlsForBoot().has(url)) return Promise.resolve();
    return prepareFoliageSource(url).then(() => {
      // Packaged iOS still extracts each source as it lands so parsed scenes
      // do not accumulate before the renderer build.
      if (GFX.nativeIosMemoryProfile) extractParts(url);
    });
  });
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
// Per-biome grass accents, normalized against the vale entry at build time:
// the per-instance tuft tint starts from the ground colour under the tuft
// (same palette zone blend and patch noise the terrain vertex colours use),
// then multiplies in the biome accent so authored casts survive (night stays
// orchid, jungle stays wet-bright) while the base still tracks the meadow.
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
// The cards are lit with up normals (see applyGrassShader), so no N.L
// compensation is needed; per-channel because the grass photo the ground
// multiplies in is not neutral against the tuft map.
const GRASS_TINT_GAIN: readonly [number, number, number] = [1.08, 1.0, 0.7];
const tuftTintChannel = (ground: number, gain: number): number =>
  Math.min(1, gain * (0.65 + 0.7 * ground));
const GRASS_ACCENT: Partial<Record<BiomeId, [number, number, number]>> = (() => {
  const vale = new THREE.Color(GRASS_TINT.vale);
  const out: Partial<Record<BiomeId, [number, number, number]>> = {};
  for (const [biome, hex] of Object.entries(GRASS_TINT) as [BiomeId, number][]) {
    const c = new THREE.Color(hex);
    out[biome] = [c.r / vale.r, c.g / vale.g, c.b / vale.b];
  }
  // Pale grounds (peaks scree, frost snowfields) land the ground-keyed tint
  // exactly on the surface value and the blades dissolve into flat slabs;
  // pull those tufts darker so the silhouette keeps definition.
  for (const pale of ['peaks', 'frost'] as const) {
    const a = out[pale];
    if (a) out[pale] = [a[0] * 0.82, a[1] * 0.85, a[2] * 0.84];
  }
  return out;
})();
// Bush/fern dressing tint gain over the ground grass colour (same curve as
// GRASS_TINT_GAIN); above 1 because the kit albedo is much darker than the
// meadow it stands in.
const DRESS_GROUND_GAIN: readonly [number, number, number] = [1.7, 1.55, 1.15];
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
// how far the authored-tint dressing path collapses toward white
const DRESS_TINT_SOFTEN = 0.65;
const DRESS_TINT_SOFTEN_LOW = 0.56;
// Same accent normalization as GRASS_ACCENT: dressing tints ride on the
// ground colour so bushes stop reading as flat biome-constant clumps, while
// authored casts (violet night shrubs, jungle greens) survive the ride.
const DRESS_ACCENT: Partial<Record<BiomeId, [number, number, number]>> = (() => {
  const vale = new THREE.Color(DRESS_TINT.vale);
  const out: Partial<Record<BiomeId, [number, number, number]>> = {};
  for (const [biome, hex] of Object.entries(DRESS_TINT) as [BiomeId, number][]) {
    const c = new THREE.Color(hex);
    out[biome] = [c.r / vale.r, c.g / vale.g, c.b / vale.b];
  }
  return out;
})();
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
   * preset x day-night scale, pre-clamp): they drive the real-model/sprite
   * handoff, so a streaming fog wall never drags the boundary toward the
   * camera (input contracts in foliage_lod.ts and foliage_impostor_core.ts).
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
    projectionPixels: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
  setGrassQuality(level: number): void;
  setModelQuality(level: number): void;
  perfStats(out?: FoliagePerfStats): FoliagePerfStats;
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
  /** sprite rows: which per-frame swap the row keys its window on */
  spriteCategory?: ImpostorCategory;
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
  // Shadow-gated clones read count 0 outside the shadow draw; the gate
  // stashes the real count so the budget telemetry keeps their true cost.
  const count =
    (mesh as unknown as { shadowPassFullCount?: number }).shadowPassFullCount ?? mesh.count;
  return {
    draws: drawCountFor(mesh.material, mesh.geometry),
    triangles: triangleCountFor(mesh.geometry) * Math.max(0, count),
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
  /** Animated fade level (1 = opaque instance, 0.2 = occluding ghost). */
  alpha: number;
  /** Live ghost stand-ins while the fade is active (empty = instanced). */
  ghosts: InstancedGhostHandle[];
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

// Slow travelling gust, shared by the canopy and grass shaders: it scales the
// sway amplitude (0.2 to 1) instead of adding displacement of its own, so the
// vegetation swells and calms in coherent waves rather than every plant
// flapping at one fixed strength. Same rate and world scale in both keeps the
// canopy and the meadow in the same weather.
const windGustGlsl = (x: string, z: string): string =>
  `0.6 + 0.4 * sin(uTime * 0.6 + ${x} * 0.05 + ${z} * 0.04)`;

// Wind sway injection for foliage materials (canopies, bushes, grass cards).
// Phase comes from the instance's world origin so neighbouring trees
// desynchronise; weight ramps by local height so bases stay planted.
// upNormalBlend bends leaf normals toward world up (uniform-driven so every
// material shares one shader program): dense canopies otherwise shade almost
// entirely by sun facing, and their backlit sides crush to black clumps,
// which is what small meadow pines read as from the east.
function addWind(mat: THREE.Material, strength: number, upNormalBlend = 0): void {
  if (!GFX.windSway && upNormalBlend === 0) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uWindStrength = { value: GFX.windSway ? strength : 0 };
    sh.uniforms.uUpNormalBlend = { value: upNormalBlend };
    // canopy pivot accumulated from the leaf parts' bounding boxes during
    // extraction (userData is final by first render, which is when this runs)
    const pivot = mat.userData as { canopyPivotSum?: number; canopyPivotN?: number };
    sh.uniforms.uCanopyPivotY = {
      value: pivot.canopyPivotN ? (pivot.canopyPivotSum ?? 0) / pivot.canopyPivotN : 0,
    };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uUpNormalBlend;
        uniform float uCanopyPivotY;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        // Bend leaf normals toward the direction from the canopy pivot
        // through the vertex, biased upward. The canopy then shades as a lit
        // volume: sun side bright, shade side dimming through the sky term,
        // where a straight-up bend gave every card the same N·L and flattened
        // the whole tree to one value. Model-local position: tree base at the
        // origin, so no instance transform is needed for the pivot.
        vec3 canopyRad = vec3(position.x, (position.y - uCanopyPivotY) * 0.75 + 0.55, position.z);
        vec3 canopyDir = canopyRad / max(length(canopyRad), 1e-4);
        objectNormal = normalize(mix(objectNormal, canopyDir, uUpNormalBlend));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 windOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 windOrigin = vec2(0.0);
        #endif
        float windPhase = windOrigin.x * 0.15 + windOrigin.y * 0.17;
        float windGust = ${windGustGlsl('windOrigin.x', 'windOrigin.y')};
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * windGust * uWindStrength * smoothstep(0.0, 1.0, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uUpNormalBlendF;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          // The up-bent vertex normal gets flipped toward DOWN on backfaces
          // by the double-sided chunk, blacking out canopy reverse sides.
          // Undo the flip in proportion to the bend so unbent materials keep
          // stock behaviour.
          normal = mix(normal, normal * faceDirection, uUpNormalBlendF);
        #endif`,
      );
    sh.uniforms.uUpNormalBlendF = { value: upNormalBlend > 0 ? 1 : 0 };
  };
}

// Leaf materials deliberately use their albedo map as a faint ambient floor.
// Both slots point at the same texture object, UV channel, and transform, so
// the fragment shader can reuse the map sample with no arithmetic or sampling
// difference. This hook runs last so canopy emissive shading stays after it.
function reuseLeafMapSampleForEmissive(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  const prevKey =
    typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = reuseDiffuseMapSampleForEmissive(shader.fragmentShader);
  };
  mat.customProgramCacheKey = () => `foliage-shared-map-emissive|${prevKey ? prevKey() : prevSrc}`;
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

/** Drop profile-derived foliage parts/materials while retaining source URL recipes. */
export function resetFoliageProfileCaches(): void {
  extractedParts.clear();
  materialCache.clear();
  farTrunkCache.clear();
}

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
  // keep the source material's name: the albedo-lift loops and the canopy
  // pivot accumulation both key off it after the rebuild
  mat.name = src.name;
  const upBlend = pol.leaf ? LEAF_UP_NORMAL_BLEND : 0;
  if (pol.windMul > 0 || upBlend > 0) addWind(mat, TREE_WIND_STRENGTH * pol.windMul, upBlend);
  if (pol.leaf && std.map) {
    // Texture-shaped ambient floor: a dense canopy shadow-maps itself into
    // darkness (worst on small meadow pines, which read as black clumps), and
    // no diffuse-side tweak survives full shadow. Kept deliberately faint: the
    // floor is constant, so any more of it also lands on sunlit canopies and
    // flattens their shading into neon. The shadowed side is carried mostly by
    // the sky term through the up-bent leaf normals (LEAF_UP_NORMAL_BLEND),
    // which falls off with light instead of glowing on its own.
    mat.emissiveMap = std.map;
    mat.emissive.setRGB(0.155, 0.175, 0.135);
  }
  applyInstanceCollapse(mat, role);
  // Trunks take the bark family, the shared boulder fields a stronger stone;
  // leaf/flower/mushroom names return null so canopies stay clean. Applied
  // LAST so the worn hook chains the collapse (and any wind) hook.
  const worn = foliageWornFamilyFor(src.name);
  if (worn)
    applySurfaceDetail(mat as THREE.MeshStandardMaterial, worn.family, { strength: worn.strength });
  // Leaf names return null above: canopies take their own clump-detail layer
  // (needle/leaf break-up) instead; unknown names no-op inside.
  applyCanopyDetail(mat, src.name);
  if (pol.leaf && std.map) reuseLeafMapSampleForEmissive(mat);
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

/** Dev-channel residency accounting sources (see assets/residency_budget.ts). */
export function foliageResidencySources(): {
  extractedGeometries: THREE.BufferGeometry[];
  parsedScenes: THREE.Object3D[];
} {
  return {
    extractedGeometries: [...extractedParts.values()].flatMap((ps) => ps.map((p) => p.geometry)),
    parsedScenes: [...loadedModels.values()].map((g) => g.scene),
  };
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
  // Accumulate the canopy pivot (mean leaf-bbox centre) on the shared
  // material for the sphere-normal bend in addWind. Materials are shared per
  // (role, name) across a species' GLB variants, so the pivot is a running
  // average over every variant that uses the sheet, close enough for a
  // shading direction.
  for (const part of parts) {
    if (!part.isLeaf) continue;
    part.geometry.computeBoundingBox();
    const bb = part.geometry.boundingBox;
    if (!bb) continue;
    const ud = part.material.userData as { canopyPivotSum?: number; canopyPivotN?: number };
    ud.canopyPivotSum = (ud.canopyPivotSum ?? 0) + (bb.min.y + bb.max.y) / 2;
    ud.canopyPivotN = (ud.canopyPivotN ?? 0) + 1;
  }
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
  /**
   * Tint family the whole SPRITE takes past the swap. One sprite covers bark
   * and canopy, so the dominant surface wins: canopied species ride the leaf
   * tint, the bare dead trees the trunk family. Same rule the old cone
   * stand-ins used, kept so the handoff does not shift a tree's color.
   */
  spriteTint: 'leaf' | 'trunk';
  /** atlas archetype per model variant, filled while the sprite arm builds */
  impostorRows?: number[];
  /** hide the heavy bark mesh beyond BARK_FAR (needs a canopy that covers) */
  cullBarkFar?: boolean;
  /** beyond BARK_FAR swap the bark for a cheap cylinder (straight trunks) */
  farTrunkProxy?: boolean;
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
  const modelUrls = foliageModelUrls();
  const speciesUrls = [
    ...modelUrls.pine,
    ...modelUrls.oak,
    ...modelUrls.twisted,
    ...modelUrls.dead,
    ...modelUrls.rock,
    modelUrls.bush[0],
    modelUrls.bushFlowers[0],
    modelUrls.fern[0],
    modelUrls.mushroom[0],
  ];
  for (const url of speciesUrls) {
    for (const part of extractParts(url)) add(part.geometry, part.material);
  }
  // Far-foliage sprite impostors: one 1-instance mesh per category material,
  // attributes included, so their programs link in this pass too. Empty until
  // buildFoliage has baked the atlas (renderer builds the world before the
  // prewarm pass runs) and on the arms without sprites.
  for (const mesh of impostorPrewarmMeshes()) group.add(mesh);
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
  impostorBucket: ImpostorBucketHandle | null,
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
        alpha: 1,
        ghosts: [],
        parts: [],
      }));
      hideRegistry.push(...handles);
      return { ...g, handles };
    });
    // Every tree in the group, near-fill included, contributes a sprite to
    // the bucket's shared impostor mesh: placement, yaw, scale and height
    // jitter mirror the real instance exactly so the handoff never moves,
    // resizes or recolors a tree. Near-fill trees used to vanish outright at
    // treeFillFar; their sprites now carry the density to the fog wall.
    if (impostorBucket && spec.impostorRows) {
      const row = spec.impostorRows[subset[gi]];
      for (const group of handlesByLod) {
        for (const d of group.items) {
          const y = terrainHeight(d.x, d.z, seed);
          const s = d.scale * spec.baseScale;
          const heightJitter = 1 + (hashAt(d.x, d.z, 31) - 0.5) * 0.18;
          const yaw = d.variant * 2.1 + hashAt(d.x, d.z, 11) * Math.PI * 2;
          const tintHex =
            spec.spriteTint === 'trunk'
              ? TRUNK_TINT[d.biome]
              : typeof spec.leafTint === 'number'
                ? spec.leafTint
                : spec.leafTint[d.biome];
          impostorBucket.add(
            row,
            d.x,
            y - spec.sink * s,
            d.z,
            yaw,
            s,
            heightJitter,
            softTint(
              d.x,
              d.z,
              tintHex,
              c,
              spec.spriteTint === 'trunk' ? BARK_TINT_SOFTEN : leafSoften(d.biome),
              spec.spriteTint === 'trunk' ? 0.5 : 1,
            ),
          );
        }
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
        // On the sprite arm the near-fill cap is retired: instances collapse at
        // the shared tree swap anyway (always inside the cap), and the
        // center-measured bucket cull used to drop a slab's still-near trees
        // with no sprite behind them.
        if (group.maxDist !== undefined && !impostorsActive()) numericCaps.push(group.maxDist);
        if (cullBark) numericCaps.push(barkFar);
        const maxDist = numericCaps.length > 0 ? Math.min(...numericCaps) : undefined;
        register(im, group.lod, undefined, maxDist, { max: true });
        if (GFX.standardMaterials && !GFX.leanFoliage && castsShadow) {
          const shadow = cloneInstancedTo(im, part.geometry, makeShadowOnlyMaterial(part.material));
          shadow.castShadow = true;
          shadow.receiveShadow = false;
          // ORDER MATTERS: compute the instance-aware bounds while the count
          // is still full; the gate below zeroes the count, and a lazily
          // computed sphere at count 0 would cache empty and cull the
          // clone's shadow forever.
          shadow.computeBoundingSphere();
          shadow.computeBoundingBox();
          // Shadow-pass only: without the gate every clone also costs a
          // colorWrite-off draw in the color pass (one per casting bucket).
          attachShadowPassOnlyGate(shadow);
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
        if (GFX.standardMaterials && !impostorsActive() && !part.isLeaf && spec.farTrunkProxy) {
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
  session: ImpostorSession | null,
): void {
  const modelUrls = foliageModelUrls();
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
    sets: modelUrls.pine.map(extractParts),
    perBucket: treeVariants,
    salt: 51,
    baseScale: 1.1,
    sink: 0.05,
    leafTint: PINE_TINT,
    castBarkShadow: false,
    spriteTint: 'leaf',
    cullBarkFar: true, // pine canopies start ~2u up: no proxy needed in fog
  };
  // Mild oak leaf lift. The old 6.5x here was calibrated on a whole-atlas
  // average (~0.012) that was both diluted ~3.4x by fully-transparent texels
  // and attributed to the wrong atlas, measured over the texels alphaTest
  // keeps, oak is (0.099, 0.197, 0.000) linear, already 2-3x BRIGHTER than
  // pine. At 6.5x the visible green albedo passed 1.0 (brighter than white)
  // and canopies read as neon lime with no shading left. 1.35x keeps oaks a
  // touch brighter than pine without erasing their lit/shade gradation.
  const oakSets = modelUrls.oak.map(extractParts);
  for (const parts of oakSets) {
    for (const part of parts) {
      if (part.isLeaf) (part.material as THREE.MeshStandardMaterial).color.setRGB(1.35, 1.25, 1.1);
    }
  }
  const oakSpec: SpeciesSpec = {
    sets: oakSets,
    perBucket: treeVariants,
    salt: 54,
    baseScale: 1.15,
    sink: 0.05,
    leafTint: OAK_TINT,
    castBarkShadow: false,
    spriteTint: 'leaf',
    farTrunkProxy: true, // oak crowns float without a trunk stand-in
  };
  const twistedSpec: SpeciesSpec = {
    sets: modelUrls.twisted.map(extractParts),
    perBucket: treeVariants,
    salt: 57,
    baseScale: 0.5,
    sink: 0.05,
    leafTint: SWAMP_CANOPY_TINT,
    castBarkShadow: false,
    spriteTint: 'leaf',
  };
  const deadSpec: SpeciesSpec = {
    sets: modelUrls.dead.map(extractParts),
    perBucket: 1,
    salt: 60,
    baseScale: 0.7,
    sink: 0.05,
    // dead trees have no canopy, so the bark must cast or they go shadowless
    leafTint: TRUNK_TINT.marsh,
    castBarkShadow: true,
    spriteTint: 'trunk',
  };
  if (session) {
    // one atlas row per model variant, keyed by source URL so a species list
    // change re-keys its rows with it
    pineSpec.impostorRows = pineSpec.sets.map((parts, i) =>
      session.registerArchetype('tree', modelUrls.pine[i], parts),
    );
    oakSpec.impostorRows = oakSpec.sets.map((parts, i) =>
      session.registerArchetype('tree', modelUrls.oak[i], parts),
    );
    twistedSpec.impostorRows = twistedSpec.sets.map((parts, i) =>
      session.registerArchetype('tree', modelUrls.twisted[i], parts),
    );
    // windMul 0: the dead species is bare rigid wood; the leafy 0.08 sway
    // that sells a canopy reads as the whole trunk bending on a snag
    deadSpec.impostorRows = deadSpec.sets.map((parts, i) =>
      session.registerArchetype('tree', modelUrls.dead[i], parts, 0),
    );
  }

  // rocks: 3 single variants + a merged 3-boulder cluster, each in a mossy-top
  // and a snow-dusted colorway (baked vertex colors over the rock texture)
  const rockParts = modelUrls.rock.map(extractParts);
  // source rock GLBs ship no COLOR_0, so the cached material resolves with
  // vertexColors:false — but every rock geometry below goes through
  // bakeTopTint (moss/snow vertex colors). Clone with vertexColors on, or
  // the colorways are inert. (Safe to clone: rocks take no wind hook.)
  const rockMat = (rockParts[0][0].material as THREE.MeshStandardMaterial).clone();
  rockMat.vertexColors = true;
  // clone() drops shader hooks, so the clone re-takes its collapse window
  applyInstanceCollapse(rockMat, impostorsActive() ? 'rock' : 'plain');
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
  const rockPart = (geometry: THREE.BufferGeometry) => [
    { geometry, material: rockMat as THREE.Material, isLeaf: false },
  ];
  const rockRows = session
    ? {
        moss: mossRocks.map((g, i) =>
          session.registerArchetype('rock', `rock:moss:${i}`, rockPart(g)),
        ),
        snow: snowRocks.map((g, i) =>
          session.registerArchetype('rock', `rock:snow:${i}`, rockPart(g)),
        ),
      }
    : null;

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
      spriteCategory?: ImpostorCategory,
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
        spriteCategory,
        ...bucketMeshCost(mesh),
      });
    };

    const treeSprites =
      session && pines.length + oaks.length + twisteds.length + deads.length > 0
        ? session.bucket('tree', bx, bz, bRadius)
        : null;
    placeSpecies(parent, seed, bucket, pines, pineSpec, register, hideRegistry, treeSprites);
    placeSpecies(parent, seed, bucket, oaks, oakSpec, register, hideRegistry, treeSprites);
    placeSpecies(parent, seed, bucket, twisteds, twistedSpec, register, hideRegistry, treeSprites);
    placeSpecies(parent, seed, bucket, deads, deadSpec, register, hideRegistry, treeSprites);

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
      const groupPick = (r: Decoration): { snow: boolean; index: number } => {
        const snow = isSnowy(r);
        const set = snow ? snowRocks : mossRocks;
        const singles = Math.max(1, set.length - 1); // last entry is the cluster
        const index = isCluster(r)
          ? set.length - 1
          : Math.min(
              singleSubset[Math.floor(hashAt(r.x, r.z, 72) * singleSubset.length)],
              singles - 1,
            );
        return { snow, index };
      };
      const groupGeo = (r: Decoration): THREE.BufferGeometry => {
        const pick = groupPick(r);
        return (pick.snow ? snowRocks : mossRocks)[pick.index];
      };
      const rockSprites = session && rockRows ? session.bucket('rock', bx, bz, bRadius) : null;
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
          // The rock's sprite mirrors the placement (yaw, footprint, seated
          // height, tint); the tilt folds into the baked views well enough at
          // the rock swap range, where a boulder is a handful of pixels.
          if (rockSprites && rockRows) {
            const pick = groupPick(r);
            const widthScale = (sxz1 + sxz2) / 2;
            rockSprites.add(
              rockRows[pick.snow ? 'snow' : 'moss'][pick.index],
              r.x,
              y - ROCK_SINK_UNITS * sy,
              r.z,
              r.variant * 1.7 + h3 * 2.0,
              widthScale,
              sy / Math.max(widthScale, 1e-4),
              c,
            );
          }
        });
        // no rock shadows cast: sub-pixel at typical camera range, real draw cost
        rockMesh.receiveShadow = true;
        parent.add(rockMesh);
        if (impostorsActive()) {
          // Radius-aware cull against the rock swap (spriteCategory routes it
          // in update()): the old center-measured cap dropped a slab's still
          // near rocks in one step, and with sprites visible beyond the drop
          // the missing annulus finally read as a hole.
          register(rockMesh, 'rock', undefined, undefined, { max: true }, 'rock');
        } else {
          register(rockMesh, 'rock', undefined, lodDists().rockFar);
        }
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

// Per-spot dressing tint, shared by the real instanced meshes and the sprite
// impostors so the handoff never shifts a bush's color. Extracted verbatim
// from the placement loop; every arm writes into `out` and returns it.
function dressingSpotTint(
  kind: DressKind,
  s: DressingSpot,
  seed: number,
  out: THREE.Color,
): THREE.Color {
  if (kind === 'mushroom') {
    // mushrooms keep their painted cap colors: brightness jitter only
    return out.setScalar(0.85 + hashAt(s.x, s.z, 47) * 0.3);
  }
  const biome = zoneBiomeAt(s.x, s.z);
  if (kind === 'bushFlowers' && biome === 'amber') {
    return out.set(AMBER_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * AMBER_BLOOM_TINTS.length)]);
  }
  if (kind === 'bushFlowers' && biome === 'fen') {
    return out.set(FEN_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * FEN_BLOOM_TINTS.length)]);
  }
  if (kind === 'bushFlowers' && biome === 'night') {
    // the nightblooms take their tint raw: pale petals must pop against the
    // dark ground, not soften toward it
    return out.set(NIGHT_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * NIGHT_BLOOM_TINTS.length)]);
  }
  if (kind === 'bushFlowers' && biome === 'garden') {
    // the roses take their tint raw too: a rose bed should read red.
    // Parterre roses carry their bed's authored color.
    return out.set(
      s.bloomTint ??
        GARDEN_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * GARDEN_BLOOM_TINTS.length)],
    );
  }
  if (kind === 'bushFlowers' && biome === 'gale') {
    // sea thrift takes its tint raw: pink heads over silver grass
    return out.set(GALE_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * GALE_BLOOM_TINTS.length)]);
  }
  if (kind === 'bushFlowers' && biome === 'dusk') {
    // the Hollow's flowering bushes bloom in several colors, not one
    const tint = DUSK_BLOOM_TINTS[Math.floor(hashAt(s.x, s.z, 48) * DUSK_BLOOM_TINTS.length)];
    return softTint(
      s.x,
      s.z,
      tint,
      out,
      GFX.leanFoliage ? DRESS_TINT_SOFTEN_LOW : DRESS_TINT_SOFTEN,
    );
  }
  // Bushes and ferns grow out of the same meadow as the grass tufts: key
  // their tint to the ground colour, then ride the biome accent so authored
  // casts survive. The kit albedo is dark, hence the lift gain; a flat biome
  // constant left them reading as near-black clumps on the open field.
  const dressAccent = DRESS_ACCENT[biome] ?? [1, 1, 1];
  groundGrassColorAt(s.x, s.z, seed, out);
  out.setRGB(
    Math.min(1.5, DRESS_GROUND_GAIN[0] * dressAccent[0] * (0.65 + 0.7 * out.r)),
    Math.min(1.5, DRESS_GROUND_GAIN[1] * dressAccent[1] * (0.65 + 0.7 * out.g)),
    Math.min(1.5, DRESS_GROUND_GAIN[2] * dressAccent[2] * (0.65 + 0.7 * out.b)),
  );
  out.offsetHSL(
    (hashAt(s.x, s.z, 1) - 0.5) * 0.03,
    (hashAt(s.x, s.z, 2) - 0.5) * 0.06,
    (hashAt(s.x, s.z, 3) - 0.5) * 0.05,
  );
  return out;
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

function buildDressing(
  parent: THREE.Group,
  seed: number,
  registry: BucketMesh[],
  session: ImpostorSession | null,
): void {
  const modelUrls = foliageModelUrls();
  const kindParts: Record<DressKind, ModelPart[]> = {
    bush: extractParts(modelUrls.bush[0]),
    bushFlowers: extractParts(modelUrls.bushFlowers[0]),
    fern: extractParts(modelUrls.fern[0]),
    mushroom: extractParts(modelUrls.mushroom[0]),
  };
  // Mild dressing lift. Like the oak lift above, the old 6.5x here came from
  // a transparent-texel-diluted atlas average; over visible texels the bush
  // canopy is (0.000, 0.139, 0.025) linear and fern (0.221, 0.260, 0.067).
  // The old loop was also unfiltered, so the 'Flowers' material, already at
  // (0.79, 0.58, 0.56), reached 5.2/3.2/2.2 and flowering bushes were the
  // most blown-out surface in the world. Leaves get a gentle lift; Flowers
  // get none (their authored albedo is correct).
  const albedoLift: Partial<Record<DressKind, [number, number, number]>> = {
    // 1.6/1.5 read as neon against the calmer round-8 ground: the bush sheet
    // is pure green (red 0), so brightness is the only lever here. The
    // saturation itself is tamed by canopy_detail's desat luma mix.
    bush: [1.35, 1.22, 1.08],
    bushFlowers: [1.35, 1.22, 1.08],
    fern: [1.15, 1.15, 1.15],
  };
  for (const kind of ['bush', 'bushFlowers', 'fern'] as const) {
    const lift = albedoLift[kind];
    if (!lift) continue;
    for (const part of kindParts[kind]) {
      if (part.material.name === 'Flowers') continue;
      (part.material as THREE.MeshStandardMaterial).color.setRGB(lift[0], lift[1], lift[2]);
    }
  }
  const dressRows = session
    ? {
        bush: session.registerArchetype('dress', modelUrls.bush[0], kindParts.bush),
        bushFlowers: session.registerArchetype(
          'dress',
          modelUrls.bushFlowers[0],
          kindParts.bushFlowers,
        ),
      }
    : null;
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
    // One shared dress sprite mesh per bucket: both bush kinds accumulate
    // into it, so the far band stays a single draw.
    const dressSprites =
      session && dressRows && kept.some(([kind]) => kind === 'bush' || kind === 'bushFlowers')
        ? session.bucket('dress', bx, bz, bRadius)
        : null;
    for (const [kind, list] of kept) {
      // Bush kinds hand off to sprites at the dress swap; the sprite takes
      // the same per-spot tint the real instance takes (dressingSpotTint) so
      // the handoff never shifts a bush's color.
      const spriteRow =
        dressRows && kind === 'bush'
          ? dressRows.bush
          : dressRows && kind === 'bushFlowers'
            ? dressRows.bushFlowers
            : null;
      if (dressSprites && spriteRow !== null) {
        for (const spot of list) {
          const y = terrainHeight(spot.x, spot.z, seed);
          dressSprites.add(
            spriteRow,
            spot.x,
            y - 0.04 * spot.scale,
            spot.z,
            hashAt(spot.x, spot.z, 46) * Math.PI * 2,
            spot.scale,
            1,
            dressingSpotTint(kind, spot, seed, c),
          );
        }
      }
      for (const part of kindParts[kind]) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((s, i) => {
          const y = terrainHeight(s.x, s.z, seed);
          q.setFromAxisAngle(up, hashAt(s.x, s.z, 46) * Math.PI * 2);
          m.compose(v.set(s.x, y - 0.04 * s.scale, s.z), q, sv.set(s.scale, s.scale, s.scale));
          im.setMatrixAt(i, m);
          im.setColorAt(i, dressingSpotTint(kind, s, seed, c));
        });
        im.receiveShadow = true; // dressing casts nothing: too small to matter
        parent.add(im);
        const spriteBacked = spriteRow !== null && dressSprites !== null;
        registry.push({
          mesh: im,
          x: bx,
          z: bz,
          radius: bRadius,
          // Sprite-backed kinds cull radius-aware against the dress swap
          // (spriteCategory routes it in update()); ferns and mushrooms have
          // no sprite side and keep the numeric cap.
          maxDist: spriteBacked ? undefined : lodDists().dressFar,
          maxAtDetail: spriteBacked ? true : undefined,
          spriteCategory: spriteBacked ? 'dress' : undefined,
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
  update(
    px: number,
    pz: number,
    camX: number,
    camY: number,
    camZ: number,
    projectionPixels: number,
    dt: number,
  ): void;
  setQuality(level: number): void;
  perfStats(out?: FoliagePerfStats): FoliagePerfStats;
}

interface GrassChunk {
  key: string;
  cx: number;
  cz: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  ready: boolean;
  queued: boolean;
  lastSeen: number;
  lastUsed: number;
  prioritySq: number;
  mesh?: THREE.InstancedMesh;
  grassFullCount?: number;
  grassTransitionCarry: number;
  flowerMesh?: THREE.InstancedMesh;
  flowerFullCount?: number;
  flowerTransitionCarry: number;
}

// Tags every vertex of a tuft/flower card part with the aCap attribute the
// grass shader reads: 1 on the near-horizontal cap card, 0 on upright cards
// and flowers. Every merged part carries the attribute so mergeGeometries
// keeps a uniform layout across parts.
function tagCapVertices(g: THREE.BufferGeometry, cap: 0 | 1): THREE.BufferGeometry {
  const arr = new Uint8Array(g.getAttribute('position').count);
  if (cap) arr.fill(1);
  g.setAttribute('aCap', new THREE.Uint8BufferAttribute(arr, 1));
  return g;
}

// Streamed chunks are immutable after construction. Trim their instance
// attributes before the first render so WebGL allocates and uploads only the
// live byte-identical prefix rather than each biome's conservative capacity.
function trimStaticInstanceAttributes(mesh: THREE.InstancedMesh, count: number): void {
  const matrix = mesh.instanceMatrix;
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(
    (matrix.array as Float32Array).slice(0, count * 16),
    16,
  ).setUsage(matrix.usage);
  if (mesh.instanceColor) {
    const color = mesh.instanceColor;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      (color.array as Float32Array).slice(0, count * color.itemSize),
      color.itemSize,
    ).setUsage(color.usage);
  }
}

// wind sway + masked edge fade for the grass tufts; the fade keys off the
// tuft's instance origin so alphaTest thins whole tufts without blending
function applyGrassShader(
  mat: THREE.Material,
  uniforms: { uPlayerPos: { value: THREE.Vector2 }; uFadeFar: { value: number } },
  capBand: GrassCapCollapseBand | null,
): void {
  // On tiers where the solid blade carpet runs (the exact buildBladeGrass
  // condition in blade_grass.ts), the carpet owns the near-field ground
  // cover read, and the near-horizontal cap card reads as a lattice of
  // long flat blades floating above the finer carpet. Collapse cap verts
  // to the tuft root near the player and grow them back where the carpet
  // fades out (its fade band runs 27.2 to 34). Tiers without the carpet
  // keep the cap everywhere: there it is still the only top-down read.
  const hasCap = capBand !== null;
  const baseProgramKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uniforms.uPlayerPos;
    sh.uniforms.uFadeFar = uniforms.uFadeFar;
    const capDecl = hasCap
      ? `
        attribute float aCap;
        uniform vec2 uPlayerPos;`
      : '';
    const capCollapse = grassCapCollapseShaderPatch(capBand);
    const wind = GFX.windSway
      ? `
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windGust = ${windGustGlsl('tuftBase.x', 'tuftBase.y')};
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * windGust * ${GRASS_WIND_STRENGTH.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`
      : '';
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec2 vTuftWorld;${capDecl}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tuftBase = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 tuftBase = vec2(0.0);
        #endif${capCollapse}
        ${wind}
        vTuftWorld = tuftBase;`,
      );
    // Every card used the exact up value here already. Keeping it as a shader
    // constant lets the static geometry omit 12 bytes of normal input per vertex.
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
    sh.fragmentShader = patchGrassFragmentShader(sh.fragmentShader);
  };
  const capProgramKey = capBand ? `${capBand.start.toFixed(3)}-${capBand.end.toFixed(3)}` : 'none';
  mat.customProgramCacheKey = () => `grass-card|cap:${capProgramKey}|${baseProgramKey}`;
}

/** The overworld jungle grass tint (GRASS_TINT.jungle), for interiors that
 *  reuse the grass-tuft look (the Wildheart Basin ground cover). */
export const JUNGLE_GRASS_TINT: number = GRASS_TINT.jungle;

/**
 * The standard high-tier grass-tuft material (lush texture card, alphaTest
 * cutout, wind sway on the shared uTime clock) for a STATIC interior scatter:
 * the player-distance fade is neutralized (uPlayerPos parked at infinity,
 * uFadeFar huge) so a one-shot InstancedMesh never thins with distance.
 */
export function createGrassTuftMaterial(): THREE.Material {
  const mat = configureMaskedDoubleSidedVegetationMaterial(
    new THREE.MeshStandardMaterial({
      // grassTuftTexture draws from textures.ts's shared sequential LCG, and
      // this material is built lazily on first interior entry, so the card's
      // blade layout (and the stream position of any texture generated after
      // it) depends on when in the session the basin first builds. Cosmetic
      // only, and the Yumi maze's lazy stoneTexture already ships the same
      // order-dependence; a per-module stateless hash would fix it at the
      // cost of duplicating the tuft painter.
      map: grassTuftTexture(30),
      alphaTest: 0.3,
      roughness: 0.9,
    }),
  );
  applyGrassShader(
    mat,
    {
      // uFadeFar must comfortably exceed the parked distance: the fade term is
      // 1 - smoothstep(uFadeFar*0.7, uFadeFar, distance(vTuftWorld, uPlayerPos)),
      // so with the player parked at (1e6,1e6) a uFadeFar of 1e6 SATURATES the
      // smoothstep (every tuft sits ~1.414e6 away) and alphaTest discards every
      // fragment, an invisible scatter. 1e8 keeps the factor at exactly 1.
      uPlayerPos: { value: new THREE.Vector2(1e6, 1e6) },
      uFadeFar: { value: 1e8 },
      // No cap collapse: the near-field blade carpet is an overworld chunk
      // feature and never runs in the basin interior, so there is no carpet
      // underneath to collapse the cap card into. Keep the cap everywhere.
    },
    null,
  );
  return mat;
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

function clearNumberRecord(record: Record<string, number>): void {
  for (const key in record) delete record[key];
}

function copyNumberRecord(
  out: Record<string, number>,
  source: Readonly<Record<string, number>>,
): void {
  clearNumberRecord(out);
  for (const key in source) out[key] = source[key];
}

function emptyGrassStats(
  enabled: boolean,
  cacheLimit = 0,
  out?: FoliagePerfStats,
): FoliagePerfStats {
  const stats =
    out ??
    ({
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
    } satisfies FoliagePerfStats);
  stats.modelQuality = 1;
  stats.modelBuckets = 0;
  stats.modelVisibleBuckets = 0;
  clearNumberRecord(stats.modelBucketsByLod);
  clearNumberRecord(stats.modelVisibleByLod);
  stats.modelDraws = 0;
  stats.modelVisibleDraws = 0;
  clearNumberRecord(stats.modelDrawsByLod);
  clearNumberRecord(stats.modelVisibleDrawsByLod);
  stats.modelTriangles = 0;
  stats.modelVisibleTriangles = 0;
  clearNumberRecord(stats.modelTrianglesByLod);
  clearNumberRecord(stats.modelVisibleTrianglesByLod);
  stats.grassEnabled = enabled;
  stats.grassQuality = enabled ? 1 : 0;
  stats.grassActiveRadius = 0;
  stats.grassChunks = 0;
  stats.grassReadyChunks = 0;
  stats.grassVisibleChunks = 0;
  stats.grassQueuedChunks = 0;
  stats.grassTufts = 0;
  stats.grassVisibleTufts = 0;
  stats.grassBuiltChunks = 0;
  stats.grassDisposedChunks = 0;
  stats.grassLastBuildMs = 0;
  stats.grassBuildMs = 0;
  stats.grassCacheLimit = cacheLimit;
  return stats;
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
  const capCollapseBand = grassCapCollapseBand(GFX.bladeCarpetRadius);
  const capNearCollapse = capCollapseBand !== null;
  const lowPlusGrassScale = GFX.lowPlus ? 1.08 : 1;
  const quad = new THREE.PlaneGeometry(
    lush ? 1.45 : 1.1 * lowPlusGrassScale,
    lush ? 0.9 : 0.7 * lowPlusGrassScale,
  );
  quad.translate(0, lush ? 0.4 : 0.35 * lowPlusGrassScale, 0);
  const quad2 = quad.clone().rotateY(Math.PI / 2);
  // Lush tier gets a third card at 45 degrees with a slight lean and a
  // narrower/taller silhouette: two perpendicular cards read as a flat
  // cross from above (the "4-way image"); the offset third card breaks the
  // X in every direction for one extra quad per tuft. Low tier keeps two.
  const quad3 = lush
    ? new THREE.PlaneGeometry(1.15, 1.05)
        .translate(0, 0.45, 0)
        .rotateZ(0.12)
        .rotateY(Math.PI / 4)
    : null;
  // A near-horizontal cap card: from a true top-down camera (positive pitch,
  // the chase camera's common angle) every vertical card goes edge-on and
  // the meadow read as bare ground with green fans. The cap keeps blade
  // texture facing the sky for one more quad on the lush tier only.
  const quadCap = lush
    ? new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2 + 0.18).translate(0, 0.34, 0)
    : null;
  const capPart = (part: THREE.BufferGeometry, cap: 0 | 1): THREE.BufferGeometry =>
    capNearCollapse ? tagCapVertices(part, cap) : part;
  const parts = [capPart(quad, 0), capPart(quad2, 0)];
  if (quad3) parts.push(capPart(quad3, 0));
  if (quadCap) parts.push(capPart(quadCap, 1));
  const geo = mergeGeometries(parts);
  geo.deleteAttribute('normal');

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
  applyGrassShader(mat, uniforms, capCollapseBand);

  // ground-cover flowers: a sparse companion set in the same chunks, sharing
  // the sway/fade shader so they move and thin exactly like the grass.
  // Each biome gets its own petal palette (chunk-level pick), and the dusk
  // realm grows dense flower-field drifts.
  const fquad = new THREE.PlaneGeometry(0.95, 0.8);
  fquad.translate(0, 0.38, 0);
  const fquad2 = fquad.clone().rotateY(Math.PI / 2);
  // Flowers share the sway/fade shader but have no cap card, so they omit the
  // cap attribute and per-vertex distance/smoothstep path entirely.
  const flowerGeo = mergeGeometries([fquad, fquad2]);
  flowerGeo.deleteAttribute('normal');
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
      applyGrassShader(fmMat, uniforms, null);
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
  const instanceCountStep = { count: 0, carry: 0 };

  const chunkKey = (cx: number, cz: number): string => `${cx}:${cz}`;
  const chunkCenter = (cidx: number): number => (cidx + 0.5) * GRASS_CHUNK_SIZE;

  const createChunk = (cx: number, cz: number): GrassChunk => {
    const chunk: GrassChunk = {
      key: chunkKey(cx, cz),
      cx,
      cz,
      centerX: chunkCenter(cx),
      centerY: terrainHeight(chunkCenter(cx), chunkCenter(cz), seed),
      centerZ: chunkCenter(cz),
      ready: false,
      queued: false,
      lastSeen: -1,
      lastUsed: -1,
      prioritySq: Infinity,
      grassTransitionCarry: 0,
      flowerTransitionCarry: 0,
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
    im.userData.instanceFamily = 'grass-card';
    im.userData.grassChunkKey = chunk.key;
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
    fm.userData.instanceFamily = 'ground-flower';
    fm.userData.grassChunkKey = chunk.key;
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
        // Meadow patchiness: the same soil noise that darkens the ground
        // palette decides where grass actually grows. Dense stands on the
        // lush dark-green patches thin to near-bare yellowed ground between
        // them, so the meadow reads as growth following the soil instead of
        // a uniform scatter of models. Squaring hardens the patch edges.
        const lushness = groundLushnessAt(x, z, seed);
        const density =
          (lush ? GRASS_DENSITY_HIGH : GRASS_DENSITY_LOW) *
          (gardenBedTuft ? 0.9 : (GRASS_BIOME_DENSITY[tuftBiome] ?? 1)) *
          (0.25 + 1.7 * lushness * lushness);
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
          // r is the density hash, so it only ever reaches the density cap:
          // the lush scale tops out near 0.95 rather than sprouting monsters.
          // Patch cores grow tall and patch edges stay short. With the sparse
          // areas' accepted hashes skewing small, stragglers between patches
          // come out smallest of all.
          const s = ((lush ? 0.55 : 0.45) + r * (lush ? 0.8 : 1)) * (0.72 + lushness * 0.55);
          q.setFromAxisAngle(up, r * 12.4);
          m.compose(v.set(x, h, z), q, sv.set(s, s, s));
          im.setMatrixAt(n, m);
          const accent = GRASS_ACCENT[tuftBiome] ?? [1, 1, 1];
          groundGrassColorAt(x, z, seed, c);
          c.setRGB(
            tuftTintChannel(c.r, GRASS_TINT_GAIN[0] * accent[0]),
            tuftTintChannel(c.g, GRASS_TINT_GAIN[1] * accent[1]),
            tuftTintChannel(c.b, GRASS_TINT_GAIN[2] * accent[2]),
          );
          // small enough to read as patches (the ground noise already
          // carries those) rather than per-tuft confetti
          c.offsetHSL(
            (hashAt(i, j, 3) - 0.5) * 0.024,
            (hashAt(i, j, 4) - 0.5) * 0.06,
            (hashAt(i, j, 5) - 0.5) * 0.07,
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
      reorderInstanceDataByStableRank(
        im.instanceMatrix.array as Float32Array,
        im.instanceColor ? (im.instanceColor.array as Float32Array) : null,
        n,
        seed,
        GRASS_RANK_SALT,
      );
      im.count = n;
      trimStaticInstanceAttributes(im, n);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.visible = false;
      chunk.mesh = im;
      chunk.grassFullCount = n;
      parent.add(im);
      freezeStaticMatrices(im);
    }
    if (fn > 0) {
      reorderInstanceDataByStableRank(
        fm.instanceMatrix.array as Float32Array,
        fm.instanceColor ? (fm.instanceColor.array as Float32Array) : null,
        fn,
        seed,
        FLOWER_RANK_SALT,
      );
      fm.count = fn;
      trimStaticInstanceAttributes(fm, fn);
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
      fm.computeBoundingSphere();
      fm.visible = false;
      chunk.flowerMesh = fm;
      chunk.flowerFullCount = fn;
      parent.add(fm);
      freezeStaticMatrices(fm);
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

  const chunkNearDistance = (chunk: GrassChunk, px: number, pz: number): number => {
    const minX = chunk.cx * GRASS_CHUNK_SIZE;
    const minZ = chunk.cz * GRASS_CHUNK_SIZE;
    const dx = Math.max(minX - px, 0, px - (minX + GRASS_CHUNK_SIZE));
    const dz = Math.max(minZ - pz, 0, pz - (minZ + GRASS_CHUNK_SIZE));
    return Math.hypot(dx, dz);
  };

  const chunkNearCameraDistance = (
    chunk: GrassChunk,
    camX: number,
    camY: number,
    camZ: number,
  ): number => {
    const minX = chunk.cx * GRASS_CHUNK_SIZE;
    const minZ = chunk.cz * GRASS_CHUNK_SIZE;
    const dx = Math.max(minX - camX, 0, camX - (minX + GRASS_CHUNK_SIZE));
    const dz = Math.max(minZ - camZ, 0, camZ - (minZ + GRASS_CHUNK_SIZE));
    // The centre sample is a conservative vertical approximation for a field
    // whose cards hug the terrain. A 3u envelope covers normal within-chunk
    // relief; larger cliff chunks reject grass during construction.
    const dy = Math.max(0, Math.abs(chunk.centerY - camY) - 3);
    return Math.hypot(dx, dy, dz);
  };

  const applyMeshDensity = (
    chunk: GrassChunk,
    mesh: THREE.InstancedMesh | undefined,
    fullCount: number | undefined,
    referenceHeight: number,
    densityFloor: number,
    carryKey: 'grassTransitionCarry' | 'flowerTransitionCarry',
    nearDistance: number,
    cameraDistance: number,
    projectionPixels: number,
    dt: number,
    radius: number,
  ): void => {
    if (!mesh || !fullCount) return;
    const fraction = farFieldDensityFractionForValues(
      nearDistance,
      radius,
      projectedPixelSize(referenceHeight, cameraDistance, projectionPixels),
      densityFloor,
    );
    const target = Math.round(fullCount * fraction);
    // A newly visible cached chunk takes the right prefix before it can
    // render. Continuously visible chunks change by only a few stable,
    // spatially scattered instances per frame. A fully faded chunk can drop
    // immediately because every one of its cards already has zero alpha.
    if (!mesh.visible || target === 0) {
      mesh.count = target;
      chunk[carryKey] = 0;
    } else {
      advanceInstanceCountInto(
        instanceCountStep,
        mesh.count,
        target,
        fullCount,
        dt,
        chunk[carryKey],
      );
      mesh.count = instanceCountStep.count;
      chunk[carryKey] = instanceCountStep.carry;
    }
  };

  const applyChunkDensity = (
    chunk: GrassChunk,
    px: number,
    pz: number,
    cameraDistance: number,
    projectionPixels: number,
    dt: number,
  ): void => {
    const radius = activeRadius();
    const nearDistance = chunkNearDistance(chunk, px, pz);
    applyMeshDensity(
      chunk,
      chunk.mesh,
      chunk.grassFullCount,
      lush ? GRASS_CARD_REFERENCE_HEIGHT_HIGH : GRASS_CARD_REFERENCE_HEIGHT_LOW,
      GFX.farGrassDensityFloor,
      'grassTransitionCarry',
      nearDistance,
      cameraDistance,
      projectionPixels,
      dt,
      radius,
    );
    applyMeshDensity(
      chunk,
      chunk.flowerMesh,
      chunk.flowerFullCount,
      FLOWER_CARD_REFERENCE_HEIGHT,
      Math.max(FLOWER_FAR_DENSITY_FLOOR, GFX.farGrassDensityFloor),
      'flowerTransitionCarry',
      nearDistance,
      cameraDistance,
      projectionPixels,
      dt,
      radius,
    );
  };

  return {
    setQuality(level: number): void {
      quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
      uniforms.uFadeFar.value = activeRadius();
    },
    update(
      px: number,
      pz: number,
      camX: number,
      camY: number,
      camZ: number,
      projectionPixels: number,
      dt: number,
    ): void {
      uniforms.uPlayerPos.value.set(px, pz);
      uniforms.uFadeFar.value = activeRadius();
      if (px > DUNGEON_X_THRESHOLD) {
        // dungeon instances live far outside the strip — no meadow indoors
        if (parent.visible) {
          parent.visible = false;
          for (const chunk of chunks.values()) {
            if (chunk.mesh) chunk.mesh.visible = false;
            if (chunk.flowerMesh) chunk.flowerMesh.visible = false;
          }
        }
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
          queueChunk(chunk);
        }
      }

      buildQueuedChunks();
      for (const chunk of chunks.values()) {
        if (chunk.lastSeen === generation) {
          const cameraDistance = chunkNearCameraDistance(chunk, camX, camY, camZ);
          applyChunkDensity(chunk, px, pz, cameraDistance, projectionPixels, dt);
          if (chunk.mesh) chunk.mesh.visible = true;
          if (chunk.flowerMesh) chunk.flowerMesh.visible = true;
        } else {
          if (chunk.mesh?.visible) chunk.mesh.visible = false;
          if (chunk.flowerMesh?.visible) chunk.flowerMesh.visible = false;
        }
      }
      retireStaleChunks();
    },
    perfStats(out?: FoliagePerfStats): FoliagePerfStats {
      const stats = emptyGrassStats(true, cacheLimit, out);
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

export const foliageGrassInternalsForTest = { buildGrassRing };

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
  ghosts: InstancedOccluderGhosts,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
  dt: number,
  reducedMotion: boolean,
): void {
  // This scans every world tree each frame (3k+ in the shipped field). An
  // indexed loop avoids one iterator result allocation per tree per frame.
  // A tree crossing the eye-to-camera segment swaps its instances for pooled
  // ghost meshes and fades toward 20% opacity; once clear and fully opaque the
  // ghosts return to the pool and the instances come back. The build-time
  // shadow clones are untouched either way, so faded trees keep their shadows.
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const hide = cameraSegmentHitsTree(t, eyeX, eyeY, eyeZ, camX, camY, camZ);
    if (!hide && t.ghosts.length === 0) {
      t.hidden = false;
      t.alpha = 1;
      continue;
    }
    t.hidden = hide;
    if (t.ghosts.length === 0) {
      for (let j = 0; j < t.parts.length; j++) {
        const part = t.parts[j];
        part.mesh.setMatrixAt(part.index, part.hiddenMatrix);
        part.mesh.instanceMatrix.addUpdateRange(part.index * 16, 16);
        part.mesh.instanceMatrix.needsUpdate = true;
        t.ghosts.push(ghosts.acquire(part.mesh, part.index, part.visibleMatrix));
      }
    }
    t.alpha = stepOccluderFade(t.alpha, hide, dt, reducedMotion);
    for (let j = 0; j < t.ghosts.length; j++) ghosts.setAlpha(t.ghosts[j], t.alpha);
    if (!hide && occluderFadeSettled(t.alpha, false)) {
      for (let j = 0; j < t.parts.length; j++) {
        const part = t.parts[j];
        part.mesh.setMatrixAt(part.index, part.visibleMatrix);
        part.mesh.instanceMatrix.addUpdateRange(part.index * 16, 16);
        part.mesh.instanceMatrix.needsUpdate = true;
      }
      for (let j = 0; j < t.ghosts.length; j++) ghosts.release(t.ghosts[j]);
      t.ghosts.length = 0;
    }
  }
}

export function buildFoliage(seed: number, webgl?: THREE.WebGLRenderer): FoliageView {
  const group = new THREE.Group();
  group.name = 'foliage';
  const bucketMeshes: BucketMesh[] = [];
  const treeHideables: TreeHideable[] = [];
  const treeGhosts = new InstancedOccluderGhosts();
  let modelQuality = GFX.bucketBaselines.foliage;
  let modelVisibleBuckets = 0;
  let modelVisibleDraws = 0;
  let modelVisibleTriangles = 0;
  const modelBucketsByLod: Record<string, number> = {};
  const modelDrawsByLod: Record<string, number> = {};
  const modelTrianglesByLod: Record<string, number> = {};
  const modelVisibleByLod: Record<string, number> = {};
  const modelVisibleDrawsByLod: Record<string, number> = {};
  const modelVisibleTrianglesByLod: Record<string, number> = {};
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
  const collapseWindows: CollapseWindowValues = {
    treeMax: 0,
    rockMax: 0,
    dressMax: 0,
    buildingMax: 0,
    fogCull: 0,
    fade: 0,
    spriteFar: 0,
  };
  const session = webgl ? createImpostorSession() : null;
  buildTrees(group, seed, bucketMeshes, treeHideables, session);
  buildDressing(group, seed, bucketMeshes, session);
  // The sprite swap law engages only once sprite meshes really exist: if the
  // bake throws (a grown kit overflowing the atlas, a lost context) the far
  // field falls back to the lean law instead of collapsing real trees with
  // nothing behind them. World entry survives either way.
  let spritesLive = false;
  if (session && webgl) {
    try {
      // Village buildings and skyline decor join the same atlas: the far
      // field shows civilization, not just forest. Placement math comes
      // from props.ts (collectBuildingImpostors) so a sprite is always the
      // asset the near view really renders.
      const buildings = collectBuildingImpostors(seed);
      const buildingRows = new Map<string, number>();
      for (const src of buildings.sources) {
        buildingRows.set(src.asset, session.registerArchetype('building', src.asset, src.parts));
      }
      if (buildings.instances.length > 0) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const inst of buildings.instances) {
          minX = Math.min(minX, inst.x);
          maxX = Math.max(maxX, inst.x);
          minZ = Math.min(minZ, inst.z);
          maxZ = Math.max(maxZ, inst.z);
        }
        const acc = session.bucket(
          'building',
          (minX + maxX) / 2,
          (minZ + maxZ) / 2,
          Math.hypot(maxX - minX, maxZ - minZ) / 2 + 20,
        );
        const white = new THREE.Color(1, 1, 1);
        for (const inst of buildings.instances) {
          const row = buildingRows.get(inst.asset);
          if (row === undefined) continue;
          acc.add(
            row,
            inst.x,
            inst.y,
            inst.z,
            inst.rot,
            inst.widthScale,
            inst.heightScale / Math.max(inst.widthScale, 1e-6),
            white,
          );
        }
      }
      // One atlas bake, then one quad InstancedMesh per (bucket, category):
      // the whole far field costs a handful of draws and 2 triangles per plant.
      for (const reg of session.finalize(webgl, group, seed)) {
        bucketMeshes.push({
          mesh: reg.mesh,
          x: reg.x,
          z: reg.z,
          radius: reg.radius,
          minAtDetail: true,
          lod: 'impostor',
          spriteCategory: reg.category,
          ...bucketMeshCost(reg.mesh),
        });
      }
      spritesLive = true;
    } catch (err) {
      console.error('foliage: impostor bake failed, far field keeps the lean law', err);
    }
  }
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
        perfStats(out?: FoliagePerfStats): FoliagePerfStats {
          return emptyGrassStats(false, 0, out);
        },
      }
    : buildGrassRing(group, seed);
  freezeStaticMatrices(group);
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
      projectionPixels: number,
      dt: number,
      reducedMotion = false,
    ): void {
      grass.update(px, pz, camX, camY, camZ, projectionPixels, dt);
      updateTreeHides(
        treeHideables,
        treeGhosts,
        eyeX,
        eyeY,
        eyeZ,
        camX,
        camY,
        camZ,
        dt,
        reducedMotion,
      );
      // Buckets fully behind the fog wall are pure overdraw. The handoff laws
      // are decided in foliage_impostor_core.ts (sprite arm) and
      // foliage_lod.ts (lean arm) and unit-tested there. The cull tracks the
      // LIVE fog; the handoff tracks the ATMOSPHERE (see the update() doc).
      const distanceScale = foliageDistanceScale(modelQuality, GFX.leanFoliage);
      const fogLimit = foliageFogLimit(fogFar, modelQuality);
      const dists = lodDists();
      const spritesOn = spritesLive;
      // Sprite arm: the handoff follows the budget (sprites are legible in
      // clear air); lean arm: the old fog-blend law, trees end in the murk.
      const detailFar = spritesOn
        ? spriteSwapDistance(
            dists.treeDetailFar,
            distanceScale,
            atmosFogNear,
            atmosFogFar,
            fogLimit,
          )
        : treeDetailDistance(
            dists.treeDetailFar,
            atmosFogNear,
            atmosFogFar,
            distanceScale,
            fogLimit,
          );
      // Real geometry never outlives the foliage cull (the model-quality trim
      // exists to shed triangles); only the SPRITES run past it to the wall.
      const rockSwap = Math.min(dists.rockFar * distanceScale, fogLimit);
      const dressSwap = Math.min(dists.dressFar * distanceScale, fogLimit);
      // Real buildings die with the detail horizon (props band culls), so
      // their sprites step in a little inside it: the overlap band hides
      // behind the real building it pictures.
      const buildingSwap = Math.max(0, fogFar - 40);
      // The vertex shaders enforce these same boundaries per INSTANCE, so a
      // surviving slab no longer drags its whole tree population along with it
      // (foliage_collapse.ts), and each sprite starts where its real twin
      // collapsed (foliage_impostor.ts binds the same uniforms).
      collapseWindows.treeMax = detailFar;
      collapseWindows.rockMax = spritesOn ? rockSwap : fogLimit;
      collapseWindows.dressMax = spritesOn ? dressSwap : fogLimit;
      collapseWindows.buildingMax = spritesOn ? buildingSwap : fogLimit;
      collapseWindows.fogCull = fogLimit;
      collapseWindows.fade = spritesOn ? IMPOSTOR_SWAP_FADE : 0;
      // Sprites run to the view horizon: with outdoor fog gone the renderer
      // passes the whole-world envelope through atmosFogFar, so the far
      // field carries every tree to the world rim; under a live fog (an
      // interior, the lean arm) the wall still bounds them.
      collapseWindows.spriteFar = Math.max(fogFar, atmosFogFar);
      updateCollapseUniforms(collapseWindows);
      modelVisibleBuckets = 0;
      modelVisibleDraws = 0;
      modelVisibleTriangles = 0;
      clearNumberRecord(modelVisibleByLod);
      clearNumberRecord(modelVisibleDrawsByLod);
      clearNumberRecord(modelVisibleTrianglesByLod);
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
        bucketWindow.detailFar =
          b.spriteCategory === 'rock'
            ? rockSwap
            : b.spriteCategory === 'dress'
              ? dressSwap
              : b.spriteCategory === 'building'
                ? buildingSwap
                : detailFar;
        bucketWindow.revealScale = revealScale;
        bucketWindow.fogLimit = fogLimit;
        bucketWindow.spriteRow = b.lod === 'impostor';
        bucketWindow.swapFade = collapseWindows.fade;
        bucketWindow.spriteFar = collapseWindows.spriteFar;
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
    perfStats(out?: FoliagePerfStats): FoliagePerfStats {
      const stats = grass.perfStats(out);
      stats.modelQuality = Math.round(modelQuality * 100) / 100;
      stats.modelBuckets = bucketMeshes.length;
      stats.modelVisibleBuckets = modelVisibleBuckets;
      copyNumberRecord(stats.modelBucketsByLod, modelBucketsByLod);
      copyNumberRecord(stats.modelVisibleByLod, modelVisibleByLod);
      stats.modelDraws = modelDraws;
      stats.modelVisibleDraws = modelVisibleDraws;
      copyNumberRecord(stats.modelDrawsByLod, modelDrawsByLod);
      copyNumberRecord(stats.modelVisibleDrawsByLod, modelVisibleDrawsByLod);
      stats.modelTriangles = modelTriangles;
      stats.modelVisibleTriangles = modelVisibleTriangles;
      copyNumberRecord(stats.modelTrianglesByLod, modelTrianglesByLod);
      copyNumberRecord(stats.modelVisibleTrianglesByLod, modelVisibleTrianglesByLod);
      return stats;
    },
  };
}
