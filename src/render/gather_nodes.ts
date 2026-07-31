import * as THREE from 'three';
import type { GatherNodeType } from '../sim/data';
import { GATHER_NODES } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { NODE_COLOR, NODE_Y_OFFSET } from './gather_nodes_lookup';
import { surfaceMat } from './gfx';

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
}

// One template part per mesh primitive of a node type's model: geometry +
// material plus the GLB's internal node transform, baked into each instance
// matrix so the instanced result matches the old per-node scene clones.
interface NodeTemplatePart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  local: THREE.Matrix4;
}

function nodeTemplateParts(type: GatherNodeType): NodeTemplatePart[] {
  // Placement identity with the old per-node scene clones assumes the GLB
  // scene ROOT has an identity transform (GLTFLoader always creates a fresh
  // root Group): the old code overwrote the clone root's position, while the
  // instanced matrices retain any root offset inside `matrixWorld`.
  const loaded = loadedNodeGltf.get(type);
  if (loaded) {
    loaded.updateMatrixWorld(true);
    const parts: NodeTemplatePart[] = [];
    loaded.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        parts.push({
          geo: child.geometry,
          mat: child.material as THREE.Material,
          local: child.matrixWorld.clone(),
        });
      }
    });
    if (parts.length > 0) return parts;
  }
  return [
    {
      geo: NODE_FALLBACK_GEOMETRY[type](),
      mat: surfaceMat({ color: NODE_COLOR[type] }),
      local: new THREE.Matrix4(),
    },
  ];
}

// The 33 world nodes used to be 33 individual scene clones (one draw each,
// never culled); one InstancedMesh per (node type x model part) collapses
// them to one draw per part with identical placement.
export function buildGatherNodes(seed: number): GatherNodesView {
  const group = new THREE.Group();
  group.name = 'gatherNodes';
  // Batch per (type x 180u z-band) rather than one world-spanning mesh per
  // type, so off-screen bands stay frustum-cullable.
  const byType = new Map<
    string,
    { type: GatherNodeType; nodes: (typeof GATHER_NODES)[number][] }
  >();
  for (const node of GATHER_NODES) {
    const key = `${node.type}:${Math.floor(node.pos.z / 180)}`;
    const bucket = byType.get(key);
    if (bucket) bucket.nodes.push(node);
    else byType.set(key, { type: node.type, nodes: [node] });
  }
  const placement = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();
  for (const { type, nodes } of byType.values()) {
    const ids = nodes.map((n) => n.id);
    for (const part of nodeTemplateParts(type)) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, nodes.length);
      im.name = `gatherNodes:${type}`;
      nodes.forEach((node, i) => {
        const y = terrainHeight(node.pos.x, node.pos.z, seed);
        placement.makeTranslation(node.pos.x, y + NODE_Y_OFFSET[type], node.pos.z);
        matrix.multiplyMatrices(placement, part.local);
        im.setMatrixAt(i, matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      // Click/tap-to-harvest target (#1866): the renderer raycasts the node
      // meshes; instanced hits resolve through instanceId against this list
      // (the instanced twin of the entity views' `entityId` convention).
      im.userData.gatherNodeIds = ids;
      group.add(im);
    }
  }
  return { group };
}

// Structural raycast-hit shape shared with THREE.Intersection, so the
// resolver is Node-testable without a renderer.
export interface GatherNodePickHit {
  object: { userData: Record<string, unknown>; parent?: unknown } | null;
  instanceId?: number;
}

/**
 * Resolve a raycast hit list to a gather-node content id: instanced batches
 * resolve through instanceId against the batch's `gatherNodeIds` list, and
 * any non-instanced mesh falls back to the legacy per-object
 * `gatherNodeId` parent walk. Returns null when nothing matches.
 */
export function resolveGatherNodePick(hits: readonly GatherNodePickHit[]): string | null {
  for (const hit of hits) {
    const ids = hit.object?.userData.gatherNodeIds;
    if (Array.isArray(ids) && typeof hit.instanceId === 'number') {
      const id = ids[hit.instanceId];
      if (typeof id === 'string') return id;
    }
    let o = hit.object ?? null;
    while (o) {
      if (typeof o.userData.gatherNodeId === 'string') return o.userData.gatherNodeId as string;
      o = (o.parent ?? null) as GatherNodePickHit['object'];
    }
  }
  return null;
}

/** Test-only window into the preload asset set (mirrors props.ts). */
export const gatherNodePreloadInternalsForTest = {
  nodeAssetUrl: NODE_ASSET_URL,
};
