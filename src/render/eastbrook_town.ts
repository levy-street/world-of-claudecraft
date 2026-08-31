import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../sim/building_layout';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { EASTBROOK_LAYOUT, localToWorld, wallSegmentMirrored } from '../sim/eastbrook_layout';
import type { BuildingDef, ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  createEastbrookCivicBeaconState,
  decorateEastbrookCivicBeaconMaterial,
  type EastbrookCivicBeaconState,
  setEastbrookCivicMask,
  updateEastbrookCivicBeaconMotion,
} from './eastbrook_civic_beacon';
import { buildEastbrookHarbor } from './eastbrook_harbor';
import {
  applyEastbrookTownSurfaceDetail,
  EASTBROOK_SURFACE_ATLAS_URL,
  EASTBROOK_SURFACE_NORMAL_SCALE,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceNormalTexture,
  eastbrookSurfaceRoughnessTexture,
  eastbrookTownSemanticForColor,
} from './eastbrook_surface_atlas';
import {
  type EastbrookRoofVisibilityTarget,
  eastbrookFogVisible,
  eastbrookRoofVisibilityPlanInto,
  newEastbrookRoofVisibilityPlan,
} from './eastbrook_town_visibility_core';
import { indexExactVertexTuples } from './exact_index_geometry';
import { EMISSIVE_GLOW, GFX, surfaceMat } from './gfx';
import { type KitWindowPane, kitWindowPanes } from './kit_window_panes_core';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  occluderFadeMat,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import type { RevealGateCore } from './reveal_gate_core';
import {
  newTownPiecewiseReveal,
  orderTownRootsNearestFirst,
  townPiecewiseRevealInto,
  townRootVisible,
  townStaticReveal,
} from './town_reveal_core';
import { modulateEmissiveByVertexColor } from './vertex_color_emissive';

const ROOT_NAME = 'eastbrookTownRebuild';
const FOUNDATION_OVERLAP = 0.03;
const FOUNDATION_COLOR = 0x46505e;
// Warm interior light for the kit buildings (owner refinement round 4): the
// hexb GLBs carry no emissive materials (their windows are palette texels in
// the KTX2 atlas), so each kit building gets one amber pane quad per window
// assembly detected in the model's own geometry (kit_window_panes_core.ts),
// riding the same vertex-color emissive ladder as the shape buildings'
// authored windows. Panes derived from the real window frames sit exactly in
// the models' openings; the earlier bounding-box guesses floated off walls.
const KIT_WINDOW_AMBER = 0xffb45a;
const TOWN_CULL_RADIUS =
  EASTBROOK_LAYOUT.wall.radius + EASTBROOK_LAYOUT.wall.maximumSegmentSpan / 2;
/** The one reveal-gate key of the town's static content. */
const STATIC_REVEAL_KEY = 'eastbrook-town-static';

// Deduped: since round 3 the layout re-uses kit shells across buildings
// (three hexb_home_a lots, two hexb_home_b), and this list is a set of
// URLs to load, never a per-building roster.
const NEW_ASSET_URLS = Object.freeze([
  ...new Set([
    ...EASTBROOK_LAYOUT.buildings.map((building) => building.assetId),
    EASTBROOK_LAYOUT.civic.wellBeacon.assetId,
    EASTBROOK_LAYOUT.market.stalls[0].assetId,
    EASTBROOK_LAYOUT.wall.assetId,
  ]),
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
const sourceLoadTasks = new Map<string, Promise<void>>();

function prepareTownSource(url: string): Promise<void> {
  if (loadedSources.has(url)) return Promise.resolve();
  const existing = sourceLoadTasks.get(url);
  if (existing) return existing;
  const task = loadGltf(url)
    .then((gltf) => {
      loadedSources.set(url, gltf.scene);
      sourceLoadTasks.delete(url);
    })
    .catch((err) => {
      sourceLoadTasks.delete(url);
      throw err;
    });
  sourceLoadTasks.set(url, task);
  return task;
}

export function prepareEastbrookTownProfileAssets(): Promise<void> {
  return Promise.all(ALL_ASSET_URLS.map(prepareTownSource)).then(() => undefined);
}

export function resetEastbrookTownProfileCaches(): void {
  preparedTemplates.clear();
  kitWindowPaneCache.clear();
}

if (typeof window !== 'undefined') {
  for (const url of ALL_ASSET_URLS) {
    registerDeferredPreload(() => prepareTownSource(url));
  }
}

type GroundAt = (x: number, z: number) => number;

interface TownAssetTemplate {
  opaque: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  size: THREE.Vector3;
  /** Kit buildings only: the raw GLB scene, rendered with its own materials
   *  (KTX2 palette textures the atlas bake cannot read on the CPU). */
  raw?: THREE.Object3D;
}

interface RoofHideTarget extends EastbrookRoofVisibilityTarget {
  group: THREE.Group;
  mats: OccluderFadeMat[];
  hidden: boolean;
  alpha: number;
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
    dt: number,
    reducedMotion?: boolean,
  ): void;
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
  return indexExactVertexTuples(
    eastbrookSurfaceGeometry(normalizedGeometry, (index) =>
      eastbrookTownSemanticForColor(
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
    // Kit buildings (the Galecrest hexb mix) render with their OWN GLB
    // materials: their color lives in KTX2 palette textures the GPU samples,
    // which the atlas vertex-color pipeline cannot bake (a compressed image
    // is not CPU-readable; sampling it crashed the renderer). The raw scene
    // rides the template cache for buildKitBuilding, and its GLB cache entry
    // is never released (the clones share its textures).
    if (isKitBuildingAsset(url)) {
      const box = new THREE.Box3().setFromObject(source);
      const kitSize = new THREE.Vector3();
      box.getSize(kitSize);
      cache.set(url, { opaque: null, emissive: null, size: kitSize, raw: source });
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

function isKitBuildingAsset(url: string): boolean {
  return url.startsWith('/models/biome/');
}

// Kit materials keep their GLB textures; on the Lambert tiers they downgrade
// like every town material (the Low-tier contract the surface-atlas suite
// audits), carrying map, color, and emissive across.
function kitMaterial(source: THREE.Material): THREE.Material {
  if (GFX.standardMaterials) return cloneMaterialWithHooks(source);
  const from = source as THREE.Material & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveMap?: THREE.Texture | null;
  };
  const lambert = new THREE.MeshLambertMaterial({
    map: from.map ?? null,
    color: from.color?.clone() ?? new THREE.Color(0xffffff),
  });
  if (from.emissive) lambert.emissive = from.emissive.clone();
  if (from.emissiveMap) lambert.emissiveMap = from.emissiveMap;
  lambert.name = source.name;
  return lambert;
}

// Window panes per kit asset URL, derived once from the model's own window
// assemblies (kit_window_panes_core.ts) in the raw attribute units of the
// GLB's single mesh. Filled lazily by the first buildKitBuilding for an URL.
const kitWindowPaneCache = new Map<string, KitWindowPane[]>();

// The shipped kit GLBs decode their meshopt streams into INTERLEAVED
// attributes (stride 4 with one pad lane), so the raw shared array is never
// a tight per-vertex scan target. This copies the position lanes into a
// tight typed array of the SAME element class, preserving the exact raw
// (quantized) values the detector's exact-position vertex merge relies on.
// A plain tight BufferAttribute passes its array through untouched.
function tightRawPositions(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): ArrayLike<number> {
  if (attribute instanceof THREE.InterleavedBufferAttribute) {
    const data = attribute.data;
    const src = data.array as unknown as ArrayLike<number> & {
      constructor: new (length: number) => number[];
    };
    const out = new src.constructor(attribute.count * 3);
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      const base = vertex * data.stride + attribute.offset;
      out[vertex * 3] = src[base];
      out[vertex * 3 + 1] = src[base + 1];
      out[vertex * 3 + 2] = src[base + 2];
    }
    return out;
  }
  return attribute.array as ArrayLike<number>;
}

function kitPanesForAsset(url: string, source: THREE.Object3D): KitWindowPane[] {
  const cached = kitWindowPaneCache.get(url);
  if (cached) return cached;
  let firstMesh: THREE.Mesh | null = null;
  source.traverse((child) => {
    if (firstMesh === null && child instanceof THREE.Mesh) firstMesh = child;
  });
  // The closure assignment defeats narrowing: name the found mesh explicitly.
  const first = firstMesh as THREE.Mesh | null;
  const position = first?.geometry.getAttribute('position');
  const panes =
    position && first
      ? kitWindowPanes(
          tightRawPositions(position),
          position.count,
          (first.geometry.index?.array as ArrayLike<number> | undefined) ?? null,
        )
      : [];
  kitWindowPaneCache.set(url, panes);
  return panes;
}

// KHR_mesh_quantization: a normalized attribute renders as value / range on
// the GPU, so pane quads authored in the raw attribute units the detector
// scanned need the same factor to land in the mesh node's local space.
// Interleaved attributes read their element class off the shared buffer.
function normalizedAttributeScale(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  if (!attribute.normalized) return 1;
  const array =
    attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
  if (array instanceof Int8Array) return 1 / 127;
  if (array instanceof Uint8Array) return 1 / 255;
  if (array instanceof Int16Array) return 1 / 32767;
  if (array instanceof Uint16Array) return 1 / 65535;
  return 1;
}

// The merged lit-window geometry for one kit building, in raw model space:
// each detected assembly's recessed glass plane as the model's own triangles
// (kit_window_panes_core.ts), concatenated into one soup, dequantized and
// moved by the mesh node's model-root transform (the caller settles
// matrixWorld while the clone is parentless at the origin). A uniform amber
// vertex color rides the same vertex-color emissive ladder as the shape
// buildings' authored windows.
function kitWindowPaneGeometry(
  mesh: THREE.Mesh,
  panes: readonly KitWindowPane[],
): THREE.BufferGeometry | null {
  const position = mesh.geometry.getAttribute('position');
  if (panes.length === 0 || !position) return null;
  let total = 0;
  for (const pane of panes) total += pane.positions.length;
  if (total === 0) return null;
  const soup = new Float32Array(total);
  let cursor = 0;
  for (const pane of panes) {
    soup.set(pane.positions, cursor);
    cursor += pane.positions.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(soup, 3));
  merged.computeVertexNormals();
  const count = merged.getAttribute('position').count;
  const tint = new THREE.Color(KIT_WINDOW_AMBER);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const scale = normalizedAttributeScale(position);
  merged.scale(scale, scale, scale);
  merged.applyMatrix4(mesh.matrixWorld);
  return merged;
}

// A kit building: the raw GLB scene cloned with its own materials, scaled to
// the layout's native dimensions and seated like every template building; the
// roof-hide contract is identical so camera ghosting keeps working.
function buildKitBuilding(
  building: (typeof EASTBROOK_LAYOUT.buildings)[number],
  source: THREE.Object3D,
  groundAt: GroundAt,
): { group: THREE.Group; hideTarget: RoofHideTarget } {
  const dimensions = building.nativeDimensions;
  const terrain = buildingTerrain(building, groundAt);
  const foundationDepth = Math.max(0, terrain.entranceY - terrain.minimumY);

  const clone = source.clone(true);
  // World matrices settle while the clone is parentless at the origin: the
  // window-pane bake below reads the mesh node's matrixWorld as its
  // transform relative to the model root.
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scaleX = dimensions.width / Math.max(size.x, 1e-4);
  const scaleY = dimensions.height / Math.max(size.y, 1e-4);
  const scaleZ = dimensions.depth / Math.max(size.z, 1e-4);
  const mats: OccluderFadeMat[] = [];
  let firstKitMesh: THREE.Mesh | null = null;
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (firstKitMesh === null) firstKitMesh = child;
    child.castShadow = true;
    child.receiveShadow = true;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = list.map((m) => kitMaterial(m));
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
    for (const material of cloned) occluderFadeRecordFor(mats, material, child);
  });
  const wrap = new THREE.Group();
  wrap.add(clone);
  // center the model on its footprint and rest its base at y 0 of the wrap
  clone.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
  wrap.scale.set(scaleX, scaleY, scaleZ);
  // Lit window panes (owner refinement round 5): each assembly's recessed
  // glass plane, lifted verbatim from the model's own window assemblies
  // (kit_window_panes_core.ts) so the glow fits the openings exactly, baked
  // into raw model space, added AFTER the shadow traverse and AS A SIBLING of
  // the clone inside the wrap, so the panes keep castShadow false, inherit
  // the wrap's scale-to-dimensions transform, and share the clone's centering
  // offset. matrixWorld still holds the parentless-origin update from above:
  // repositioning the clone does not recompute it.
  const paneGeometry = firstKitMesh
    ? kitWindowPaneGeometry(firstKitMesh, kitPanesForAsset(building.assetId, source))
    : null;
  if (paneGeometry) {
    const paneMaterial = townMaterial(true, undefined, true);
    paneMaterial.name = `eastbrookTownKitPanes:${building.id}`;
    // A pane sits mid-opening and must read from both approaches.
    paneMaterial.side = THREE.DoubleSide;
    // The pane triangles are coplanar with the model's own glass geometry;
    // the polygon offset wins the depth fight without geometric displacement.
    paneMaterial.polygonOffset = true;
    paneMaterial.polygonOffsetFactor = -2;
    paneMaterial.polygonOffsetUnits = -2;
    const panes = new THREE.Mesh(paneGeometry, paneMaterial);
    panes.name = `eastbrookBuildingEmissive:${building.id}`;
    panes.castShadow = false;
    panes.receiveShadow = false;
    panes.position.copy(clone.position);
    wrap.add(panes);
    occluderFadeRecordFor(mats, paneMaterial, panes);
  }

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
  group.add(wrap);
  if (foundationDepth > 1e-4) {
    const height = foundationDepth + FOUNDATION_OVERLAP;
    const skirtGeometry = coloredBox(
      dimensions.width,
      height,
      dimensions.depth,
      (FOUNDATION_OVERLAP - foundationDepth) / 2,
    );
    const skirtMaterial = townMaterial(false, undefined, true);
    skirtMaterial.name = `eastbrookTownKitSkirt:${building.id}`;
    const skirt = new THREE.Mesh(skirtGeometry, skirtMaterial);
    skirt.castShadow = false;
    skirt.receiveShadow = true;
    group.add(skirt);
    occluderFadeRecordFor(mats, skirtMaterial, skirt);
  }

  return {
    group,
    hideTarget: {
      group,
      mats,
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

function materialOptions(emissive: boolean, atlas = eastbrookSurfaceAtlasTexture()) {
  // Baked PBR companions ride the color atlas's cell UVs (Standard tier only;
  // Lambert tiers skip the bind outright, surfaceMat would drop the maps).
  // Emissive windows keep their authored flat look.
  const detail = !emissive && GFX.standardMaterials;
  const normalMap = detail ? eastbrookSurfaceNormalTexture() : undefined;
  const roughnessMap = detail ? eastbrookSurfaceRoughnessTexture() : undefined;
  return {
    color: 0xffffff,
    map: emissive ? undefined : atlas,
    vertexColors: true,
    normalMap,
    roughnessMap,
    // The rough atlas bakes per-cell base roughness, so it is the authority
    // when bound; the flat 0.86 stays the fallback while it has not loaded.
    roughness: emissive ? 0.55 : roughnessMap ? 1 : 0.86,
    metalness: emissive ? 0.08 : 0,
    emissive: emissive ? 0xffffff : 0x000000,
    // White x vertex color (vertex_color_emissive.ts), so the amber/cyan pane
    // tints carry the hue and their luma (0.47 amber) sets how far this has to
    // climb to clear post.ts BLOOM_THRESHOLD. At the old intensity 1 no window
    // in town glowed while sunlit plaster nearly did.
    // EMISSIVE_GLOW is calibrated against the bloom threshold; without the
    // composer the raise just desaturates the amber to a pasted-on cream,
    // so non-bloom tiers keep the authored pane level.
    emissiveIntensity: emissive
      ? GFX.standardMaterials && GFX.composer
        ? EMISSIVE_GLOW
        : GFX.standardMaterials
          ? 1
          : 0.72
      : 1,
    flatShading: !GFX.standardMaterials,
  } as const;
}

function townMaterial(
  emissive: boolean,
  atlas: THREE.Texture | undefined,
  independent = false,
): THREE.Material {
  const shared = surfaceMat(materialOptions(emissive, atlas));
  if (shared instanceof THREE.MeshStandardMaterial && shared.normalMap) {
    // Idempotent on the shared cached material; the key includes the map, so
    // only the town's atlas-normal material ever carries this scale.
    shared.normalScale.setScalar(EASTBROOK_SURFACE_NORMAL_SCALE);
  }
  // Hook-preserving clone: a bare clone dropped the zone-haze hook and split
  // the program cache key, so each independent building material linked a new
  // program at first sight (the town's share of the first-contact burst).
  const material = independent ? cloneMaterialWithHooks(shared) : shared;
  // Conservative triplanar detail OVER the baked atlas (the baked cells are
  // stretched per-face and judged too flat alone); applied after the clone
  // decision so the clone records its own detail spec.
  return emissive
    ? modulateEmissiveByVertexColor(material)
    : applyEastbrookTownSurfaceDetail(material);
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
  return indexExactVertexTuples(eastbrookSurfaceGeometry(geometry, 'darkStoneBlocks'));
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

  const materials = [occluderFadeMat(opaqueMaterial, opaqueMesh)];
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
    materials.push(occluderFadeMat(emissiveMaterial, emissiveMesh));
  }

  return {
    group,
    hideTarget: {
      group,
      mats: materials,
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
    return {
      group,
      update: () => undefined,
      setRevealGate: () => undefined,
      staticRevealRoots: () => [],
    };
  }

  const roofHideTargets: RoofHideTarget[] = [];
  const buildingGroups: THREE.Object3D[] = [];
  for (const building of EASTBROOK_LAYOUT.buildings) {
    const kitTemplate = templates.get(building.assetId);
    if (kitTemplate?.raw) {
      const built = buildKitBuilding(building, kitTemplate.raw, groundAt);
      group.add(built.group);
      roofHideTargets.push(built.hideTarget);
      // A kit building is a reveal root like any other: its kit materials are
      // unshared with the batches, and roofHideTargets stays index-aligned
      // with buildingGroups (the footprint anchors are built from that pair).
      buildingGroups.push(built.group);
      continue;
    }
    const template = templates.get(building.assetId);
    if (!template) throw new Error(`Eastbrook town template is missing: ${building.assetId}`);
    const built = buildBuilding(building, template, groundAt, atlas);
    group.add(built.group);
    roofHideTargets.push(built.hideTarget);
    buildingGroups.push(built.group);
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
  // The reveal gate compiles the buildings with the static batches: their
  // per-building materials are not shared with any batch, so a building
  // outside the roots linked cold on the frame its own fog cull first showed
  // it (the Fenbridge shape, same fix).
  const staticRevealRoots: THREE.Object3D[] = [...staticCullTargets, ...buildingGroups];
  // Piecewise reveal anchors, in staticRevealRoots order: a batch spans the
  // whole town so it anchors at the centre (Eastbrook sits on the world
  // origin), a building at its own footprint. roofHideTargets is built in the
  // buildingGroups loop, so the two stay index-aligned by construction.
  // Only the buildings are FOOTPRINT-anchored, so only they can take the reach
  // floor: a batch's centre anchor is an ordering hint, never an arm's-length
  // distance (a camera at the centre would flip every batch at once).
  const rootX: number[] = staticCullTargets.map(() => 0);
  const rootZ: number[] = staticCullTargets.map(() => 0);
  const rootFootprint: boolean[] = staticCullTargets.map(() => false);
  for (const target of roofHideTargets) {
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

  let revealGate: RevealGateCore | null = null;
  let staticRevealed = false;
  // The gate asks for the roots the moment the consult fires the request, so
  // these are the CAMERA's coordinates of that very frame: an arrival submits
  // the buildings it landed among before the far side of the town.
  let lastCamX = 0;
  let lastCamZ = 0;
  const orderedRevealRoots: THREE.Object3D[] = [];
  return {
    group,
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
      updateEastbrookCivicBeaconMotion(microBuild.civicBeaconState, reducedMotion);
      lastCamX = camX;
      lastCamZ = camZ;
      // Eastbrook is centred on the world origin, so the camera's distance
      // squared to the town centre is camX^2 + camZ^2.
      const reveal = townStaticReveal(
        eastbrookFogVisible(camX, camZ, 0, 0, fogFar, TOWN_CULL_RADIUS),
        staticRevealed,
        camX * camX + camZ * camZ,
        TOWN_CULL_RADIUS,
        revealGate,
        STATIC_REVEAL_KEY,
      );
      if (reveal === 'revealed') staticRevealed = true;
      // While the key is held, each root that has linked comes in on its own,
      // nearest first: the whole town no longer waits for its slowest program.
      townPiecewiseRevealInto(staticPiecewise, reveal, camX, camZ, revealGate);
      for (let index = 0; index < staticCullTargets.length; index++) {
        staticCullTargets[index].visible = townRootVisible(reveal, staticPiecewise, index);
      }
      // Buildings keep their own fog cull and roof fade, but their FIRST
      // reveal rides the same hold as the batches: while the gate compiles
      // the town they stay hidden until their own group has linked, and once
      // the key is revealed the latch above never consults the gate again (a
      // fog re-entry is a plain cull flip).
      const buildingRootBase = staticCullTargets.length;
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
        target.group.visible =
          roofVisibilityPlan.visible &&
          townRootVisible(reveal, staticPiecewise, buildingRootBase + index);
        if (!roofVisibilityPlan.visible) continue;
        prefetchOccluderFadeWithin(target.mats, target.x, target.z, camX, camZ);
        target.hidden = roofVisibilityPlan.hidden;
        target.alpha = advanceOccluderFade(
          target.mats,
          target.alpha,
          target.hidden,
          dt,
          reducedMotion,
        );
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
  const view = buildFromTemplates(
    preparedTemplates,
    (x, z) => terrainHeight(x, z, seed),
    true,
    eastbrookSurfaceAtlasTexture(),
  );
  // The harbor waterfront rides the town view's group: quay boardwalk and
  // piers from the same deck rectangles groundHeight walks
  // (render/eastbrook_harbor.ts), so the parent's category tag and matrix
  // freeze cover it.
  view.group.add(buildEastbrookHarbor(seed));
  return view;
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
