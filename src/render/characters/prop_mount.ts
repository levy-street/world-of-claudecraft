// The one way to put a held prop on a rig. Thin three.js half of
// `prop_placement_core.ts`: it flattens the prop scene, reads whatever grip nodes the rig
// carries, asks the core where the prop goes, writes that, and parents it.
//
// Every surface that draws a character mounts through `mountProp`. That is the whole
// point: the flatten step DEFINES the frame the core's numbers are expressed in, so a
// caller that flattens differently (or not at all) silently gets a different placement.
// The /wiki guide viewer used to do exactly that, which is why a warrior's sword sat half
// a yard down the arm there and 180 degrees around from the game.
//
// Loading and cloning stay with the caller: the game reads its preloaded, tier-resolved
// cache synchronously, the guide awaits one `loadGltf` per figure. Both hand in a fresh
// clone and get back a mounted payload.
import * as THREE from 'three';
import {
  type PropPlacement,
  type PropTransform,
  resolvePropPlacement,
} from './prop_placement_core';

/** The authored attachment fields the placement reads. Structurally satisfied by
 *  `AttachDef` (manifest.ts) and by the guide's baked `GuideModelAttach`, so neither
 *  side needs to convert. */
export interface MountableAttach {
  url: string;
  bone: string;
  position?: [number, number, number];
  rotationY?: number;
  gripRef?: string;
}

/** KayKit standalone weapon GLBs wrap their mesh in a single child node carrying a
 *  translation and a scale. Collapse it: the child's SCALE is hoisted onto a fresh
 *  holder and its translation and rotation are dropped, so the payload's local frame is
 *  the raw glTF mesh frame. A grip transform is then expressed against that frame, and
 *  the core's tables are all authored in it.
 *
 *  Multi-child scenes are returned untouched (there is nothing unambiguous to hoist), so
 *  their frame is the scene root's. That asymmetry is inherited, not chosen; it is why
 *  the frame contract has to live in one module. */
export function flattenPropScene(src: THREE.Object3D): THREE.Object3D {
  if (src.children.length !== 1) return src;
  const holder = new THREE.Group();
  const child = src.children[0];
  holder.scale.copy(child.scale);
  child.scale.set(1, 1, 1);
  child.position.set(0, 0, 0);
  child.rotation.set(0, 0, 0);
  src.remove(child);
  holder.add(child);
  return holder;
}

// Reused across mounts; `setFromObject` fully rewrites it each call.
const measureBox = new THREE.Box3();

/** Native (post-flatten, pre-placement) height of a payload, for the variant clamp.
 *  MUST be read before a placement is applied, since applying overwrites the scale the
 *  flatten step hoisted. */
export function measurePropHeight(payload: THREE.Object3D): number {
  measureBox.setFromObject(payload);
  return measureBox.max.y - measureBox.min.y;
}

/** GLTFLoader sanitizes node names, so try the authored name and the stripped one, the
 *  same two spellings bone resolution tries. */
function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[[\].:/]/g, '')) ?? null;
}

function nodeTransform(root: THREE.Object3D, name: string): PropTransform | null {
  const node = findNode(root, name);
  if (!node) return null;
  return {
    position: [node.position.x, node.position.y, node.position.z],
    quaternion: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
    scale: [node.scale.x, node.scale.y, node.scale.z],
  };
}

/** Write a resolved placement onto a payload. An absent field is deliberately left
 *  alone: that is how an authored `rotationY` on its own keeps the model's native scale. */
export function applyPropPlacement(payload: THREE.Object3D, placement: PropPlacement): void {
  if (placement.position) payload.position.set(...placement.position);
  if (placement.quaternion) payload.quaternion.set(...placement.quaternion);
  if (placement.rotationY !== undefined) payload.rotation.y = placement.rotationY;
  if (typeof placement.scale === 'number') payload.scale.setScalar(placement.scale);
  else if (placement.scale) payload.scale.set(...placement.scale);
}

export interface MountPropOptions {
  /** The character rig root, for accessory and `gripRef` node lookups. */
  root: THREE.Object3D;
  /** The bone to parent onto. The caller picks it (chest while sheathed, else the
   *  authored bone); `att.bone` stays the AUTHORED one so the placement still knows
   *  which hand the prop belongs in. */
  bone: THREE.Object3D;
  /** A fresh clone of the prop GLB scene. Never the cached scene itself. */
  scene: THREE.Object3D;
  att: MountableAttach;
  stowed?: boolean;
}

/** Flatten, resolve, apply, parent. The only sanctioned way to mount a held prop.
 *  Returns the payload root, already added to the bone.
 *
 *  ORDER IS LOAD-BEARING: the height measurement runs while the payload is still
 *  UNPARENTED, so `Box3.setFromObject` reports the model's own height. Parent first and
 *  it reports the height of the model as posed in world space, which silently corrupts
 *  every variant-pack size clamp. Do not move the `bone.add` above the resolve. */
export function mountProp(opts: MountPropOptions): THREE.Object3D {
  const { root, bone, att } = opts;
  const payload = flattenPropScene(opts.scene);
  const placement = resolvePropPlacement({
    url: att.url,
    bone: att.bone,
    position: att.position,
    rotationY: att.rotationY,
    gripRef: att.gripRef,
    // Both lazy: the core calls them only if its precedence chain gets that far, so a
    // variant-pack weapon (the common case) pays for neither a name traversal nor a
    // bounding-box walk it would not read.
    lookupNode: (name) => nodeTransform(root, name),
    measureNativeHeight: () => measurePropHeight(payload),
    stowed: opts.stowed,
  });
  applyPropPlacement(payload, placement);
  bone.add(payload);
  return payload;
}
