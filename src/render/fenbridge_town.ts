import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../sim/building_layout';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import {
  FENBRIDGE_BUILDINGS_BY_ID,
  FENBRIDGE_LAYOUT,
  localToWorld,
  palisadeSegmentMirrored,
} from '../sim/fenbridge_layout';
import type { BuildingDef, ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
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
import { EMISSIVE_GLOW, GFX, surfaceMat } from './gfx';
import { applyOccluderFade, type OccluderFadeMat, occluderFadeMat } from './occluder_fade';
import { occluderFadeSettled, stepOccluderFade } from './occluder_fade_core';
import { modulateEmissiveByVertexColor } from './vertex_color_emissive';

const ROOT_NAME = 'fenbridgeTownRebuild';
const OVERLAY_NAME = 'fenbridgeCaptureOverlay';
const FOUNDATION_OVERLAP = 0.03;
const FOUNDATION_COLOR = 0x4e5650;
const TOWN_CULL_RADIUS = FENBRIDGE_LAYOUT.hub.radius + FENBRIDGE_LAYOUT.wall.maximumSegmentSpan / 2;

const PROP_ASSET_URLS = Object.freeze([
  ...FENBRIDGE_LAYOUT.buildings.map((building) => building.assetId),
  FENBRIDGE_LAYOUT.civic.cistern.assetId,
  FENBRIDGE_LAYOUT.civic.provisionStall.assetId,
  FENBRIDGE_LAYOUT.civic.musterBoard.assetId,
  FENBRIDGE_LAYOUT.wall.assetId,
  FENBRIDGE_LAYOUT.wall.gates[0].arch.assetId,
  FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId,
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
  fenbridge_palisade_wing: FENBRIDGE_LAYOUT.wall.segments.length,
  fenbridge_gate_arch: FENBRIDGE_LAYOUT.wall.gates.length,
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
  add(FENBRIDGE_LAYOUT.wall.assetId, FENBRIDGE_LAYOUT.wall.segments.length);
  add(FENBRIDGE_LAYOUT.wall.gates[0].arch.assetId, FENBRIDGE_LAYOUT.wall.gates.length);
  add(FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId, FENBRIDGE_LAYOUT.repeated.boardwalks.length);
  add(QUEST_ASSET_URL, FENBRIDGE_LAYOUT.repeated.musterOrders.length);
  return Object.freeze(counts);
})();

const loadedSources = new Map<string, THREE.Group>();
const preparedTemplates = new Map<string, TownAssetTemplate>();

if (typeof window !== 'undefined') {
  // The quest renderer owns the muster-order GLB's one preload/cache/release
  // lifecycle. This town renderer declares and inventories that URL, but only
  // extracts the thirteen prop templates it actually draws.
  for (const url of PROP_ASSET_URLS) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        loadedSources.set(url, gltf.scene);
      }),
    );
  }
}

type GroundAt = (x: number, z: number) => number;

interface TownAssetTemplate {
  opaque: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  size: THREE.Vector3;
  triangles: number;
}

interface SurfaceTextures {
  atlas: THREE.Texture | undefined;
  normal: THREE.Texture | undefined;
  roughness: THREE.Texture | undefined;
}

interface BuildingHideTarget extends FenbridgeBuildingVisibilityTarget {
  group: THREE.Group;
  materials: OccluderFadeMat[];
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
}

export interface FenbridgeTownDrawStats {
  colorDraws: number;
  shadowDraws: number;
  triangles: number;
  buildingCount: number;
  buildingFadeTargetCount: number;
  microBatchCount: number;
  repeatedBatchCount: number;
  wallSegmentCount: number;
  gateCount: number;
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

function assetKeyFromUrl(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
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
  // glow triangles into the Lambert color pass to hold the town under 16 draws.
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

function prepareTemplates(
  sources: ReadonlyMap<string, THREE.Object3D>,
  cache: Map<string, TownAssetTemplate>,
  release: boolean,
): Map<string, TownAssetTemplate> {
  for (const url of PROP_ASSET_URLS) {
    if (cache.has(url)) continue;
    const source = sources.get(url);
    if (!source) throw new Error(`Fenbridge town asset was not preloaded: ${url}`);
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
  doubleSided = false,
): THREE.Material {
  const shared = surfaceMat({
    ...materialOptions(emissive, textures),
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (shared instanceof THREE.MeshStandardMaterial && shared.normalMap) {
    shared.normalScale.setScalar(FENBRIDGE_SURFACE_NORMAL_SCALE);
    // The shared response texture packs roughness in green and semantic
    // metalness in blue, so aged iron/brass can read distinctly without a
    // fourth town-wide texture allocation.
    shared.metalness = 1;
    shared.metalnessMap = shared.roughnessMap;
  }
  const material = independent ? shared.clone() : shared;
  return emissive
    ? modulateEmissiveByVertexColor(material)
    : applyFenbridgeTownSurfaceDetail(material);
}

function scaledGeometry(
  geometry: THREE.BufferGeometry,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): THREE.BufferGeometry {
  return geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
}

function foundationGeometry(
  width: number,
  height: number,
  depth: number,
  centerY: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth).toNonIndexed();
  geometry.translate(0, centerY, 0);
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color(FOUNDATION_COLOR);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return indexExactVertexTuples(fenbridgeSurfaceGeometry(geometry, 'mossStone'));
}

function buildingTerrain(
  building: (typeof FENBRIDGE_LAYOUT.buildings)[number],
  groundAt: GroundAt,
): { entranceY: number; minimumY: number } {
  const { width, depth } = building.nativeDimensions;
  const xSteps = Math.max(1, Math.ceil(width / BUILDING_TERRAIN_SAMPLE_STEP));
  const zSteps = Math.max(1, Math.ceil(depth / BUILDING_TERRAIN_SAMPLE_STEP));
  let minimumY = Infinity;
  for (let zIndex = 0; zIndex <= zSteps; zIndex++) {
    const localZ = -depth / 2 + (depth * zIndex) / zSteps;
    for (let xIndex = 0; xIndex <= xSteps; xIndex++) {
      const localX = -width / 2 + (width * xIndex) / xSteps;
      const world = localToWorld(building.position, building.rotation, localX, localZ);
      minimumY = Math.min(minimumY, groundAt(world.x, world.z));
    }
  }
  const entranceLocal = building.sockets.entrance.localPosition;
  const entrance = localToWorld(
    building.position,
    building.rotation,
    entranceLocal.x,
    entranceLocal.z,
  );
  return { entranceY: groundAt(entrance.x, entrance.z), minimumY };
}

function buildBuilding(
  building: (typeof FENBRIDGE_LAYOUT.buildings)[number],
  template: TownAssetTemplate,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): { group: THREE.Group; hideTarget: BuildingHideTarget } {
  if (!template.opaque) throw new Error(`Fenbridge building has no opaque mesh: ${building.id}`);
  const dimensions = building.nativeDimensions;
  const scaleX = dimensions.width / template.size.x;
  const scaleY = dimensions.height / template.size.y;
  const scaleZ = dimensions.depth / template.size.z;
  const terrain = buildingTerrain(building, groundAt);
  const foundationDepth = Math.max(0, terrain.entranceY - terrain.minimumY);
  const opaqueParts = [scaledGeometry(template.opaque, scaleX, scaleY, scaleZ)];
  if (foundationDepth > 1e-4) {
    const height = foundationDepth + FOUNDATION_OVERLAP;
    opaqueParts.push(
      foundationGeometry(
        dimensions.width,
        height,
        dimensions.depth,
        (FOUNDATION_OVERLAP - foundationDepth) / 2,
      ),
    );
  }
  const opaqueGeometry = mergeParts(opaqueParts, `${building.id} foundation`);
  if (!opaqueGeometry) throw new Error(`Fenbridge building lost geometry: ${building.id}`);

  const opaqueMaterial = townMaterial(false, textures, true);
  opaqueMaterial.name = `fenbridgeTownOpaque:${building.id}`;
  const opaqueMesh = new THREE.Mesh(opaqueGeometry, opaqueMaterial);
  opaqueMesh.name = `fenbridgeBuildingOpaque:${building.id}`;
  opaqueMesh.castShadow = GFX.dynamicShadows;
  opaqueMesh.receiveShadow = GFX.dynamicShadows;
  opaqueMesh.userData.placementId = building.id;
  opaqueMesh.userData.placementAssetKey = assetKeyFromUrl(building.assetId);

  const group = new THREE.Group();
  group.name = `fenbridgeBuilding:${building.id}`;
  group.userData.placementId = building.id;
  group.userData.fenbridgeBuildingId = building.id;
  group.userData.assetId = building.assetId;
  group.userData.assetUrl = building.assetId;
  group.userData.position = building.position;
  group.userData.rotation = building.rotation;
  group.userData.target = dimensions;
  group.userData.front = building.frontStandingPoint;
  group.userData.foundationDepth = foundationDepth;
  group.position.set(building.position.x, terrain.entranceY, building.position.z);
  group.rotation.y = building.rotation;
  group.add(opaqueMesh);

  const materials = [opaqueMaterial];
  if (template.emissive) {
    const emissiveMaterial = townMaterial(true, textures, true);
    emissiveMaterial.name = `fenbridgeTownEmissive:${building.id}`;
    const emissiveMesh = new THREE.Mesh(
      scaledGeometry(template.emissive, scaleX, scaleY, scaleZ),
      emissiveMaterial,
    );
    emissiveMesh.name = `fenbridgeBuildingEmissive:${building.id}`;
    emissiveMesh.castShadow = false;
    emissiveMesh.receiveShadow = false;
    emissiveMesh.userData.placementId = building.id;
    group.add(emissiveMesh);
    materials.push(emissiveMaterial);
  }

  return {
    group,
    hideTarget: {
      group,
      materials: materials.map(occluderFadeMat),
      hidden: false,
      alpha: 1,
      x: building.position.x,
      z: building.position.z,
      halfWidth: dimensions.width / 2,
      halfDepth: dimensions.depth / 2,
      cosine: Math.cos(building.rotation),
      sine: Math.sin(building.rotation),
      topY: terrain.entranceY + dimensions.height,
      cullRadius: building.maxCornerRadius,
    },
  };
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

type SegmentPoint = Readonly<{ x: number; z: number }>;

interface PitchedSegmentPlacement {
  centerX: number;
  centerY: number;
  centerZ: number;
  rotation: number;
  pitch: number;
  spatialLength: number;
  terrainOffset: number;
}

function forEachSegmentFootprintSample(
  start: SegmentPoint,
  end: SegmentPoint,
  width: number,
  visit: (x: number, z: number, progress: number) => void,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const alongSteps = Math.max(1, Math.ceil(length / BUILDING_TERRAIN_SAMPLE_STEP));
  const acrossSteps = Math.max(1, Math.ceil(width / BUILDING_TERRAIN_SAMPLE_STEP));
  const normalX = length > 1e-8 ? -dz / length : 0;
  const normalZ = length > 1e-8 ? dx / length : 1;
  for (let along = 0; along <= alongSteps; along++) {
    const progress = along / alongSteps;
    const centerX = start.x + dx * progress;
    const centerZ = start.z + dz * progress;
    for (let across = 0; across <= acrossSteps; across++) {
      const lateral = -width / 2 + (width * across) / acrossSteps;
      visit(centerX + normalX * lateral, centerZ + normalZ * lateral, progress);
    }
  }
}

function pitchedSegmentPlacement(
  start: SegmentPoint,
  end: SegmentPoint,
  width: number,
  groundAt: GroundAt,
): PitchedSegmentPlacement {
  const startY = groundAt(start.x, start.z);
  const endY = groundAt(end.x, end.z);
  const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z);
  const deltaY = endY - startY;
  let minimumResidual = 0;
  forEachSegmentFootprintSample(start, end, width, (x, z, progress) => {
    const pitchedBottomY = startY + deltaY * progress;
    minimumResidual = Math.min(minimumResidual, groundAt(x, z) - pitchedBottomY);
  });
  return {
    centerX: (start.x + end.x) / 2,
    centerY: (startY + endY) / 2 + minimumResidual,
    centerZ: (start.z + end.z) / 2,
    rotation: Math.atan2(-(end.z - start.z), end.x - start.x),
    pitch: Math.atan2(deltaY, horizontalLength),
    spatialLength: Math.hypot(horizontalLength, deltaY),
    terrainOffset: minimumResidual,
  };
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
  const cistern = FENBRIDGE_LAYOUT.civic.cistern;
  const stall = FENBRIDGE_LAYOUT.civic.provisionStall;
  const board = FENBRIDGE_LAYOUT.civic.musterBoard;
  return [
    {
      id: cistern.id,
      assetId: cistern.assetId,
      position: cistern.position,
      rotation: 0,
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
      groundAt(placement.position.x, placement.position.z),
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
  doubleSided = false,
): THREE.InstancedMesh[] {
  const opaque = repeatedInstanceMesh(
    template.opaque,
    townMaterial(false, textures, false, doubleSided),
    placements,
    `${name}OpaqueInstances`,
    assetKey,
    false,
    castShadow,
    true,
  );
  const emissive = repeatedInstanceMesh(
    template.emissive,
    townMaterial(true, textures, false, doubleSided),
    placements,
    `${name}EmissiveInstances`,
    assetKey,
    true,
    false,
    opaque === null,
  );
  return [opaque, emissive].filter((mesh): mesh is THREE.InstancedMesh => mesh !== null);
}

function buildWallBatches(
  template: TownAssetTemplate,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): THREE.InstancedMesh[] {
  const placements: InstancePlacement[] = [];
  for (const segment of FENBRIDGE_LAYOUT.wall.segments) {
    const terrain = pitchedSegmentPlacement(
      segment.start,
      segment.end,
      FENBRIDGE_LAYOUT.wall.thickness,
      groundAt,
    );
    const signedLength = palisadeSegmentMirrored(segment)
      ? -terrain.spatialLength
      : terrain.spatialLength;
    placements.push({
      id: segment.id,
      matrix: placementMatrix(
        template,
        terrain.centerX,
        terrain.centerY,
        terrain.centerZ,
        terrain.rotation,
        signedLength,
        segment.height,
        FENBRIDGE_LAYOUT.wall.thickness,
        terrain.pitch,
      ),
    });
  }
  // A negative local-X scale mirrors the asymmetric wing in the same instance
  // batch; DoubleSide keeps its winding valid without paying two wall draws.
  return buildRepeatedBatches(
    template,
    placements,
    'fenbridgeTownPalisade',
    'fenbridge_palisade_wing',
    textures,
    true,
    true,
  );
}

function buildGateBatches(
  template: TownAssetTemplate,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): THREE.InstancedMesh[] {
  const placements = FENBRIDGE_LAYOUT.wall.gates.map((gate) => {
    const terrain = pitchedFootprintPlacement(
      gate.arch.position,
      gate.arch.rotation,
      gate.arch.nativeDimensions.width,
      gate.arch.nativeDimensions.depth,
      groundAt,
    );
    return {
      id: gate.arch.id,
      matrix: placementMatrix(
        template,
        terrain.centerX,
        terrain.centerY,
        terrain.centerZ,
        terrain.rotation,
        terrain.spatialLength,
        gate.arch.nativeDimensions.height,
        gate.arch.nativeDimensions.depth,
        terrain.pitch,
      ),
    };
  });
  return buildRepeatedBatches(
    template,
    placements,
    'fenbridgeTownGateArch',
    'fenbridge_gate_arch',
    textures,
    true,
  );
}

function buildBoardwalkBatches(
  template: TownAssetTemplate,
  groundAt: GroundAt,
  textures: SurfaceTextures,
): THREE.InstancedMesh[] {
  const placements = FENBRIDGE_LAYOUT.repeated.boardwalks.map((boardwalk) => {
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
    colliderRecords.push({ kind: 'obb', ...building.footprint });
    addObbOutline(colliderVertices, building.footprint, groundAt);
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
  for (const wall of FENBRIDGE_LAYOUT.wall.segments) {
    colliderRecords.push({ kind: 'obb', ...wall.footprint });
    addObbOutline(colliderVertices, wall.footprint, groundAt);
  }
  for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
    for (const jamb of gate.arch.jambs) {
      colliderRecords.push({ kind: 'obb', ...jamb });
      addObbOutline(colliderVertices, jamb, groundAt);
    }
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
    fenbridge_palisade_wing: 0,
    fenbridge_gate_arch: 0,
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
  group.userData.wallSegmentCount = 0;
  group.userData.gateCount = 0;
  group.userData.boardwalkCount = 0;

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
    return { group, update: () => undefined, setCaptureOverlay };
  }

  const hideTargets: BuildingHideTarget[] = [];
  for (const building of FENBRIDGE_LAYOUT.buildings) {
    const template = templates.get(building.assetId);
    if (!template) throw new Error(`Fenbridge town template is missing: ${building.assetId}`);
    const built = buildBuilding(building, template, groundAt, textures);
    group.add(built.group);
    hideTargets.push(built.hideTarget);
  }

  const microBatches = buildMicroBatches(templates, groundAt, textures);
  for (const batch of microBatches) group.add(batch);

  const wallTemplate = templates.get(FENBRIDGE_LAYOUT.wall.assetId);
  if (!wallTemplate) {
    throw new Error(`Fenbridge town template is missing: ${FENBRIDGE_LAYOUT.wall.assetId}`);
  }
  const wallBatches = buildWallBatches(wallTemplate, groundAt, textures);
  for (const batch of wallBatches) group.add(batch);

  const gateUrl = FENBRIDGE_LAYOUT.wall.gates[0].arch.assetId;
  const gateTemplate = templates.get(gateUrl);
  if (!gateTemplate) throw new Error(`Fenbridge town template is missing: ${gateUrl}`);
  const gateBatches = buildGateBatches(gateTemplate, groundAt, textures);
  for (const batch of gateBatches) group.add(batch);

  const boardwalkUrl = FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId;
  const boardwalkTemplate = templates.get(boardwalkUrl);
  if (!boardwalkTemplate) throw new Error(`Fenbridge town template is missing: ${boardwalkUrl}`);
  const boardwalkBatches = buildBoardwalkBatches(boardwalkTemplate, groundAt, textures);
  for (const batch of boardwalkBatches) group.add(batch);

  const orderEvidence = buildMusterOrderEvidence(groundAt);
  group.add(orderEvidence);
  const overlay = buildCaptureOverlay(groundAt);
  group.add(overlay);

  const repeatedBatches = [...wallBatches, ...gateBatches, ...boardwalkBatches];
  const staticCullTargets: THREE.Object3D[] = [...microBatches, ...repeatedBatches];
  const visibilityPlan = newFenbridgeBuildingVisibilityPlan();
  const setCaptureOverlay = (visible: boolean): void => {
    overlay.visible = visible;
  };

  group.userData.setFenbridgeCaptureOverlay = setCaptureOverlay;
  group.userData.buildingIds = FENBRIDGE_LAYOUT.buildings.map((building) => building.id);
  group.userData.buildingFadeTargetCount = hideTargets.length;
  group.userData.microBatchNames = microBatches.map((batch) => batch.name);
  group.userData.repeatedBatchNames = repeatedBatches.map((batch) => batch.name);
  group.userData.wallSegmentCount = FENBRIDGE_LAYOUT.wall.segments.length;
  group.userData.gateCount = FENBRIDGE_LAYOUT.wall.gates.length;
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

  return {
    group,
    setCaptureOverlay,
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
      const staticVisible = fenbridgeFogVisible(
        camX,
        camZ,
        FENBRIDGE_LAYOUT.hub.center.x,
        FENBRIDGE_LAYOUT.hub.center.z,
        fogFar,
        TOWN_CULL_RADIUS,
      );
      for (let index = 0; index < staticCullTargets.length; index++) {
        staticCullTargets[index].visible = staticVisible;
      }
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
          fogFar,
        );
        target.group.visible = visibilityPlan.visible;
        if (!visibilityPlan.visible) continue;
        target.hidden = visibilityPlan.hidden;
        if (occluderFadeSettled(target.alpha, target.hidden)) continue;
        target.alpha = stepOccluderFade(target.alpha, target.hidden, dt, reducedMotion);
        applyOccluderFade(target.materials, target.alpha);
      }
    },
  };
}

export function buildFenbridgeTownView(seed: number): FenbridgeTownView {
  // Extract once even if a custom world is currently active so loader-owned
  // prop GLTFs can be released and a later same-page switch remains sync.
  if (loadedSources.size > 0) prepareTemplates(loadedSources, preparedTemplates, true);
  if (getActiveWorldContent() !== BUILTIN_WORLD) {
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
    wallSegmentCount: Number(root.userData.wallSegmentCount ?? 0),
    gateCount: Number(root.userData.gateCount ?? 0),
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
  const maximumFoundationTriangles = FENBRIDGE_LAYOUT.buildings.length * 12;
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
  questAssetUrl: QUEST_ASSET_URL,
  allAssetUrls: ALL_ASSET_URLS,
  requiredPlacementIds: REQUIRED_PLACEMENT_IDS,
  assetPlacementCounts: ASSET_PLACEMENT_COUNTS,
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

export const FENBRIDGE_TOWN_ROOT_NAME = ROOT_NAME;
export const FENBRIDGE_CAPTURE_OVERLAY_NAME = OVERLAY_NAME;
export const FENBRIDGE_TOWN_PROP_ASSET_URLS = PROP_ASSET_URLS;
export const FENBRIDGE_TOWN_ASSET_URLS = ALL_ASSET_URLS;
export const FENBRIDGE_TOWN_REQUIRED_PLACEMENT_IDS = REQUIRED_PLACEMENT_IDS;
export const FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS = ASSET_PLACEMENT_COUNTS;
export const FENBRIDGE_TOWN_ASSET_INSTANCE_COUNTS = ASSET_INSTANCE_COUNTS;
