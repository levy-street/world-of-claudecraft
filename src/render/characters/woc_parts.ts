// The three.js half of WOC part selection: resolve a body's part nodes by name
// once and flip their visibility to a set the pure core decided. Visibility is
// the whole mechanism (nothing is pruned, merged per look, or re-cached): the
// GLB carries every part on the one rig, so dressing a character is a flag per
// node, and a look change never rebuilds geometry.
//
// Two node shapes are resolved for a part name: the part's own node, and the
// `<name>_bodymerged` SkinnedMesh rig_merge.ts mints when it folds same-material
// parts into one draw (an armor piece's left/right halves, a chest's front and
// back), which retains the names of every constituent part. Both halves of a
// merged pair belong to one item, so the pair's flag is one flag.
//
// An armor part resolves only once its set's file is attached (the split files,
// woc_armor_dressing.ts): until then it is simply absent from the map, and the
// body's own suit shows in its place. Only the BASE's own parts (the body and
// the face pieces) are a contract every body must resolve.
import type * as THREE from 'three';
import { logAssetMissOnce } from './asset_miss_log';
import { skinnedPartNames } from './rig_merge';
import type { WocCharacterManifest } from './woc_character_manifest';
import { wocAllPartNames, wocBodyPartNames, wocNodeNameOf } from './woc_parts_core';

/** Part name -> the nodes that draw it under this root (resolved once per body). */
export type WocPartNodes = ReadonlyMap<string, readonly THREE.Object3D[]>;

export function resolveWocPartNodes(
  root: THREE.Object3D,
  manifest: WocCharacterManifest,
): WocPartNodes {
  const names = new Set(wocAllPartNames(manifest));
  const found = new Map<string, THREE.Object3D[]>();
  root.traverse((o) => {
    // A merged draw represents every source part, including parts whose own
    // nodes were removed. Split primitive names still resolve as one part.
    for (const name of new Set(skinnedPartNames(o).map(wocNodeNameOf))) {
      if (!names.has(name)) continue;
      const list = found.get(name);
      if (list) list.push(o);
      else found.set(name, [o]);
    }
  });
  // A body part with no node is the silent failure class the manifest header
  // warns about (a renamed node, or a merge that folded one part into another):
  // say so once per rig in dev instead of drawing a body missing a piece forever.
  const missing = wocBodyPartNames(manifest).filter((name) => !found.has(name));
  if (missing.length > 0) {
    logAssetMissOnce(
      `woc-parts:${manifest.rigId}:${manifest.fit}`,
      `WOC body ${manifest.rigId}: manifest parts resolved to no node: ${missing.join(', ')}`,
      undefined,
    );
  }
  return found;
}

/** Show exactly the parts in `visible`; every other manifest part hides.
 *  Returns how many part names resolved to at least one node. */
export function applyWocPartVisibility(
  parts: WocPartNodes,
  manifest: WocCharacterManifest,
  visible: ReadonlySet<string>,
): number {
  let resolved = 0;
  for (const name of wocAllPartNames(manifest)) {
    const nodes = parts.get(name);
    if (!nodes) continue;
    resolved++;
    const on = visible.has(name);
    for (const node of nodes) node.visible = on;
  }
  return resolved;
}
