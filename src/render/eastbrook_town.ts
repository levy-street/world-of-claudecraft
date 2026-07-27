import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../sim/building_layout';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { EASTBROOK_LAYOUT, localToWorld, wallSegmentMirrored } from '../sim/eastbrook_layout';
import type { BuildingDef, ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import {
  createEastbrookCivicBeaconState,
  decorateEastbrookCivicBeaconMaterial,
  type EastbrookCivicBeaconState,
  setEastbrookCivicMask,
  updateEastbrookCivicBeaconMotion,
} from './eastbrook_civic_beacon';
import {
  EASTBROOK_SURFACE_ATLAS_URL,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookTownSemanticForColor,
} from './eastbrook_surface_atlas';
import {
  type EastbrookRoofVisibilityTarget,
  eastbrookFogVisible,
  eastbrookRoofVisibilityPlanInto,
  newEastbrookRoofVisibilityPlan,
} from './eastbrook_town_visibility_core';
import { GFX, surfaceMat } from './gfx';
import { modulateEmissiveByVertexColor } from './vertex_color_emissive';

const ROOT_NAME = 'eastbrookTownRebuild';
const FOUNDATION_OVERLAP = 0.03;
const FOUNDATION_COLOR = 0x46505e;
const TOWN_CULL_RADIUS =
  EASTBROOK_LAYOUT.wall.radius + EASTBROOK_LAYOUT.wall.maximumSegmentSpan / 2;

const NEW_ASSET_URLS = Object.freeze([
  ...EASTBROOK_LAYOUT.buildings.map((building) => building.assetId),
  EASTBROOK_LAYOUT.civic.wellBeacon.assetId,
  EASTBROOK_LAYOUT.market.stalls[0].assetId,
  EASTBROOK_LAYOUT.wall.assetId,
]);
const SUPPORT_ASSET_URLS = Object.freeze([
  EASTBROOK_LAYOUT.civic.benches[0].assetId,
  EASTBROOK_LAYOUT.fences[0].assetId,
]);
const ALL_ASSET_URLS = Object.freeze([...new Set([...NEW_ASSET_URLS, ...SUPPORT_ASSET_URLS])]);

const ASSET_INSTANCE_COUNTS = (() => {
  const counts: Record<string, number> = {};
  const add = (assetUrl: string): void => {
    counts[assetUrl] = (counts[assetUrl] ?? 0) + 1;
  };
  for (const building of EASTBROOK_LAYOUT.buildings) add(building.assetId);
  add(EASTBROOK_LAYOUT.civic.wellBeacon.assetId);
  for (const bench of EASTBROOK_LAYOUT.civic.benches) add(bench.assetId);
  for (const stall of EASTBROOK_LAYOUT.market.stalls) add(stall.assetId);
  for (const fence of EASTBROOK_LAYOUT.fences) add(fence.assetId);
  for (const segment of EASTBROOK_LAYOUT.wall.segments) add(segment.assetId);
  return Object.freeze(counts);
})();

const loadedSources = new Map<string, THREE.Group>();
const preparedTemplates = new Map<string, TownAssetTemplate>();

if (typeof window !== 'undefined') {
  for (const url of ALL_ASSET_URLS) {
    registerPreload(
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
}

interface RoofHideTarget extends EastbrookRoofVisibilityTarget {
  group: THREE.Group;
  materials: THREE.Material[];
  hidden: boolean;
}

export interface EastbrookTownView {
  group: THREE.Group;
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
    reducedMotion?: boolean,
  ): void;
}

export interface EastbrookTownDrawStats {
  colorDraws: number;
  shadowDraws: number;
  triangles: number;
  buildingCount: number;
  roofHideTargetCount: number;
  microBatchCount: number;
  wallBatchCount: number;
  wallSegmentCount: number;
  gateCount: number;
}

export interface EastbrookTownTriangleBudget {
  assetTriangles: number;
  maximumFoundationTriangles: number;
  maximumRuntimeTriangles: number;
  hardCeiling: number;
  target: number;
  withinHardCeiling: boolean;
  meetsTarget: boolean;
  assets: Array<{
    assetUrl: string;
    instances: number;
    trianglesPerInstance: number;
    repeatedTriangles: number;
  }>;
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

function materialColor(material: THREE.Material, url: string): THREE.Color {
  if (url === EASTBROOK_LAYOUT.civic.benches[0].assetId) return new THREE.Color(0x735238);
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
  if (!position) throw new Error(`Eastbrook town asset has no positions: ${url}`);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', toFloatAttr(position, 3));
  const normal = source.getAttribute('normal');
  if (normal) geometry.setAttribute('normal', toFloatAttr(normal, 3));
  const sourceColor = source.getAttribute('color');
  const tint = materialColor(material, url);
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
  const normalizedGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
  const finalColor = normalizedGeometry.getAttribute('color');
  return eastbrookSurfaceGeometry(normalizedGeometry, (index) =>
    eastbrookTownSemanticForColor(
      finalColor.getX(index),
      finalColor.getY(index),
      finalColor.getZ(index),
    ),
  );
}

function mergeParts(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`Could not merge Eastbrook town ${label} geometry`);
  return merged;
}

function extractTemplate(source: THREE.Object3D, url: string): TownAssetTemplate {
  // The loader cache is immutable. Clone the transform graph before updating
  // matrices and clone every geometry attribute before normalization.
  const instance = source.clone(true);
  instance.updateMatrixWorld(true);
  const opaque: THREE.BufferGeometry[] = [];
  const emissive: THREE.BufferGeometry[] = [];
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (materials.length !== 1) {
      throw new Error(`Eastbrook town asset uses an unsupported material array: ${url}`);
    }
    const geometry = geometryFromMesh(child, materials[0], url);
    (materialIsEmissive(materials[0]) ? emissive : opaque).push(geometry);
  });
  if (opaque.length === 0 && emissive.length === 0) {
    throw new Error(`Eastbrook town asset has no meshes: ${url}`);
  }

  const box = new THREE.Box3();
  for (const geometry of [...opaque, ...emissive]) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox as THREE.Box3);
  }
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  for (const geometry of [...opaque, ...emissive]) {
    geometry.translate(-centerX, -box.min.y, -centerZ);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return {
    opaque: mergeParts(opaque, `${url} opaque`),
    emissive: mergeParts(emissive, `${url} emissive`),
    size: box.getSize(new THREE.Vector3()),
  };
}

function prepareTemplates(
  sources: ReadonlyMap<string, THREE.Object3D>,
  cache: Map<string, TownAssetTemplate>,
  release: boolean,
): Map<string, TownAssetTemplate> {
  for (const url of ALL_ASSET_URLS) {
    if (cache.has(url)) continue;
    const source = sources.get(url);
    if (!source) throw new Error(`Eastbrook town asset was not preloaded: ${url}`);
    cache.set(url, extractTemplate(source, url));
    if (release) {
      loadedSources.delete(url);
      releaseGltf(url);
    }
  }
  return cache;
}

function materialOptions(emissive: boolean, atlas = eastbrookSurfaceAtlasTexture()) {
  return {
    color: 0xffffff,
    map: emissive ? undefined : atlas,
    vertexColors: true,
    roughness: emissive ? 0.55 : 0.86,
    metalness: emissive ? 0.08 : 0,
    emissive: emissive ? 0xffffff : 0x000000,
    emissiveIntensity: emissive ? (GFX.standardMaterials ? 1 : 0.72) : 1,
    flatShading: !GFX.standardMaterials,
  } as const;
}

function townMaterial(
  emissive: boolean,
  atlas: THREE.Texture | undefined,
  independent = false,
): THREE.Material {
  const shared = surfaceMat(materialOptions(emissive, atlas));
  const material = independent ? shared.clone() : shared;
  return emissive ? modulateEmissiveByVertexColor(material) : material;
}

function scaledGeometry(
  geometry: THREE.BufferGeometry,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): THREE.BufferGeometry {
  return geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
}

function coloredBox(
  width: number,
  height: number,
  depth: number,
  centerY: number,
): THREE.BufferGeometry {
  const indexed = new THREE.BoxGeometry(width, height, depth);
  const geometry = indexed.toNonIndexed();
  geometry.deleteAttribute('uv');
  geometry.translate(0, centerY, 0);
  const count = geometry.getAttribute('position').count;
  const tint = new THREE.Color(FOUNDATION_COLOR);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return eastbrookSurfaceGeometry(geometry, 'darkStoneBlocks');
}

function buildingTerrain(
  building: (typeof EASTBROOK_LAYOUT.buildings)[number],
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
  const entrance = localToWorld(building.position, building.rotation, 0, depth / 2);
  return { entranceY: groundAt(entrance.x, entrance.z), minimumY };
}

function buildBuilding(
  building: (typeof EASTBROOK_LAYOUT.buildings)[number],
  template: TownAssetTemplate,
  groundAt: GroundAt,
  atlas: THREE.Texture | undefined,
): { group: THREE.Group; hideTarget: RoofHideTarget } {
  if (!template.opaque)
    throw new Error(`Eastbrook service building has no opaque mesh: ${building.id}`);
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
      coloredBox(
        dimensions.width,
        height,
        dimensions.depth,
        (FOUNDATION_OVERLAP - foundationDepth) / 2,
      ),
    );
  }
  const opaqueGeometry = mergeParts(opaqueParts, `${building.id} foundation`);
  if (!opaqueGeometry)
    throw new Error(`Eastbrook service building lost opaque geometry: ${building.id}`);

  const opaqueMaterial = townMaterial(false, atlas, true);
  opaqueMaterial.name = `eastbrookTownOpaque:${building.id}`;
  const opaqueMesh = new THREE.Mesh(opaqueGeometry, opaqueMaterial);
  opaqueMesh.name = `eastbrookBuildingOpaque:${building.id}`;
  opaqueMesh.castShadow = true;
  opaqueMesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = `eastbrookBuilding:${building.id}`;
  group.userData.eastbrookBuildingId = building.id;
  group.userData.assetId = building.assetId;
  group.userData.assetUrl = building.assetId;
  group.userData.position = building.position;
  group.userData.rotation = building.rotation;
  group.userData.target = building.nativeDimensions;
  group.userData.front = building.frontStandingPoint;
  group.userData.foundationDepth = foundationDepth;
  group.position.set(building.position.x, terrain.entranceY, building.position.z);
  group.rotation.y = building.rotation;
  group.add(opaqueMesh);

  const materials = [opaqueMaterial];
  if (template.emissive) {
    const emissiveMaterial = townMaterial(true, atlas, true);
    emissiveMaterial.name = `eastbrookTownEmissive:${building.id}`;
    const emissiveMesh = new THREE.Mesh(
      scaledGeometry(template.emissive, scaleX, scaleY, scaleZ),
      emissiveMaterial,
    );
    emissiveMesh.name = `eastbrookBuildingEmissive:${building.id}`;
    emissiveMesh.castShadow = false;
    emissiveMesh.receiveShadow = false;
    group.add(emissiveMesh);
    materials.push(emissiveMaterial);
  }

  return {
    group,
    hideTarget: {
      group,
      materials,
      hidden: false,
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

function addPlacedCivicEmissiveGeometry(
  out: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry | null,
  matrix: THREE.Matrix4,
  selected: boolean,
): void {
  if (!geometry) return;
  const placed = geometry.clone().applyMatrix4(matrix);
  setEastbrookCivicMask(placed, selected);
  out.push(placed);
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

function reflectedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const index = geometry.getIndex();
  if (index) {
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const second = index.getX(triangle + 1);
      index.setX(triangle + 1, index.getX(triangle + 2));
      index.setX(triangle + 2, second);
    }
    index.needsUpdate = true;
  } else {
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute instanceof THREE.InterleavedBufferAttribute) {
        throw new Error('Eastbrook reflected geometry must use normalized buffer attributes');
      }
      for (let triangle = 0; triangle < attribute.count; triangle += 3) {
        for (let component = 0; component < attribute.itemSize; component++) {
          const second = attribute.getComponent(triangle + 1, component);
          attribute.setComponent(
            triangle + 1,
            component,
            attribute.getComponent(triangle + 2, component),
          );
          attribute.setComponent(triangle + 2, component, second);
        }
      }
      attribute.needsUpdate = true;
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function wallSegmentNeedsMirror(segment: (typeof EASTBROOK_LAYOUT.wall.segments)[number]): boolean {
  // The one shared rule (sim/eastbrook_layout.ts): the wing's pillar
  // colliders flip with the same mirror the instancing applies here.
  return wallSegmentMirrored(segment);
}

interface MicroBatchBuild {
  batches: THREE.Mesh[];
  civicBeaconState: EastbrookCivicBeaconState;
}

function buildMicroBatches(
  templates: ReadonlyMap<string, TownAssetTemplate>,
  groundAt: GroundAt,
  atlas: THREE.Texture | undefined,
): MicroBatchBuild {
  const opaque: THREE.BufferGeometry[] = [];
  const emissive: THREE.BufferGeometry[] = [];
  const well = EASTBROOK_LAYOUT.civic.wellBeacon;
  const civicBeaconState = createEastbrookCivicBeaconState(well.position.x, well.position.z);
  const add = (url: string, matrix: THREE.Matrix4, civic = false): void => {
    const template = templates.get(url);
    if (!template) throw new Error(`Eastbrook town template is missing: ${url}`);
    addPlacedGeometry(opaque, template.opaque, matrix);
    addPlacedCivicEmissiveGeometry(emissive, template.emissive, matrix, civic);
  };

  const wellTemplate = templates.get(well.assetId);
  if (!wellTemplate) throw new Error(`Eastbrook town template is missing: ${well.assetId}`);
  add(
    well.assetId,
    placementMatrix(
      wellTemplate,
      well.position.x,
      groundAt(well.position.x, well.position.z),
      well.position.z,
      0,
      well.nativeDimensions.width,
      well.nativeDimensions.height,
      well.nativeDimensions.depth,
    ),
    true,
  );

  for (const bench of EASTBROOK_LAYOUT.civic.benches) {
    const template = templates.get(bench.assetId);
    if (!template) throw new Error(`Eastbrook town template is missing: ${bench.assetId}`);
    const horizontalScale = Math.min(bench.width / template.size.x, bench.depth / template.size.z);
    add(
      bench.assetId,
      placementMatrix(
        template,
        bench.position.x,
        groundAt(bench.position.x, bench.position.z),
        bench.position.z,
        bench.rotation,
        bench.width,
        template.size.y * horizontalScale,
        bench.depth,
      ),
    );
  }

  for (const stall of EASTBROOK_LAYOUT.market.stalls) {
    const template = templates.get(stall.assetId);
    if (!template) throw new Error(`Eastbrook town template is missing: ${stall.assetId}`);
    add(
      stall.assetId,
      placementMatrix(
        template,
        stall.position.x,
        groundAt(stall.position.x, stall.position.z),
        stall.position.z,
        stall.rotation,
        stall.width,
        stall.height,
        stall.depth,
      ),
    );
  }

  for (const fence of EASTBROOK_LAYOUT.fences) {
    const template = templates.get(fence.assetId);
    if (!template) throw new Error(`Eastbrook town template is missing: ${fence.assetId}`);
    const placement = pitchedSegmentPlacement(fence.start, fence.end, fence.width, groundAt);
    add(
      fence.assetId,
      placementMatrix(
        template,
        placement.centerX,
        placement.centerY,
        placement.centerZ,
        placement.rotation,
        placement.spatialLength,
        fence.height,
        fence.width,
        placement.pitch,
      ),
    );
  }

  const batches: THREE.Mesh[] = [];
  const opaqueGeometry = mergeParts(opaque, 'micro opaque batch');
  if (opaqueGeometry) {
    const mesh = new THREE.Mesh(opaqueGeometry, townMaterial(false, atlas));
    mesh.name = 'eastbrookTownMicroOpaqueBatch';
    mesh.userData.eastbrookMicroBatch = 'opaque';
    mesh.userData.neverRoofHideTarget = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    batches.push(mesh);
  }
  const emissiveGeometry = mergeParts(emissive, 'micro emissive batch');
  if (emissiveGeometry) {
    const material = decorateEastbrookCivicBeaconMaterial(
      townMaterial(true, atlas, true),
      civicBeaconState,
    );
    const mesh = new THREE.Mesh(emissiveGeometry, material);
    mesh.name = 'eastbrookTownMicroEmissiveBatch';
    mesh.userData.eastbrookMicroBatch = 'emissive';
    mesh.userData.neverRoofHideTarget = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    batches.push(mesh);
  }
  return { batches, civicBeaconState };
}

interface WallInstancePlacement {
  id: string;
  matrix: THREE.Matrix4;
}

function wallInstanceMesh(
  geometry: THREE.BufferGeometry | null,
  material: THREE.Material,
  placements: readonly WallInstancePlacement[],
  name: string,
  handedness: 'original' | 'mirrored',
  emissive: boolean,
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
  mesh.castShadow = !emissive;
  mesh.receiveShadow = !emissive;
  mesh.frustumCulled = true;
  mesh.userData.eastbrookWallInstances = true;
  mesh.userData.handedness = handedness;
  mesh.userData.segmentIds = placements.map((placement) => placement.id);
  mesh.userData.neverRoofHideTarget = true;
  return mesh;
}

function buildWallBatches(
  template: TownAssetTemplate,
  groundAt: GroundAt,
  atlas: THREE.Texture | undefined,
): THREE.InstancedMesh[] {
  const original: WallInstancePlacement[] = [];
  const mirrored: WallInstancePlacement[] = [];
  for (const segment of EASTBROOK_LAYOUT.wall.segments) {
    const placement = pitchedSegmentPlacement(
      segment.start,
      segment.end,
      EASTBROOK_LAYOUT.wall.thickness,
      groundAt,
    );
    const entry = {
      id: segment.id,
      matrix: placementMatrix(
        template,
        placement.centerX,
        placement.centerY,
        placement.centerZ,
        placement.rotation,
        placement.spatialLength,
        segment.height,
        EASTBROOK_LAYOUT.wall.thickness,
        placement.pitch,
      ),
    };
    (wallSegmentNeedsMirror(segment) ? mirrored : original).push(entry);
  }

  const opaqueMaterial = townMaterial(false, atlas);
  const emissiveMaterial = townMaterial(true, atlas);
  const candidates = [
    wallInstanceMesh(
      template.opaque,
      opaqueMaterial,
      original,
      'eastbrookTownWallOpaqueInstances',
      'original',
      false,
    ),
    wallInstanceMesh(
      template.opaque ? reflectedGeometry(template.opaque) : null,
      opaqueMaterial,
      mirrored,
      'eastbrookTownWallOpaqueMirroredInstances',
      'mirrored',
      false,
    ),
    wallInstanceMesh(
      template.emissive,
      emissiveMaterial,
      original,
      'eastbrookTownWallEmissiveInstances',
      'original',
      true,
    ),
    wallInstanceMesh(
      template.emissive ? reflectedGeometry(template.emissive) : null,
      emissiveMaterial,
      mirrored,
      'eastbrookTownWallEmissiveMirroredInstances',
      'mirrored',
      true,
    ),
  ];
  return candidates.filter((mesh): mesh is THREE.InstancedMesh => mesh !== null);
}

function buildFromTemplates(
  templates: ReadonlyMap<string, TownAssetTemplate>,
  groundAt: GroundAt,
  builtInWorld: boolean,
  atlas: THREE.Texture | undefined,
): EastbrookTownView {
  const group = new THREE.Group();
  group.name = ROOT_NAME;
  group.userData.layoutId = EASTBROOK_LAYOUT.id;
  group.userData.builtInOnly = true;
  group.userData.microBatchNeverRoofHideTarget = true;
  group.userData.assetUrls = ALL_ASSET_URLS;
  group.userData.newAssetUrls = NEW_ASSET_URLS;
  group.userData.assetInstanceCounts = ASSET_INSTANCE_COUNTS;
  group.userData.wallSegmentCount = 0;
  group.userData.gateCount = 0;
  group.userData.roofHideTargetCount = 0;
  group.userData.eastbrookSurfaceAtlas = {
    url: EASTBROOK_SURFACE_ATLAS_URL,
    textureUuid: null,
    materialBindings: 0,
  };
  if (!builtInWorld) {
    group.userData.drawStats = eastbrookTownDrawStats(group);
    return { group, update: () => undefined };
  }

  const roofHideTargets: RoofHideTarget[] = [];
  for (const building of EASTBROOK_LAYOUT.buildings) {
    const template = templates.get(building.assetId);
    if (!template) throw new Error(`Eastbrook town template is missing: ${building.assetId}`);
    const built = buildBuilding(building, template, groundAt, atlas);
    group.add(built.group);
    roofHideTargets.push(built.hideTarget);
  }
  const microBuild = buildMicroBatches(templates, groundAt, atlas);
  const microBatches = microBuild.batches;
  for (const batch of microBatches) group.add(batch);
  const wallTemplate = templates.get(EASTBROOK_LAYOUT.wall.assetId);
  if (!wallTemplate)
    throw new Error(`Eastbrook town template is missing: ${EASTBROOK_LAYOUT.wall.assetId}`);
  const wallBatches = buildWallBatches(wallTemplate, groundAt, atlas);
  for (const batch of wallBatches) group.add(batch);
  const staticCullTargets: THREE.Object3D[] = [...microBatches, ...wallBatches];
  const roofVisibilityPlan = newEastbrookRoofVisibilityPlan();

  group.userData.buildingIds = EASTBROOK_LAYOUT.buildings.map((building) => building.id);
  group.userData.microBatchNames = microBatches.map((batch) => batch.name);
  group.userData.wallBatchNames = wallBatches.map((batch) => batch.name);
  group.userData.mirroredWallSegmentIds = wallBatches.find(
    (batch) => batch.userData.handedness === 'mirrored',
  )?.userData.segmentIds;
  group.userData.microPlacementIds = [
    EASTBROOK_LAYOUT.civic.wellBeacon.id,
    ...EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id),
    ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id),
    ...EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
    ...EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
  ];
  group.userData.wallSegmentCount = EASTBROOK_LAYOUT.wall.segments.length;
  group.userData.gateCount = EASTBROOK_LAYOUT.wall.gates.length;
  group.userData.roofHideTargetCount = roofHideTargets.length;
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  group.userData.drawStats = eastbrookTownDrawStats(group);

  return {
    group,
    update(
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
      reducedMotion = false,
    ): void {
      updateEastbrookCivicBeaconMotion(microBuild.civicBeaconState, reducedMotion);
      const staticVisible = eastbrookFogVisible(camX, camZ, 0, 0, fogFar, TOWN_CULL_RADIUS);
      for (let index = 0; index < staticCullTargets.length; index++) {
        staticCullTargets[index].visible = staticVisible;
      }
      for (let index = 0; index < roofHideTargets.length; index++) {
        const target = roofHideTargets[index];
        eastbrookRoofVisibilityPlanInto(
          roofVisibilityPlan,
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
        target.group.visible = roofVisibilityPlan.visible;
        if (!roofVisibilityPlan.visible || !roofVisibilityPlan.hiddenChanged) continue;
        target.hidden = roofVisibilityPlan.hidden;
        for (let materialIndex = 0; materialIndex < target.materials.length; materialIndex++) {
          const material = target.materials[materialIndex];
          material.colorWrite = !roofVisibilityPlan.hidden;
          material.depthWrite = !roofVisibilityPlan.hidden;
        }
      }
    },
  };
}

export function buildEastbrookTownView(seed: number): EastbrookTownView {
  // Extract once even when an editor/custom world is first: the empty custom
  // root stays isolated, while loader-owned decoded sources can be released and
  // a later same-page switch to the built-in world remains synchronous.
  if (loadedSources.size > 0) prepareTemplates(loadedSources, preparedTemplates, true);
  if (getActiveWorldContent() !== BUILTIN_WORLD) {
    return buildFromTemplates(preparedTemplates, () => 0, false, undefined);
  }
  prepareTemplates(loadedSources, preparedTemplates, true);
  return buildFromTemplates(
    preparedTemplates,
    (x, z) => terrainHeight(x, z, seed),
    true,
    eastbrookSurfaceAtlasTexture(),
  );
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-8;
}

export function isEastbrookRebuildBuilding(building: BuildingDef): boolean {
  return EASTBROOK_LAYOUT.buildings.some(
    (candidate) =>
      candidate.kind === building.kind &&
      sameNumber(candidate.position.x, building.x) &&
      sameNumber(candidate.position.z, building.z) &&
      sameNumber(candidate.nativeDimensions.width, building.w) &&
      sameNumber(candidate.nativeDimensions.depth, building.d) &&
      sameNumber(candidate.rotation, building.rot),
  );
}

export function isEastbrookRebuildWell(well: ZonePropsDef['wells'][number]): boolean {
  const candidate = EASTBROOK_LAYOUT.civic.wellBeacon;
  return (
    sameNumber(candidate.position.x, well.x) &&
    sameNumber(candidate.position.z, well.z) &&
    sameNumber(candidate.radius, well.r)
  );
}

export function isEastbrookRebuildStall(stall: ZonePropsDef['stalls'][number]): boolean {
  return EASTBROOK_LAYOUT.market.stalls.some(
    (candidate) =>
      sameNumber(candidate.position.x, stall.x) &&
      sameNumber(candidate.position.z, stall.z) &&
      sameNumber(candidate.rotation, stall.rot),
  );
}

export function isEastbrookRebuildFence(fence: ZonePropsDef['fences'][number]): boolean {
  return EASTBROOK_LAYOUT.fences.some(
    (candidate) =>
      (sameNumber(candidate.start.x, fence.x1) &&
        sameNumber(candidate.start.z, fence.z1) &&
        sameNumber(candidate.end.x, fence.x2) &&
        sameNumber(candidate.end.z, fence.z2)) ||
      (sameNumber(candidate.start.x, fence.x2) &&
        sameNumber(candidate.start.z, fence.z2) &&
        sameNumber(candidate.end.x, fence.x1) &&
        sameNumber(candidate.end.z, fence.z1)),
  );
}

export function eastbrookTownDrawStats(root: THREE.Object3D): EastbrookTownDrawStats {
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
    roofHideTargetCount: Number(root.userData.roofHideTargetCount ?? 0),
    microBatchCount: Array.isArray(root.userData.microBatchNames)
      ? root.userData.microBatchNames.length
      : 0,
    wallBatchCount: Array.isArray(root.userData.wallBatchNames)
      ? root.userData.wallBatchNames.length
      : 0,
    wallSegmentCount: Number(root.userData.wallSegmentCount ?? 0),
    gateCount: Number(root.userData.gateCount ?? 0),
  };
}

/**
 * Aggregate the actual artifact triangle counts through the exact canonical
 * placement multiplicities. The small foundation reserve covers the optional
 * 12-triangle skirt on every independently seated building.
 */
export function eastbrookTownTriangleBudget(
  triangleCountByAsset: Readonly<Record<string, number>>,
): EastbrookTownTriangleBudget {
  const assets = ALL_ASSET_URLS.map((assetUrl) => {
    const trianglesPerInstance = triangleCountByAsset[assetUrl];
    if (!Number.isFinite(trianglesPerInstance) || trianglesPerInstance < 0) {
      throw new Error(`Missing Eastbrook town triangle count: ${assetUrl}`);
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
  const maximumFoundationTriangles = EASTBROOK_LAYOUT.buildings.length * 12;
  const maximumRuntimeTriangles = assetTriangles + maximumFoundationTriangles;
  const hardCeiling = 40_000;
  const target = 30_000;
  return {
    assetTriangles,
    maximumFoundationTriangles,
    maximumRuntimeTriangles,
    hardCeiling,
    target,
    withinHardCeiling: maximumRuntimeTriangles <= hardCeiling,
    meetsTarget: maximumRuntimeTriangles <= target,
    assets,
  };
}

/** Test-only access to the tier-independent preload and deterministic build contract. */
export const eastbrookTownInternalsForTest = {
  rootName: ROOT_NAME,
  newAssetUrls: NEW_ASSET_URLS,
  supportAssetUrls: SUPPORT_ASSET_URLS,
  allAssetUrls: ALL_ASSET_URLS,
  materialOptions,
  extractTemplate,
  buildFromSources(
    sources: ReadonlyMap<string, THREE.Object3D>,
    groundAt: GroundAt,
    builtIn: boolean,
    atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
  ) {
    if (!builtIn)
      return buildFromTemplates(new Map<string, TownAssetTemplate>(), groundAt, false, undefined);
    const templates = prepareTemplates(sources, new Map<string, TownAssetTemplate>(), false);
    return buildFromTemplates(templates, groundAt, true, atlas);
  },
  forEachSegmentFootprintSample,
  pitchedSegmentPlacement,
  reflectedGeometry,
  wallSegmentNeedsMirror,
};

export const EASTBROOK_TOWN_ROOT_NAME = ROOT_NAME;
export const EASTBROOK_TOWN_NEW_ASSET_URLS = NEW_ASSET_URLS;
export const EASTBROOK_TOWN_ASSET_URLS = ALL_ASSET_URLS;
export const EASTBROOK_TOWN_ASSET_INSTANCE_COUNTS = ASSET_INSTANCE_COUNTS;
