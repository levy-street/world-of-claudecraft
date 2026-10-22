import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getActiveWorldContent } from '../sim/data';
import { FENBRIDGE_BUILDINGS_BY_ID, FENBRIDGE_LAYOUT, localToWorld } from '../sim/fenbridge_layout';
import {
  forEachSegmentFootprintSample,
  type PitchedSegmentPlacement,
  pitchedSegmentPlacement,
  type SegmentPoint,
} from '../sim/pitched_segment';
import type { BuildingDef, ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { civicGroundY } from '../sim/world_layout/civic';
import { loadGltf, releaseGltf } from './assets/loader';
import { mediaAssetExists } from './assets/media';
import { registerDeferredPreload } from './assets/preload';
import { activeWorldHasAuthoredTown } from './authored_town_gate';
import { buildPlacedTownBuilding, isPlacedBuildingAsset } from './eastbrook_placed_building';
import { indexExactVertexTuples } from './exact_index_geometry';
import {
  applyFenbridgeTownSurfaceDetail,
  FENBRIDGE_SURFACE_NORMAL_SCALE,
  fenbridgeSemanticForColor,
  fenbridgeSurfaceAtlasMetadata,
  fenbridgeSurfaceAtlasTexture,
  fenbridgeSurfaceGeometry,
  fenbridgeSurfaceNormalTexture,
  fenbridgeSurfaceRoughnessTexture,
} from './fenbridge_surface_atlas';
import {
  type FenbridgeBuildingVisibilityTarget,
  fenbridgeBuildingVisibilityPlanInto,
  fenbridgeFogVisible,
  newFenbridgeBuildingVisibilityPlan,
} from './fenbridge_town_visibility_core';
import { EMISSIVE_GLOW, GFX, type GfxSettings, surfaceMat } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { type PlacedTextureTier, placedTextureTierPath } from './placed_texture_tier_core';
import { placedTownCullRadius } from './placed_town_buildings';
import { createPlacedTownInteriors } from './placed_town_interiors';
import { activeWorldPromoted } from './promoted_scenery_gate';
import type { RevealGateCore } from './reveal_gate_core';
import {
  isLowSceneryCullActive,
  prepareSceneryDetailRoot,
  sceneryClutterFar,
  sceneryStructureFar,
} from './scenery_detail';
import {
  newTownPiecewiseReveal,
  orderTownRootsNearestFirst,
  townPiecewiseRevealInto,
  townRootVisible,
  townStaticReveal,
} from './town_reveal_core';
import { modulateEmissiveByVertexColor } from './vertex_color_emissive';

const ROOT_NAME = 'fenbridgeTownRebuild';
const OVERLAY_NAME = 'fenbridgeCaptureOverlay';
// The town-wide cull and imminent-reveal circle round the hub centre. Every
// static batch (the boardwalks, the cistern, the stall, the muster board)
// stands inside the hub ring; the margin keeps the circle where the walled
// town had it (half a palisade wing past the ring), so opening the town moved
// no cull and no reveal. Stood grand, the north street's shops reach past that
// circle, so it grows to hold every building's own cull circle whole, the
// placed-town rule (placed_town_buildings.ts): the town's fog answer never
// hides a building its own cull still draws.
const TOWN_CULL_MARGIN_YD = 6;
const TOWN_CULL_RADIUS = placedTownCullRadius(FENBRIDGE_LAYOUT, TOWN_CULL_MARGIN_YD);
/** The one reveal-gate key of the town's static content. */
const STATIC_REVEAL_KEY = 'fenbridge-town-static';

// Fenbridge stands open: no palisade wing or gate arch is drawn or loaded
// here (their GLBs stay shipped for Studio).
const PROP_ASSET_URLS = Object.freeze([
  ...FENBRIDGE_LAYOUT.buildings.map((building) => building.assetId),
  FENBRIDGE_LAYOUT.civic.cistern.assetId,
  FENBRIDGE_LAYOUT.civic.provisionStall.assetId,
  FENBRIDGE_LAYOUT.civic.musterBoard.assetId,
  FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId,
]);
/** The painted Tidehold buildings (eastbrook_placed_building.ts): drawn with
 *  their own materials, never baked into the town's vertex-colour batches, and
 *  loaded from the file of the profile's texture tier. */
const BUILDING_ASSET_URLS = Object.freeze([
  ...new Set(FENBRIDGE_LAYOUT.buildings.map((building) => building.assetId)),
]);
const QUEST_ASSET_URL = FENBRIDGE_LAYOUT.repeated.musterOrders[0].assetId;
const ALL_ASSET_URLS = Object.freeze([...PROP_ASSET_URLS, QUEST_ASSET_URL]);

const REQUIRED_PLACEMENT_IDS = Object.freeze([
  ...FENBRIDGE_LAYOUT.buildings.map((building) => building.id),
  FENBRIDGE_LAYOUT.civic.cistern.id,
  FENBRIDGE_LAYOUT.civic.provisionStall.id,
  FENBRIDGE_LAYOUT.civic.musterBoard.id,
]);

const ASSET_PLACEMENT_COUNTS = Object.freeze({
  fenbridge_boardwalk: FENBRIDGE_LAYOUT.repeated.boardwalks.length,
  fenbridge_muster_order: FENBRIDGE_LAYOUT.repeated.musterOrders.length,
});

const ASSET_INSTANCE_COUNTS = (() => {
  const counts: Record<string, number> = {};
  const add = (url: string, count = 1): void => {
    counts[url] = (counts[url] ?? 0) + count;
  };
  for (const building of FENBRIDGE_LAYOUT.buildings) add(building.assetId);
  add(FENBRIDGE_LAYOUT.civic.cistern.assetId);
  add(FENBRIDGE_LAYOUT.civic.provisionStall.assetId);
  add(FENBRIDGE_LAYOUT.civic.musterBoard.assetId);
  add(FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId, FENBRIDGE_LAYOUT.repeated.boardwalks.length);
  add(QUEST_ASSET_URL, FENBRIDGE_LAYOUT.repeated.musterOrders.length);
  return Object.freeze(counts);
})();

const loadedSources = new Map<string, THREE.Group>();
const preparedTemplates = new Map<string, TownAssetTemplate>();
const sourceLoadTasks = new Map<string, Promise<void>>();
/** The indoor camera's rooms of the live view's walk-in buildings (dropped when the next
 *  view builds). */
const cameraInteriors = createPlacedTownInteriors();
/** The FILE each resident source was read from. A painted building's URL
 *  names the model; the file follows the profile's texture tier (same
 *  geometry, see placed_texture_tier_core.ts), so everything else here stays
 *  keyed on the URL and a tier change is one replaced source. */
const loadedSourceFiles = new Map<string, string>();

function prepareTownSource(url: string, tier: PlacedTextureTier = GFX.placedTextureTier) {
  const file = isPlacedBuildingAsset(url)
    ? placedTextureTierPath(url, tier, mediaAssetExists)
    : url;
  const residentFile = loadedSourceFiles.get(url);
  if (loadedSources.has(url) && residentFile === file) return Promise.resolve();
  const existing = sourceLoadTasks.get(url);
  if (existing) return existing;
  const task = loadGltf(file)
    .then((gltf) => {
      loadedSources.set(url, gltf.scene);
      loadedSourceFiles.set(url, file);
      // The tier this replaces is no longer wanted: drop its cache entry (the
      // retiring view's clones keep its textures alive until they go).
      if (residentFile !== undefined && residentFile !== file) releaseGltf(residentFile);
      sourceLoadTasks.delete(url);
    })
    .catch((err) => {
      sourceLoadTasks.delete(url);
      throw err;
    });
  sourceLoadTasks.set(url, task);
  return task;
}

/**
 * Only the painted buildings follow the graphics profile (their texture
 * tier). `target` is the profile about to be activated: a rebuild prepares
 * its assets BEFORE the live settings switch, so the tier must come from the
 * target, never from the profile being retired.
 */
export function prepareFenbridgeTownProfileAssets(
  target: Pick<GfxSettings, 'placedTextureTier'> = GFX,
): Promise<void> {
  return Promise.all(
    BUILDING_ASSET_URLS.map((url) => prepareTownSource(url, target.placedTextureTier)),
  ).then(() => undefined);
}

/** A rebuild re-reads each painted building from the source its tier loaded. */
export function resetFenbridgeTownProfileCaches(): void {
  for (const url of BUILDING_ASSET_URLS) preparedTemplates.delete(url);
}

if (typeof window !== 'undefined') {
  // The quest renderer owns the muster-order GLB's one preload/cache/release
  // lifecycle. This town renderer declares and inventories that URL, but only
  // prepares the prop templates and painted buildings it actually draws.
  for (const url of PROP_ASSET_URLS) {
    registerDeferredPreload(() => prepareTownSource(url));
  }
}

type GroundAt = (x: number, z: number) => number;

interface TownAssetTemplate {
  opaque: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  size: THREE.Vector3;
  triangles: number;
  /** Painted buildings only: the loaded model scene, drawn with its own
   *  materials (eastbrook_placed_building.ts). */
  raw?: THREE.Object3D;
}

interface SurfaceTextures {
  atlas: THREE.Texture | undefined;
  normal: THREE.Texture | undefined;
  roughness: THREE.Texture | undefined;
}

interface BuildingHideTarget extends FenbridgeBuildingVisibilityTarget {
  group: THREE.Group;
  materials: OccluderFadeMat[];
  interiors: readonly THREE.Object3D[];
  interiorsVisible: boolean;
  hidden: boolean;
  alpha: number;
}

export interface FenbridgeTownView {
  group: THREE.Group;
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
  setCaptureOverlay(visible: boolean): void;
  /**
   * First-reveal compile gating (hitch-hunt P3a): the static batches' first
   * fog-cull reveal is held hidden until the gate warms the town key, so a
   * cold approach never links the town's programs inside a live frame. No
   * gate keeps the historical immediate reveal.
   */
  setRevealGate(gate: RevealGateCore | null): void;
  /** The compile roots behind the town's reveal key (the static batches). */
  staticRevealRoots(): readonly THREE.Object3D[];
}

export interface FenbridgeTownDrawStats {
  colorDraws: number;
  shadowDraws: number;
  triangles: number;
  buildingCount: number;
  buildingFadeTargetCount: number;
  microBatchCount: number;
  repeatedBatchCount: number;
  boardwalkCount: number;
}

export interface FenbridgeTownTriangleBudget {
  assetTriangles: number;
  maximumFoundationTriangles: number;
  maximumRuntimeTriangles: number;
  hardCeiling: number;
  withinHardCeiling: boolean;
  assets: Array<{
    assetUrl: string;
    instances: number;
    trianglesPerInstance: number;
    repeatedTriangles: number;
  }>;
}

function runtimeSurfaceTextures(): SurfaceTextures {
  return {
    atlas: fenbridgeSurfaceAtlasTexture(),
    normal: fenbridgeSurfaceNormalTexture(),
    roughness: fenbridgeSurfaceRoughnessTexture(),
  };
}

function toFloatAttr(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let index = 0; index < attr.count; index++) {
    out[index * itemSize] = attr.getX(index);
    if (itemSize > 1) out[index * itemSize + 1] = attr.getY(index);
    if (itemSize > 2) out[index * itemSize + 2] = attr.getZ(index);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function sourceMaterialColor(material: THREE.Material): THREE.Color {
  const source = material as THREE.Material & { color?: THREE.Color };
  return source.color?.clone() ?? new THREE.Color(0xffffff);
}

function materialIsEmissive(material: THREE.Material): boolean {
  const source = material as THREE.Material & { emissive?: THREE.Color };
  return (
    material.name.toLowerCase().includes('emissive') ||
    (source.emissive !== undefined && source.emissive.getHex() !== 0)
  );
}

function geometryFromMesh(
  mesh: THREE.Mesh,
  material: THREE.Material,
  url: string,
): THREE.BufferGeometry {
  const source = mesh.geometry;
  const position = source.getAttribute('position');
  if (!position) throw new Error(`Fenbridge town asset has no positions: ${url}`);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', toFloatAttr(position, 3));
  const normal = source.getAttribute('normal');
  if (normal) geometry.setAttribute('normal', toFloatAttr(normal, 3));
  const sourceColor = source.getAttribute('color');
  const tint = sourceMaterialColor(material);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    colors[index * 3] = (sourceColor?.getX(index) ?? 1) * tint.r;
    colors[index * 3 + 1] = (sourceColor?.getY(index) ?? 1) * tint.g;
    colors[index * 3 + 2] = (sourceColor?.getZ(index) ?? 1) * tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
  const finalColor = normalized.getAttribute('color');
  return indexExactVertexTuples(
    fenbridgeSurfaceGeometry(normalized, (index) =>
      fenbridgeSemanticForColor(
        finalColor.getX(index),
        finalColor.getY(index),
        finalColor.getZ(index),
      ),
    ),
  );
}

function mergeParts(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`Could not merge Fenbridge town ${label} geometry`);
  return merged;
}

function extractTemplate(source: THREE.Object3D, url: string): TownAssetTemplate {
  // Loader-cache outputs are immutable shared resources. Clone the hierarchy,
  // then rebuild every geometry attribute before normalization.
  const instance = source.clone(true);
  instance.updateMatrixWorld(true);
  const opaqueParts: THREE.BufferGeometry[] = [];
  const emissiveParts: THREE.BufferGeometry[] = [];
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (materials.length !== 1) {
      throw new Error(`Fenbridge town asset uses an unsupported material array: ${url}`);
    }
    const geometry = geometryFromMesh(child, materials[0], url);
    (materialIsEmissive(materials[0]) ? emissiveParts : opaqueParts).push(geometry);
  });
  if (opaqueParts.length === 0 && emissiveParts.length === 0) {
    throw new Error(`Fenbridge town asset has no meshes: ${url}`);
  }

  const box = new THREE.Box3();
  for (const geometry of [...opaqueParts, ...emissiveParts]) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox as THREE.Box3);
  }
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  for (const geometry of [...opaqueParts, ...emissiveParts]) {
    geometry.translate(-centerX, -box.min.y, -centerZ);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  let opaque = mergeParts(opaqueParts, `${url} opaque`);
  let emissive = mergeParts(emissiveParts, `${url} emissive`);
  // Low preserves the exact same silhouettes and placements but folds authored
  // glow triangles into the Lambert color pass, one draw per batch instead of
  // two. (The painted buildings draw their own materials and are not batched.)
  if (!GFX.standardMaterials && emissive) {
    opaque = mergeParts([...(opaque ? [opaque] : []), emissive], `${url} low combined surface`);
    emissive = null;
  }
  const triangles = [...(opaque ? [opaque] : []), ...(emissive ? [emissive] : [])].reduce(
    (sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute('position').count) / 3,
    0,
  );
  return { opaque, emissive, size: box.getSize(new THREE.Vector3()), triangles };
}

function placedTemplate(source: THREE.Object3D): TownAssetTemplate {
  const box = new THREE.Box3().setFromObject(source);
  let triangles = 0;
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.getAttribute('position');
    triangles += (child.geometry.index?.count ?? position?.count ?? 0) / 3;
  });
  return {
    opaque: null,
    emissive: null,
    size: box.getSize(new THREE.Vector3()),
    triangles,
    raw: source,
  };
}

function prepareTemplates(
  sources: ReadonlyMap<string, THREE.Object3D>,
  cache: Map<string, TownAssetTemplate>,
  release: boolean,
): Map<string, TownAssetTemplate> {
  for (const url of PROP_ASSET_URLS) {
    if (cache.has(url)) continue;
    const source = sources.get(url);
    if (!source) throw new Error(`Fenbridge town asset was not preloaded: ${url}`);
    if (isPlacedBuildingAsset(url)) {
      // The raw scene rides the template cache, and its GLB cache entry is
      // never released: every building's clones share its textures.
      cache.set(url, placedTemplate(source));
      continue;
    }
    cache.set(url, extractTemplate(source, url));
    if (release) {
      loadedSources.delete(url);
      releaseGltf(url);
    }
  }
  return cache;
}

function materialOptions(emissive: boolean, textures: SurfaceTextures) {
  const pbr = !emissive && GFX.standardMaterials;
  const normalMap = pbr ? textures.normal : undefined;
  const roughnessMap = pbr ? textures.roughness : undefined;
  return {
    color: 0xffffff,
    map: emissive ? undefined : textures.atlas,
    // The atlas owns opaque semantic albedo. If it is unavailable, authored
    // COLOR_0 remains a complete Low and Standard fallback. Standard emissive
    // surfaces also keep COLOR_0 so amber and cyan can share one primitive.
    vertexColors: emissive || !textures.atlas,
    normalMap,
    roughnessMap,
    roughness: emissive ? 0.5 : roughnessMap ? 1 : 0.88,
    metalness: emissive ? 0.04 : 0,
    emissive: emissive ? 0xffffff : 0x000000,
    emissiveIntensity: emissive
      ? GFX.standardMaterials && GFX.composer
        ? EMISSIVE_GLOW
        : GFX.standardMaterials
          ? 1
          : 0
      : 1,
    flatShading: !GFX.standardMaterials,
  } as const;
}

function townMaterial(
  emissive: boolean,
  textures: SurfaceTextures,
  independent = false,
): THREE.Material {
  // FrontSide stays spelled out: the side is part of surfaceMat's dedupe key,
  // so this keeps every batch on the shared entry it has always drawn with.
  const options = {
    ...materialOptions(emissive, textures),
    side: THREE.FrontSide,
  };
  // The shared response texture packs roughness in green and semantic metalness
  // in blue, so aged iron/brass can read distinctly without a fourth town-wide
  // texture allocation. It rides in the OPTIONS: surfaceMat dedupes by key and
  // metalnessMap is a program-cache-key input, so writing it onto the returned
  // shared entry relinked every material already drawing with it.
  const shared = surfaceMat(
    options.normalMap ? { ...options, metalness: 1, metalnessMap: options.roughnessMap } : options,
  );
  if (shared instanceof THREE.MeshStandardMaterial && shared.normalMap) {
    shared.normalScale.setScalar(FENBRIDGE_SURFACE_NORMAL_SCALE);
  }
  // Hook-preserving clone: a bare clone dropped the zone-haze hook and split
  // the program cache key, so each independent building material linked a new
  // program at first sight (the town's share of the first-contact burst).
  const material = independent ? cloneMaterialWithHooks(shared) : shared;
  return emissive
    ? modulateEmissiveByVertexColor(material)
    : applyFenbridgeTownSurfaceDetail(material);
}

function addPlacedGeometry(
  out: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry | null,
  matrix: THREE.Matrix4,
): void {
  if (geometry) out.push(geometry.clone().applyMatrix4(matrix));
}

function placementMatrix(
  template: TownAssetTemplate,
  x: number,
  y: number,
  z: number,
  rotation: number,
  width: number,
  height: number,
  depth: number,
  pitch = 0,
): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, rotation, pitch, 'YZX'),
  );
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    quaternion,
    new THREE.Vector3(width / template.size.x, height / template.size.y, depth / template.size.z),
  );
}

function pitchedFootprintPlacement(
  center: SegmentPoint,
  rotation: number,
  length: number,
  width: number,
  groundAt: GroundAt,
): PitchedSegmentPlacement {
  const start = localToWorld(center, rotation, -length / 2, 0);
  const end = localToWorld(center, rotation, length / 2, 0);
  return pitchedSegmentPlacement(start, end, width, groundAt);
}

function microPlacements() {
  // A document that owns the square's dressing as placements
  // (promotedScenery.authoredTownDressing) draws the cistern, the stall and
  // the muster board itself.
  if (activeWorldPromoted('authoredTownDressing')) return [];
  const cistern = FENBRIDGE_LAYOUT.civic.cistern;
  const stall = FENBRIDGE_LAYOUT.civic.provisionStall;
  const board = FENBRIDGE_LAYOUT.civic.musterBoard;
  return [
    {
      id: cistern.id,
      assetId: cistern.assetId,
      position: cistern.position,
      rotation: cistern.rotation,
      width: cistern.nativeDimensions.width,
      height: cistern.nativeDimensions.height,
      depth: cistern.nativeDimensions.depth,
    },
    {
      id: stall.id,
      assetId: stall.assetId,
      position: stall.position,
      rotation: stall.rotation,
      width: stall.width,
      height: stall.height,
      depth: stall.depth,
    },
    {
      id: board.id,
      assetId: board.assetId,
      position: board.position,
      rotation: board.rotation,
      width: board.nativeDimensions.width,
      height: board.nativeDimensions.height,
      depth: board.nativeDimensions.depth,
    },
  ] as const;
}

function buildMicroBatches(
  templates: ReadonlyMap<string, TownAssetTemplate>,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): THREE.Mesh[] {
  const opaque: THREE.BufferGeometry[] = [];
  const emissive: THREE.BufferGeometry[] = [];
  const placementIds: string[] = [];
  for (const placement of microPlacements()) {
    const template = templates.get(placement.assetId);
    if (!template) throw new Error(`Fenbridge town template is missing: ${placement.assetId}`);
    const matrix = placementMatrix(
      template,
      placement.position.x,
      civicGroundY(placement.id, placement.position, groundAt),
      placement.position.z,
      placement.rotation,
      placement.width,
      placement.height,
      placement.depth,
    );
    addPlacedGeometry(opaque, template.opaque, matrix);
    addPlacedGeometry(emissive, template.emissive, matrix);
    placementIds.push(placement.id);
  }

  const batches: THREE.Mesh[] = [];
  const opaqueGeometry = mergeParts(opaque, 'micro opaque batch');
  if (opaqueGeometry) {
    const mesh = new THREE.Mesh(opaqueGeometry, townMaterial(false, textures));
    mesh.name = 'fenbridgeTownMicroOpaqueBatch';
    mesh.castShadow = GFX.dynamicShadows;
    mesh.receiveShadow = GFX.dynamicShadows;
    mesh.userData.fenbridgeMicroBatch = 'opaque';
    mesh.userData.placementIds = placementIds;
    mesh.userData.neverBuildingFadeTarget = true;
    batches.push(mesh);
  }
  const emissiveGeometry = mergeParts(emissive, 'micro emissive batch');
  if (emissiveGeometry) {
    const mesh = new THREE.Mesh(emissiveGeometry, townMaterial(true, textures));
    mesh.name = 'fenbridgeTownMicroEmissiveBatch';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.fenbridgeMicroBatch = 'emissive';
    mesh.userData.placementIds = placementIds;
    mesh.userData.neverBuildingFadeTarget = true;
    batches.push(mesh);
  }
  return batches;
}

interface InstancePlacement {
  id: string;
  matrix: THREE.Matrix4;
}

function repeatedInstanceMesh(
  geometry: THREE.BufferGeometry | null,
  material: THREE.Material,
  placements: readonly InstancePlacement[],
  name: string,
  assetKey: keyof typeof ASSET_PLACEMENT_COUNTS,
  emissive: boolean,
  castShadow: boolean,
  evidence: boolean,
): THREE.InstancedMesh | null {
  if (!geometry || placements.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = name;
  for (let index = 0; index < placements.length; index++) {
    mesh.setMatrixAt(index, placements[index].matrix);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.castShadow = !emissive && castShadow && GFX.dynamicShadows;
  mesh.receiveShadow = !emissive && GFX.dynamicShadows;
  mesh.frustumCulled = true;
  mesh.userData.fenbridgeRepeatedInstances = true;
  mesh.userData.placementIds = placements.map((placement) => placement.id);
  mesh.userData.placementCount = placements.length;
  mesh.userData.neverBuildingFadeTarget = true;
  if (evidence) mesh.userData.assetKey = assetKey;
  else mesh.userData.fenbridgeAssetPart = assetKey;
  return mesh;
}

function buildRepeatedBatches(
  template: TownAssetTemplate,
  placements: readonly InstancePlacement[],
  name: string,
  assetKey: keyof typeof ASSET_PLACEMENT_COUNTS,
  textures: SurfaceTextures,
  castShadow: boolean,
): THREE.InstancedMesh[] {
  const opaque = repeatedInstanceMesh(
    template.opaque,
    townMaterial(false, textures),
    placements,
    `${name}OpaqueInstances`,
    assetKey,
    false,
    castShadow,
    true,
  );
  const emissive = repeatedInstanceMesh(
    template.emissive,
    townMaterial(true, textures),
    placements,
    `${name}EmissiveInstances`,
    assetKey,
    true,
    false,
    opaque === null,
  );
  return [opaque, emissive].filter((mesh): mesh is THREE.InstancedMesh => mesh !== null);
}

function buildBoardwalkBatches(
  template: TownAssetTemplate,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): THREE.InstancedMesh[] {
  const boardwalks = activeWorldPromoted('authoredTownDressing')
    ? []
    : FENBRIDGE_LAYOUT.repeated.boardwalks;
  const placements = boardwalks.map((boardwalk) => {
    const terrain = pitchedFootprintPlacement(
      boardwalk.position,
      boardwalk.rotation,
      boardwalk.nativeDimensions.width,
      boardwalk.nativeDimensions.depth,
      groundAt,
    );
    return {
      id: boardwalk.id,
      matrix: placementMatrix(
        template,
        terrain.centerX,
        terrain.centerY,
        terrain.centerZ,
        terrain.rotation,
        terrain.spatialLength,
        boardwalk.nativeDimensions.height,
        boardwalk.nativeDimensions.depth,
        terrain.pitch,
      ),
    };
  });
  return buildRepeatedBatches(
    template,
    placements,
    'fenbridgeTownBoardwalk',
    'fenbridge_boardwalk',
    textures,
    false,
  );
}

function addObbOutline(
  vertices: number[],
  footprint: {
    center: { x: number; z: number };
    halfWidth: number;
    halfDepth: number;
    rotation: number;
  },
  groundAt: GroundAt,
): void {
  const corners = [
    localToWorld(footprint.center, footprint.rotation, -footprint.halfWidth, -footprint.halfDepth),
    localToWorld(footprint.center, footprint.rotation, footprint.halfWidth, -footprint.halfDepth),
    localToWorld(footprint.center, footprint.rotation, footprint.halfWidth, footprint.halfDepth),
    localToWorld(footprint.center, footprint.rotation, -footprint.halfWidth, footprint.halfDepth),
  ];
  for (let index = 0; index < corners.length; index++) {
    const first = corners[index];
    const second = corners[(index + 1) % corners.length];
    vertices.push(
      first.x,
      groundAt(first.x, first.z) + 0.22,
      first.z,
      second.x,
      groundAt(second.x, second.z) + 0.22,
      second.z,
    );
  }
}

function addCircleOutline(
  vertices: number[],
  x: number,
  z: number,
  radius: number,
  groundAt: GroundAt,
): void {
  const steps = 24;
  for (let index = 0; index < steps; index++) {
    const firstAngle = (index / steps) * Math.PI * 2;
    const secondAngle = ((index + 1) / steps) * Math.PI * 2;
    const firstX = x + Math.cos(firstAngle) * radius;
    const firstZ = z + Math.sin(firstAngle) * radius;
    const secondX = x + Math.cos(secondAngle) * radius;
    const secondZ = z + Math.sin(secondAngle) * radius;
    vertices.push(
      firstX,
      groundAt(firstX, firstZ) + 0.22,
      firstZ,
      secondX,
      groundAt(secondX, secondZ) + 0.22,
      secondZ,
    );
  }
}

function lineSegments(name: string, vertices: number[], color: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = name;
  lines.renderOrder = 1000;
  lines.frustumCulled = false;
  return lines;
}

function buildCaptureOverlay(groundAt: GroundAt): THREE.Group {
  const overlay = new THREE.Group();
  overlay.name = OVERLAY_NAME;
  overlay.visible = false;
  const musterBoards = getActiveWorldContent().services?.musterBoards ?? [];

  const colliderRecords: Array<Record<string, unknown>> = [];
  const colliderVertices: number[] = [];
  for (const building of FENBRIDGE_LAYOUT.buildings) {
    for (const box of [building.footprint, ...building.annexes]) {
      colliderRecords.push({ kind: 'obb', ...box });
      addObbOutline(colliderVertices, box, groundAt);
    }
  }
  const cistern = FENBRIDGE_LAYOUT.civic.cistern;
  colliderRecords.push({
    id: cistern.id,
    kind: 'circle',
    x: cistern.position.x,
    z: cistern.position.z,
    radius: cistern.radius,
  });
  addCircleOutline(
    colliderVertices,
    cistern.position.x,
    cistern.position.z,
    cistern.radius,
    groundAt,
  );
  const stallFootprint = FENBRIDGE_LAYOUT.civic.provisionStall.footprint;
  colliderRecords.push({ kind: 'obb', ...stallFootprint });
  addObbOutline(colliderVertices, stallFootprint, groundAt);
  for (const board of musterBoards) {
    const footprint = {
      id: board.id,
      center: { x: board.x, z: board.z },
      halfWidth: board.width / 2,
      halfDepth: board.depth / 2,
      rotation: board.rotation,
    };
    colliderRecords.push({ kind: 'obb', ...footprint });
    addObbOutline(colliderVertices, footprint, groundAt);
  }
  overlay.add(lineSegments('fenbridgeCaptureColliderLines', colliderVertices, 0xff4b4b));

  const routeRecords = FENBRIDGE_LAYOUT.roads.map((road) => ({
    id: road.id,
    gateId: road.gateId,
    halfWidth: road.halfWidth,
    points: road.points,
  }));
  const routeVertices: number[] = [];
  for (const road of FENBRIDGE_LAYOUT.roads) {
    for (let index = 0; index < road.points.length - 1; index++) {
      const first = road.points[index];
      const second = road.points[index + 1];
      routeVertices.push(
        first.x,
        groundAt(first.x, first.z) + 0.3,
        first.z,
        second.x,
        groundAt(second.x, second.z) + 0.3,
        second.z,
      );
    }
  }
  overlay.add(lineSegments('fenbridgeCaptureRouteLines', routeVertices, 0x33f0dc));

  const serviceRecords = [
    ...FENBRIDGE_LAYOUT.services.npcs.map((npc) => ({
      id: npc.id,
      kind: 'npc',
      position: npc.position,
      anchorId: npc.anchorId,
    })),
    ...FENBRIDGE_LAYOUT.services.stations.map((station) => ({
      id: station.id,
      kind: 'station',
      position: station.position,
    })),
    ...FENBRIDGE_LAYOUT.repeated.musterOrders.map((order) => ({
      id: order.id,
      kind: 'quest-object',
      position: order.position,
    })),
    {
      id: FENBRIDGE_LAYOUT.services.bank.teller.id,
      kind: 'bank-teller',
      position: FENBRIDGE_LAYOUT.services.bank.teller.standingPoint,
    },
    {
      id: FENBRIDGE_LAYOUT.services.mailbox.id,
      kind: 'mailbox',
      position: FENBRIDGE_LAYOUT.services.mailbox.position,
    },
    {
      id: FENBRIDGE_LAYOUT.services.graveyard.id,
      kind: 'graveyard',
      position: FENBRIDGE_LAYOUT.services.graveyard.position,
    },
    {
      id: FENBRIDGE_LAYOUT.services.rest.id,
      kind: 'rest',
      position:
        FENBRIDGE_BUILDINGS_BY_ID[FENBRIDGE_LAYOUT.services.rest.buildingId].frontStandingPoint,
    },
    ...musterBoards.map((board) => ({
      id: board.id,
      kind: 'muster-board',
      position: board.frontStandingPoint,
    })),
  ];
  const serviceVertices: number[] = [];
  for (const service of serviceRecords) {
    const y = groundAt(service.position.x, service.position.z) + 0.38;
    const radius = 0.45;
    serviceVertices.push(
      service.position.x - radius,
      y,
      service.position.z,
      service.position.x + radius,
      y,
      service.position.z,
      service.position.x,
      y,
      service.position.z - radius,
      service.position.x,
      y,
      service.position.z + radius,
    );
  }
  overlay.add(lineSegments('fenbridgeCaptureServiceLines', serviceVertices, 0xffd34d));

  const captureRecords = {
    colliders: colliderRecords,
    routes: routeRecords,
    services: serviceRecords,
  };
  overlay.userData.captureRecords = captureRecords;
  overlay.userData.recordCounts = {
    colliders: colliderRecords.length,
    routes: routeRecords.length,
    services: serviceRecords.length,
  };
  overlay.userData.layoutId = FENBRIDGE_LAYOUT.id;
  return overlay;
}

function buildMusterOrderEvidence(groundAt: GroundAt): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fenbridgeMusterOrderPlacements';
  group.userData.assetKey = 'fenbridge_muster_order';
  group.userData.placementCount = FENBRIDGE_LAYOUT.repeated.musterOrders.length;
  group.userData.placementIds = FENBRIDGE_LAYOUT.repeated.musterOrders.map((order) => order.id);
  group.userData.renderOwner = 'quest_objects';
  group.userData.noDuplicateTownMesh = true;
  for (const order of FENBRIDGE_LAYOUT.repeated.musterOrders) {
    const anchor = new THREE.Object3D();
    anchor.name = `fenbridgeMusterOrderAnchor:${order.id}`;
    anchor.position.set(
      order.position.x,
      groundAt(order.position.x, order.position.z),
      order.position.z,
    );
    anchor.userData.placementId = order.id;
    anchor.userData.itemId = order.itemId;
    anchor.userData.assetUrl = order.assetId;
    anchor.userData.renderOwner = 'quest_objects';
    group.add(anchor);
  }
  return group;
}

function zeroPlacementCounts(): Record<keyof typeof ASSET_PLACEMENT_COUNTS, number> {
  return {
    fenbridge_boardwalk: 0,
    fenbridge_muster_order: 0,
  };
}

function buildFromTemplates(
  templates: ReadonlyMap<string, TownAssetTemplate>,
  groundAt: GroundAt,
  builtInWorld: boolean,
  textures: SurfaceTextures,
): FenbridgeTownView {
  const group = new THREE.Group();
  group.name = ROOT_NAME;
  group.userData.layoutId = FENBRIDGE_LAYOUT.id;
  group.userData.builtInOnly = true;
  group.userData.assetUrls = builtInWorld ? ALL_ASSET_URLS : [];
  group.userData.placementIds = builtInWorld ? REQUIRED_PLACEMENT_IDS : [];
  group.userData.assetPlacementCounts = builtInWorld
    ? ASSET_PLACEMENT_COUNTS
    : zeroPlacementCounts();
  group.userData.assetInstanceCounts = builtInWorld ? ASSET_INSTANCE_COUNTS : {};
  group.userData.placementInventory = {
    required: builtInWorld ? REQUIRED_PLACEMENT_IDS : [],
    repeated: group.userData.assetPlacementCounts,
  };
  group.userData.buildingIds = [];
  group.userData.buildingFadeTargetCount = 0;
  group.userData.microBatchNames = [];
  group.userData.repeatedBatchNames = [];
  group.userData.boardwalkCount = 0;
  // the previous view's rooms go with it: a world without the town keeps no air
  cameraInteriors.clear();

  if (!builtInWorld) {
    const setCaptureOverlay = (): void => undefined;
    group.userData.setFenbridgeCaptureOverlay = setCaptureOverlay;
    group.userData.drawStats = fenbridgeTownDrawStats(group);
    group.userData.triangleStats = {
      scope: 'fenbridge-town-render-root-only',
      renderedTriangles: 0,
      extractedPropTriangles: 0,
      emittedFoundationTriangles: 0,
      includesQuestObjects: false,
      informationalOnly: true,
    };
    return {
      group,
      update: () => undefined,
      setCaptureOverlay,
      setRevealGate: () => undefined,
      staticRevealRoots: () => [],
    };
  }

  const hideTargets: BuildingHideTarget[] = [];
  const buildingGroups: THREE.Object3D[] = [];
  // The document may own the town's BUILDINGS as placements (the
  // promoted-scenery contract): only the building loop stands down.
  const fenBuildingList = activeWorldPromoted('authoredTowns') ? [] : FENBRIDGE_LAYOUT.buildings;
  for (const building of fenBuildingList) {
    const template = templates.get(building.assetId);
    if (!template?.raw) {
      throw new Error(`Fenbridge town building is missing: ${building.assetId}`);
    }
    // A painted Tidehold building in the Fenrire look, stood as its layout
    // record says (eastbrook_placed_building.ts). A reveal root and a fade
    // target like every building, so the two lists stay index-aligned.
    const built = buildPlacedTownBuilding('fenbridge', building, template.raw, groundAt);
    built.group.userData.placementId = building.id;
    // a walk-in one keeps the indoor camera to its rooms (placed_town_interiors.ts), and its
    // doors keep it solid while the player steps in looking through one (the Highwatch rule)
    const interior = cameraInteriors.add(building, groundAt);
    group.add(built.group);
    hideTargets.push({
      group: built.group,
      materials: built.mats,
      interiors: built.interiors,
      interiorsVisible: true,
      hidden: false,
      alpha: 1,
      x: building.position.x,
      z: building.position.z,
      halfWidth: building.nativeDimensions.width / 2,
      halfDepth: building.nativeDimensions.depth / 2,
      cosine: Math.cos(building.rotation),
      sine: Math.sin(building.rotation),
      topY: built.topY,
      cullRadius: built.cullRadius,
      walkIn: building.walkIn,
      doorways: interior?.openings.map((opening) => interior.boxes[opening.box]),
      doorwayFrame: interior?.frame,
    });
    buildingGroups.push(built.group);
  }

  const microBatches = buildMicroBatches(templates, groundAt, textures);
  const microBatchCount = microBatches.length;
  for (const batch of microBatches) group.add(batch);

  const boardwalkUrl = FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId;
  const boardwalkTemplate = templates.get(boardwalkUrl);
  if (!boardwalkTemplate) throw new Error(`Fenbridge town template is missing: ${boardwalkUrl}`);
  const boardwalkBatches = buildBoardwalkBatches(boardwalkTemplate, groundAt, textures);
  for (const batch of boardwalkBatches) group.add(batch);

  const orderEvidence = buildMusterOrderEvidence(groundAt);
  group.add(orderEvidence);
  const overlay = buildCaptureOverlay(groundAt);
  group.add(overlay);

  const repeatedBatches = boardwalkBatches;
  const staticCullTargets: THREE.Object3D[] = [...microBatches, ...repeatedBatches];
  // The reveal gate compiles the buildings with the static batches: their
  // per-building materials (the emissive lantern variant above all) are not
  // shared with any batch, so a building outside the roots linked cold on the
  // frame its own fog cull first showed it (the prod 220 ms
  // fenbridgeTownEmissive row).
  const staticRevealRoots: THREE.Object3D[] = [...staticCullTargets, ...buildingGroups];
  // Piecewise reveal anchors, in staticRevealRoots order: a batch spans the
  // whole town so it anchors at the hub centre, a building at its own
  // footprint. hideTargets is built in the buildingGroups loop, so the two
  // stay index-aligned by construction.
  // Only the buildings are FOOTPRINT-anchored, so only they can take the reach
  // floor: a batch's centre anchor is an ordering hint, never an arm's-length
  // distance (a camera at the hub would flip every batch at once).
  const rootX: number[] = staticCullTargets.map(() => FENBRIDGE_LAYOUT.hub.center.x);
  const rootZ: number[] = staticCullTargets.map(() => FENBRIDGE_LAYOUT.hub.center.z);
  const rootFootprint: boolean[] = staticCullTargets.map(() => false);
  for (const target of hideTargets) {
    rootX.push(target.x);
    rootZ.push(target.z);
    rootFootprint.push(true);
  }
  const staticPiecewise = newTownPiecewiseReveal(
    STATIC_REVEAL_KEY,
    staticRevealRoots,
    rootX,
    rootZ,
    rootFootprint,
  );
  const visibilityPlan = newFenbridgeBuildingVisibilityPlan();
  const setCaptureOverlay = (visible: boolean): void => {
    overlay.visible = visible;
  };

  group.userData.setFenbridgeCaptureOverlay = setCaptureOverlay;
  group.userData.buildingIds = FENBRIDGE_LAYOUT.buildings.map((building) => building.id);
  group.userData.buildingFadeTargetCount = hideTargets.length;
  group.userData.microBatchNames = microBatches.map((batch) => batch.name);
  group.userData.repeatedBatchNames = repeatedBatches.map((batch) => batch.name);
  group.userData.boardwalkCount = FENBRIDGE_LAYOUT.repeated.boardwalks.length;
  group.userData.surfaceAtlas = fenbridgeSurfaceAtlasMetadata(group, textures.atlas);
  group.userData.captureContract = {
    layoutId: FENBRIDGE_LAYOUT.id,
    placementIds: REQUIRED_PLACEMENT_IDS,
    assetPlacementCounts: ASSET_PLACEMENT_COUNTS,
    assetUrls: ALL_ASSET_URLS,
    overlayName: OVERLAY_NAME,
    overlayRecordCounts: overlay.userData.recordCounts,
  };
  group.userData.fenbridgeCapture = group.userData.captureContract;
  const drawStats = fenbridgeTownDrawStats(group);
  group.userData.drawStats = drawStats;
  const extractedPropTriangles = PROP_ASSET_URLS.reduce((sum, url) => {
    const template = templates.get(url);
    return sum + (template?.triangles ?? 0) * (ASSET_INSTANCE_COUNTS[url] ?? 0);
  }, 0);
  group.userData.triangleStats = {
    scope: 'fenbridge-town-render-root-only',
    renderedTriangles: drawStats.triangles,
    extractedPropTriangles,
    emittedFoundationTriangles: Math.max(0, drawStats.triangles - extractedPropTriangles),
    includesQuestObjects: false,
    informationalOnly: true,
  };

  let revealGate: RevealGateCore | null = null;
  let staticRevealed = false;
  // The gate asks for the roots the moment the consult fires the request, so
  // these are the CAMERA's coordinates of that very frame: an arrival submits
  // the buildings it landed among before the far side of the town.
  let lastCamX = 0;
  let lastCamZ = 0;
  const orderedRevealRoots: THREE.Object3D[] = [];
  for (const root of [...staticCullTargets, ...buildingGroups]) prepareSceneryDetailRoot(root);
  return {
    group,
    setCaptureOverlay,
    setRevealGate(gate: RevealGateCore | null): void {
      revealGate = gate;
    },
    staticRevealRoots(): readonly THREE.Object3D[] {
      return orderTownRootsNearestFirst(
        staticRevealRoots,
        staticPiecewise.x,
        staticPiecewise.z,
        lastCamX,
        lastCamZ,
        orderedRevealRoots,
      );
    },
    update(
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
      dt: number,
      reducedMotion = false,
    ): void {
      lastCamX = camX;
      lastCamZ = camZ;
      const lowCull = isLowSceneryCullActive(fogFar);
      const clutterFar = sceneryClutterFar(fogFar);
      const structureFar = sceneryStructureFar(fogFar);
      const cullX = lowCull ? eyeX : camX;
      const cullZ = lowCull ? eyeZ : camZ;
      const hubDx = cullX - FENBRIDGE_LAYOUT.hub.center.x;
      const hubDz = cullZ - FENBRIDGE_LAYOUT.hub.center.z;
      const microVisible = fenbridgeFogVisible(
        cullX,
        cullZ,
        FENBRIDGE_LAYOUT.hub.center.x,
        FENBRIDGE_LAYOUT.hub.center.z,
        clutterFar,
        TOWN_CULL_RADIUS,
      );
      const reveal = townStaticReveal(
        fenbridgeFogVisible(
          cullX,
          cullZ,
          FENBRIDGE_LAYOUT.hub.center.x,
          FENBRIDGE_LAYOUT.hub.center.z,
          structureFar,
          TOWN_CULL_RADIUS,
        ),
        staticRevealed,
        hubDx * hubDx + hubDz * hubDz,
        TOWN_CULL_RADIUS,
        revealGate,
        STATIC_REVEAL_KEY,
      );
      if (reveal === 'revealed') staticRevealed = true;
      // While the key is held, each root that has linked comes in on its own,
      // nearest first: the whole town no longer waits for its slowest program.
      townPiecewiseRevealInto(staticPiecewise, reveal, camX, camZ, revealGate);
      for (let index = 0; index < staticCullTargets.length; index++) {
        staticCullTargets[index].visible =
          (index >= microBatchCount || microVisible) &&
          townRootVisible(reveal, staticPiecewise, index);
      }
      // Buildings keep their own fog cull and camera fade, but their FIRST
      // reveal rides the same hold as the batches: while the gate compiles
      // the town they stay hidden until their own group has linked, and once
      // the key is revealed the latch above never consults the gate again (a
      // fog re-entry is a plain cull flip).
      const buildingRootBase = staticCullTargets.length;
      for (let index = 0; index < hideTargets.length; index++) {
        const target = hideTargets[index];
        fenbridgeBuildingVisibilityPlanInto(
          visibilityPlan,
          target,
          target.hidden,
          camX,
          camY,
          camZ,
          eyeX,
          eyeY,
          eyeZ,
          structureFar,
          cullX,
          cullZ,
        );
        target.group.visible =
          visibilityPlan.visible &&
          townRootVisible(reveal, staticPiecewise, buildingRootBase + index);
        if (!visibilityPlan.visible) continue;
        const bDx = cullX - target.x;
        const bDz = cullZ - target.z;
        const interiorReach = target.cullRadius + 6;
        const showInteriors =
          !lowCull ||
          visibilityPlan.hidden ||
          bDx * bDx + bDz * bDz <= interiorReach * interiorReach;
        if (target.interiorsVisible !== showInteriors) {
          target.interiorsVisible = showInteriors;
          for (let i = 0; i < target.interiors.length; i++) {
            target.interiors[i].visible = showInteriors;
          }
        }
        prefetchOccluderFadeWithin(target.materials, target.x, target.z, camX, camZ);
        target.hidden = visibilityPlan.hidden;
        target.alpha = advanceOccluderFade(
          target.materials,
          target.alpha,
          target.hidden,
          dt,
          reducedMotion,
        );
      }
    },
  };
}

export function buildFenbridgeTownView(seed: number): FenbridgeTownView {
  // Extract once even if a custom world is currently active so loader-owned
  // prop GLTFs can be released and a later same-page switch remains sync.
  if (loadedSources.size > 0) prepareTemplates(loadedSources, preparedTemplates, true);
  // Data-gated, not identity-gated: an editor copy of the built-in world
  // still carries this town's buildings and must get its real art, or the
  // kit buildings it replaces draw in Studio instead (authored_town_gate.ts).
  if (!activeWorldHasAuthoredTown(isFenbridgeRebuildBuilding)) {
    return buildFromTemplates(preparedTemplates, () => 0, false, {
      atlas: undefined,
      normal: undefined,
      roughness: undefined,
    });
  }
  prepareTemplates(loadedSources, preparedTemplates, true);
  return buildFromTemplates(
    preparedTemplates,
    (x, z) => terrainHeight(x, z, seed),
    true,
    runtimeSurfaceTextures(),
  );
}

/** Stable-ID matching only; the props caller applies the built-in-world gate. */
export function isFenbridgeRebuildBuilding(building: BuildingDef): boolean {
  return FENBRIDGE_LAYOUT.buildings.some((candidate) => candidate.id === building.id);
}

/** Stable-ID matching only; the props caller applies the built-in-world gate. */
export function isFenbridgeRebuildWell(well: ZonePropsDef['wells'][number]): boolean {
  return well.id === FENBRIDGE_LAYOUT.civic.cistern.id;
}

/** Stable-ID matching only; the props caller applies the built-in-world gate. */
export function isFenbridgeRebuildStall(stall: ZonePropsDef['stalls'][number]): boolean {
  return stall.id === FENBRIDGE_LAYOUT.civic.provisionStall.id;
}

export function fenbridgeTownDrawStats(root: THREE.Object3D): FenbridgeTownDrawStats {
  let colorDraws = 0;
  let shadowDraws = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    colorDraws += Array.isArray(object.material) ? object.material.length : 1;
    if (object.castShadow) shadowDraws++;
    const position = object.geometry.getAttribute('position');
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    triangles += ((object.geometry.index?.count ?? position?.count ?? 0) / 3) * instances;
  });
  return {
    colorDraws,
    shadowDraws,
    triangles,
    buildingCount: Array.isArray(root.userData.buildingIds) ? root.userData.buildingIds.length : 0,
    buildingFadeTargetCount: Number(root.userData.buildingFadeTargetCount ?? 0),
    microBatchCount: Array.isArray(root.userData.microBatchNames)
      ? root.userData.microBatchNames.length
      : 0,
    repeatedBatchCount: Array.isArray(root.userData.repeatedBatchNames)
      ? root.userData.repeatedBatchNames.length
      : 0,
    boardwalkCount: Number(root.userData.boardwalkCount ?? 0),
  };
}

export function fenbridgeTownTriangleBudget(
  triangleCountByAsset: Readonly<Record<string, number>>,
): FenbridgeTownTriangleBudget {
  const assets = ALL_ASSET_URLS.map((assetUrl) => {
    const trianglesPerInstance = triangleCountByAsset[assetUrl];
    if (!Number.isFinite(trianglesPerInstance) || trianglesPerInstance < 0) {
      throw new Error(`Missing Fenbridge town triangle count: ${assetUrl}`);
    }
    const instances = ASSET_INSTANCE_COUNTS[assetUrl] ?? 0;
    return {
      assetUrl,
      instances,
      trianglesPerInstance,
      repeatedTriangles: instances * trianglesPerInstance,
    };
  });
  const assetTriangles = assets.reduce((sum, asset) => sum + asset.repeatedTriangles, 0);
  // A painted building buries its own footing and draws no skirt.
  const maximumFoundationTriangles =
    FENBRIDGE_LAYOUT.buildings.filter((building) => !isPlacedBuildingAsset(building.assetId))
      .length * 12;
  const maximumRuntimeTriangles = assetTriangles + maximumFoundationTriangles;
  // Raised with the concept-quality geometry pass so plank walls and shingle
  // courses can ship without a hard 40k wall. Still a real bound, not unbounded.
  const hardCeiling = 88_000;
  return {
    assetTriangles,
    maximumFoundationTriangles,
    maximumRuntimeTriangles,
    hardCeiling,
    withinHardCeiling: maximumRuntimeTriangles <= hardCeiling,
    assets,
  };
}

/** Test-only access to preload membership and deterministic construction. */
export const fenbridgeTownInternalsForTest = {
  rootName: ROOT_NAME,
  overlayName: OVERLAY_NAME,
  propAssetUrls: PROP_ASSET_URLS,
  buildingAssetUrls: BUILDING_ASSET_URLS,
  questAssetUrl: QUEST_ASSET_URL,
  allAssetUrls: ALL_ASSET_URLS,
  requiredPlacementIds: REQUIRED_PLACEMENT_IDS,
  assetPlacementCounts: ASSET_PLACEMENT_COUNTS,
  townCullRadius: TOWN_CULL_RADIUS,
  materialOptions,
  extractTemplate,
  forEachSegmentFootprintSample,
  pitchedSegmentPlacement,
  pitchedFootprintPlacement,
  buildFromSources(
    sources: ReadonlyMap<string, THREE.Object3D>,
    groundAt: GroundAt,
    builtIn: boolean,
    textures: Partial<SurfaceTextures> = {},
  ): FenbridgeTownView {
    if (!builtIn) {
      return buildFromTemplates(new Map<string, TownAssetTemplate>(), groundAt, false, {
        atlas: undefined,
        normal: undefined,
        roughness: undefined,
      });
    }
    const templates = prepareTemplates(sources, new Map<string, TownAssetTemplate>(), false);
    return buildFromTemplates(templates, groundAt, true, {
      atlas: textures.atlas,
      normal: textures.normal,
      roughness: textures.roughness,
    });
  },
};

/**
 * One town model as a standalone object drawn exactly as the town draws it
 * (the Eastbrook twin is eastbrookStyledPlacedObject): the extracted,
 * semantic-recoloured geometry under the town's surface materials, for the
 * Fenbridge-only models a Studio document promotes to placements. Both
 * materials are hook-preserving clones, never the shared entries the town's
 * batches draw with (placed batching patches whatever it is handed), and the
 * object is null until the town's atlas has loaded.
 */
export function fenbridgeStyledPlacedObject(
  source: THREE.Object3D,
  url: string,
): THREE.Object3D | null {
  const textures = runtimeSurfaceTextures();
  if (!textures.atlas) return null;
  const template = extractTemplate(source, url);
  const group = new THREE.Group();
  if (template.opaque) {
    const mesh = new THREE.Mesh(template.opaque, townMaterial(false, textures, true));
    mesh.castShadow = GFX.dynamicShadows;
    mesh.receiveShadow = GFX.dynamicShadows;
    group.add(mesh);
  }
  if (template.emissive) {
    group.add(new THREE.Mesh(template.emissive, townMaterial(true, textures, true)));
  }
  return group;
}

export const FENBRIDGE_TOWN_ROOT_NAME = ROOT_NAME;
export const FENBRIDGE_CAPTURE_OVERLAY_NAME = OVERLAY_NAME;
export const FENBRIDGE_TOWN_PROP_ASSET_URLS = PROP_ASSET_URLS;
export const FENBRIDGE_TOWN_ASSET_URLS = ALL_ASSET_URLS;
export const FENBRIDGE_TOWN_REQUIRED_PLACEMENT_IDS = REQUIRED_PLACEMENT_IDS;
export const FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS = ASSET_PLACEMENT_COUNTS;
