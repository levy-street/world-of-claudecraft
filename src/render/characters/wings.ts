// Wings back-cosmetic (Entity.wings): a static prop GLB parented to the upper
// spine bone so it rides the chest through every clip, the way held weapons
// ride the handslot bones. One wings model ships today (the Combat Mech
// thruster wings); the slot itself is model-agnostic, so a future wings
// catalog only swaps the prop scene passed in.
//
// Seating: mixamorig bone axes are not world-aligned and the v02 rigs carry
// non-uniform ancestor scales, so the seat is computed, never hand-authored in
// bone space: the desired transform is expressed in MODEL space (raw suit
// units) and converted to a bone-local matrix at attach time
// (local = bone_rel_model^-1 * desired), while the rig is at its bind pose.
import * as THREE from 'three';

/** Seat offsets from the upper spine bone's own model-space position, in raw
 *  suit units (the warrior mech suit is ~2.09 tall): a touch above the bone and
 *  pushed behind the torso shell, sized to span past the pauldrons. Anchoring
 *  on the bone position (not absolute model coords) keeps the seat valid on any
 *  rig regardless of where its root origin sits. The prop is authored facing
 *  the viewer (mount block on its far side), so it yaws 180 to press the mount
 *  against the back; the fin tops lean back a touch. */
const SEAT_DY = -0.3;
const SEAT_DZ = -0.32;
const SEAT_SCALE = 0.9;
const SEAT_YAW_RAD = Math.PI;
const SEAT_PITCH_RAD = -0.12;

/** userData tag on the wings wrapper so remove/queries never rely on names. */
export const WINGS_PROP_TAG = 'wingsProp';

/** The bone-local matrix that seats `desired` (a model-space transform) under a
 *  bone whose model-relative matrix is `boneRelModel`. Pure math, Node-tested:
 *  local = boneRelModel^-1 * desired. */
export function boneLocalSeat(boneRelModel: THREE.Matrix4, desired: THREE.Matrix4): THREE.Matrix4 {
  return boneRelModel.clone().invert().multiply(desired);
}

/** The model-space seat matrix for the wings prop, anchored on the bone's own
 *  model-space position (x centered on the spine): translation, then yaw, then
 *  pitch, then uniform scale. Exported for the seat test. */
export function wingsSeatMatrix(bonePos: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(0, bonePos.y + SEAT_DY, bonePos.z + SEAT_DZ)
    .multiply(new THREE.Matrix4().makeRotationY(SEAT_YAW_RAD))
    .multiply(new THREE.Matrix4().makeRotationX(SEAT_PITCH_RAD))
    .multiply(new THREE.Matrix4().makeScale(SEAT_SCALE, SEAT_SCALE, SEAT_SCALE));
}

/** Parent `scene` (a fresh wings prop clone) to the model's upper spine bone at
 *  the computed seat. Returns the wrapper, or null when the rig has no spine
 *  bone (non-humanoid forms). */
export function attachWings(model: THREE.Object3D, scene: THREE.Object3D): THREE.Object3D | null {
  const bone = model.getObjectByName('mixamorigSpine2') ?? model.getObjectByName('mixamorigSpine1');
  if (!bone) return null;
  model.updateWorldMatrix(true, true);
  const boneRelModel = new THREE.Matrix4()
    .copy(model.matrixWorld)
    .invert()
    .multiply(bone.matrixWorld);
  const wrapper = new THREE.Group();
  wrapper.name = 'Wings';
  wrapper.userData[WINGS_PROP_TAG] = true;
  const bonePos = new THREE.Vector3().setFromMatrixPosition(boneRelModel);
  boneLocalSeat(boneRelModel, wingsSeatMatrix(bonePos)).decompose(
    wrapper.position,
    wrapper.quaternion,
    wrapper.scale,
  );
  wrapper.add(scene);
  bone.add(wrapper);
  return wrapper;
}

/** Remove an attached wings prop. Returns whether one was present. */
export function removeWings(model: THREE.Object3D): boolean {
  let found: THREE.Object3D | null = null;
  model.traverse((o) => {
    if (o.userData[WINGS_PROP_TAG]) found = o;
  });
  if (!found) return false;
  (found as THREE.Object3D).removeFromParent();
  return true;
}
