// Portraits need the drawn silhouette, not a skinned mesh's cached culling
// box. WOC gear carries loose boxes and the root also contains hidden far,
// shadow and pick proxies. Measure the posed manifest parts once per capture.
//
// The headshot frames off the drawn modular HEAD instead (measureWocPortraitHead
// below, framed by portrait_framing.ts headshotAimForHead): its pieces are rigid
// children of the head bone (woc_head_packs.ts), so their boxes are exact, and a
// frame sized on them is the same for every class kit and body scale. And the
// head is drawn uncovered first (uncoverWocPortraitHead): a portrait is the face.
import * as THREE from 'three';
import type { PortraitHeadBounds } from './portrait_framing';
import type { WocCharacterManifest } from './woc_character_manifest';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  type WocHeadLook,
  type WocHeadType,
  wocHeadBaseNode,
  wocHeadTypeForGender,
  wocHeadVisibleNodes,
} from './woc_head_catalog';
import { wocHeadBaldCrownWeight } from './woc_head_look_core';
import { WOC_HEAD_WRAPPER } from './woc_head_packs';
import { resolveWocPartNodes } from './woc_parts';

/** Whether `node` draws: it and every ancestor up to `root` are visible. */
function drawnUnder(node: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = node; at; at = at.parent) {
    if (!at.visible) return false;
    if (at === root) break;
  }
  return true;
}

export function measureWocPortraitBounds(
  root: THREE.Object3D,
  manifest: WocCharacterManifest,
  target: THREE.Box3,
): boolean {
  target.makeEmpty();
  // Bone siblings must all have current world matrices before the first skin
  // vertex is sampled; measuring each mesh separately can cache a stale pose.
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  const meshes = new Set<THREE.Mesh>();
  const collect = (node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.weaponMesh && !mesh.userData.weaponVfxMesh) meshes.add(mesh);
  };
  for (const nodes of resolveWocPartNodes(root, manifest).values()) {
    for (const node of nodes) {
      // A multi-material GLTF part is a Group of primitive meshes. A body
      // Mesh can own bones and weapons, so do not traverse through that mesh.
      if ((node as THREE.Mesh).isMesh) collect(node);
      else node.traverse(collect);
    }
  }
  const vertex = new THREE.Vector3();
  for (const mesh of meshes) {
    if (!drawnUnder(mesh, root)) continue;
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    for (let index = 0; index < position.count; index++) {
      // THREE's same precise path as Box3(..., true): includes the current
      // morph and skin transforms and never reads cached mesh.boundingBox.
      mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
      target.expandByPoint(vertex);
    }
  }
  return !target.isEmpty();
}

const pieceBox = new THREE.Box3();
const baseBox = new THREE.Box3();
const eyeBox = new THREE.Box3();
const drawnBox = new THREE.Box3();

/**
 * The drawn modular head of a WOC body of head `type`, measured on its posed
 * pieces: the head base's box, the drawn eyes' centre (the face's horizontal
 * centre and its eye line), and the top of every drawn piece (a topknot, a high
 * ponytail). A piece is a direct child of a hung head's wrapper group, so no
 * other rig part is ever read. Precise
 * boxes, so the face-control morphs (the scalp tuck under a hairstyle, the chin)
 * count. Null when no head is hung or its base does not draw: the caller then
 * frames from the body box as before.
 */
export function measureWocPortraitHead(
  root: THREE.Object3D,
  type: WocHeadType,
): PortraitHeadBounds | null {
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  const baseName = wocHeadBaseNode(type);
  const eyePrefix = `${baseName.slice(0, -'base'.length)}eyes_`;
  baseBox.makeEmpty();
  eyeBox.makeEmpty();
  drawnBox.makeEmpty();
  root.traverse((node) => {
    if (node.parent?.userData[WOC_HEAD_WRAPPER] !== type || !drawnUnder(node, root)) return;
    pieceBox.setFromObject(node, true);
    if (pieceBox.isEmpty()) return;
    drawnBox.union(pieceBox);
    if (node.name === baseName) baseBox.union(pieceBox);
    else if (node.name.startsWith(eyePrefix)) eyeBox.union(pieceBox);
  });
  if (baseBox.isEmpty()) return null;
  const eyes = !eyeBox.isEmpty();
  return {
    baseMinY: baseBox.min.y,
    baseMaxY: baseBox.max.y,
    centerX: eyes ? (eyeBox.min.x + eyeBox.max.x) / 2 : (baseBox.min.x + baseBox.max.x) / 2,
    centerZ: (baseBox.min.z + baseBox.max.z) / 2,
    eyeY: eyes ? (eyeBox.min.y + eyeBox.max.y) / 2 : null,
    topY: drawnBox.max.y,
  };
}

/**
 * Draw a WOC portrait rig's head UNCOVERED, right before its capture draws: every
 * part of an item worn in the head slot (the kit's helm or hood) hidden, and the
 * hung head showing exactly the pieces `look` draws with no helm (its hairstyle),
 * the bald crown back to the look's own weight (a hair-hiding helm raises it).
 * A portrait is the character's FACE, and the class kit's helm hides the hair the
 * player picked. Visibility flags and one morph influence on a throwaway rig,
 * never the visual's dressing API: every dressing setter streams the live tier's
 * armor (WocArmorDressing.want), which a portrait's no-fetch kit must not do, and
 * the pieces it shows were prepared with the rest (compile and the texture sweep
 * ignore visibility). `look` null (no head dressing): only the helm comes off.
 */
export function uncoverWocPortraitHead(
  root: THREE.Object3D,
  manifest: WocCharacterManifest,
  look: WocHeadLook | null,
): void {
  const headSlot = new Set<string>();
  for (const item of Object.values(manifest.items)) {
    if (item.slot === 'head') for (const node of item.nodes) headSlot.add(node);
  }
  for (const [name, nodes] of resolveWocPartNodes(root, manifest)) {
    if (!headSlot.has(name)) continue;
    for (const node of nodes) node.visible = false;
  }
  if (!look) return;
  const type = wocHeadTypeForGender(manifest.fit);
  const drawn = new Set(wocHeadVisibleNodes(type, look, { helm: false }));
  const crown = wocHeadBaldCrownWeight(look, false);
  root.traverse((node) => {
    if (node.parent?.userData[WOC_HEAD_WRAPPER] !== type) return;
    node.visible = drawn.has(node.name);
    node.traverse((part) => {
      const mesh = part as THREE.Mesh;
      const at = mesh.morphTargetDictionary?.[WOC_HEAD_BALD_CROWN_MORPH];
      if (at !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[at] = crown;
    });
  });
}
