// Hands on a handle: a two-bone reach that puts a mounted rider's hands ON the grip of a
// mount ridden astride a shaft (the Emberbristle Broom), whatever the body's proportions.
//
// The seated loop's arms are authored for a saddle or a chair and land anywhere relative
// to a broom handle, and an additive nudge lands wherever the base pose happens to put
// them (tall and short bodies differ by a forearm). So this solves it: each arm's shoulder,
// elbow and wrist are read from the posed rig, the grip point is placed in the rider's own
// frame (forward and up from the root, so it rides the hover bob with him), and the classic
// two-bone triangle (law of cosines, elbow bent toward a down-and-out pole) gives the elbow.
// Each bone is then turned so its limb points along the solved segment: a world-space
// "aim" that needs no knowledge of the rig's local bone axes, only that a joint's child
// joint lies down its limb. Blended by `k` (the ride pose's own fade).
//
// Per frame, per rider ON such a mount only; no allocation (module scratch), and only
// the arm chains' world matrices are recomputed.
import * as THREE from 'three';

export interface RideGrip {
  /** Grip centre ahead of the rider's root, in the root's local units (yards at scale 1). */
  forward: number;
  /** Grip height above the rider's root. */
  up: number;
  /** How far apart the two hands sit along the handle (the leading hand ahead). */
  stagger: number;
}

const tmpS = new THREE.Vector3();
const tmpE = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpPole = new THREE.Vector3();
const tmpElbow = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const qDelta = new THREE.Quaternion();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qLocal = new THREE.Quaternion();

/** Turn `bone` (blend k) so the limb from it to `childPos` points at `target` (world). */
function aim(
  bone: THREE.Object3D,
  childPos: THREE.Vector3,
  target: THREE.Vector3,
  k: number,
): void {
  bone.getWorldPosition(tmpA);
  tmpB.subVectors(childPos, tmpA);
  const from = tmpB.lengthSq() > 1e-10 ? tmpB.normalize() : null;
  tmpA.subVectors(target, tmpA);
  if (!from || tmpA.lengthSq() < 1e-10) return;
  qDelta.setFromUnitVectors(from, tmpA.normalize());
  bone.getWorldQuaternion(qWorld);
  qWorld.premultiply(qDelta);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(qParent);
    qLocal.copy(qParent).invert().multiply(qWorld);
  } else {
    qLocal.copy(qWorld);
  }
  bone.quaternion.slerp(qLocal, k);
  bone.updateMatrixWorld(true);
}

/** Solve one arm (upper arm, forearm, hand bones) onto `target` (world). `outSign` is +1
 *  for the left arm, -1 for the right (the elbow's pole points out to that side). */
export function reachArm(
  upper: THREE.Object3D,
  fore: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  rootQuat: THREE.Quaternion,
  outSign: number,
  k: number,
): void {
  upper.getWorldPosition(tmpS);
  fore.getWorldPosition(tmpE);
  hand.getWorldPosition(tmpW);
  const l1 = tmpS.distanceTo(tmpE);
  const l2 = tmpE.distanceTo(tmpW);
  if (l1 < 1e-4 || l2 < 1e-4) return;
  tmpDir.subVectors(target, tmpS);
  const reach = Math.min(tmpDir.length(), (l1 + l2) * 0.999);
  if (reach < 1e-4) return;
  tmpDir.normalize();
  // the elbow drops down and a little out, the way hands on a stick hold it
  tmpPole.set(outSign * 0.6, -1, -0.2).applyQuaternion(rootQuat);
  tmpPole.addScaledVector(tmpDir, -tmpPole.dot(tmpDir));
  if (tmpPole.lengthSq() < 1e-8) return;
  tmpPole.normalize();
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  tmpElbow.copy(tmpS).addScaledVector(tmpDir, a).addScaledVector(tmpPole, h);
  tmpT.copy(tmpS).addScaledVector(tmpDir, reach);
  aim(upper, tmpE, tmpElbow, k);
  fore.getWorldPosition(tmpE);
  hand.getWorldPosition(tmpW);
  aim(fore, tmpW, tmpT, k);
}

const gripLocal = new THREE.Vector3();
const gripWorld = new THREE.Vector3();
const rootQ = new THREE.Quaternion();

/** Both hands onto the grip: the leading (right) hand ahead, the left behind it. */
export function applyRideGrip(
  root: THREE.Object3D,
  arms: readonly [
    THREE.Object3D | null,
    THREE.Object3D | null,
    THREE.Object3D | null,
    THREE.Object3D | null,
    THREE.Object3D | null,
    THREE.Object3D | null,
  ],
  grip: RideGrip,
  k: number,
): void {
  // a rig frozen off-screen (rig_visibility_freeze.ts) stays frozen: no solve
  if (!root.matrixWorldAutoUpdate) return;
  root.updateWorldMatrix(true, false);
  root.getWorldQuaternion(rootQ);
  const [ul, fl, hl, ur, fr, hr] = arms;
  // only the two arm chains are brought current (their ancestors and the arm below),
  // never the whole rider subtree the scene pass updates anyway
  ul?.updateWorldMatrix(true, true);
  ur?.updateWorldMatrix(true, true);
  if (ul && fl && hl) {
    gripLocal.set(0.04, grip.up, grip.forward - grip.stagger * 0.5);
    root.localToWorld(gripWorld.copy(gripLocal));
    reachArm(ul, fl, hl, gripWorld, rootQ, 1, k);
  }
  if (ur && fr && hr) {
    gripLocal.set(-0.04, grip.up, grip.forward + grip.stagger * 0.5);
    root.localToWorld(gripWorld.copy(gripLocal));
    reachArm(ur, fr, hr, gripWorld, rootQ, -1, k);
  }
}
