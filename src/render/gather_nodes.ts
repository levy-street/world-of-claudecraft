import * as THREE from 'three';
import type { GatherNodeType } from '../sim/data';
import { GATHER_NODES } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
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
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedNodeGltf.set(type, gltf.scene);
      }),
    );
  }
}

export interface GatherNodesView {
  group: THREE.Group;
}

function buildNodeMesh(type: GatherNodeType): THREE.Object3D {
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

export function buildGatherNodes(seed: number): GatherNodesView {
  const group = new THREE.Group();
  group.name = 'gatherNodes';
  for (const node of GATHER_NODES) {
    const obj = buildNodeMesh(node.type);
    const y = terrainHeight(node.pos.x, node.pos.z, seed);
    obj.position.set(node.pos.x, y + NODE_Y_OFFSET[node.type], node.pos.z);
    obj.name = node.id;
    // Click/tap-to-harvest target (#1866): the renderer raycasts clickable node
    // meshes and reads this back to resolve which node was hit, the same
    // userData convention entity views use for `entityId`.
    obj.userData.gatherNodeId = node.id;
    group.add(obj);
  }
  return { group };
}

/** Test-only window into the preload asset set (mirrors props.ts). */
export const gatherNodePreloadInternalsForTest = {
  nodeAssetUrl: NODE_ASSET_URL,
};
