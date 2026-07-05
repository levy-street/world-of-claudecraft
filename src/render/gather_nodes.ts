import * as THREE from 'three';
import type { GatherNodeType } from '../sim/data';
import { GATHER_NODES } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { NODE_COLOR, NODE_Y_OFFSET } from './gather_nodes_lookup';
import { surfaceMat } from './gfx';

// Minimal visible markers for gatherable world nodes (ore/wood/herb). Content
// and placements come from sim/content/gather_nodes.ts (merged into
// sim/data.ts's GATHER_NODES); this module only draws them. No harvest logic
// here (see G3); these are static, unowned fixtures.
//
// Procedural-only, no new textures: each node type maps to a simple colored
// primitive. Adding a node type requires a new entry here plus a matching
// entry in gather_nodes_lookup.ts (colors) and the GatherNodeType union
// (sim/types.ts).
const NODE_GEOMETRY: Record<GatherNodeType, () => THREE.BufferGeometry> = {
  ore: () => new THREE.IcosahedronGeometry(0.7, 0),
  wood: () => new THREE.ConeGeometry(0.55, 1.8, 6),
  herb: () => new THREE.BoxGeometry(0.5, 0.5, 0.5),
};

export interface GatherNodesView {
  group: THREE.Group;
}

export function buildGatherNodes(seed: number): GatherNodesView {
  const group = new THREE.Group();
  group.name = 'gatherNodes';
  for (const node of GATHER_NODES) {
    const geo = NODE_GEOMETRY[node.type]();
    const mat = surfaceMat({ color: NODE_COLOR[node.type] });
    const mesh = new THREE.Mesh(geo, mat);
    const y = terrainHeight(node.pos.x, node.pos.z, seed);
    mesh.position.set(node.pos.x, y + NODE_Y_OFFSET[node.type], node.pos.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = node.id;
    group.add(mesh);
  }
  return { group };
}
