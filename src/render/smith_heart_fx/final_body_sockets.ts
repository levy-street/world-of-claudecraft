// The Masterless Strength's sockets: empty points hung on the bones of its
// model (final_body_core.ts FINAL_BODY_SOCKETS), so the effects (final_fx.ts,
// final_body_fx.ts) read where its heart crystal and its eyes are THIS frame,
// through every authored clip: on its knee, pushing up, folded tight in the
// transformation's charge, lunging into a strike. The anchors' fractions
// (FINAL_BODY_ANCHORS, FINAL_BODY_KNEEL_ANCHORS) stand in while no view is up.
//
// Attached once per character view by ../template_model_vfx.ts (the seam the
// renderer calls when it builds or re-takes a view from its pool); the latest
// live set is what the effects read (one such boss lives at a time; a view
// retired from the scene, or hidden, reads as none). The view owns its
// sockets for its whole life: they ride its bones, carry no geometry and no
// material, and nothing new is left for the GPU to prepare.

import * as THREE from 'three';
import { FINAL_BODY_SOCKETS, type FinalBodySocketId } from './final_body_core';

const SOCKETS_KEY = 'smithHeartFinalSockets';
/** Reads between two tries at a view whose model was still loading. */
const RETRY_EVERY = 30;

interface FinalBodySocketSet {
  readonly root: THREE.Object3D;
  readonly points: Readonly<Record<FinalBodySocketId, THREE.Object3D | null>>;
}

let latest: FinalBodySocketSet | null = null;
/** A view whose model had not loaded yet when it was attached: retried on read. */
let pending: THREE.Object3D | null = null;
let retryIn = 0;

/** Hang the sockets on the model under `root` (idempotent per root). A view
 *  whose model is still loading is remembered and hung on a later read. */
export function attachFinalBodySockets(root: THREE.Object3D): void {
  const existing = root.userData[SOCKETS_KEY] as FinalBodySocketSet | undefined;
  if (existing) {
    latest = existing;
    pending = null;
    return;
  }
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
  const points: Record<FinalBodySocketId, THREE.Object3D | null> = { heart: null, head: null };
  for (const s of FINAL_BODY_SOCKETS) {
    const name = THREE.PropertyBinding.sanitizeNodeName(s.bone);
    const bone = root.getObjectByName(name) ?? root.getObjectByName(s.bone);
    if (!bone) continue;
    const socket = new THREE.Object3D();
    socket.name = `smithHeartFinalSocket_${s.id}`;
    socket.position.set(s.local[0], s.local[1], s.local[2]);
    bone.add(socket);
    points[s.id] = socket;
  }
  const set: FinalBodySocketSet = { root, points };
  root.userData[SOCKETS_KEY] = set;
  latest = set;
}

/** Forget the sockets (the effects host's dispose; tests). */
export function clearFinalBodySockets(): void {
  latest = null;
  pending = null;
  retryIn = 0;
}

/** Where socket `id` is this frame (world, written into `out`), or null while
 *  no view of the boss is drawn (still loading, retired, hidden): the caller
 *  then reads the anchor's own place. */
export function finalSocketPoint(id: FinalBodySocketId, out: THREE.Vector3): THREE.Vector3 | null {
  if (!latest && pending) {
    if (!pending.parent) pending = null;
    else if (--retryIn <= 0) {
      retryIn = RETRY_EVERY;
      attachFinalBodySockets(pending);
    }
  }
  // A view retired from the scene is let go (never kept alive by this module).
  if (latest && !latest.root.parent) latest = null;
  if (!latest?.root.visible) return null;
  const p = latest.points[id];
  return p ? p.getWorldPosition(out) : null;
}
