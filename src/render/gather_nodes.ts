import * as THREE from 'three';
import { GATHER_NODES } from '../sim/data';
import type { GatherNodeDef, GatherNodeType } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { NODE_COLOR, NODE_Y_OFFSET, nodeTierScale } from './gather_nodes_lookup';
import { surfaceMat } from './gfx';
import { casterShadowMayReachCamera, type ScenerySphere } from './resident_scenery_core';

// Visible markers for gatherable world nodes (ore/wood/herb). Content and
// placements come from sim/content/gather_nodes.ts (merged into
// sim/data.ts's GATHER_NODES); this module only draws them. No harvest logic
// here (see G3); these are static, unowned fixtures.
//
// Each node type is a small Tripo-generated GLB (see public/models/resources/
// CLAUDE.md for the generation/compression pipeline). Adding a node type
// requires a new entry in NODE_ASSET_URL here plus a matching entry in
// gather_nodes_lookup.ts (colors, used as the fallback-primitive tint) and
// the GatherNodeType union (sim/types.ts).
const NODE_ASSET_URL: Record<GatherNodeType, string> = {
  ore: '/models/resources/gather_ore_vein.glb',
  wood: '/models/resources/gather_wood_pile.glb',
  herb: '/models/resources/gather_herb_cluster.glb',
};

// Fallback primitive geometry, used only if a node's GLB has not finished
// loading yet by the time buildGatherNodes runs (headless/test hosts, or a
// slow preload race online). Kept tiny and deterministic, no textures.
const NODE_FALLBACK_GEOMETRY: Record<GatherNodeType, () => THREE.BufferGeometry> = {
  ore: () => new THREE.IcosahedronGeometry(0.7, 0),
  wood: () => new THREE.ConeGeometry(0.55, 1.8, 6),
  herb: () => new THREE.BoxGeometry(0.5, 0.5, 0.5),
};

const loadedNodeGltf = new Map<GatherNodeType, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [type, url] of Object.entries(NODE_ASSET_URL) as [GatherNodeType, string][]) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        loadedNodeGltf.set(type, gltf.scene);
      }),
    );
  }
}

export interface GatherNodesView {
  group: THREE.Group;
  updateShadowVisibility(
    camera: THREE.PerspectiveCamera,
    lightDirection: THREE.Vector3,
    shadowsEnabled: boolean,
  ): void;
}

interface GatherNodeShadowEntry {
  readonly bounds: ScenerySphere;
  readonly casters: THREE.Mesh[];
  casts: boolean;
}

interface GatherNodeBatch {
  type: GatherNodeType;
  zoneId: string;
  band: number;
  nodes: GatherNodeDef[];
}

interface GatherNodeMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
  source: THREE.Mesh;
}

function buildNodeTemplate(type: GatherNodeType): THREE.Object3D {
  const loaded = loadedNodeGltf.get(type);
  if (loaded) {
    const inst = loaded.clone(true);
    inst.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return inst;
  }
  const geo = NODE_FALLBACK_GEOMETRY[type]();
  const mat = surfaceMat({ color: NODE_COLOR[type] });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function isOpaqueMaterial(material: THREE.Material): boolean {
  const physical = material as THREE.Material & { transmission?: number };
  return (
    material.visible &&
    !material.transparent &&
    material.opacity === 1 &&
    material.alphaTest === 0 &&
    !material.alphaHash &&
    !material.alphaToCoverage &&
    material.depthTest &&
    material.depthWrite &&
    material.colorWrite &&
    (physical.transmission ?? 0) === 0
  );
}

function gatherNodeMeshParts(template: THREE.Object3D): GatherNodeMeshPart[] | null {
  template.updateMatrixWorld(true);
  const parts: GatherNodeMeshPart[] = [];
  let supported = true;
  template.traverse((child) => {
    if (
      child instanceof THREE.Line ||
      child instanceof THREE.Points ||
      child instanceof THREE.Sprite ||
      child instanceof THREE.SkinnedMesh
    ) {
      supported = false;
      return;
    }
    if (!(child instanceof THREE.Mesh) || !child.visible) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (
      materials.some((material) => !isOpaqueMaterial(material)) ||
      Object.keys(child.geometry.morphAttributes).length > 0
    ) {
      supported = false;
      return;
    }
    parts.push({
      geometry: child.geometry,
      material: child.material,
      matrix: child.matrixWorld.clone(),
      source: child,
    });
  });
  return supported && parts.length > 0 ? parts : null;
}

function gatherNodeBatches(nodes: readonly GatherNodeDef[]): GatherNodeBatch[] {
  const byZoneTypeAndBand = new Map<string, GatherNodeBatch>();
  for (const node of nodes) {
    const band = Math.floor(node.pos.z / 180);
    const key = `${node.zoneId}:${node.type}:${band}`;
    let batch = byZoneTypeAndBand.get(key);
    if (!batch) {
      batch = { type: node.type, zoneId: node.zoneId, band, nodes: [] };
      byZoneTypeAndBand.set(key, batch);
    }
    batch.nodes.push(node);
  }
  return [...byZoneTypeAndBand.values()];
}

function copyMeshRenderState(source: THREE.Mesh, target: THREE.InstancedMesh): void {
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.layers.mask = source.layers.mask;
  target.renderOrder = source.renderOrder;
  target.frustumCulled = source.frustumCulled;
  target.customDepthMaterial = source.customDepthMaterial;
  target.customDistanceMaterial = source.customDistanceMaterial;
  target.onBeforeRender = source.onBeforeRender;
  target.onAfterRender = source.onAfterRender;
  target.onBeforeShadow = source.onBeforeShadow;
  target.onAfterShadow = source.onAfterShadow;
}

function addInstancedBatch(
  group: THREE.Group,
  batch: GatherNodeBatch,
  parts: GatherNodeMeshPart[],
  seed: number,
  shadowEntries: GatherNodeShadowEntry[],
): void {
  const placement = new THREE.Matrix4();
  const tierMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const partBox = new THREE.Box3();
  const nodeIds = batch.nodes.map((node) => node.id);
  // The UNSCALED template bounds, per BUILD and not module-level: the GLBs
  // can finish loading between one build and a later one (the
  // fallback-primitive race), and a stale cache would then anchor fresh
  // GLB instances with the primitive's minY. The base anchor below needs
  // the geometry-space minY of the whole template (the parts union, each
  // in its baked local transform, the instanced twin of the old clone's
  // Box3). A degenerate box (no geometry yet) reads 0 and the anchor is a
  // no-op.
  const templateBox = new THREE.Box3();
  for (const part of parts) {
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) {
      partBox.copy(part.geometry.boundingBox).applyMatrix4(part.matrix);
      templateBox.union(partBox);
    }
  }
  const minY = Number.isFinite(templateBox.min.y) ? templateBox.min.y : 0;
  // Instance transforms are baked into world space. Union every mesh part so
  // one castShadow decision conservatively covers the regional batch.
  const batchBounds = new THREE.Box3();
  const casters: THREE.Mesh[] = [];
  for (const [partIndex, part] of parts.entries()) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, batch.nodes.length);
    mesh.name = `gatherNodes:${batch.zoneId}:${batch.type}:${batch.band}:${partIndex}`;
    // Raycaster intersections carry the instance index, which resolves through
    // this stable content-order table without widening the renderer's picker.
    mesh.userData.gatherNodeIds = nodeIds;
    mesh.userData.gatherNodeZoneId = batch.zoneId;
    mesh.userData.gatherNodeType = batch.type;
    mesh.userData.gatherNodeBand = batch.band;
    copyMeshRenderState(part.source, mesh);
    for (const [instanceId, node] of batch.nodes.entries()) {
      const y = terrainHeight(node.pos.x, node.pos.z, seed);
      // Tier differentiation (the UX pass): size, never hue, identical on
      // every preset (gather_nodes_lookup.ts nodeTierScale), anchored at
      // the BASE and not the geometry center (the phase 14 QA): the prop
      // geometries are centered in Y, so a center-anchored upscale pushes
      // the base (s - 1) * |minY| deeper and a tier-3 prop sinks visibly
      // into the terrain. Compensate so the base sits at the same height
      // above ground at every tier.
      const tierScale = nodeTierScale(node.tier);
      placement.makeTranslation(
        node.pos.x,
        y + NODE_Y_OFFSET[node.type] - (tierScale - 1) * minY,
        node.pos.z,
      );
      tierMatrix.makeScale(tierScale, tierScale, tierScale);
      instanceMatrix.multiplyMatrices(placement, tierMatrix).multiply(part.matrix);
      mesh.setMatrixAt(instanceId, instanceMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    if (mesh.boundingBox) batchBounds.union(mesh.boundingBox);
    if (mesh.castShadow) casters.push(mesh);
    group.add(mesh);
  }
  if (casters.length > 0 && !batchBounds.isEmpty()) {
    const sphere = batchBounds.getBoundingSphere(new THREE.Sphere());
    shadowEntries.push({
      bounds: {
        x: sphere.center.x,
        y: sphere.center.y,
        z: sphere.center.z,
        radius: sphere.radius,
      },
      casters,
      casts: true,
    });
  }
}

function addIndividualNode(
  group: THREE.Group,
  template: THREE.Object3D,
  node: GatherNodeDef,
  seed: number,
  shadowEntries: GatherNodeShadowEntry[],
): void {
  const obj = template.clone(true);
  const y = terrainHeight(node.pos.x, node.pos.z, seed);
  // Tier scale with the same base anchor as the instanced path: measure the
  // clone's UNSCALED bounds at the origin (fresh per build, the
  // fallback-primitive race), then compensate the upscale's push so the
  // prop base sits at the same height above ground at every tier.
  const templateBox = new THREE.Box3().setFromObject(obj);
  const minY = Number.isFinite(templateBox.min.y) ? templateBox.min.y : 0;
  const tierScale = nodeTierScale(node.tier);
  obj.scale.setScalar(tierScale);
  obj.position.set(node.pos.x, y + NODE_Y_OFFSET[node.type] - (tierScale - 1) * minY, node.pos.z);
  obj.name = node.id;
  obj.userData.gatherNodeId = node.id;
  group.add(obj);
  const casters: THREE.Mesh[] = [];
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.castShadow) casters.push(child);
  });
  if (casters.length > 0) {
    const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    shadowEntries.push({
      bounds: {
        x: sphere.center.x,
        y: sphere.center.y,
        z: sphere.center.z,
        radius: sphere.radius,
      },
      casters,
      casts: true,
    });
  }
}

function buildGatherNodesFromTemplates(
  seed: number,
  templates: ReadonlyMap<GatherNodeType, THREE.Object3D>,
  nodes: readonly GatherNodeDef[],
): GatherNodesView {
  const group = new THREE.Group();
  group.name = 'gatherNodes';
  const shadowEntries: GatherNodeShadowEntry[] = [];
  const partsByType = new Map<GatherNodeType, GatherNodeMeshPart[] | null>();
  for (const batch of gatherNodeBatches(nodes)) {
    const template = templates.get(batch.type);
    if (!template) throw new Error(`Missing gather node render template: ${batch.type}`);
    if (!partsByType.has(batch.type)) {
      partsByType.set(batch.type, gatherNodeMeshParts(template));
    }
    const parts = partsByType.get(batch.type);
    if (parts) {
      addInstancedBatch(group, batch, parts, seed, shadowEntries);
      continue;
    }
    // Preserve the authored hierarchy and draw order if a future asset uses
    // transparent, alpha-tested, skinned, morphed, line, point, or sprite
    // rendering. Those cases are not safe to consolidate.
    for (const node of batch.nodes) {
      addIndividualNode(group, template, node, seed, shadowEntries);
    }
  }
  const cameraForward = new THREE.Vector3();
  const cameraState = {
    position: new THREE.Vector3(),
    forward: cameraForward,
    near: 0,
  };
  return {
    group,
    updateShadowVisibility(
      camera: THREE.PerspectiveCamera,
      lightDirection: THREE.Vector3,
      shadowsEnabled: boolean,
    ): void {
      if (!shadowsEnabled) return;
      camera.getWorldDirection(cameraForward);
      cameraState.position.copy(camera.position);
      cameraState.near = camera.near;
      for (const entry of shadowEntries) {
        const casts = casterShadowMayReachCamera(entry.bounds, cameraState, lightDirection);
        if (casts === entry.casts) continue;
        entry.casts = casts;
        for (const mesh of entry.casters) mesh.castShadow = casts;
      }
    },
  };
}

export function buildGatherNodes(seed: number): GatherNodesView {
  const templates = new Map<GatherNodeType, THREE.Object3D>();
  for (const node of GATHER_NODES) {
    if (!templates.has(node.type)) templates.set(node.type, buildNodeTemplate(node.type));
  }
  return buildGatherNodesFromTemplates(seed, templates, GATHER_NODES);
}

export function gatherNodeIdFromIntersection(
  hit: THREE.Intersection<THREE.Object3D>,
): string | null {
  const instanceIds = hit.object.userData.gatherNodeIds;
  if (hit.instanceId !== undefined && Array.isArray(instanceIds)) {
    const id = instanceIds[hit.instanceId];
    if (typeof id === 'string') return id;
  }
  let object: THREE.Object3D | null = hit.object;
  while (object) {
    if (typeof object.userData.gatherNodeId === 'string') {
      return object.userData.gatherNodeId as string;
    }
    object = object.parent;
  }
  return null;
}

// Structural raycast-hit shape shared with THREE.Intersection, so the
// resolver is Node-testable without a renderer.
export interface GatherNodePickHit {
  object: { userData: Record<string, unknown>; parent?: unknown } | null;
  instanceId?: number;
}

/**
 * Resolve a raycast hit list to a gather-node content id. Instanced batches
 * resolve through instanceId against their stable id list, while authored
 * hierarchy fallbacks walk parents for the legacy per-object id.
 */
export function resolveGatherNodePick(hits: readonly GatherNodePickHit[]): string | null {
  for (const hit of hits) {
    const ids = hit.object?.userData.gatherNodeIds;
    if (Array.isArray(ids) && typeof hit.instanceId === 'number') {
      const id = ids[hit.instanceId];
      if (typeof id === 'string') return id;
    }
    let object = hit.object ?? null;
    while (object) {
      if (typeof object.userData.gatherNodeId === 'string') {
        return object.userData.gatherNodeId as string;
      }
      object = (object.parent ?? null) as GatherNodePickHit['object'];
    }
  }
  return null;
}

/** Test-only window into the preload asset set (mirrors props.ts). */
export const gatherNodePreloadInternalsForTest = {
  nodeAssetUrl: NODE_ASSET_URL,
  buildFromTemplates: buildGatherNodesFromTemplates,
};
