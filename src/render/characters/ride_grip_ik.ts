// Hands on a handle: an arm solve that closes a mounted rider's fists ROUND the grip of a
// mount ridden astride a shaft (the Emberbristle Broom), whatever the body's proportions.
//
// The seated loop's arms are authored for a saddle or a chair and land anywhere relative
// to a broom handle, so this solves them, per body, every animated frame:
//   1. Where each hand closes: its authored place on the handle, pulled back along the
//      handle when this body's arm cannot reach that far (gripAlongHandle), eased over a
//      few frames when the shoulders move (RideGripState), so a lean never snaps it.
//   2. How each fist sits: the rig's own `handslot` (where a weapon's grip sits in the fist,
//      the same frame every held sword uses) is turned so its grip axis runs along the
//      handle, the wrist on the shoulder's side of the stick: knuckles up and out, the palm
//      round the shaft. That fixes the wrist's target too (the fist is rigid).
//   3. The arm: the classic two-bone triangle (law of cosines, the elbow dropped toward a
//      down-and-out pole) reaches the wrist there, and each bone is given an ABSOLUTE
//      orientation: its limb down the solved segment and its elbow hinge (read once from
//      the rig's bind pose, resolveRideArms) square to the arm's plane.
//
// Round 11 (owner playtest): the round-10 solve turned each bone by the smallest rotation
// that pointed it at its target, so the arm's twist was whatever the clip left it, and the
// hand's roll was never set at all. The hands crept as the seated loop breathed and the left
// fist, twisted the other way from the right, showed its palm. Every answer here is a
// function of the shoulders, the handle and the rig alone, so it cannot drift with the clip
// and the two hands mirror each other.
//
// Per frame, per rider ON such a mount only; no allocation (module scratch). The arm chains
// are brought current once (their ancestors and the arms below), then read straight off
// their cached world matrices; each write re-derives only the written bone's subtree. Blended by `k` (the ride pose's own fade).
import * as THREE from 'three';

export interface RideGrip {
  /** Grip centre ahead of the rider's root, in the root's local units (yards at scale 1). */
  forward: number;
  /** Grip height above the rider's root. */
  up: number;
  /** How far apart the two hands sit along the handle (the leading hand ahead). */
  stagger: number;
}

/** One arm of the rider, calibrated once (resolveRideArms). */
export interface RideArm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  /** The forearm's child joint: the wrist (the whole fist turns about it). */
  wrist: THREE.Object3D;
  /** The weapon grip under the fist (`handslot`), or null on a rig without one. */
  slot: THREE.Object3D | null;
  /** Whether the upper arm hangs off a clavicle the shoulder roll may turn (WOC bodies). */
  clavicle: boolean;
  /** Each bone's limb direction in its own frame (towards its child joint). */
  limbUpper: THREE.Vector3;
  limbFore: THREE.Vector3;
  /** The elbow's hinge axis, in the upper arm's (and the forearm's) own frame: the axis
   *  the bind pose bends the elbow about, signed so a positive turn folds the forearm. */
  hinge: THREE.Vector3;
}

export interface RideArms {
  left: RideArm;
  right: RideArm;
}

/** Where along the handle each hand closes, eased between frames (left, right). */
export interface RideGripState {
  t: [number, number];
  primed: boolean;
}

export function newRideGripState(): RideGripState {
  return { t: [0, 0], primed: false };
}

/** How fast the grip's place along the handle follows the shoulders (1/s). */
const GRIP_FOLLOW_RATE = 7;

/** How much of a straight arm a grip may take (a hand on a stick never locks the elbow). */
export const GRIP_REACH = 0.94;

const m4a = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const qTmp = new THREE.Quaternion();
const sTmp = new THREE.Vector3();
const pTmp = new THREE.Vector3();

/** The fore bone's rest rotation relative to the upper arm, from the skeleton's bind
 *  matrices (the clips overwrite the live one). Null when no skinned mesh binds both. */
function bindRelative(model: THREE.Object3D, upper: THREE.Object3D, fore: THREE.Object3D) {
  let out: THREE.Quaternion | null = null;
  model.traverse((o) => {
    if (out || !(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const sk = (o as THREE.SkinnedMesh).skeleton;
    const iu = sk.bones.indexOf(upper as THREE.Bone);
    const iF = sk.bones.indexOf(fore as THREE.Bone);
    if (iu < 0 || iF < 0) return;
    m4a.copy(sk.boneInverses[iu]); // = inverse(bindWorld(upper))
    m4b.copy(sk.boneInverses[iF]).invert(); // = bindWorld(fore)
    m4a.multiply(m4b).decompose(pTmp, qTmp, sTmp);
    out = qTmp.clone();
  });
  return out;
}

function calibrateArm(
  model: THREE.Object3D,
  upper: THREE.Object3D,
  fore: THREE.Object3D,
): RideArm | null {
  const wrist = fore.children.find((c) => (c as THREE.Bone).isBone) ?? null;
  if (!wrist) return null;
  let slot: THREE.Object3D | null = null;
  wrist.traverse((o) => {
    if (!slot && o !== wrist && /handslot/i.test(o.name)) slot = o;
  });
  const limbUpper = fore.position.clone();
  const limbFore = wrist.position.clone();
  if (limbUpper.lengthSq() < 1e-12 || limbFore.lengthSq() < 1e-12) return null;
  limbUpper.normalize();
  limbFore.normalize();
  // The elbow's hinge: the axis of the forearm's rest bend (bind pose, else the live pose),
  // with a positive angle. A rig whose rest elbow is dead straight has no axis to read: it
  // falls back to local X, the hinge of every Blender-authored arm this game ships.
  const rest = bindRelative(model, upper, fore) ?? fore.quaternion.clone();
  if (rest.w < 0) rest.set(-rest.x, -rest.y, -rest.z, -rest.w);
  const hinge = new THREE.Vector3(rest.x, rest.y, rest.z);
  if (hinge.lengthSq() < 1e-8) hinge.set(1, 0, 0);
  hinge.normalize();
  const clavicle = !!upper.parent && /clavicle/i.test(upper.parent.name);
  return { upper, fore, wrist, slot, clavicle, limbUpper, limbFore, hinge };
}

/** Both arms (upper arm and forearm bone names, left then right), calibrated once per
 *  body. Null when either arm is missing. */
export function resolveRideArms(
  model: THREE.Object3D,
  upperNames: readonly [string, string],
  foreNames: readonly [string, string],
): RideArms | null {
  const arms: RideArm[] = [];
  for (let i = 0; i < 2; i++) {
    const upper = model.getObjectByName(upperNames[i]);
    const fore = model.getObjectByName(foreNames[i]);
    if (!upper || !fore) return null;
    const arm = calibrateArm(model, upper, fore);
    if (!arm) return null;
    arms.push(arm);
  }
  return { left: arms[0], right: arms[1] };
}

const toShoulder = new THREE.Vector3();

/** The handle parameter `t` of where a hand can close (the handle is `origin + t * dir`, dir
 *  a unit vector forward along the broom; `want` the hand's authored place). `want` when the
 *  arm reaches it; else the farthest point along the handle it CAN reach (so the hand stays
 *  ON the handle, only nearer the rider); and when the handle passes wholly out of reach,
 *  the handle point nearest the shoulder. */
export function gripParamAlongHandle(
  shoulder: THREE.Vector3,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  want: number,
  reach: number,
): number {
  toShoulder.subVectors(shoulder, origin);
  const t0 = toShoulder.dot(dir);
  const perp2 = Math.max(0, toShoulder.lengthSq() - t0 * t0);
  if (perp2 >= reach * reach) return t0;
  const span = Math.sqrt(reach * reach - perp2);
  return Math.min(Math.max(want, t0 - span), t0 + span);
}

/** gripParamAlongHandle as a point, written into `out`. */
export function gripAlongHandle(
  shoulder: THREE.Vector3,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  want: number,
  reach: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const t = gripParamAlongHandle(shoulder, origin, dir, want, reach);
  return out.copy(origin).addScaledVector(dir, t);
}

const tmpS = new THREE.Vector3();
const tmpE = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpPole = new THREE.Vector3();
const tmpElbow = new THREE.Vector3();
const tmpWristAt = new THREE.Vector3();
const tmpHinge = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const fA = new THREE.Vector3();
const fB = new THREE.Vector3();
const fC = new THREE.Vector3();
const fD = new THREE.Vector3();
const qInv = new THREE.Quaternion();
const basisL = new THREE.Matrix4();
const basisW = new THREE.Matrix4();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qLocal = new THREE.Quaternion();
const qWrist = new THREE.Quaternion();
const qSlot = new THREE.Quaternion();
const qRel = new THREE.Quaternion();
const qWant = new THREE.Quaternion();
const slotOffset = new THREE.Vector3();
const gripAt = new THREE.Vector3();
const handleOrigin = new THREE.Vector3();
const handleDir = new THREE.Vector3();
const rootQ = new THREE.Quaternion();
const rootS = new THREE.Vector3();
const UP_Y = new THREE.Vector3(0, 1, 0);

const decP = new THREE.Vector3();
const decS = new THREE.Vector3();
/** World position / orientation off the bone's CURRENT matrixWorld, with no climb to the
 *  scene root: applyRideGrip brings both arm chains current once, and every write below
 *  re-derives the written bone's subtree, so the cached matrices are always fresh. */
function posOf(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(o.matrixWorld);
}
function quatOf(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  o.matrixWorld.decompose(decP, out, decS);
  return out;
}

/** The rotation taking local axis `la` to world `wa` and local `lb` (made square to `la`)
 *  as near as it can go to world `wb` (made square to `wa`). Written into `out`. */
function frameRotation(
  la: THREE.Vector3,
  lb: THREE.Vector3,
  wa: THREE.Vector3,
  wb: THREE.Vector3,
  out: THREE.Quaternion,
): boolean {
  fA.copy(lb).addScaledVector(la, -lb.dot(la));
  fB.copy(wb).addScaledVector(wa, -wb.dot(wa));
  if (fA.lengthSq() < 1e-10 || fB.lengthSq() < 1e-10) return false;
  fA.normalize();
  fB.normalize();
  basisL.makeBasis(la, fA, fC.crossVectors(la, fA));
  basisW.makeBasis(wa, fB, fD.crossVectors(wa, fB));
  basisW.multiply(basisL.transpose());
  out.setFromRotationMatrix(basisW);
  return true;
}

/** Give `bone` the world orientation `world` (blend k), recomputing its subtree. */
function setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion, k: number): void {
  if (bone.parent) {
    quatOf(bone.parent, qParent);
    qLocal.copy(qParent).invert().multiply(world);
  } else {
    qLocal.copy(world);
  }
  bone.quaternion.slerp(qLocal, k);
  bone.updateMatrixWorld(true);
}

/** Below this share of a straight arm the shoulder stays where the clip put it. */
const SHOULDER_ASSIST_FROM = 0.95;
/** The most the shoulder rolls in toward the fist (radians, about 26 degrees). */
const SHOULDER_ASSIST_MAX = 0.45;
const shC = new THREE.Vector3();
const shS = new THREE.Vector3();
const shAxis = new THREE.Vector3();
const shQ = new THREE.Quaternion();

/**
 * Roll the shoulder (the upper arm's parent, when it is a clavicle) toward `target` until the
 * shoulder is `want` from it, capped at SHOULDER_ASSIST_MAX. True when it moved the shoulder.
 * Rigs without a clavicle (the KayKit bodies hang the arm off the chest) are left alone.
 */
function shrugToward(arm: RideArm, target: THREE.Vector3, want: number, k: number): boolean {
  const clav = arm.upper.parent;
  if (!clav || !arm.clavicle) return false;
  posOf(clav, shC);
  posOf(arm.upper, shS);
  const now = shS.distanceTo(target);
  if (now <= want) return false;
  const rc = shC.distanceTo(shS);
  const dct = shC.distanceTo(target);
  if (rc < 1e-5 || dct < 1e-5) return false;
  tmpA.subVectors(shS, shC).normalize();
  tmpB.subVectors(target, shC).normalize();
  const theta = Math.acos(Math.min(1, Math.max(-1, tmpA.dot(tmpB))));
  // the angle off the clavicle-to-target line that leaves the shoulder `want` from the target
  const c = (rc * rc + dct * dct - want * want) / (2 * rc * dct);
  const thetaWant = c >= 1 ? 0 : Math.acos(Math.max(-1, c));
  const turn = Math.min(SHOULDER_ASSIST_MAX, theta - thetaWant);
  if (turn <= 1e-4) return false;
  shAxis.crossVectors(tmpA, tmpB);
  if (shAxis.lengthSq() < 1e-10) return false;
  shAxis.normalize();
  quatOf(clav, qWorld);
  qWorld.premultiply(shQ.setFromAxisAngle(shAxis, turn * k));
  setWorldQuat(clav, qWorld, 1);
  return true;
}

/** Solve one arm onto the grip point `grip` (world) on a handle running along `dir`.
 *  `outSign` is +1 for the left arm, -1 for the right (the elbow's pole points out to that
 *  side). */
function solveArm(
  arm: RideArm,
  grip: THREE.Vector3,
  dir: THREE.Vector3,
  outSign: number,
  k: number,
): void {
  const { upper, fore, wrist, slot } = arm;
  posOf(upper, tmpS);
  posOf(fore, tmpE);
  posOf(wrist, tmpW);
  const l1 = tmpS.distanceTo(tmpE);
  const l2 = tmpE.distanceTo(tmpW);
  if (l1 < 1e-4 || l2 < 1e-4) return;
  // The fist: its grip (handslot) on the handle, the grip axis along it, the wrist on the
  // shoulder's side of the stick. The fist is rigid, so the wrist's place follows.
  let wristWant: THREE.Quaternion | null = null;
  tmpWristAt.copy(grip);
  if (slot) {
    quatOf(wrist, qWrist);
    quatOf(slot, qSlot);
    posOf(slot, tmpA);
    // the slot in the wrist's frame (rotation and offset): rigid through any wrist turn
    qRel.copy(qWrist).invert().multiply(qSlot);
    slotOffset.subVectors(tmpA, tmpW).applyQuaternion(qInv.copy(qWrist).invert());
    // the wrist in the slot's frame, across the grip axis: which side the forearm comes from
    tmpB.subVectors(tmpW, tmpA).applyQuaternion(qInv.copy(qSlot).invert());
    // the shoulder's side of the handle
    tmpC.subVectors(tmpS, grip);
    if (frameRotation(UP_Y, tmpB, dir, tmpC, qWant)) {
      // wrist world = want * rel^-1; the wrist sits so the slot lands on the grip
      wristWant = qWrist.copy(qWant).multiply(qRel.invert());
      tmpWristAt.copy(slotOffset).applyQuaternion(wristWant).negate().add(grip);
    }
  }
  // A body whose arm falls short rolls its shoulder in toward the fist, the way a rider
  // reaches down a shaft: without it a short arm stretched straight and its fist hung in
  // the air above the handle, rising and falling with every breath of the seated loop.
  if (shrugToward(arm, tmpWristAt, (l1 + l2) * SHOULDER_ASSIST_FROM, k)) {
    posOf(upper, tmpS);
    posOf(fore, tmpE);
  }
  tmpDir.subVectors(tmpWristAt, tmpS);
  const reach = Math.min(tmpDir.length(), (l1 + l2) * 0.999);
  if (reach < 1e-4) return;
  tmpDir.normalize();
  // the elbow drops down and a little out, the way hands on a stick hold it
  tmpPole.set(outSign * 0.6, -1, -0.2).applyQuaternion(rootQ);
  tmpPole.addScaledVector(tmpDir, -tmpPole.dot(tmpDir));
  if (tmpPole.lengthSq() < 1e-8) return;
  tmpPole.normalize();
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  tmpElbow.copy(tmpS).addScaledVector(tmpDir, a).addScaledVector(tmpPole, h);
  // the elbow folds about the normal of the arm's plane (shoulder, elbow, wrist): with the
  // elbow off the line toward the pole, upper x fore is along pole x dir, never degenerate
  tmpHinge.crossVectors(tmpPole, tmpDir).normalize();
  // upper arm: limb to the elbow, hinge square to the plane
  tmpA.subVectors(tmpElbow, tmpS).normalize();
  if (frameRotation(arm.limbUpper, arm.hinge, tmpA, tmpHinge, qWorld)) {
    setWorldQuat(upper, qWorld, k);
  }
  // forearm: limb from the elbow to the wrist's place, the same hinge
  posOf(fore, tmpE);
  tmpB.copy(tmpS).addScaledVector(tmpDir, reach).sub(tmpE).normalize();
  if (frameRotation(arm.limbFore, arm.hinge, tmpB, tmpHinge, qWorld)) {
    setWorldQuat(fore, qWorld, k);
  }
  if (wristWant) setWorldQuat(wrist, wristWant, k);
}

/** Both hands onto the grip: the leading (right) hand ahead, the left behind it. With a
 *  `state`, each hand's place along the handle eases toward its target at `dt`. */
export function applyRideGrip(
  root: THREE.Object3D,
  arms: RideArms,
  grip: RideGrip,
  k: number,
  state?: RideGripState,
  dt = 0,
): void {
  // a rig frozen off-screen (rig_visibility_freeze.ts) stays frozen: no solve
  if (!root.matrixWorldAutoUpdate) return;
  if (k <= 0) return;
  root.updateWorldMatrix(true, false);
  root.getWorldQuaternion(rootQ);
  const scale = root.getWorldScale(rootS).x || 1;
  // only the two arm chains are brought current (their ancestors and the arm below),
  // never the whole rider subtree the scene pass updates anyway
  arms.left.upper.updateWorldMatrix(true, true);
  arms.right.upper.updateWorldMatrix(true, true);
  // the handle runs forward along the rider's own +Z through the grip height
  handleDir.set(0, 0, 1).applyQuaternion(rootQ).normalize();
  const follow = state?.primed ? 1 - Math.exp(-dt * GRIP_FOLLOW_RATE) : 1;
  for (let i = 0; i < 2; i++) {
    const arm = i === 0 ? arms.left : arms.right;
    const side = i === 0 ? 0.04 : -0.04;
    const forward = grip.forward + (i === 0 ? -0.5 : 0.5) * grip.stagger;
    posOf(arm.upper, tmpS);
    posOf(arm.fore, tmpE);
    posOf(arm.wrist, tmpW);
    const armReach = (tmpS.distanceTo(tmpE) + tmpE.distanceTo(tmpW)) * GRIP_REACH;
    root.localToWorld(handleOrigin.set(side, grip.up, 0));
    let t = gripParamAlongHandle(tmpS, handleOrigin, handleDir, forward * scale, armReach);
    if (state) {
      t = state.t[i] + (t - state.t[i]) * follow;
      state.t[i] = t;
    }
    gripAt.copy(handleOrigin).addScaledVector(handleDir, t);
    solveArm(arm, gripAt, handleDir, i === 0 ? 1 : -1, k);
  }
  if (state) state.primed = true;
}
