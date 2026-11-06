// The Guardian of the Heat's fire sockets: empty points hung on the bones of
// its model (heat_body_core.ts HEAT_SOCKETS), so the effects layer
// (heat_body.ts) reads where a fist, a shoulder or a horn is THIS frame,
// through every authored clip, at whatever scale the view draws it.
//
// Attached once per character view by ../template_model_vfx.ts (the seam the
// renderer calls when it builds or re-takes a view from its pool); the latest
// live set is what the effects read (one guardian lives at a time; a view
// retired from the scene, or hidden, reads as none). The view owns its
// sockets for its whole life: they ride its bones, carry no geometry and no
// material, and nothing new is left for the GPU to prepare.

import * as THREE from 'three';
import { HEAT_SOCKETS } from './heat_body_core';

const SOCKETS_KEY = 'smithHeartHeatSockets';

/** One view's sockets, in HEAT_SOCKETS order (null where a bone is missing). */
export interface HeatBodySocketSet {
  readonly root: THREE.Object3D;
  readonly points: readonly (THREE.Object3D | null)[];
}

let latest: HeatBodySocketSet | null = null;
/** A view whose model had not loaded yet when it was attached: retried on read. */
let pending: THREE.Object3D | null = null;

/** Hang the sockets on the model under `root` (idempotent per root). A view
 *  whose model is still loading is remembered and hung on the next read. */
export function attachHeatBodySockets(root: THREE.Object3D): void {
  const existing = root.userData[SOCKETS_KEY] as HeatBodySocketSet | undefined;
  if (existing) {
    latest = existing;
    pending = null;
    return;
  }
  // Each socket rides its bone at the offset read off the GLB's rest pose
  // (never the skin's inverse binds: the shipped file's mesh quantization
  // folds its dequantization into those).
  let skinned = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  if (!skinned) {
    pending = root;
    latest = null;
    return;
  }
  pending = null;
  const points: (THREE.Object3D | null)[] = [];
  for (const s of HEAT_SOCKETS) {
    const name = THREE.PropertyBinding.sanitizeNodeName(s.bone);
    const bone = root.getObjectByName(name) ?? root.getObjectByName(s.bone);
    if (!bone) {
      points.push(null);
      continue;
    }
    const socket = new THREE.Object3D();
    socket.name = `smithHeartHeatSocket_${s.id}`;
    socket.position.set(s.local[0], s.local[1], s.local[2]);
    bone.add(socket);
    points.push(socket);
  }
  const set: HeatBodySocketSet = { root, points };
  root.userData[SOCKETS_KEY] = set;
  latest = set;
}

/** The live sockets (the latest view's, while it is still in the scene). */
export function heatBodySockets(): HeatBodySocketSet | null {
  if (latest && (!latest.root.parent || !latest.root.visible)) return null;
  return latest;
}

/** Hang the sockets on a view whose model was still loading when it was
 *  attached (called on the effects' scan tick, never every frame). */
export function retryHeatBodySockets(): void {
  if (!latest && pending?.parent) attachHeatBodySockets(pending);
}

/** Forget the sockets (the effects host's dispose; tests). */
export function clearHeatBodySockets(): void {
  latest = null;
  pending = null;
}
