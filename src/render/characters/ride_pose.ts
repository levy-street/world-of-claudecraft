// The straddle a rider sits in astride a mount (CharacterVisual.applyRidePose): where each leg
// bone and each arm bone should point, solved as DIRECTIONS rather than as absolute bone
// rotations, so the same numbers sit a rider correctly on every rig the game ships.
//
// Why directions. The first version wrote absolute local quaternions built off the KayKit leg
// rest (a half turn about X). The WOC bodies every player wears now rest their thighs on a half
// turn about Z instead and their feet at +63 degrees: an absolute target twisted each WOC leg a
// half turn about its own axis, so the knee hinged the wrong way and the feet pointed BACKWARDS.
// Here each bone is turned by the smallest rotation that carries its current direction (the
// seated clip's, the rig's own twist included) onto the target direction, so a rig's rest frame
// never enters the sum.
//
// Frames: every direction is in the PELVIS frame (the `hips` bone, +X to the rider's left, +Y
// up, +Z forward), each bone points down its own local +Y, and a bone's parent frame is found
// by composing the local rotations between the pelvis and that bone. No scene, no matrices, no
// allocation per frame: the caller passes its own scratch. Pinned by tests/ride_pose.test.ts.

import * as THREE from 'three';
import type { MountRideSpec } from '../mount_visuals';

const DOWN = /* @__PURE__ */ new THREE.Vector3(0, -1, 0);
const BONE_AXIS = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const AXIS_X = /* @__PURE__ */ new THREE.Vector3(1, 0, 0);
const AXIS_Z = /* @__PURE__ */ new THREE.Vector3(0, 0, 1);
const qa = /* @__PURE__ */ new THREE.Quaternion();
const qb = /* @__PURE__ */ new THREE.Quaternion();
const qInv = /* @__PURE__ */ new THREE.Quaternion();
const cur = /* @__PURE__ */ new THREE.Vector3();
const want = /* @__PURE__ */ new THREE.Vector3();

/** Pelvis-frame direction of a limb pitched forward by `pitch` (0 hangs straight down) and
 *  opened outward by `spread` on `side` (+1 the left leg at +X, -1 the right). */
export function limbDirection(
  pitch: number,
  spread: number,
  side: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  qa.setFromAxisAngle(AXIS_Z, side * spread);
  qb.setFromAxisAngle(AXIS_X, -pitch);
  return out.copy(DOWN).applyQuaternion(qa.multiply(qb));
}

/** The pelvis-frame directions the spec asks of one leg: the thigh, the shin (whose pitch is
 *  `thigh - knee`, and whose own opening defaults to the thigh's), and the foot, pointed
 *  forward and `ankle` below level (negative tips the toes down), barely splayed. */
export function rideLegDirections(
  spec: MountRideSpec,
  side: number,
  thigh: THREE.Vector3,
  shin: THREE.Vector3,
  foot: THREE.Vector3,
): void {
  limbDirection(spec.thigh, spec.spread, side, thigh);
  limbDirection(spec.thigh - spec.knee, spec.shinSpread ?? spec.spread, side, shin);
  limbDirection(
    Math.PI / 2 + (spec.ankle ?? 0),
    (spec.shinSpread ?? spec.spread) * 0.3,
    side,
    foot,
  );
}

/**
 * Turn `bone` (a local quaternion, written in place) so its +Y points along `dirPelvis`, given
 * `parentInPelvis`: the rotation from the bone's parent frame to the pelvis frame. The turn is
 * the shortest one from where the bone points now, so the bone keeps its own twist.
 */
export function aimBone(
  bone: THREE.Quaternion,
  parentInPelvis: THREE.Quaternion,
  dirPelvis: THREE.Vector3,
): THREE.Quaternion {
  qInv.copy(parentInPelvis).invert();
  want.copy(dirPelvis).applyQuaternion(qInv).normalize();
  cur.copy(BONE_AXIS).applyQuaternion(bone).normalize();
  qa.setFromUnitVectors(cur, want);
  return bone.premultiply(qa);
}

/** How the hands take the reins: pelvis-frame directions for the upper arm (down, forward and
 *  a little out, the elbows easy at the rider's sides) and the forearm (forward, in and a touch
 *  down, so the two fists meet low over the pommel). */
export const REIN_UPPER_ARM = { pitch: 0.55, spread: 0.22 } as const;
export const REIN_FOREARM = { pitch: 1.3, spread: -0.32 } as const;

export function reinArmDirections(side: number, upper: THREE.Vector3, fore: THREE.Vector3): void {
  limbDirection(REIN_UPPER_ARM.pitch, REIN_UPPER_ARM.spread, side, upper);
  limbDirection(REIN_FOREARM.pitch, REIN_FOREARM.spread, side, fore);
}
