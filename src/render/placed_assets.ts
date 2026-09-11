// Renderer for the map editor's freely placed GLB assets (WorldContent.placements).
// Cosmetic and play-test-only: each placement names a public GLB path; we load it
// once, clone it per placement, normalize its size, and seat it on the terrain.
// Loads are async (the initial batch is registered as preloads); models pop in
// when ready, which is fine because placements never affect gameplay.
//
// The view is a small live instancer keyed by the editor's DOCUMENT placement
// index (an unresolvable id leaves its slot empty rather than shifting later
// ones): addPlacement / updatePlacement / removePlacement mutate one entry,
// removePlacementAt additionally reindexes the survivors after a single doc
// removal, reSeat(region?) re-samples the ground after a sculpt (region-scoped
// at stroke end, everything on load/undo), setSelected() drapes a gold ring
// under one asset, and showFootprints() drapes the collideRadius circle under
// every colliding placement. Everything editor-facing is opt-in; the shipped
// game only ever runs the constructor build.

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import {
  type BakedCollisionBox,
  bakedBoxesForPath,
  collisionOverrideFor,
} from '../sim/asset_collision';
import { legacyAssetFireEmitter } from '../sim/fire_effects';
import {
  GRASS_PATCH_PATH,
  MODEL_PATH,
  ROCK_PATH,
  ROCK_RIDGE_PATH,
  TREE_PATH,
  WATERFALL_PATH,
} from '../sim/map_doc';
import type { AssetFireEmitter, PlacedAsset } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { targetHeightFor } from './asset_scale';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { buildCampfireFlame, CAMPFIRE_FLAME_HEIGHT, campfireFlameScale } from './campfire_flame';
import { foliageFarPlacementsActive } from './foliage';
import { buildFoliageModel } from './foliage_gen';
import { lodDistsFor } from './foliage_lod';
import { GFX, sharedUniforms } from './gfx';
import {
  buildGrassPatchModel,
  DEFAULT_TUFTS_PER_PATCH,
  grassPatchRadius,
  grassPatchSeed,
} from './grass_patch';
import { type InteriorSpec, interiorSpecFor, revealState } from './interior_reveal';
import { buildModelMesh } from './model_gen';
import { placementBatchable } from './placed_batch_core';
import { type BatchSub, PlacedBatches, templateSubs } from './placed_batches';
import { buildRockChainModel, buildRockModel, rockSeed } from './rock_gen';
import { refreshFrozenWorldMatrix } from './static_matrix';
import { type TreeBuild, treeSeed } from './tree_gen';
import {
  LEAF_KIND_MUL,
  LEAF_SHIMMER_YARDS,
  LEAN_FRACTION,
  leafStrengthForMaterialName,
  type SwayKind,
  swayKindForAssetPath,
  treeSwayLeafGlsl,
  treeSwayUniforms,
  treeSwayWaveGlsl,
} from './tree_sway';
import { buildWaterfallModel } from './waterfall';

const RING_SEGMENTS = 40;
const RING_LIFT = 0.08; // yards above the sampled ground, against z-fighting
const SELECTION_COLOR = 0xd4af37; // the classic target-reticle gold
const FOOTPRINT_COLOR = 0xe0503c;
// Extra yards around a sculpt region whose placements still get re-seated: the
// brush falloff softens past its nominal bounds, so seat a small margin too.
const RESEAT_MARGIN = 2;
// GLB emissive channels usually author intensity 1, which lands under the
// bloom threshold (0.85 post-ACES) and reads flat; lift weak ones once per
// template so "glowy" materials actually glow, editor and playtest alike.
const MIN_NATIVE_EMISSIVE_INTENSITY = 2.2;

// Built-in sway for placed tree/bush/palm GLBs (tree_sway.ts).
// Attached ONCE per shared template material; every placement clone shares
// the program. World base comes from modelMatrix (placed clones are plain
// meshes) times instanceMatrix when present (the Palmreach strand renders
// the same palm materials instanced, so its palms sway too when the player
// walks the strand).
//
// Two terms, matching what the procedural foliage does so a placed oak and a
// grown one move alike (the editor promotes foliage into placements, so most
// of a maker's world takes THIS path): a whole-plant lean weighted
// quadratically up the GLB's own vertical span, roots planted, crown carries
// the motion, plus a leaf shimmer on the leaf materials only, sized in world
// yards and divided back through the placement's world scale so it stays a
// flutter on a great oak instead of a metre of thrash.
export function attachPlacedTreeSway(
  object: THREE.Object3D,
  minY: number,
  maxY: number,
  kind: SwayKind,
): void {
  const span = Math.max(0.001, maxY - minY);
  const amp = span * LEAN_FRACTION[kind];
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || mat.userData.wocTreeSway) continue;
      mat.userData.wocTreeSway = true;
      const leaf = leafStrengthForMaterialName(mat.name) * LEAF_KIND_MUL[kind];
      // Bark and stone pay for neither the shimmer sines nor the world-scale
      // sqrt: the whole block is compiled out for them.
      const shimmer =
        leaf > 0
          ? `${treeSwayLeafGlsl(leaf * LEAF_SHIMMER_YARDS, 'wocSwayScale')}
            transformed.x += wocLeafWave * wocBendW;
            transformed.z += wocLeafWave * wocBendW * 0.6;`
          : '';
      const scaleTerm =
        leaf > 0
          ? `#ifdef USE_INSTANCING
              float wocSwayScale = length((modelMatrix * instanceMatrix[1]).xyz);
            #else
              float wocSwayScale = length(modelMatrix[1].xyz);
            #endif`
          : '';
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = sharedUniforms.uTime;
        sh.uniforms.uSwayPlayer = treeSwayUniforms.uSwayPlayer;
        sh.vertexShader = sh.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform vec2 uSwayPlayer;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec4 wocSwayBase4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #else
              vec4 wocSwayBase4 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #endif
            vec2 wocSwayBase = wocSwayBase4.xz;
            ${scaleTerm}
            ${treeSwayWaveGlsl()}
            float wocBendW = clamp((transformed.y - ${minY.toFixed(3)}) / ${span.toFixed(3)}, 0.0, 1.0);
            float wocBend = wocSwayWave * ${amp.toFixed(4)} * wocBendW * wocBendW;
            transformed.x += wocBend;
            transformed.z += wocBend * 0.6;
            ${shimmer}`,
          );
      };
      mat.customProgramCacheKey = () => `${mat.uuid}:woc-tree-sway`;
      // Force a recompile. On a first attach the material has not been built
      // yet and this is redundant, but on a RE-attach (the maker switching sway
      // back on, or undoing the switch-off) it is the whole fix: the material
      // is already compiled against the no-sway program from
      // detachPlacedTreeSway, and without this it silently keeps it, sway
      // never comes back.
      mat.needsUpdate = true;
    }
  });
}

// Undo attachPlacedTreeSway. Needed because the sway hook is installed on the
// SHARED parsed glTF (assets/loader caches one parse per URL for the whole
// session), so a maker turning sway off for an asset cannot simply drop this
// view's template and reload, the same materials would come back still
// carrying the program. Clearing the hook and bumping needsUpdate recompiles
// them without the sway block; the userData flag drops too, so switching sway
// back on re-attaches cleanly.
export function detachPlacedTreeSway(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat?.userData.wocTreeSway) continue;
      delete mat.userData.wocTreeSway;
      mat.onBeforeCompile = () => {};
      mat.customProgramCacheKey = () => `${mat.uuid}:woc-no-sway`;
      mat.needsUpdate = true;
    }
  });
}
// Distance culling (the base game's foliage/props hide by distance; placed
// assets get the same treatment so thousands of decor placements stay cheap).
// EVERY placement hides past this camera distance, and sooner still where the
// fog or the maker's asset view distance is tighter (see updateLod). Placed
// decor is the most expensive per-model class (full-resolution GLB clones), so
// it gets a hard ceiling; generous enough that landmark decor still reads
// across a vista. The cull is a plain hysteresis show/hide: the old opacity
// fade near the edge forced a per-entry clone of every material of every
// placement in the fade shell (plus transparent-pass sorting), which cost far
// more than the pop it hid.
const LOD_RANGE_ASSETS = 500;
/** Collision-footprint overlay range (yards from the camera): the overlay is
 *  a reading aid for the spot being edited, not a map-wide diagram. */
const FOOTPRINT_RANGE = 100;

/** Residency streaming (game hosts on big authored maps): resident radius,
 *  release band, reconcile stride, and the map size that turns it on. The
 *  radius clears every render range (LOD_RANGE_ASSETS + fog margin) so
 *  streaming is invisible, it changes what is MATERIALIZED, never what a
 *  standing player can see. */
const STREAM_RADIUS = 650;
const STREAM_HYSTERESIS = 96;
const STREAM_MIN_PLACEMENTS = 1500;
/** Slots examined per frame and the add/remove ceiling within them. */
const STREAM_SLICE = 800;
const STREAM_OPS_BUDGET = 24;

/** Region residency (setCullBeyond's load/unload half): how many placements
 *  may be released or rebuilt in one frame. Restoring is the expensive
 *  direction, it clones a template, where releasing hands one back, so it
 *  gets the smaller budget. At 48 a frame the Deepglass sheds its 5,317
 *  Tidehold placements in under two seconds of bout, and at 32 it rebuilds
 *  them over the ~100 yards of causeway between the bell and the city wall. */
const REGION_EVICT_BUDGET = 48;
const REGION_RESTORE_BUDGET = 32;

// Editable foliage placements adopt the SHIPPED world's tree/rock handoff:
// the real model ends at the same lodDists plane procedural foliage swaps at,
// and the placement's far-sprite mirror (foliage_far_placements_core.ts,
// injected into the impostor lane) carries it to the fog wall. Without the
// cap a converted forest drew full tree models out to LOD_RANGE_ASSETS, // far past where the game ever draws a real tree, which is exactly the
// frame-time gap between the shipped world and an editable-all map.
const FAR_SPRITE_KIND = new Map<string, 'tree' | 'rock' | null>();
function farSpriteKindFor(path: string | undefined): 'tree' | 'rock' | null {
  if (!path) return null;
  let kind = FAR_SPRITE_KIND.get(path);
  if (kind === undefined) {
    const m = /^\/models\/foliage\/(pine|oak|twisted|dead|rock)_\d+\.glb$/.exec(path);
    kind = m ? (m[1] === 'rock' ? 'rock' : 'tree') : null;
    FAR_SPRITE_KIND.set(path, kind);
  }
  return kind;
}
const LOD_HYSTERESIS = 1.12; // re-show at range, re-hide at range * this
// Spread the distance checks: at most this many entries re-test per frame.
const LOD_BUDGET_PER_FRAME = 400;
// Untrusted maps may carry thousands of placements. Keep the rich visuals
// bounded globally even though each placement is independently sanitized.
const MAX_RENDERED_FIRE_EMITTERS = 64;
// Real-time point lights change the material shader signature as streamed
// assets arrive. Keep that signature bounded; every additional authored fire
// still retains its emissive core and procedural glow even after the light cap.
// How many of the authored fire emitters cast a real PointLight at once.
//
// These lights do NOT go through the renderer's ranked fire-light budget, so
// this count IS `numPointLights` in every lit material's program cache key and
// must never change at runtime. It used to be a FIRST-COME cap, which in a city
// with more than eight lit emitters handed every light to whichever building
// streamed in first and left the rest, the Warden's Keep among them, pitch
// dark inside. The eight lights are a POOL now: they are re-assigned to the
// emitters nearest the player each frame (assignFireLights), so the count stays
// pinned while the light always lands where somebody is standing.
const MAX_RENDERED_FIRE_LIGHTS = 8;

/** What a fire emitter would light with, if it holds one of the pooled lights.
 *  Recorded on the emitter group at build time; read by assignFireLights. */
interface FireLightSpec {
  color: THREE.Color;
  glow: number;
  range: number;
  yOffset: number;
}

/** World-space XZ bounds of a terrain edit (the sculpt stroke region). */
/**
 * A half-plane of the map to drop from the frame entirely: a placement is
 * hidden when `nx * x + nz * z >= d`.
 *
 * Distance culling asks whether the player COULD see a placement from here.
 * This asks a different question, whether it is worth existing for them at
 * all right now, and it is the answer when a wall, not a range, is what hides
 * something. The Deepglass is the case it was written for: from inside the
 * bell, Tidehold stands behind the Tide Gate's curtain wall and behind a
 * hundred yards of water, and 5,317 of that map's 6,127 placements are up
 * there. None of them can be seen from the arena and every one of them was
 * still being submitted.
 */
export interface PlacedCullHalfPlane {
  readonly nx: number;
  readonly nz: number;
  readonly d: number;
}

export interface SeatRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Ordered editor-pick result. `direct` means the pointer ray touched actual
 * rendered geometry; nearby candidates are only the forgiving rapid-cycle
 * tail for small/clustered props. */
export interface PlacedAssetPickCandidate {
  index: number;
  distance: number;
  direct: boolean;
}

/** Whether a placement anchored at (x, z) needs re-seating after a sculpt over `region`. */
export function needsReSeat(
  x: number,
  z: number,
  region: SeatRegion,
  margin = RESEAT_MARGIN,
): boolean {
  return (
    x >= region.minX - margin &&
    x <= region.maxX + margin &&
    z >= region.minZ - margin &&
    z <= region.maxZ + margin
  );
}

/** Grow a running union of edit regions (null accumulator starts the union). */
export function unionRegion(acc: SeatRegion | null, region: SeatRegion): SeatRegion {
  if (!acc) return { ...region };
  return {
    minX: Math.min(acc.minX, region.minX),
    minZ: Math.min(acc.minZ, region.minZ),
    maxX: Math.max(acc.maxX, region.maxX),
    maxZ: Math.max(acc.maxZ, region.maxZ),
  };
}

/**
 * After removing document index `removed` (the key itself must already be
 * deleted), shift every Map key above it down by one so view slots stay in
 * lockstep with document indices. Pure bookkeeping; exported for unit tests.
 */
export function reindexAfterRemoval<T>(entries: Map<number, T>, removed: number): void {
  const above = [...entries.keys()].filter((k) => k > removed).sort((a, b) => a - b);
  for (const k of above) {
    const v = entries.get(k) as T;
    entries.delete(k);
    entries.set(k - 1, v);
  }
}

// Shared unit-box edge geometry for the baked-collision footprint view (one
// LineSegments per baked box, scaled/positioned per placement; the geometry
// and material are module-shared, never disposed per entry).
let boxEdges: THREE.EdgesGeometry | null = null;
function boxEdgesGeometry(): THREE.EdgesGeometry {
  if (!boxEdges) boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  return boxEdges;
}
const bakedFootprintMat = new THREE.LineBasicMaterial({
  color: FOOTPRINT_COLOR,
  transparent: true,
  opacity: 0.9,
  // X-ray: the collision shapes must read THROUGH the model they hug.
  depthTest: false,
  userData: { noWireframe: true },
});
// Collision Master authored mesh volumes draw in the SAME blue as the CM
// studio, so the maker's modeled hitbox is what they see on placements, // never the red derived-box approximation.
const authoredFootprintMat = new THREE.LineBasicMaterial({
  color: 0x37c5ff,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
  userData: { noWireframe: true },
});

// Module-shared geometry for the procedural multi-emitter fire system. Every
// authored emitter owns only its uniforms/materials and tiny ember buffer.
const flamePlaneGeo = new THREE.PlaneGeometry(1, 1.6, 8, 14);
flamePlaneGeo.translate(0, 0.8, 0);
const fireCoreGeo = new THREE.SphereGeometry(0.18, 10, 7);
/** Measured game-to-placed height ratio: lands an unflickered placed campfire
 *  on the game's 1.09yd (0.95 authored x the 1.15 props.ts scale). */
const LEGACY_CAMPFIRE_FLAME_FIT = 0.643;
const smokePuffGeo = new THREE.SphereGeometry(0.5, 9, 7);

const FIRE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uTurbulence;
  uniform float uPhase;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float lift = clamp(uv.y, 0.0, 1.0);
    float wave = sin(uTime * 3.1 + uPhase + uv.y * 8.0) * 0.055;
    wave += sin(uTime * 5.7 + uPhase * 1.7 + uv.y * 14.0) * 0.025;
    p.x += wave * uTurbulence * lift;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FIRE_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uPhase;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uTurbulence;
  uniform vec3 uOuter;
  uniform vec3 uCore;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    float y = clamp(vUv.y, 0.0, 1.0);
    float n1 = noise(vec2(vUv.x * 5.0 + uPhase, y * 6.0 - uTime * 1.7));
    float n2 = noise(vec2(vUv.x * 10.0 - uTime, y * 11.0 - uTime * 2.7 + uPhase));
    float noisy = (n1 * 0.65 + n2 * 0.35 - 0.5) * uTurbulence;
    float taper = mix(0.46, 0.025, pow(clamp(y, 0.0, 1.0), 0.72));
    float body = 1.0 - smoothstep(taper - 0.11, taper + 0.03, abs(vUv.x - 0.5) + noisy * 0.07);
    float tip = 1.0 - smoothstep(0.82 + noisy * 0.12, 1.02, y);
    float base = smoothstep(0.0, 0.08, y);
    float alpha = body * tip * base * uOpacity;
    float hotY = 1.0 - smoothstep(0.05, 0.48, y);
    float hotX = 1.0 - smoothstep(0.0, taper, abs(vUv.x - 0.5));
    float hot = hotY * hotX;
    vec3 color = mix(uOuter, uCore, clamp(hot + n2 * 0.18, 0.0, 1.0));
    color *= 0.75 + uIntensity * 0.45;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// One template per GLB path: the cached scene (cloned per placement, per the
// loader's cache-immutability rule) plus its source-unit bounds.
interface TemplateInfo {
  object: THREE.Object3D;
  norm: number; // source units -> TARGET_HEIGHT normalization factor
  minY: number; // source-unit base offset (seat the lowest point on the ground)
  maxY: number; // source-unit top (fire-effect anchor)
  radiusSrc: number; // source-unit horizontal half-extent (selection ring)
}

interface Entry {
  // Current DOCUMENT index. It follows removePlacementAt reindexing so a mesh
  // hit can resolve by entry identity without scanning every map placement.
  index: number;
  placement: PlacedAsset;
  model: THREE.Object3D | null; // null until the GLB resolves (async pop-in)
  info: TemplateInfo | null;
  footprint: THREE.Object3D | null; // draped ring Mesh, or baked-box wireframe Group
  // Per-entry material clones (created lazily when a shader tweak is set;
  // clones the shared template materials ONCE so overrides never leak).
  ownMats: THREE.Material[] | null;
  // Animated fire effect (placement.fire): flame mesh + ember glow.
  fireFx: THREE.Group | null;
  // Distance-culled this frame (model kept, just hidden).
  lodHidden: boolean;
  // Whether this entry's subtree is matrix-frozen after every transform write
  // (see refreezeMatrices). False only for transform-animated models: waterfall
  // mist sprites reposition in onBeforeRender, and skinned rigs pose via bones.
  freezeStatic: boolean;
  // Drawn as instances in the shared batches instead of as its own GLB clone.
  // `model` is then an EMPTY proxy Group carrying only the transform: every
  // consumer that reads model.position / model.visible / the pick-root parent
  // walk keeps working, and the proxy's matrixWorld is what seats the instance.
  batched: boolean;
  // Set by removePlacement so an in-flight GLB load drops its clone. Checked by
  // IDENTITY (not slot) because removePlacementAt reindexes surviving entries.
  removed: boolean;
  // Generated trees only (see render/tree_gen.ts): the build's own geometry
  // handles, plus the resolved canopy volumes the editor overlay draws.
  treeBuild: TreeBuild | null;
}

/** Triangles under an object: indexed geometry by index count, else by vertex
 *  count, honouring the draw range; an InstancedMesh counts every instance. */
function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const total = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0);
    const range = geo.drawRange;
    const drawn = range.count === Infinity ? total : Math.min(total, range.count);
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    tris += Math.floor(drawn / 3) * inst;
  });
  return tris;
}

export class PlacedAssetsView {
  readonly group: THREE.Group;
  // Ambience animation speed (map "world speed"): scales the placed-fire flicker
  // so authored fire matches the rest of the ambient motion. 1 = shipped speed.
  ambienceScale = 1;
  // Editor shadow cache poke: fired whenever placement geometry appears, moves,
  // or vanishes, so the renderer knows its parked sun-shadow map went stale
  // (renderer.ts wires this to invalidateShadows; null in the shipped game).
  onSceneChanged: (() => void) | null = null;
  // Optional async prepare for a freshly arrived GLB clone (the game renderer
  // wires webgl.compileAsync here when KHR_parallel_shader_compile is
  // available). When set, a streamed-in model joins the scene HIDDEN and turns
  // visible only once its programs report linked, so arrival never compiles
  // shaders inside a live frame. Null (the editor-viewport-less/test builds,
  // or no extension) keeps the old immediate pop-in.
  prepareModel: ((model: THREE.Object3D) => Promise<void>) | null = null;
  private readonly seed: number;
  private readonly entries = new Map<number, Entry>();
  private readonly templates = new Map<string, Promise<TemplateInfo | null>>();
  // One InstancedMesh per (asset sub-mesh, caster) shared by every eligible
  // placement of that asset: the draw-call fix (see render/placed_batches).
  private readonly batches = new PlacedBatches();
  // Instanceable sub-meshes per template path; null = this GLB must be cloned
  // (skinned rig, multi-material mesh, or nothing drawable in it).
  private readonly batchSubs = new Map<string, BatchSub[] | null>();
  private footprintsOn = false;
  private cullBeyond: PlacedCullHalfPlane | null = null;
  /** Every placement this view was built from, kept so the region residency
   *  pass can rebuild what it released. The array is held by reference. */
  private allPlacements: readonly (PlacedAsset | null)[] = [];
  /** Indices released by the region pass, and therefore owed a rebuild when
   *  the line clears. Never touched by the ordinary LOD or stream paths. */
  private readonly regionEvicted = new Set<number>();
  private regionCursor = 0;
  // Imported-model collision bakes (MapDoc.assetCollision), for the footprint
  // view: catalogue assets resolve into the generated table instead.
  private assetCollision: Readonly<Record<string, readonly BakedCollisionBox[]>> | null = null;
  private selected: number | null = null;
  private selectionRing: THREE.Mesh | null = null;
  private lodCursor = 0;
  // Cached document-index list for the per-frame LOD stride. Rebuilt ONLY when
  // the placement set changes (add/remove/reindex/rebuild), never per frame, so
  // updateLod allocates nothing on the hot path (thousands of brushed foliage
  // placements used to churn GC by materializing the key set every frame).
  private lodKeys: number[] = [];
  private lodKeysDirty = true;
  // Last camera position seen by updateLod: the GLB stream priority (nearest
  // placement first) reads it live at every queue dequeue. Null until the
  // first frame, which keeps boot-time ordering FIFO as before.
  private lodCamX: number | null = null;
  private lodCamZ = 0;
  // Placements still waiting on their GLB template, per path, so the loader
  // queue can ask "how close is the nearest placement that wants this file?".
  private readonly waitingByPath = new Map<string, Set<PlacedAsset>>();
  private fireEmitterCount = 0;
  /** The eight pooled fire lights, built once and never added to or removed
   *  from the scene (see MAX_RENDERED_FIRE_LIGHTS). */
  private readonly fireLightPool: THREE.PointLight[] = [];
  /** Reused scratch for the per-frame ranking, so the hot path allocates
   *  nothing once the city has settled. */
  private readonly fireLightCandidates: {
    emitter: THREE.Object3D;
    spec: FireLightSpec;
    d2: number;
  }[] = [];
  // Interior-reveal building clones (render/interior_reveal.ts): the player's
  // position hides their roof/upper-storey groups from inside.
  private readonly reveals: {
    entry: Entry;
    model: THREE.Object3D;
    spec: InteriorSpec;
    h1: THREE.Object3D | null;
    h2: THREE.Object3D | null;
    h3: THREE.Object3D | null;
    state: 0 | 1 | 2 | 3;
  }[] = [];
  private readonly revealTmpM = new THREE.Matrix4();
  private readonly revealTmpV = new THREE.Vector3();
  private readonly pickRoots = new WeakMap<THREE.Object3D, Entry>();
  private readonly pickCenter = new THREE.Vector3();
  private readonly pickOffset = new THREE.Vector3();
  private readonly pickClosest = new THREE.Vector3();
  // The selection ring + footprint rings are editor overlays parented under this
  // (props-categorized) group; noWireframe keeps the editor's Wireframe mode from
  // drawing them as wireframe (viewport applyWireframe honors this flag).
  private readonly selectionMat = new THREE.MeshBasicMaterial({
    color: SELECTION_COLOR,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    userData: { noWireframe: true },
  });
  private readonly footprintMat = new THREE.MeshBasicMaterial({
    color: FOOTPRINT_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    userData: { noWireframe: true },
  });

  constructor(
    placements: readonly (PlacedAsset | null)[],
    seed: number,
    opts?: { streamAround?: { x: number; z: number } },
  ) {
    this.group = new THREE.Group();
    this.group.name = 'placed-assets';
    this.group.add(this.batches.group);
    this.streamCenter = opts?.streamAround ?? null;
    // The fire-light pool, built once and permanently visible: three counts a
    // point light into numPointLights iff it is `visible`, so a pool that grew
    // and shrank would recompile every lit material in the scene. Unused ones
    // sit at intensity 0 (see assignFireLights).
    for (let i = 0; i < MAX_RENDERED_FIRE_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 1.55);
      light.name = `placed-fire-light-${i}`;
      light.castShadow = false;
      this.fireLightPool.push(light);
      this.group.add(light);
    }
    this.seed = seed;
    this.allPlacements = placements;
    if (this.streamCenter && placements.length > STREAM_MIN_PLACEMENTS) {
      // Game host on a big authored map: materialize only the placements
      // around the spawn now (boot stops paying for the whole map) and let
      // streamResidency() bring the rest in as the player travels, the same
      // discipline the editor's zone stream applies to its viewport.
      this.streamSource = placements;
      this.streamResidency(this.streamCenter.x, this.streamCenter.z, STREAM_RADIUS, true);
      this.warmStreamTemplates();
    } else {
      this.rebuildAll(placements, true);
    }
  }

  // ---- game-side residency streaming ---------------------------------------
  // The editor keeps its viewport light by only materializing the placements
  // of the zones around the camera; a game host on a 9k-placement authored
  // map got ALL of them materialized at boot and kept resident forever. This
  // streams the same way: resident within STREAM_RADIUS of the player,
  // released past the hysteresis band. Editor hosts never enable it
  // (rebuildAll clears the source): the zone stream owns residency there.
  //
  // AMORTIZED: a per-frame cursor slice with a hard add/remove budget. The
  // first cut reconciled the WHOLE map in one burst every 32yd of travel,   // a hundred-odd adds in one frame, each dirtying instance buffers and the
  // parked sun-shadow cache, which read as a periodic stutter while moving.
  private streamSource: readonly (PlacedAsset | null)[] | null = null;
  private streamCenter: { x: number; z: number } | null = null;
  private streamCursor = 0;

  /** Reconcile a slice of residency around (camX, camZ), constant, tiny
   *  per-frame work; a full pass completes every ~dozen frames. `force` runs
   *  the whole map in one pass (boot only). */
  streamResidency(camX: number, camZ: number, radius = STREAM_RADIUS, force = false): void {
    const src = this.streamSource;
    if (!src || src.length === 0) return;
    const keep2 = radius * radius;
    const drop2 = (radius + STREAM_HYSTERESIS) * (radius + STREAM_HYSTERESIS);
    const slots = force ? src.length : Math.min(src.length, STREAM_SLICE);
    let ops = 0;
    for (let step = 0; step < slots; step++) {
      this.streamCursor = (this.streamCursor + 1) % src.length;
      const p = src[this.streamCursor];
      if (!p) continue;
      const dx = p.x - camX;
      const dz = p.z - camZ;
      const d2 = dx * dx + dz * dz;
      const resident = this.entries.has(this.streamCursor);
      // preload only for the boot pass (force=true): a mid-travel add is an
      // ordinary async pop-in, never a boot-gate registration.
      // A placement the region pass has ruled out must not be streamed back
      // in behind its back (the two systems are independent, and only their
      // agreement on this test keeps them from fighting).
      if (!resident && d2 <= keep2 && !this.beyondCull(p)) {
        this.addPlacement(this.streamCursor, p, force);
        ops++;
      } else if (resident && d2 > drop2) {
        this.removePlacement(this.streamCursor);
        ops++;
      }
      if (!force && ops >= STREAM_OPS_BUDGET) break;
    }
  }

  /** Boot warm-up: start every unique GLB fetch now (deduped by the template
   *  cache), so a placement streaming in later clones a cached template
   *  instead of hitching on a network fetch mid-travel. */
  private warmStreamTemplates(): void {
    const src = this.streamSource;
    if (!src) return;
    const seen = new Set<string>();
    for (const p of src) {
      if (!p || seen.has(p.path)) continue;
      seen.add(p.path);
      void this.template(p.path);
    }
  }

  /**
   * WoW-style interior reveal: hide the roof (and on the ground storey, the
   * upper floor) of whichever reveal-enabled building the player stands in.
   * Player position in world yards; returns true when any visibility flipped
   * so the caller can invalidate its parked shadow map.
   */
  /** Hand the eight pooled lights to the nearest lit emitters. Called every
   *  frame with the player position, alongside the interior-reveal pass.
   *
   *  Ranking is by squared distance to the player, over the emitters that are
   *  visible and advertise a spec. Every pool light stays in the scene and
   *  stays `visible` whatever happens, an unused one simply sits at intensity
   *  0, because the VISIBLE count is what three bakes into the program key. */
  private assignFireLights(px: number, py: number, pz: number): void {
    const cands = this.fireLightCandidates;
    cands.length = 0;
    for (const root of this.group.children) {
      if (root.name !== 'placed-fire-effects' || !root.visible) continue;
      for (const emitter of root.children) {
        const spec = emitter.userData.fireLightSpec as FireLightSpec | undefined;
        if (!spec || !emitter.visible) continue;
        const dx = emitter.position.x - px;
        const dy = emitter.position.y + spec.yOffset - py;
        const dz = emitter.position.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Outside its own falloff a light contributes nothing, so it never
        // competes for a slot with one the player is standing next to.
        if (d2 > spec.range * spec.range) continue;
        cands.push({ emitter, spec, d2 });
      }
    }
    cands.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.fireLightPool.length; i++) {
      const light = this.fireLightPool[i];
      const pick = cands[i];
      if (!pick) {
        light.intensity = 0;
        continue;
      }
      const { emitter, spec } = pick;
      light.color.copy(spec.color);
      light.distance = spec.range;
      light.position.set(emitter.position.x, emitter.position.y + spec.yOffset, emitter.position.z);
      const pulse = (emitter.userData.fireLightPulse as number | undefined) ?? 1;
      light.intensity = spec.glow * pulse;
    }
  }

  updateInteriorReveal(px: number, py: number, pz: number): boolean {
    this.assignFireLights(px, py, pz);
    let changed = false;
    for (let i = this.reveals.length - 1; i >= 0; i--) {
      const r = this.reveals[i];
      if (r.entry.removed || r.entry.model !== r.model || !r.model.parent) {
        this.reveals.splice(i, 1);
        continue;
      }
      const v = this.revealTmpV.set(px, py, pz);
      v.applyMatrix4(this.revealTmpM.copy(r.model.matrixWorld).invert());
      const state = revealState(r.spec, v.x, v.y, v.z);
      if (state === r.state) continue;
      r.state = state;
      if (r.h1) r.h1.visible = state !== 1;
      if (r.h3) r.h3.visible = state === 0 || state === 3; // the third storey: hidden from both floors under it
      if (r.h2) r.h2.visible = state === 0;
      changed = true;
    }
    return changed;
  }

  /** Release every placement clone and editor overlay owned by this view. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.removed = true;
      this.dropFireFx(entry);
    }
    this.entries.clear();
    this.reveals.length = 0;
    this.templates.clear();
    this.batches.clear();
    this.batchSubs.clear();
    this.waitingByPath.clear();
    this.lodKeys.length = 0;
    for (const light of this.fireLightPool) light.dispose();
    this.fireLightPool.length = 0;
    this.fireLightCandidates.length = 0;
    this.group.clear();
    this.selectionRing?.geometry.dispose();
    this.selectionRing = null;
    this.selectionMat.dispose();
    this.footprintMat.dispose();
    this.setGhostAsset(null);
    this.ghostOkMat.dispose();
    this.ghostBadMat.dispose();
  }

  // -------------------------------------------------------------------------
  // City Build ghost: ONE translucent preview clone that follows the cursor
  // before a kit piece or prefab anchor is committed. Never part of entries,
  // never pickable, and green vs red comes from swapping two shared materials.
  // -------------------------------------------------------------------------
  private ghostModel: THREE.Object3D | null = null;
  private ghostPath: string | null = null;
  private ghostInfo: TemplateInfo | null = null;
  private ghostToken = 0;
  private ghostBlocked = false;
  private readonly ghostOkMat = new THREE.MeshStandardMaterial({
    color: 0x59c46a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    userData: { noWireframe: true },
  });
  private readonly ghostBadMat = new THREE.MeshStandardMaterial({
    color: 0xd2564a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    userData: { noWireframe: true },
  });

  /** Show (or clear, with null) the ghost preview for a catalogue GLB path. */
  setGhostAsset(path: string | null): void {
    if (path === this.ghostPath) return;
    this.ghostToken++;
    if (this.ghostModel) {
      this.group.remove(this.ghostModel);
      this.ghostModel = null;
    }
    this.ghostPath = path;
    this.ghostInfo = null;
    if (!path) return;
    const token = this.ghostToken;
    this.template(path).then((info) => {
      if (!info || token !== this.ghostToken) return;
      const model = info.object.clone(true);
      const mat = this.ghostBlocked ? this.ghostBadMat : this.ghostOkMat;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = mat;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.raycast = () => {};
        }
      });
      model.visible = false;
      this.ghostModel = model;
      this.ghostInfo = info;
      this.group.add(model);
    });
  }

  /** Move the ghost to a world point; blocked flips the tint red. groundY
   *  overrides terrain seating (the connect-tiles height anchor). */
  updateGhost(
    x: number,
    z: number,
    rotY: number,
    scale: number,
    blocked: boolean,
    groundY?: number,
  ): void {
    if (blocked !== this.ghostBlocked) {
      this.ghostBlocked = blocked;
      const mat = blocked ? this.ghostBadMat : this.ghostOkMat;
      this.ghostModel?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = mat;
      });
    }
    const model = this.ghostModel;
    const info = this.ghostInfo;
    if (!model || !info) return;
    const s = info.norm * scale;
    model.visible = true;
    model.scale.setScalar(s);
    model.rotation.set(0, rotY, 0);
    const ground = groundY ?? terrainHeight(x, z, this.seed);
    model.position.set(x, ground - info.minY * s, z);
  }

  hideGhost(): void {
    if (this.ghostModel) this.ghostModel.visible = false;
  }

  /**
   * World-yard bounds of a catalogue asset at placement scale 1 (after the
   * TARGET_HEIGHT normalization). City Build fits wall segments, walk decks,
   * and stairs with it.
   */
  async assetFootprint(
    path: string,
  ): Promise<{ sizeX: number; sizeZ: number; sizeY: number } | null> {
    const info = await this.template(path);
    if (!info) return null;
    const box = new THREE.Box3().setFromObject(info.object);
    const size = new THREE.Vector3();
    box.getSize(size);
    return { sizeX: size.x * info.norm, sizeZ: size.z * info.norm, sizeY: size.y * info.norm };
  }

  /** Insert (or replace) the placement rendered at this editor index. */
  addPlacement(index: number, placedAsset: PlacedAsset, preload = false): void {
    this.removePlacement(index);
    const entry: Entry = {
      index,
      placement: { ...placedAsset },
      model: null,
      info: null,
      footprint: null,
      ownMats: null,
      fireFx: null,
      lodHidden: false,
      freezeStatic: true,
      batched: false,
      removed: false,
      treeBuild: null,
    };
    this.entries.set(index, entry);
    this.lodKeysDirty = true;
    // The collide footprint only needs the record, not the GLB: show it now.
    this.refreshFootprint(entry);
    // Procedural grass patches skip the GLB pipeline entirely: built here,
    // synchronously, with norm 1 (the patch authors its own source-unit size).
    if (entry.placement.path === GRASS_PATCH_PATH) {
      const p = entry.placement;
      const model = buildGrassPatchModel(p.hue, p.lum, p.clump, grassPatchSeed(p.x, p.z));
      entry.model = model;
      entry.info = {
        object: model,
        norm: 1,
        minY: 0,
        maxY: 0.6,
        radiusSrc: Math.max(0.6, grassPatchRadius(p.clump ?? DEFAULT_TUFTS_PER_PATCH)),
      };
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Procedural generated rocks (see render/rock_gen.ts): a seeded displaced
    // icosphere, rebuilt from the placement's rock* params, synchronously.
    if (entry.placement.path === ROCK_PATH) {
      const p = entry.placement;
      const model = buildRockModel({
        rockSeed: p.rockSeed ?? rockSeed(p.x, p.z),
        rockNoise: p.rockNoise,
        rockDetail: p.rockDetail,
        rockSharp: p.rockSharp,
        rockTex: p.rockTex,
        rockHeight: p.rockHeight,
        rockDepth: p.rockDepth,
        rockJag: p.rockJag,
        rockTexId: p.rockTexId,
        rockTexTile: p.rockTexTile,
        worldSize: 2.4 * (p.scale || 1),
      });
      const box = model.geometry.boundingBox as THREE.Box3;
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      // Ground embed: report a raised source floor so the seat calculation
      // sinks that fraction of the rock below the terrain line.
      const embed = Math.min(1, Math.max(0, p.rockDepth ?? 0)) * size.y * 0.7;
      entry.model = model;
      entry.info = {
        object: model,
        // Rocks land at believable boulder size (the foliage rock height).
        norm: 2.4 / maxDim,
        minY: box.min.y + embed,
        maxY: box.max.y,
        radiusSrc: Math.max(size.x, size.z) / 2 || 1,
      };
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyMaterialOverride(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Merged rock ridge (one solid body lofted along the chain's nodes). The
    // node offsets are authored in world units relative to the anchor, so the
    // model needs no normalization (norm 1); node dy values already carry the
    // deck line, and minY 0 seats local origin on the anchor's ground.
    if (entry.placement.path === ROCK_RIDGE_PATH) {
      const p = entry.placement;
      const nodes = p.rockNodes ?? [];
      if (nodes.length < 2) return;
      const model = buildRockChainModel(nodes, {
        rockSeed: p.rockSeed ?? rockSeed(p.x, p.z),
        rockNoise: p.rockNoise,
        rockDetail: p.rockDetail,
        rockSharp: p.rockSharp,
        rockTex: p.rockTex,
        rockJag: p.rockJag,
        rockTexId: p.rockTexId,
        rockTexTile: p.rockTexTile,
      });
      const box = model.geometry.boundingBox as THREE.Box3;
      const size = new THREE.Vector3();
      box.getSize(size);
      entry.model = model;
      entry.info = {
        object: model,
        norm: 1,
        minY: 0,
        maxY: box.max.y,
        radiusSrc: Math.max(size.x, size.z) / 2 || 1,
      };
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyMaterialOverride(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Custom built model (see render/model_gen.ts): the maker's hand-modeled
    // volumes fused into one textured solid. Authored in world yards, so norm 1
    // and the geometry's own min Y seats it on the terrain like a real object.
    if (entry.placement.path === MODEL_PATH) {
      const p = entry.placement;
      const meshes = p.meshes ?? [];
      if (meshes.length === 0) return;
      const model = buildModelMesh({
        meshes: meshes.map((m) => ({ verts: [...m.verts], tris: [...m.tris], ramp: m.ramp })),
        modelTexId: p.modelTexId,
        modelTexTile: p.modelTexTile,
        modelHue: p.modelHue,
        modelSat: p.modelSat,
        modelLight: p.modelLight,
      });
      const box = model.geometry.boundingBox as THREE.Box3;
      const size = new THREE.Vector3();
      box.getSize(size);
      entry.model = model;
      entry.info = {
        object: model,
        norm: 1,
        // Seat the model's LOCAL origin (y=0) on the terrain, NOT its lowest
        // vertex: authored Y is meaningful (a floor at y=0 sits on the ground, a
        // foundation dipping below embeds), so the edit overlay and the derived
        // collision boxes line up with the solid.
        minY: 0,
        maxY: box.max.y,
        radiusSrc: Math.max(size.x, size.z) / 2 || 1,
      };
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyMaterialOverride(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Generated foliage (see render/foliage_gen.ts). Branches, canopy volumes
    // and the leaf scatter are grown synchronously from the placement's `tree`
    // recipe; for a tree the foundation trunk GLB streams in behind them and
    // joins the group when it lands. Authored in yards, so norm 1 like the
    // built model. A recipe with no `kind` is a tree, which is what every
    // placement authored before the generator grew bushes and grass is.
    if (entry.placement.path === TREE_PATH) {
      const p = entry.placement;
      const params = { ...(p.tree ?? {}) };
      if (params.seed === undefined) params.seed = treeSeed(p.x, p.z);
      const built = buildFoliageModel(params, (path) =>
        loadGltf(path).then((gltf) => gltf.scene.clone(true)),
      );
      entry.model = built.group;
      entry.treeBuild = built;
      entry.info = {
        object: built.group,
        norm: 1,
        minY: 0,
        maxY: built.height,
        radiusSrc: Math.max(built.collideRadius, 0.2),
      };
      this.group.add(built.group);
      this.markPickRoot(entry, built.group);
      this.applyTransform(entry);
      this.applyMaterialOverride(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Procedural waterfalls likewise (see render/waterfall.ts): the animated
    // sheet + pool, authored in source units, stretched by scale/scaleY.
    if (entry.placement.path === WATERFALL_PATH) {
      const model = buildWaterfallModel();
      // Mist sprites reposition themselves in onBeforeRender: never freeze.
      entry.freezeStatic = false;
      entry.model = model;
      entry.info = { object: model, norm: 1, minY: 0, maxY: 5, radiusSrc: 2 };
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyFireFx(entry);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    // Register with the stream-priority index BEFORE the load is queued so the
    // very first pump already sees this placement's distance.
    let waiting = this.waitingByPath.get(entry.placement.path);
    if (!waiting) {
      waiting = new Set();
      this.waitingByPath.set(entry.placement.path, waiting);
    }
    waiting.add(entry.placement);
    const task = this.template(entry.placement.path).then((info) => {
      this.unregisterWaiting(entry.placement);
      // Removed or replaced while the GLB was in flight: drop the clone.
      if (!info || entry.removed) return;
      // The instanced path: an ordinary static placement of an instanceable
      // GLB draws from the shared batches, so N copies of one asset cost one
      // draw per sub-mesh instead of N clone subtrees. `model` becomes an empty
      // proxy that carries only the transform (see Entry.batched).
      // Interior-reveal buildings are NEVER batched: hiding one instance's
      // roof needs a per-clone scene graph (see render/interior_reveal.ts).
      const subs = this.subsFor(entry.placement.path, info.object);
      if (subs && placementBatchable(entry.placement) && !interiorSpecFor(entry.placement.path)) {
        const proxy = new THREE.Group();
        proxy.name = 'placed-instance';
        entry.model = proxy;
        entry.info = info;
        entry.batched = true;
        this.group.add(proxy);
        this.markPickRoot(entry, proxy);
        this.applyTransform(entry); // composes the proxy and seats the instance
        this.applyFireFx(entry);
        this.refreshFootprint(entry);
        if (this.selected !== null && this.entries.get(this.selected) === entry) {
          this.refreshSelection();
        }
        return;
      }
      // Rigged models (characters) need SkeletonUtils.clone: a naive clone
      // shares bind state with the template and renders nothing. Skinned
      // meshes also skip frustum culling (their bounds ignore the bind pose).
      let skinned = false;
      info.object.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
      });
      const model = skinned ? skeletonClone(info.object) : info.object.clone(true);
      // Skinned rigs pose through their bone hierarchy: never matrix-freeze.
      if (skinned) entry.freezeStatic = false;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
        }
      });
      entry.model = model;
      entry.info = info;
      this.group.add(model);
      this.markPickRoot(entry, model);
      this.applyTransform(entry);
      this.applyMaterialOverride(entry);
      this.applyFireFx(entry);
      this.refreshFootprint(entry);
      const revealSpec = interiorSpecFor(entry.placement.path);
      if (revealSpec) {
        this.reveals.push({
          entry,
          model,
          spec: revealSpec,
          h1: model.getObjectByName('G_H1') ?? null,
          h2: model.getObjectByName('G_H2') ?? null,
          h3: model.getObjectByName('G_H3') ?? null,
          state: 0,
        });
      }
      // With a prepare hook, the fresh clone stays HIDDEN until its programs
      // have linked off-thread; its first visible frame then draws without a
      // synchronous compile stall. Without one, it appears immediately.
      if (this.prepareModel) {
        model.visible = false;
        const reveal = (): void => {
          if (entry.removed) return;
          model.visible = !entry.lodHidden;
        };
        this.prepareModel(model).then(reveal, reveal);
      }
      // By identity, not the captured slot: reindexing may have shifted it.
      if (this.selected !== null && this.entries.get(this.selected) === entry) {
        this.refreshSelection();
      }
    });
    // Boot-time builds gate the loading screen; live editor adds do not. Eager by
    // nature: this runs while the world is being built, not at module import, so
    // `task` is already in flight and there is nothing for the deferred lane to hold.
    if (preload) registerPreload(task);
  }

  /** Move/rotate/rescale the placement at `index` (fields left undefined keep).
   *  `collideRadius` is the EFFECTIVE footprint radius (0 or less = none), so
   *  the editor's collide/radius edits repaint the ring without a rebuild. */
  updatePlacement(
    index: number,
    change: {
      x?: number;
      z?: number;
      rotY?: number;
      scale?: number;
      collideRadius?: number;
      collideShape?: 'square' | null;
      rotX?: number;
      rotZ?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      y?: number;
      detached?: boolean;
      groundY?: number;
      tint?: number | null;
      opacity?: number | null;
      glow?: number | null;
      glowStrength?: number | null;
      fire?: boolean | null;
      fireEffects?: readonly AssetFireEmitter[] | null;
      collideCustom?: boolean;
      hitboxes?: PlacedAsset['hitboxes'] | null;
    },
  ): void {
    const entry = this.entries.get(index);
    if (!entry) return;
    const p = entry.placement;
    if (change.collideCustom !== undefined) {
      if (change.collideCustom) p.collideCustom = true;
      else delete p.collideCustom;
    }
    if (change.hitboxes !== undefined) {
      if (change.hitboxes && change.hitboxes.length > 0) p.hitboxes = change.hitboxes;
      else delete p.hitboxes;
    }
    if (change.detached !== undefined) p.detached = change.detached;
    if (change.groundY !== undefined) p.groundY = change.groundY;
    if (change.x !== undefined) p.x = change.x;
    if (change.z !== undefined) p.z = change.z;
    if (change.rotY !== undefined) p.rotY = change.rotY;
    if (change.collideShape !== undefined) {
      if (change.collideShape === 'square') p.collideShape = 'square';
      else delete p.collideShape;
    }
    let matsTouched = false;
    for (const key of ['tint', 'opacity', 'glow', 'glowStrength'] as const) {
      if (change[key] === undefined) continue;
      matsTouched = true;
      const v = change[key];
      if (v === null) delete p[key];
      else p[key] = v;
    }
    if (matsTouched) this.applyMaterialOverride(entry);
    if (change.fire !== undefined) {
      if (change.fire) p.fire = true;
      else delete p.fire;
    }
    if (change.fireEffects !== undefined) {
      if (change.fireEffects && change.fireEffects.length > 0) {
        p.fireEffects = change.fireEffects.map((fx) => ({ ...fx }));
      } else delete p.fireEffects;
    }
    if (change.fire !== undefined || change.fireEffects !== undefined) this.applyFireFx(entry);
    if (change.scale !== undefined) p.scale = change.scale;
    if (change.rotX !== undefined) p.rotX = change.rotX;
    if (change.rotZ !== undefined) p.rotZ = change.rotZ;
    if (change.scaleX !== undefined) p.scaleX = change.scaleX;
    if (change.scaleY !== undefined) p.scaleY = change.scaleY;
    if (change.scaleZ !== undefined) p.scaleZ = change.scaleZ;
    if (change.y !== undefined) p.y = change.y;
    if (change.collideRadius !== undefined) {
      if (change.collideRadius > 0) p.collideRadius = change.collideRadius;
      else delete p.collideRadius;
    }
    // A per-placement tint/opacity/glow (or authored fire) needs its OWN
    // material clones and per-frame hooks, which an instance cannot carry.
    // Rebuild just this placement as a clone -- its template is already cached,
    // so it comes straight back -- and leave its siblings sharing the batch.
    // Checked LAST, after every field above landed, so the rebuild carries the
    // whole change rather than only the part applied before the bail-out.
    if (entry.batched && !placementBatchable(p)) {
      this.addPlacement(index, p);
      if (this.selected === index) this.refreshSelection();
      return;
    }
    this.applyTransform(entry);
    this.refreshFootprint(entry);
    if (this.selected === index) this.refreshSelection();
  }

  removePlacement(index: number): void {
    const entry = this.entries.get(index);
    if (!entry) return;
    entry.removed = true;
    this.unregisterWaiting(entry.placement);
    this.entries.delete(index);
    this.lodKeysDirty = true;
    // Release the instance slots BEFORE the proxy goes: the batch swaps its
    // last live instance into the hole, so nothing stale is left submitted.
    if (entry.batched) this.batches.detach(index);
    if (entry.model) this.group.remove(entry.model);
    // Clones share the loader-cached template geometry/materials: never dispose
    // them here. The draped rings are per-entry allocations, so those we do,
    // and a grass patch's instance buffers are per-entry too (its geometry and
    // material stay shared).
    if (entry.placement.path === GRASS_PATCH_PATH && entry.model) {
      (entry.model as THREE.InstancedMesh).dispose();
    }
    // A generated rock's geometry is per-entry (its material is shared).
    if (
      (entry.placement.path === ROCK_PATH || entry.placement.path === ROCK_RIDGE_PATH) &&
      entry.model
    ) {
      (entry.model as THREE.Mesh).geometry.dispose();
    }
    // A built model's fused geometry is per-entry (its texture material is shared).
    if (entry.placement.path === MODEL_PATH && entry.model) {
      (entry.model as THREE.Mesh).geometry.dispose();
    }
    // A generated tree owns its branch geometry and its leaf quad + instance
    // buffers; its bark and leaf materials are shared and cached by key.
    if (entry.treeBuild) {
      entry.model?.traverse((o) => {
        const inst = o as THREE.InstancedMesh;
        if (inst.isInstancedMesh) inst.dispose();
      });
      entry.treeBuild.dispose();
      entry.treeBuild = null;
    }
    // A waterfall's sheet/pool geometry + materials are module-shared; only
    // its mist sprite materials are per-model.
    if (entry.placement.path === WATERFALL_PATH && entry.model) {
      entry.model.traverse((o) => {
        if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
      });
    }
    if (entry.ownMats) for (const m of entry.ownMats) m.dispose();
    this.dropFireFx(entry);
    this.dropFootprint(entry);
    if (this.selected === index) this.setSelected(null);
    this.onSceneChanged?.();
  }

  /**
   * Surgical single removal at a DOCUMENT index: drop the entry (if the id ever
   * resolved) and shift every entry above it down by one so view slots stay in
   * lockstep with document indices, without re-cloning the untouched models.
   * Bulk structural changes (load/paste/undo/mid-list insert) use rebuildAll.
   */
  removePlacementAt(index: number): void {
    this.removePlacement(index);
    reindexAfterRemoval(this.entries, index);
    for (const [nextIndex, entry] of this.entries) entry.index = nextIndex;
    // The batches address instances by document index too. Ascending order, so
    // a rename never writes over an id that is still live under its old number
    // (SlotTable.rename documents the same rule).
    for (const nextIndex of [...this.entries.keys()].sort((a, b) => a - b)) {
      if (nextIndex >= index) this.batches.rename(nextIndex + 1, nextIndex);
    }
    this.lodKeysDirty = true;
    if (this.selected !== null && this.selected > index) {
      this.selected--;
      this.refreshSelection();
    }
  }

  /** Drape a gold ring under one placement (null clears). */
  setSelected(index: number | null): void {
    this.selected = index;
    this.refreshSelection();
  }

  /**
   * Triangles in one placement's model (the editor's "Selected polygons"
   * readout). Counted on the MODEL, not the frame: a batched placement draws
   * from the shared instance buffers and its own `model` is an empty proxy, so
   * the template is what carries its geometry; a cloned or generated model
   * (rocks, trees, built solids) carries its own. Template counts are cached
   * per GLB path; 0 while the GLB is still streaming in.
   */
  triangleCount(index: number): number {
    const entry = this.entries.get(index);
    if (!entry) return 0;
    if (entry.batched || !entry.model) {
      const info = entry.info;
      if (!info) return 0;
      const path = entry.placement.path;
      let n = this.templateTris.get(path);
      if (n === undefined) {
        n = countTriangles(info.object);
        this.templateTris.set(path, n);
      }
      return n;
    }
    return countTriangles(entry.model);
  }
  private readonly templateTris = new Map<string, number>();

  /** Tag a rendered root with its stable entry identity. Descendant mesh hits
   * walk to this direct group child, then read the entry's current doc index. */
  private markPickRoot(entry: Entry, root: THREE.Object3D): void {
    this.pickRoots.set(root, entry);
  }

  /** Resolve one raycast hit to its entry, instanced or cloned. A batched
   *  placement is hit as an instance of a shared mesh, so the slot -> id map is
   *  the only way back to the document; clones keep the pick-root parent walk. */
  private entryFromHit(hit: THREE.Intersection): Entry | null {
    if (hit.instanceId !== undefined && hit.instanceId !== null) {
      const id = this.batches.idAt(hit.object, hit.instanceId);
      if (id !== null) {
        const entry = this.entries.get(id);
        return entry && !entry.removed && !entry.lodHidden ? entry : null;
      }
    }
    return this.entryFromPickObject(hit.object);
  }

  private entryFromPickObject(object: THREE.Object3D): Entry | null {
    let root: THREE.Object3D | null = object;
    while (root?.parent && root.parent !== this.group) root = root.parent;
    if (!root || root.parent !== this.group) return null;
    const entry = this.pickRoots.get(root);
    return entry && !entry.removed && entry.model?.visible !== false ? entry : null;
  }

  private pickRadius(entry: Entry): number {
    const info = entry.info;
    if (!info) return 0.5;
    const p = entry.placement;
    const scale = this.worldScale(entry);
    const horizontal = info.radiusSrc * scale * Math.max(p.scaleX ?? 1, p.scaleZ ?? 1);
    const vertical = ((info.maxY - info.minY) * scale * Math.max(0.05, p.scaleY ?? 1)) / 2;
    return Math.max(0.35, horizontal, vertical);
  }

  private pickWorldPerPixel(
    distance: number,
    viewportHeightPx: number,
    verticalFovDeg: number,
    orthographicViewHeight?: number,
  ): number {
    if (orthographicViewHeight !== undefined) {
      return Math.max(0.0001, orthographicViewHeight) / Math.max(1, viewportHeightPx);
    }
    return (
      (2 * Math.max(0.02, distance) * Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2)) /
      Math.max(1, viewportHeightPx)
    );
  }

  /** Exact geometry hits followed by small-prop candidates close to the same
   * pointer ray. Exact hits always win the first click; rapid clicks can then
   * walk the nearby tail from camera-near to camera-far. */
  pickCandidates(
    raycaster: THREE.Raycaster,
    viewportHeightPx: number,
    verticalFovDeg: number,
    orthographicViewHeight?: number,
    maxDepth = 10,
  ): PlacedAssetPickCandidate[] {
    const direct: PlacedAssetPickCandidate[] = [];
    const seen = new Set<number>();
    for (const hit of raycaster.intersectObject(this.group, true)) {
      const entry = this.entryFromHit(hit);
      if (!entry || seen.has(entry.index)) continue;
      seen.add(entry.index);
      direct.push({ index: entry.index, distance: hit.distance, direct: true });
      if (direct.length >= maxDepth) return direct;
    }

    const nearby: PlacedAssetPickCandidate[] = [];
    const ray = raycaster.ray;
    for (const entry of this.entries.values()) {
      if (seen.has(entry.index) || entry.removed || !entry.model?.visible || !entry.info) continue;
      const scale = this.worldScale(entry);
      const p = entry.placement;
      const height = (entry.info.maxY - entry.info.minY) * scale * Math.max(0.05, p.scaleY ?? 1);
      this.pickCenter.set(
        entry.model.position.x,
        entry.model.position.y + height * 0.5,
        entry.model.position.z,
      );
      this.pickOffset.subVectors(this.pickCenter, ray.origin);
      const distance = this.pickOffset.dot(ray.direction);
      if (distance <= 0) continue;
      this.pickClosest.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
      const radius = this.pickRadius(entry);
      // An 18px halo keeps bushes and tightly stacked props reachable without
      // letting a click jump to unrelated scenery at wide camera distances.
      const halo =
        this.pickWorldPerPixel(distance, viewportHeightPx, verticalFovDeg, orthographicViewHeight) *
        18;
      if (this.pickCenter.distanceToSquared(this.pickClosest) > (radius + halo) ** 2) continue;
      nearby.push({ index: entry.index, distance, direct: false });
    }
    nearby.sort((a, b) => a.distance - b.distance || a.index - b.index);
    return direct.concat(nearby).slice(0, maxDepth);
  }

  /** Cheap hover affordance: bounding-volume math only, never GLB triangle
   * raycasts. Clicks still use pickCandidates() for exact visible geometry. */
  hasCandidateNearRay(
    raycaster: THREE.Raycaster,
    viewportHeightPx: number,
    verticalFovDeg: number,
    orthographicViewHeight?: number,
  ): boolean {
    const ray = raycaster.ray;
    for (const entry of this.entries.values()) {
      if (entry.removed || !entry.model?.visible || !entry.info) continue;
      const scale = this.worldScale(entry);
      const p = entry.placement;
      const height = (entry.info.maxY - entry.info.minY) * scale * Math.max(0.05, p.scaleY ?? 1);
      this.pickCenter.set(
        entry.model.position.x,
        entry.model.position.y + height * 0.5,
        entry.model.position.z,
      );
      this.pickOffset.subVectors(this.pickCenter, ray.origin);
      const distance = this.pickOffset.dot(ray.direction);
      if (distance <= 0) continue;
      this.pickClosest.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
      const halo =
        this.pickWorldPerPixel(distance, viewportHeightPx, verticalFovDeg, orthographicViewHeight) *
        12;
      const radius = this.pickRadius(entry) + halo;
      if (this.pickCenter.distanceToSquared(this.pickClosest) <= radius * radius) return true;
    }
    return false;
  }

  /** Imported-model bakes for the footprint view (doc assetCollision map). */
  /**
   * Re-apply the per-asset wind-sway decision (tree_sway.ts
   * setSwayDisabledAssets) to every template this view has already loaded, so
   * the editor's toggle lands on the placements standing in the scene instead
   * of only on the next map load. Templates not yet loaded pick the decision up
   * on arrival. Call AFTER setSwayDisabledAssets.
   */
  refreshSway(): void {
    for (const [path, pending] of this.templates) {
      void pending.then((info) => {
        if (!info) return;
        const kind = swayKindForAssetPath(path);
        if (kind) attachPlacedTreeSway(info.object, info.minY, info.maxY, kind);
        else detachPlacedTreeSway(info.object);
      });
    }
  }

  setAssetCollision(map: Readonly<Record<string, readonly BakedCollisionBox[]>> | null): void {
    this.assetCollision = map;
    if (this.footprintsOn) for (const entry of this.entries.values()) this.refreshFootprint(entry);
  }

  /** Editor-only: show/hide every colliding placement's collideRadius circle. */
  showFootprints(on: boolean): void {
    if (this.footprintsOn === on) return;
    this.footprintsOn = on;
    for (const entry of this.entries.values()) this.refreshFootprint(entry);
  }

  /**
   * Re-seat placements on the CURRENT terrainHeight (after a sculpt). With a
   * `region` (the stroke bounds), only placements anchored inside it (plus a
   * small margin) re-sample the ground and re-drape their footprint; the rest
   * are untouched, so a stroke-end never scans every placement on a big map.
   * Without one, everything re-seats (map load / undo paths).
   */
  reSeat(region?: SeatRegion): void {
    for (const entry of this.entries.values()) {
      const p = entry.placement;
      if (region && !needsReSeat(p.x, p.z, region)) continue;
      // Detached placements float free: a nearby sculpt must not re-glue the model
      // to the new ground. The footprint ring still re-drapes (collision is 2D).
      if (!p.detached) this.applyTransform(entry);
      this.refreshFootprint(entry);
    }
    this.refreshSelection();
  }

  /**
   * Replace the whole placement set (map load / undo). The array is INDEX-
   * ALIGNED with the editor document: a null hole (unresolvable asset id)
   * renders nothing but still occupies its slot, so later document indices
   * keep addressing the right meshes.
   */
  rebuildAll(placements: readonly (PlacedAsset | null)[], preload = false): void {
    // An explicit full rebuild is an editor host taking ownership of
    // residency (its zone stream passes null slots itself).
    this.streamSource = null;
    this.allPlacements = placements;
    this.regionEvicted.clear();
    for (const index of [...this.entries.keys()]) this.removePlacement(index);
    this.setSelected(null);
    for (let index = 0; index < placements.length; index++) {
      const placed = placements[index];
      if (placed) this.addPlacement(index, placed, preload);
    }
  }

  /** Drop a placement from the stream-priority index (template resolved, or
   * the placement was removed while its GLB was still in flight). */
  private unregisterWaiting(p: PlacedAsset): void {
    const set = this.waitingByPath.get(p.path);
    if (!set) return;
    set.delete(p);
    if (set.size === 0) this.waitingByPath.delete(p.path);
  }

  /** Queue order for this path's GLB: squared distance from the last-seen
   * camera to the NEAREST placement still waiting on it. Before the first
   * frame (no camera yet) everything is 0, plain FIFO, the old behavior. */
  private streamPriority(path: string): number {
    if (this.lodCamX === null) return 0;
    const waiting = this.waitingByPath.get(path);
    if (!waiting || waiting.size === 0) return 0;
    let best = Infinity;
    for (const p of waiting) {
      const dx = p.x - this.lodCamX;
      const dz = p.z - this.lodCamZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return best;
  }

  private template(path: string): Promise<TemplateInfo | null> {
    let cached = this.templates.get(path);
    if (!cached) {
      // v0.35's loader queues by submission order and takes no priority hook,
      // so nearest-first template streaming rides on WHEN we ask rather than a
      // priority callback. streamPriority still orders the request sweep.
      cached = loadGltf(path)
        .then((gltf) => {
          const object = gltf.scene;
          // Weakly authored emissive channels never cross the bloom threshold;
          // lift them once on the shared template so "glowy" GLB materials
          // actually glow (clones inherit it).
          object.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const raw of mats) {
              const m = raw as THREE.MeshStandardMaterial;
              if (
                m.emissive &&
                (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0) &&
                m.emissiveIntensity > 0 &&
                m.emissiveIntensity < MIN_NATIVE_EMISSIVE_INTENSITY
              ) {
                m.emissiveIntensity = MIN_NATIVE_EMISSIVE_INTENSITY;
              }
            }
          });
          const box = new THREE.Box3().setFromObject(object);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          // Tree, bush and palm GLBs ship with the sway built in. The hook
          // lives on the SHARED template material (mutated once, like the
          // emissive lift above): the shader gates on the mesh's WORLD base
          // position vs the player, so far foliage rests and costs nothing.
          const swayKind = swayKindForAssetPath(path);
          if (swayKind) {
            attachPlacedTreeSway(object, box.min.y, box.max.y, swayKind);
          }
          return {
            object,
            norm: targetHeightFor(path) / maxDim,
            minY: box.min.y,
            maxY: box.max.y,
            radiusSrc: Math.max(size.x, size.z) / 2 || 1,
          };
        })
        .catch(() => {
          // Missing or unreadable GLB: skip. The editor catalogue may list a
          // model that is not present in a given build; one bad asset must not
          // blank the whole scene.
          return null;
        });
      this.templates.set(path, cached);
    }
    return cached;
  }

  /**
   * Shader tweaks: tint multiplies the albedo, opacity fades the whole model,
   * glow adds emissive. The shared template materials are cloned ONCE per
   * entry on the first tweak; clearing every field restores the shared ones.
   */
  private applyMaterialOverride(entry: Entry): void {
    const model = entry.model;
    if (!model) return;
    // Procedural models (grass, waterfalls) own their shared shader materials;
    // the per-placement tweak pipeline never touches them.
    if (entry.placement.path === GRASS_PATCH_PATH || entry.placement.path === WATERFALL_PATH) {
      return;
    }
    const p = entry.placement;
    const has =
      p.tint !== undefined ||
      p.opacity !== undefined ||
      p.glow !== undefined ||
      p.glowStrength !== undefined;
    if (!has && !entry.ownMats) return;
    if (!entry.ownMats) {
      const clones: THREE.Material[] = [];
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const cloned = mats.map((mat) => {
          const c = (mat as THREE.Material).clone();
          clones.push(c);
          return c;
        });
        m.material = Array.isArray(m.material) ? cloned : cloned[0];
        (m.userData as { wocBaseColor?: number[] }).wocBaseColor = cloned.map((c) =>
          (c as THREE.MeshStandardMaterial).color?.getHex?.(),
        ) as number[];
        // Baseline emissive too, so a tint/opacity tweak (or clearing a glow)
        // restores the model's OWN glow instead of silencing it to black.
        (m.userData as { wocBaseEmissive?: (number | undefined)[] }).wocBaseEmissive = cloned.map(
          (c) => (c as THREE.MeshStandardMaterial).emissive?.getHex?.(),
        );
        (m.userData as { wocBaseEmissiveI?: (number | undefined)[] }).wocBaseEmissiveI = cloned.map(
          (c) => (c as THREE.MeshStandardMaterial).emissiveIntensity,
        );
      });
      entry.ownMats = clones;
    }
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const ud = m.userData as {
        wocBaseColor?: (number | undefined)[];
        wocBaseEmissive?: (number | undefined)[];
        wocBaseEmissiveI?: (number | undefined)[];
      };
      const bases = ud.wocBaseColor ?? [];
      const baseEm = ud.wocBaseEmissive ?? [];
      const baseEmI = ud.wocBaseEmissiveI ?? [];
      mats.forEach((raw, i) => {
        const mat = raw as THREE.MeshStandardMaterial;
        if (mat.color) {
          const base = bases[i];
          if (base !== undefined) mat.color.setHex(base);
          if (p.tint !== undefined) mat.color.multiply(new THREE.Color(p.tint));
        }
        const wasTransparent = mat.transparent;
        const op = p.opacity ?? 1;
        mat.transparent = op < 1;
        mat.opacity = op;
        mat.depthWrite = op >= 0.99;
        if (mat.emissive) {
          if (p.glow !== undefined) {
            mat.emissive.setHex(p.glow);
            mat.emissiveIntensity = p.glowStrength ?? 1;
          } else {
            mat.emissive.setHex(baseEm[i] ?? 0x000000);
            mat.emissiveIntensity = baseEmI[i] ?? 1;
          }
        }
        // Color/emissive/opacity land as uniform updates on their own; only a
        // transparency FLIP needs the material re-initialized.
        if (mat.transparent !== wasTransparent) mat.needsUpdate = true;
      });
    });
  }

  // ---- authored asset fire effects ---------------------------------------------

  /** The rich list is authoritative; old maps keep their original one-flame
   *  behavior through a synthesized emitter that never mutates the document. */
  private fireEmitters(entry: Entry): readonly AssetFireEmitter[] {
    if (entry.placement.fireEffects && entry.placement.fireEffects.length > 0) {
      return entry.placement.fireEffects;
    }
    if (!entry.placement.fire) return [];
    const legacy = legacyAssetFireEmitter();
    // Preserve the old asset-relative size for a legacy Boolean fire.
    legacy.scale = Math.min(2.4, Math.max(0.7, this.worldScale(entry) * 0.5));
    return [legacy];
  }

  /** Build a layered procedural fire, glow, smoke, and ember system for every
   *  emitter. Rebuilds are bounded to 16 emitters and dispose all owned GPU
   *  resources before replacement, so long authoring sessions do not leak. */
  private applyFireFx(entry: Entry): void {
    this.dropFireFx(entry);
    if (!entry.model || !entry.info) return;
    // Old maps used a Boolean fire toggle whose renderer cost was two meshes.
    // Do not silently expand every one of those into the rich smoke/ember/light
    // stack; only explicitly authored fireEffects opt into that heavier path.
    const legacy =
      entry.placement.fire === true &&
      (!entry.placement.fireEffects || entry.placement.fireEffects.length === 0);
    const effects = this.fireEmitters(entry).slice(
      0,
      Math.max(0, MAX_RENDERED_FIRE_EMITTERS - this.fireEmitterCount),
    );
    if (effects.length === 0) return;

    const root = new THREE.Group();
    root.name = 'placed-fire-effects';
    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];
    let litEmitters = 0;

    effects.forEach((fx, index) => {
      const emitter = new THREE.Group();
      emitter.name = `placed-fire-${fx.id}`;
      emitter.userData.fireEmitterIndex = index;
      emitter.visible = fx.enabled;

      const hue = (((fx.hue % 360) + 360) % 360) / 360;
      const outer = new THREE.Color().setHSL(hue, fx.saturation, 0.47);
      const core = new THREE.Color().setHSL(hue, Math.max(0.2, fx.saturation * 0.58), 0.82);
      const phase =
        Math.abs(entry.placement.x * 7.3 + entry.placement.z * 3.1 + index * 2.137) % (Math.PI * 2);
      const blend = fx.blend === 'alpha' ? THREE.NormalBlending : THREE.AdditiveBlending;
      const flameMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: phase },
          uIntensity: { value: fx.intensity },
          uOpacity: { value: fx.opacity },
          uTurbulence: { value: fx.turbulence },
          uOuter: { value: outer },
          uCore: { value: core },
        },
        vertexShader: FIRE_VERTEX_SHADER,
        fragmentShader: FIRE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: blend,
        userData: { noWireframe: true },
      });
      ownedMaterials.push(flameMat);

      const flameRoot = new THREE.Group();
      // A legacy `fire: true` placement is a promoted WORLD campfire, and it
      // should look like the campfire it was: the game's small lathed teardrop
      // (campfire_flame.ts), not the generic billboard tongues. Those are
      // authored for bonfires and wildfires, and at campfire size they read as
      // a pale cone over a white core rather than a fire.
      if (legacy) {
        const { flame: lathe, materials: latheMats } = buildCampfireFlame();
        ownedMaterials.push(...latheMats);
        lathe.position.y = 0.16;
        flameRoot.add(lathe);
        // fx.scale was tuned for the billboard tongue (1.6yd authored) and
        // over-scales the 0.95yd lathe by the ratio between them. Measured on a
        // default promoted campfire: 1.95yd tall against the game's 1.09yd, so
        // bring it back to the game's size. Still multiplicative, so scaling
        // the placement still scales its fire.
        flameRoot.scale.setScalar(fx.scale * LEGACY_CAMPFIRE_FLAME_FIT);
        emitter.add(flameRoot);
        // Same flicker the renderer's scenery lane gives a world campfire, so a
        // promoted fire and an unpromoted one beside it move together.
        lathe.onBeforeRender = () => {
          const tt = (performance.now() / 1000) * this.ambienceScale;
          const f = campfireFlameScale(tt, index);
          lathe.scale.set(f.xz, f.y, f.xz);
        };
        root.add(emitter);
        // No fireEmitterCount bookkeeping here: the caller adds effects.length
        // once the whole forEach is done, and a legacy fire is exactly one of
        // them. Counting it here too would halve the budget for the next map.
        return;
      }
      const flameCount = Math.max(1, Math.min(8, Math.round(fx.flames)));
      // All tongues share one material and animation clock, so render them as
      // one instanced draw instead of one draw call per tongue. Wildfire's
      // eight tongues now cost the same number of submissions as a torch.
      const tongues = new THREE.InstancedMesh(flamePlaneGeo, flameMat, flameCount);
      const tongueTransform = new THREE.Object3D();
      for (let i = 0; i < flameCount; i++) {
        const ring = i === 0 ? 0 : 0.13 + (i / flameCount) * 0.23;
        const a = phase + i * 2.39996;
        tongueTransform.position.set(Math.cos(a) * ring, 0, Math.sin(a) * ring);
        tongueTransform.rotation.set(0, a, 0);
        const taper = 1 - (i / Math.max(1, flameCount - 1)) * 0.32;
        tongueTransform.scale.set(taper, 0.82 + taper * 0.18, taper);
        tongueTransform.updateMatrix();
        tongues.setMatrixAt(i, tongueTransform.matrix);
      }
      tongues.instanceMatrix.needsUpdate = true;
      tongues.renderOrder = 2;
      flameRoot.add(tongues);
      flameRoot.scale.set(fx.scale * fx.width, fx.scale * fx.height, fx.scale * fx.width);
      emitter.add(flameRoot);

      const coreMat = new THREE.MeshBasicMaterial({
        color: core,
        transparent: true,
        opacity: Math.min(1, fx.opacity * (0.45 + fx.intensity * 0.08)),
        depthWrite: false,
        blending: blend,
        userData: { noWireframe: true },
      });
      ownedMaterials.push(coreMat);
      const hotCore = new THREE.Mesh(fireCoreGeo, coreMat);
      hotCore.position.y = 0.16 * fx.scale;
      hotCore.scale.setScalar(fx.scale * (0.68 + fx.width * 0.18));
      emitter.add(hotCore);

      // The light itself comes from the shared pool (assignFireLights); the
      // emitter only advertises what it WOULD light with.
      if (!legacy && fx.glow > 0) {
        emitter.userData.fireLightSpec = {
          color: core,
          glow: fx.glow,
          range: fx.glowRange,
          yOffset: Math.max(0.15, fx.scale * 0.45),
        } satisfies FireLightSpec;
        litEmitters++;
      }

      // Soft, individually cycling puffs create actual rising smoke rather
      // than baking gray into the flame shader. Five puffs are enough to read
      // as a column while keeping the per-emitter draw cost bounded.
      if (!legacy && fx.smoke > 0.005) {
        for (let i = 0; i < 5; i++) {
          const smokeColor = new THREE.Color().setHSL(hue, fx.saturation * 0.06, 0.18);
          const smokeMat = new THREE.MeshBasicMaterial({
            color: smokeColor,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.NormalBlending,
            userData: { noWireframe: true },
          });
          ownedMaterials.push(smokeMat);
          const puff = new THREE.Mesh(smokePuffGeo, smokeMat);
          const puffPhase = i / 5;
          puff.onBeforeRender = () => {
            const tt = (performance.now() / 1000) * this.ambienceScale * Math.max(0.01, fx.speed);
            const cycle = (tt * 0.18 + puffPhase + phase / 17) % 1;
            const rise = fx.scale * (0.7 + cycle * (1.4 + fx.smokeRise));
            puff.position.set(
              Math.sin(tt * 0.55 + i * 2.1 + phase) * fx.scale * 0.18 * fx.turbulence,
              rise,
              Math.cos(tt * 0.48 + i * 1.7 + phase) * fx.scale * 0.14 * fx.turbulence,
            );
            const grow = fx.scale * fx.smokeScale * (0.35 + cycle * 0.65);
            puff.scale.set(grow, grow * 0.72, grow);
            smokeMat.opacity = fx.smoke * Math.sin(Math.PI * cycle) * 0.26;
          };
          emitter.add(puff);
        }
      }

      // One Points draw call carries the whole ember shower. Positions are
      // deterministic and updated in-place; no per-frame arrays or objects.
      const emberCount = legacy ? 0 : Math.round(fx.embers * 28);
      if (emberCount > 0) {
        const emberGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(emberCount * 3);
        const seeds = new Float32Array(emberCount * 3);
        for (let i = 0; i < emberCount; i++) {
          const a = phase + i * 2.39996;
          seeds[i * 3] = a;
          seeds[i * 3 + 1] = (i + 0.5) / emberCount;
          seeds[i * 3 + 2] = 0.4 + ((i * 37) % 61) / 100;
        }
        emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        ownedGeometries.push(emberGeo);
        const emberMat = new THREE.PointsMaterial({
          color: core,
          size: Math.max(0.025, fx.scale * 0.055),
          sizeAttenuation: true,
          transparent: true,
          opacity: Math.min(1, 0.45 + fx.intensity * 0.12),
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        ownedMaterials.push(emberMat);
        const sparks = new THREE.Points(emberGeo, emberMat);
        sparks.frustumCulled = false;
        sparks.onBeforeRender = () => {
          const tt = (performance.now() / 1000) * this.ambienceScale * Math.max(0.02, fx.speed);
          for (let i = 0; i < emberCount; i++) {
            const cycle = (tt * seeds[i * 3 + 2] * 0.45 + seeds[i * 3 + 1]) % 1;
            const radius = fx.scale * fx.width * (0.08 + cycle * 0.28);
            const a = seeds[i * 3] + tt * 0.38 * fx.turbulence;
            positions[i * 3] = Math.cos(a) * radius;
            positions[i * 3 + 1] = fx.scale * (0.18 + cycle * (1.1 + fx.smokeRise * 0.35));
            positions[i * 3 + 2] = Math.sin(a) * radius;
          }
          (emberGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        };
        emitter.add(sparks);
      }

      // One clock source updates uniforms, flame deformation, and light pulse.
      const clockMesh = flameRoot.children[0] as THREE.Mesh;
      clockMesh.onBeforeRender = () => {
        const tt = (performance.now() / 1000) * this.ambienceScale * Math.max(0.01, fx.speed);
        flameMat.uniforms.uTime.value = tt;
        const flicker =
          1 +
          (Math.sin(tt * 9 + phase) * 0.06 + Math.sin(tt * 21 + phase * 1.7) * 0.025) * fx.flicker;
        flameRoot.scale.set(
          fx.scale * fx.width * flicker,
          fx.scale * fx.height * (2 - flicker),
          fx.scale * fx.width * flicker,
        );
        // The pooled light reads this, so a flame that currently holds one
        // still pulses with its own flicker (assignFireLights).
        emitter.userData.fireLightPulse = 0.86 + (flicker - 0.94) * 1.8;
      };

      root.add(emitter);
    });

    root.userData.fireOwnedMaterials = ownedMaterials;
    root.userData.fireOwnedGeometries = ownedGeometries;
    root.userData.fireEmitterCount = effects.length;
    // Diagnostic only: how many of this placement's emitters WANT a pooled
    // light. Which of them actually hold one is decided per frame.
    root.userData.fireLitEmitters = litEmitters;
    this.fireEmitterCount += effects.length;
    this.group.add(root);
    this.markPickRoot(entry, root);
    entry.fireFx = root;
    this.placeFireFx(entry);
  }

  private effectWorldPosition(
    entry: Entry,
    fx: AssetFireEmitter,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const info = entry.info;
    if (!info) return out.set(entry.placement.x, 0, entry.placement.z);
    const p = entry.placement;
    const s = this.worldScale(entry);
    const height = (info.maxY - info.minY) * s * (p.scaleY ?? 1);
    const anchorHeight =
      fx.anchor === 'base' ? 0 : fx.anchor === 'center' ? height * 0.5 : height * 0.82;
    const rotation = new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0, 'XYZ');
    const local = out.set(fx.x, anchorHeight + fx.y, fx.z).applyEuler(rotation);
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    local.x += p.x;
    local.y += ground + (p.y ?? 0);
    local.z += p.z;
    return local;
  }

  /** Public anchor query used by the editor's ordinary 3-axis transform gizmo. */
  fireEmitterWorldPosition(
    index: number,
    emitterIndex: number,
    out = new THREE.Vector3(),
  ): THREE.Vector3 | null {
    const entry = this.entries.get(index);
    if (!entry?.info) return null;
    const fx = this.fireEmitters(entry)[emitterIndex];
    return fx ? this.effectWorldPosition(entry, fx, out) : null;
  }

  /** Re-seat every emitter after its asset moves, tilts, or scales. */
  private placeFireFx(entry: Entry): void {
    const root = entry.fireFx;
    if (!root) return;
    const effects = this.fireEmitters(entry);
    effects.forEach((fx, index) => {
      const emitter = root.children[index];
      if (!emitter) return;
      this.effectWorldPosition(entry, fx, emitter.position);
    });
  }

  private dropFireFx(entry: Entry): void {
    const root = entry.fireFx;
    if (!root) return;
    this.group.remove(root);
    const materials = root.userData.fireOwnedMaterials as THREE.Material[] | undefined;
    const geometries = root.userData.fireOwnedGeometries as THREE.BufferGeometry[] | undefined;
    this.fireEmitterCount = Math.max(
      0,
      this.fireEmitterCount - (root.userData.fireEmitterCount ?? 0),
    );
    materials?.forEach((mat) => {
      mat.dispose();
    });
    geometries?.forEach((geo) => {
      geo.dispose();
    });
    root.clear();
    entry.fireFx = null;
  }

  private worldScale(entry: Entry): number {
    const p = entry.placement;
    return (entry.info?.norm ?? 1) * (p.scale > 0 ? p.scale : 1);
  }

  /**
   * How the placement set is actually being drawn: how many entries became
   * instances, how many still clone, and which templates forced the fallback.
   * Diagnostics for the A/B harness (scripts/map_export_ab.mjs) and the editor
   * perf overlay, a map that suddenly clones everything is the regression this
   * makes visible.
   */
  batchStats(): {
    entries: number;
    batched: number;
    cloned: number;
    batches: number;
    instances: number;
    clonedPaths: Record<string, number>;
  } {
    const clonedPaths: Record<string, number> = {};
    let batched = 0;
    let cloned = 0;
    for (const entry of this.entries.values()) {
      if (entry.batched) {
        batched++;
        continue;
      }
      if (!entry.model) continue; // still streaming: neither yet
      cloned++;
      clonedPaths[entry.placement.path] = (clonedPaths[entry.placement.path] ?? 0) + 1;
    }
    return {
      entries: this.entries.size,
      batched,
      cloned,
      batches: this.batches.batchCount,
      instances: this.batches.instanceCount,
      clonedPaths,
    };
  }

  /** Instanceable sub-meshes for a resolved template, decomposed once per path
   *  (null = this GLB has to be cloned). */
  private subsFor(path: string, object: THREE.Object3D): BatchSub[] | null {
    let subs = this.batchSubs.get(path);
    if (subs === undefined) {
      subs = templateSubs(object);
      this.batchSubs.set(path, subs);
    }
    return subs;
  }

  /** Seat (or re-seat) a batched entry's instances from its proxy transform.
   *  A LOD-hidden entry holds no slot, so this is a no-op for it. */
  private syncBatch(entry: Entry): void {
    if (!entry.batched || !entry.model || entry.lodHidden) return;
    const subs = this.batchSubs.get(entry.placement.path);
    if (!subs) return;
    this.batches.attach(entry.index, entry.placement.path, subs, entry.model.matrixWorld);
  }

  private applyTransform(entry: Entry): void {
    if (!entry.model || !entry.info) return;
    const p = entry.placement;
    const s = this.worldScale(entry);
    // Per-axis multipliers (editor gizmo) ride on top of the uniform scale.
    const sy = s * (p.scaleY ?? 1);
    entry.model.scale.set(s * (p.scaleX ?? 1), sy, s * (p.scaleZ ?? 1));
    // Seat the model base on the ground (lift by -minY*scale so its lowest
    // point rests at terrainHeight; approximate under a gizmo tilt), plus the
    // authored vertical offset (the gizmo's Y arrow). A DETACHED placement floats
    // at a frozen ground height instead of tracking the live terrain (Move tool).
    const groundY = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    entry.model.position.set(p.x, groundY - entry.info.minY * sy + (p.y ?? 0), p.z);
    entry.model.rotation.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
    this.refreezeMatrices(entry);
    // refreezeMatrices has just cascaded the proxy's matrixWorld, so the
    // instance can be composed straight off it, no duplicate seating math,
    // and a gizmo drag rewrites one instance matrix instead of moving a node.
    this.syncBatch(entry);
    if (entry.fireFx) this.placeFireFx(entry);
    this.onSceneChanged?.();
  }

  /**
   * Static-matrix discipline for placement clones (see render/static_matrix.ts:
   * three recomposes every auto-update node's matrices EVERY frame, and a big
   * authored map is thousands of never-moving clone subtrees). After each
   * transform write the entry's matrices are recomposed ONCE here, then the
   * subtree is frozen; matrixWorldAutoUpdate=false additionally makes the
   * per-frame scene walk skip the whole subtree. Gizmo drags stay live because
   * every drag step lands here via updatePlacement -> applyTransform.
   */
  private refreezeMatrices(entry: Entry): void {
    const model = entry.model;
    if (!model || !entry.freezeStatic) return;
    const alreadyFrozen = !model.matrixWorldAutoUpdate;
    // Compose the root's fresh TRS, then cascade world matrices.
    //
    // `updateMatrix()` first, and then the refresh must go through
    // static_matrix.ts's helper rather than a bare updateMatrixWorld(). Under
    // three r185 `Object3D.updateMatrixWorld` composes the node's own
    // matrixWorld only `if (this.matrixWorldAutoUpdate === true)`, and this
    // subtree turns that flag off at the end of its first pass. So every pass
    // after the first recomposed `matrix`, cleared the dirty bit, and left
    // matrixWorld frozen at whatever it held when the flag went down.
    //
    // Everything that draws reads matrixWorld: the instanced batch seats its
    // instance off it (syncBatch), and a non-batched clone's meshes cascade
    // from it. The DOCUMENT moved regardless, and the collider and hitbox
    // overlay read the document, so a gizmo drag or a scale in Studio moved an
    // asset's hitbox and left its mesh standing where it was. That is the r185
    // note at the top of static_matrix.ts, and this was the one caller that
    // still had the pre-r185 assumption baked in.
    model.updateMatrix();
    refreshFrozenWorldMatrix(model);
    // First pass only: freeze the locals. The per-frame scene walk then skips
    // the whole subtree, which is the point of the exercise.
    if (!alreadyFrozen) {
      model.traverse((o) => {
        o.matrixAutoUpdate = false;
      });
      model.matrixWorldAutoUpdate = false;
    }
  }

  /**
   * Distance culling, called once per frame by the renderer: placements past
   * LOD_RANGE_ASSETS (or the maker's view distance or the fog, whichever is
   * nearest) stop rendering. `maxFar` is the maker's chosen asset
   * view distance; the fog cap keeps a placement from ever drawing past the
   * terrain. Checks are strided so huge maps never spend more than
   * LOD_BUDGET_PER_FRAME tests a frame.
   */
  /**
   * Drop every placement on the far side of a line in world XZ; null clears.
   *
   * Takes effect over the next few frames, as the strided sweep in updateLod
   * comes round to each entry. That lag is deliberate in both directions:
   * flipping five thousand entries in one frame is exactly the stutter the
   * strided sweep exists to prevent, and whatever this hides was already
   * behind something.
   */
  /** Is this placement on the far side of the region line? One owner for the
   *  test, read by the LOD sweep, the residency stream and the region pass. */
  private beyondCull(p: PlacedAsset): boolean {
    const b = this.cullBeyond;
    return b !== null && p.x * b.nx + p.z * b.nz >= b.d;
  }

  /**
   * The LOAD half of {@link setCullBeyond}: release the placements past the
   * line outright, and rebuild them once it clears.
   *
   * The LOD sweep's region test stops them being DRAWN within a few frames,
   * which is all the eye needs. This is what gives the memory back, the
   * clone, its instance slots, and the per-entry geometry a grass patch,
   * generated rock, built model or generated tree owns. Both directions are
   * budgeted per frame, because doing five thousand of either at once is
   * exactly the stutter every strided sweep in this file exists to avoid.
   *
   * Release runs on a rolling cursor over the whole placement list; the
   * rebuild drains the released set, so nothing the region pass did not take
   * away is ever added by it.
   */
  reconcileCullRegion(): void {
    const src = this.allPlacements;
    if (src.length === 0) return;
    if (this.cullBeyond !== null) {
      let ops = 0;
      for (let step = 0; step < src.length && ops < REGION_EVICT_BUDGET; step++) {
        this.regionCursor = (this.regionCursor + 1) % src.length;
        const p = src[this.regionCursor];
        if (!p || !this.entries.has(this.regionCursor) || !this.beyondCull(p)) continue;
        // The selected placement is being edited: never pull it out from
        // under the maker, the same exemption the LOD sweep makes.
        if (this.regionCursor === this.selected) continue;
        this.removePlacement(this.regionCursor);
        this.regionEvicted.add(this.regionCursor);
        ops++;
      }
      return;
    }
    if (this.regionEvicted.size === 0) return;
    let ops = 0;
    for (const index of this.regionEvicted) {
      if (ops >= REGION_RESTORE_BUDGET) break;
      this.regionEvicted.delete(index);
      const p = src[index];
      if (p) this.addPlacement(index, p);
      ops++;
    }
  }

  setCullBeyond(plane: PlacedCullHalfPlane | null): void {
    const held = this.cullBeyond;
    if (held === plane) return;
    if (
      held !== null &&
      plane !== null &&
      held.nx === plane.nx &&
      held.nz === plane.nz &&
      held.d === plane.d
    ) {
      return;
    }
    this.cullBeyond = plane;
  }

  updateLod(camX: number, camZ: number, fogFar: number, maxFar = Number.POSITIVE_INFINITY): void {
    // Feed the GLB stream priority: pending loads re-read this at dequeue.
    this.lodCamX = camX;
    this.lodCamZ = camZ;
    // Rebuild the stride list only when the placement set changed; between
    // structural edits this is allocation-free every frame.
    if (this.lodKeysDirty) {
      this.lodKeys = [...this.entries.keys()];
      this.lodKeysDirty = false;
      if (this.lodCursor >= this.lodKeys.length) this.lodCursor = 0;
    }
    const keys = this.lodKeys;
    if (keys.length === 0) return;
    const budget = Math.min(keys.length, LOD_BUDGET_PER_FRAME);
    for (let n = 0; n < budget; n++) {
      this.lodCursor = (this.lodCursor + 1) % keys.length;
      const entry = this.entries.get(keys[this.lodCursor]);
      if (!entry?.model) continue;
      const p = entry.placement;
      // The selected object never LOD-culls: while being placed or moved it can
      // sit far from the camera (dragging it across the map), and it must stay
      // visible for the maker to keep dragging it (fix: "move objects anywhere").
      if (keys[this.lodCursor] === this.selected) {
        if (entry.lodHidden) {
          entry.lodHidden = false;
          entry.model.visible = true;
          this.syncBatch(entry);
          if (entry.fireFx) entry.fireFx.visible = true;
        }
        if (this.footprintsOn && entry.footprint === null) this.refreshFootprint(entry);
        continue;
      }
      // The asset ceiling, tightened by the maker's view distance and the fog
      // (a placement must not render where the ground has fogged out).
      // Foliage-family placements tighten further to the shipped tree/rock
      // handoff plane, but ONLY on hosts whose far-sprite mirrors take over
      // beyond it (game boots), an editor viewport without sprites keeps
      // the full asset range rather than an empty 300-500yd band.
      const spriteKind = foliageFarPlacementsActive() ? farSpriteKindFor(p.path) : null;
      const speciesCap =
        spriteKind === 'tree'
          ? lodDistsFor(GFX.leanFoliage, GFX.tier).treeFillFar
          : spriteKind === 'rock'
            ? lodDistsFor(GFX.leanFoliage, GFX.tier).rockFar
            : Number.POSITIVE_INFINITY;
      const range = Math.min(fogFar + 60, maxFar, LOD_RANGE_ASSETS, speciesCap);
      const dx = p.x - camX;
      const dz = p.z - camZ;
      const d2 = dx * dx + dz * dz;
      const limit = entry.lodHidden ? range : range * LOD_HYSTERESIS;
      // The host's region cull sits alongside the range test rather than
      // inside it: it carries no hysteresis, because its boundary is a wall
      // rather than a fog plane and nothing oscillates across it. This hides
      // within a few frames; reconcileCullRegion releases behind it.
      const hide = d2 > limit * limit || this.beyondCull(p);
      if (hide !== entry.lodHidden) {
        entry.lodHidden = hide;
        entry.model.visible = !hide;
        // A batched entry culls by releasing its instance slots: the batch
        // compacts and lowers mesh.count, so the far instances stop being
        // submitted at all rather than drawing degenerate geometry.
        if (entry.batched) {
          if (hide) this.batches.detach(entry.index);
          else this.syncBatch(entry);
        }
        if (entry.fireFx) entry.fireFx.visible = !hide;
      }
      // Footprint-overlay reconciliation rides the same strided sweep: build
      // the overlay as a placement comes inside FOOTPRINT_RANGE, drop it as
      // it leaves (same near-gate refreshFootprint applies on every path).
      if (this.footprintsOn) {
        const wantFootprint = (p.collideRadius ?? 0) > 0 && d2 <= FOOTPRINT_RANGE * FOOTPRINT_RANGE;
        if (wantFootprint !== (entry.footprint !== null)) this.refreshFootprint(entry);
      }
    }
  }

  // A flat ring whose vertices are draped onto the terrain: each vertex takes
  // the ground height under it, so the ring hugs slopes instead of clipping.
  private drapedRingGeometry(x: number, z: number, radius: number): THREE.RingGeometry {
    const width = Math.max(0.06, radius * 0.08);
    const geo = new THREE.RingGeometry(Math.max(0.05, radius - width), radius, RING_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(x + pos.getX(i), z + pos.getZ(i), this.seed) + RING_LIFT);
    }
    geo.computeBoundingSphere();
    return geo;
  }

  // The square-footprint outline (collideShape 'square'): a hollow rot-following
  // frame draped onto the terrain like the circle ring.
  private drapedSquareGeometry(
    x: number,
    z: number,
    half: number,
    rotY: number,
  ): THREE.BufferGeometry {
    const width = Math.max(0.06, half * 0.08);
    const outer = new THREE.Shape();
    outer.moveTo(-half, -half);
    outer.lineTo(half, -half);
    outer.lineTo(half, half);
    outer.lineTo(-half, half);
    outer.closePath();
    const inner = new THREE.Path();
    const ih = Math.max(0.05, half - width);
    inner.moveTo(-ih, -ih);
    inner.lineTo(ih, -ih);
    inner.lineTo(ih, ih);
    inner.lineTo(-ih, ih);
    inner.closePath();
    outer.holes.push(inner);
    const geo = new THREE.ShapeGeometry(outer);
    geo.rotateX(-Math.PI / 2);
    // The sim OBB rotates by rotY in three.js convention; match it.
    geo.rotateY(rotY);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(x + pos.getX(i), z + pos.getZ(i), this.seed) + RING_LIFT);
    }
    geo.computeBoundingSphere();
    return geo;
  }

  private refreshFootprint(entry: Entry): void {
    this.dropFootprint(entry);
    const p = entry.placement;
    const r = p.collideRadius ?? 0;
    if (!this.footprintsOn || r <= 0) return;
    // The overlay follows the camera: a box past FOOTPRINT_RANGE is not
    // built at all (updateLod's strided sweep re-checks entries as the
    // camera moves), so a 9k-placement map drapes dozens of nearby shapes
    // instead of thousands map-wide. The selected placement keeps its
    // overlay at any distance (it can be dragged far from the camera).
    if (entry.index !== this.selected && this.lodCamX !== null && this.lodCamZ !== null) {
      const fdx = p.x - this.lodCamX;
      const fdz = p.z - this.lodCamZ;
      if (fdx * fdx + fdz * fdz > FOOTPRINT_RANGE * FOOTPRINT_RANGE) return;
    }
    // Baked per-asset collision (the sim's real playtest shapes): draw the box
    // set as X-ray wireframes hugging the model. A hand-authored radius/square
    // keeps the legacy draped circle/frame - exactly what the sim blocks with.
    // Per-placement resolved hitboxes (hand-edited / fine mesh bake) first,
    // then the baked catalogue/import set - matching the sim exactly.
    // Collision Master authored MESH volumes: when the asset's collision
    // comes from a CM override with meshes (no per-placement hand edits), the
    // footprint IS the maker's blue modeled shape, the sim's boxes are
    // derived from exactly these volumes.
    const overrideId =
      !p.collideCustom && (!p.hitboxes || p.hitboxes.length === 0) && p.path
        ? /^\/models\/(.+)\.glb$/.exec(p.path)?.[1]
        : undefined;
    const authoredMeshes = overrideId ? collisionOverrideFor(overrideId)?.meshes : undefined;
    if (authoredMeshes && authoredMeshes.length > 0) {
      const g = new THREE.Group();
      g.name = 'authored-collision-footprint';
      const s = p.scale > 0 ? p.scale : 1;
      const groundY = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
      g.position.set(p.x, groundY + (p.y ?? 0), p.z);
      // Tilts lean the collision with the model (sim fits yaw-banded covers).
      g.rotation.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
      g.scale.set(s * (p.scaleX ?? 1), s * (p.scaleY ?? 1), s * (p.scaleZ ?? 1));
      for (const m of authoredMeshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([...m.verts], 3));
        geo.setIndex([...m.tris]);
        const edges = new THREE.EdgesGeometry(geo, 30);
        geo.dispose();
        const line = new THREE.LineSegments(edges, authoredFootprintMat);
        line.renderOrder = 3;
        g.add(line);
      }
      entry.footprint = g;
      this.group.add(g);
      return;
    }
    const baked =
      p.hitboxes && p.hitboxes.length > 0
        ? p.hitboxes
        : p.collideCustom
          ? null
          : bakedBoxesForPath(p.path, this.assetCollision ?? undefined);
    if (baked) {
      const g = new THREE.Group();
      g.name = 'baked-collision-footprint';
      const s = p.scale > 0 ? p.scale : 1;
      const sx = s * (p.scaleX ?? 1);
      const sy = s * (p.scaleY ?? 1);
      const sz = s * (p.scaleZ ?? 1);
      const groundY = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
      g.position.set(p.x, groundY + (p.y ?? 0), p.z);
      // Tilts lean the collision with the model (sim fits yaw-banded covers).
      g.rotation.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
      for (const b of baked) {
        const line = new THREE.LineSegments(boxEdgesGeometry(), bakedFootprintMat);
        line.position.set(b.x * sx, b.y * sy, b.z * sz);
        const bry = (b as { ry?: number }).ry ?? 0;
        if (bry !== 0) line.rotation.y = bry;
        line.scale.set(
          Math.max(0.02, b.hx * 2 * sx),
          Math.max(0.02, b.hy * 2 * sy),
          Math.max(0.02, b.hz * 2 * sz),
        );
        line.renderOrder = 3;
        g.add(line);
      }
      entry.footprint = g;
      this.group.add(g);
      return;
    }
    const geo =
      p.collideShape === 'square'
        ? this.drapedSquareGeometry(p.x, p.z, r, p.rotY)
        : this.drapedRingGeometry(p.x, p.z, r);
    const mesh = new THREE.Mesh(geo, this.footprintMat);
    mesh.position.set(p.x, 0, p.z);
    entry.footprint = mesh;
    this.group.add(mesh);
  }

  private dropFootprint(entry: Entry): void {
    if (!entry.footprint) return;
    this.group.remove(entry.footprint);
    // The draped ring owns its geometry; baked-box groups share the module
    // edge geometry + material (nothing per-entry to dispose). Authored-mesh
    // groups build per-entry edge geometries: dispose those.
    if (entry.footprint.name === 'authored-collision-footprint') {
      entry.footprint.traverse((o) => {
        if (o instanceof THREE.LineSegments) o.geometry.dispose();
      });
    }
    const m = entry.footprint as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
    entry.footprint = null;
  }

  private refreshSelection(): void {
    const entry = this.selected === null ? undefined : this.entries.get(this.selected);
    if (!entry) {
      if (this.selectionRing) {
        this.group.remove(this.selectionRing);
        this.selectionRing.geometry.dispose();
        this.selectionRing = null;
      }
      return;
    }
    const p = entry.placement;
    // Before the GLB resolves the footprint radius is unknown: use a stand-in.
    const radius = entry.info
      ? Math.max(0.6, entry.info.radiusSrc * this.worldScale(entry) * 1.15)
      : 1;
    const geo = this.drapedRingGeometry(p.x, p.z, radius);
    if (this.selectionRing) {
      this.selectionRing.geometry.dispose();
      this.selectionRing.geometry = geo;
    } else {
      this.selectionRing = new THREE.Mesh(geo, this.selectionMat);
      this.selectionRing.renderOrder = 2;
      this.group.add(this.selectionRing);
    }
    this.selectionRing.position.set(p.x, 0, p.z);
  }
}
