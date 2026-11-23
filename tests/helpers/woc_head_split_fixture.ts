// Synthetic SPLIT WOC head files for the head suites (woc_head_dressing, the Guide
// viewer's head, the far LOD's head, the store): every catalog node of a head type
// grouped into the file the split library ships it in (woc_head_catalog.ts
// wocHeadCoreUrl / wocHeadPieceUrl), each file a scene whose `head` node carries its
// pieces, the shape woc_head_pack_split.mjs writes. The piece meshes are the calling
// suite's own (its materials, morph targets and sizes), built by `makePiece`.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_SITES,
  type WocHeadType,
  wocHeadBaseNode,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
  wocHeadPiercingNode,
  wocHeadVariantNodes,
} from '../../src/render/characters/woc_head_catalog';

/** Every piece node of a type's library, grouped by the url of the file it ships in. */
export function wocHeadNodesByFile(type: WocHeadType): Map<string, string[]> {
  const core = wocHeadCoreUrl(type);
  const out = new Map<string, string[]>([[core, [wocHeadBaseNode(type)]]]);
  const add = (url: string, nodes: readonly string[]): void => {
    if (nodes.length === 0) return;
    const list = out.get(url) ?? [];
    list.push(...nodes);
    out.set(url, list);
  };
  for (const slot of WOC_HEAD_SLOTS) {
    for (const v of WOC_HEAD_TYPES[type].slots[slot]) {
      const url = wocHeadPieceUrl(type, slot, v.id) ?? core;
      add(url, wocHeadVariantNodes(type, slot, v.id));
    }
  }
  add(
    core,
    WOC_PIERCING_SITES.map((site) => wocHeadPiercingNode(type, site)),
  );
  return out;
}

/** The url of the file one piece node ships in. */
export function wocHeadFileOfNode(type: WocHeadType, node: string): string {
  for (const [url, nodes] of wocHeadNodesByFile(type)) if (nodes.includes(node)) return url;
  throw new Error(`${node} is no ${type} head piece`);
}

/** One split file's scene: a `head` node at the scene root carrying one piece per node
 *  name (the rig above `head` is not needed: the binder hangs pieces by bone NAME). */
export function splitHeadScene(
  nodes: readonly string[],
  makePiece: (name: string) => THREE.Object3D,
): GLTF {
  const scene = new THREE.Group();
  const head = new THREE.Object3D();
  head.name = 'head';
  scene.add(head);
  for (const name of nodes) head.add(makePiece(name));
  return { scene, animations: [] } as unknown as GLTF;
}

/** Every split file of a type's library as a scene, by url. */
export function splitHeadScenes(
  type: WocHeadType,
  makePiece: (name: string) => THREE.Object3D,
): Map<string, GLTF> {
  const out = new Map<string, GLTF>();
  for (const [url, nodes] of wocHeadNodesByFile(type)) {
    out.set(url, splitHeadScene(nodes, makePiece));
  }
  return out;
}
