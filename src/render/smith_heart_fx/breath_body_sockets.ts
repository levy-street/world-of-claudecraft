// The Guardian of the Breath's wind sockets: empty points hung on the bones of
// its model (breath_body_core.ts BREATH_SOCKETS), so the effects layer
// (breath_body.ts, and the fight's inhale and roar drawn at its mouth) reads
// where a hand, a pauldron or the war-horn mouth is THIS frame, through every
// authored clip, at whatever scale the view draws it.
//
// Attached once per character view by ../template_model_vfx.ts (the seam the
// renderer calls when it builds or re-takes a view from its pool); the latest
// live set is what the effects read (one guardian lives at a time; a view
// retired from the scene, or hidden, reads as none). The view owns its
// sockets for its whole life: they ride its bones, carry no geometry and no
// material, and nothing new is left for the GPU to prepare.

import * as THREE from 'three';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import {
  BREATH_SOCKETS,
  BREATH_YD_PER_UNIT,
  type BreathSocketId,
  breathSocketIndex,
} from './breath_body_core';

const SOCKETS_KEY = 'smithHeartBreathSockets';

/** One view's sockets, in BREATH_SOCKETS order (null where a bone is missing). */
export interface BreathBodySocketSet {
  readonly root: THREE.Object3D;
  readonly points: readonly (THREE.Object3D | null)[];
}

let latest: BreathBodySocketSet | null = null;
/** A view whose model had not loaded yet when it was attached: retried on read. */
let pending: THREE.Object3D | null = null;

/** Hang the sockets on the model under `root` (idempotent per root). A view
 *  whose model is still loading is remembered and hung on the next read. */
export function attachBreathBodySockets(root: THREE.Object3D): void {
  const existing = root.userData[SOCKETS_KEY] as BreathBodySocketSet | undefined;
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
  const points: (THREE.Object3D | null)[] = [];
  for (const s of BREATH_SOCKETS) {
    const name = THREE.PropertyBinding.sanitizeNodeName(s.bone);
    const bone = root.getObjectByName(name) ?? root.getObjectByName(s.bone);
    if (!bone) {
      points.push(null);
      continue;
    }
    const socket = new THREE.Object3D();
    socket.name = `smithHeartBreathSocket_${s.id}`;
    socket.position.set(s.local[0], s.local[1], s.local[2]);
    bone.add(socket);
    points.push(socket);
  }
  const set: BreathBodySocketSet = { root, points };
  root.userData[SOCKETS_KEY] = set;
  latest = set;
}

/** The live sockets (the latest view's, while it is still in the scene). */
export function breathBodySockets(): BreathBodySocketSet | null {
  if (latest && (!latest.root.parent || !latest.root.visible)) return null;
  return latest;
}

/** Hang the sockets on a view whose model was still loading when it was
 *  attached (called on the effects' scan tick, never every frame). */
export function retryBreathBodySockets(): void {
  if (!latest && pending?.parent) attachBreathBodySockets(pending);
}

/** Forget the sockets (the effects host's dispose; tests). */
export function clearBreathBodySockets(): void {
  latest = null;
  pending = null;
}

/** Where socket `id` of guardian `g` is (world, written into `out`): its live
 *  bone when the model's view is up, else its rest place round the guardian's
 *  drawn position and facing (a view still loading). */
export function breathSocketPoint(
  g: Entity,
  id: BreathSocketId,
  out: THREE.Vector3,
): THREE.Vector3 {
  const i = breathSocketIndex(id);
  const p = breathBodySockets()?.points[i];
  if (p) return p.getWorldPosition(out);
  const a = fxAnchor(g);
  const at = BREATH_SOCKETS[i].at;
  const x = at[0] * BREATH_YD_PER_UNIT;
  const z = at[2] * BREATH_YD_PER_UNIT;
  const sin = Math.sin(g.facing);
  const cos = Math.cos(g.facing);
  return out.set(
    a.x + x * cos + z * sin,
    a.y + at[1] * BREATH_YD_PER_UNIT,
    a.z - x * sin + z * cos,
  );
}
