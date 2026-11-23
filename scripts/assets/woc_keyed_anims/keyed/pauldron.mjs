// How a WOC pauldron follows its arm: the rule the rig's own animation library
// (`public/models/chars/players/woc/anims_<fit>.glb`) keys, measured off every
// frame of it and reproduced here for the hand-keyed clips.
//
// A shoulder pad is a rigid part hung on its own `armor_shoulder` bone, a sibling
// of the upper arm under the clavicle with the same bind (the T-pose: the arm
// level and pointing out). It takes only part of the arm's swing out of that
// bind: half of a swing forward or back, 0.45 of a drop and 0.3 of a lift, and
// none of the arm's twist about its own length. So an arm hanging at the side
// tips its pad about 40 degrees and the plate stays on top of the shoulder,
// instead of riding down the outside of the arm; an arm raised overhead lifts it
// about 27 degrees, so it cannot be driven into the head.
//
// `tests/woc_keyed_pauldrons.test.ts` holds this rule to the rig's own library
// and the shipped hand-keyed clips to this rule.
import { Quaternion, Vector3 } from 'three';

/** Fractions of the arm's swing out of the bind that the pad takes. */
export const PAULDRON_FOLLOW = Object.freeze({ swing: 0.5, drop: 0.45, lift: 0.3 });

const AXIS = new Vector3(0, 1, 0); // a bone points along its own +Y

/**
 * The pad's local rotation for its arm's local rotation (both under the clavicle).
 * `down` is the body's down in the arm's bind frame, square to the bone since the
 * bind arm is level: it splits the swing into its drop or lift and its swing
 * forward or back.
 */
export function pauldronLocal(armBind, armLocal, padBind, down) {
  const delta = armBind.clone().invert().multiply(armLocal);
  const swing = new Quaternion().setFromUnitVectors(AXIS, AXIS.clone().applyQuaternion(delta));
  const w = Math.min(1, Math.max(-1, swing.w));
  const half = Math.sqrt(1 - w * w);
  if (half < 1e-9) return padBind.clone();
  // The swing as a rotation vector, measured about the two axes square to the
  // bone: the drop axis (a positive turn about it swings the arm down) and the
  // body's vertical (a turn about it swings the arm forward or back).
  const turn = new Vector3(swing.x, swing.y, swing.z).multiplyScalar((2 * Math.acos(w)) / half);
  const vertical = down.clone().normalize();
  const dropAxis = AXIS.clone().cross(vertical).normalize();
  const dropped = turn.dot(dropAxis);
  const follow = dropAxis
    .multiplyScalar(dropped * (dropped > 0 ? PAULDRON_FOLLOW.drop : PAULDRON_FOLLOW.lift))
    .addScaledVector(vertical, turn.dot(vertical) * PAULDRON_FOLLOW.swing);
  const angle = follow.length();
  if (angle < 1e-12) return padBind.clone();
  return padBind
    .clone()
    .multiply(new Quaternion().setFromAxisAngle(follow.divideScalar(angle), angle));
}
