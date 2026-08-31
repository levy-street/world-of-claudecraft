import type * as THREE from 'three';
import { type MountVisualSpec, mountBobY } from './mount_visuals';

// A wheeled mount's jump attitude: it tips nose-up as it leaves the ground and
// rights itself before it lands.
//
// Ported from the Goblin Rocket Sled, where this shape was tuned on screen.
// Both mounts are vehicles with a rigid body and no legs to absorb a launch, so
// without this they leave the ground perfectly level and read as a prop being
// slid through the air rather than a cart being thrown off a bump.
//
// The two branches will eventually collapse into one shared implementation;
// they cannot yet, because the sled's copy lives on a branch this one does not
// descend from. Keep the numbers here in step with that copy until they merge.
//
// The decision math is pure; the one function that writes to the scene graph is
// at the bottom, so the renderer keeps only a call.

/** Nose-up angle held at the top of the arc, degrees. */
const NEUTRAL_PITCH_DEG = 12;
/** Extra nose-up while still climbing hard, degrees. */
const RISE_PITCH_DEG = 10;
/** How far the nose comes back DOWN while falling hard, degrees below neutral.
 *  Bigger than the rise on purpose: the cart has to be visibly levelling out,
 *  and slightly past level, by the time it touches down. */
const FALL_PITCH_DEG = 16;
/** Vertical speed at which the rise/fall blends reach full effect. */
const VY_FULL = 7;
/** Vertical speed below which the body counts as neither rising nor falling. */
const VY_DEADZONE = 0.5;
/** Damping toward the target, 1/s. Faster on the ground so a landing snaps
 *  level instead of wallowing back over the following second. */
const AIRBORNE_RATE = 12;
const GROUNDED_RATE = 18;
/** Longest frame integrated in one go, so an alt-tab cannot teleport the pose. */
const MAX_STEP_DT = 0.1;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Advance the jump pitch, in radians, positive nose-up.
 *
 * `verticalVelocity` is the body's DISPLAYED vertical speed, not a physics
 * value: the visual should answer to what the eye sees the cart doing.
 */
export function stepMountJumpPitch(
  current: number,
  airborne: boolean,
  verticalVelocity: number,
  dt: number,
): number {
  const step = Math.min(MAX_STEP_DT, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const vy = Number.isFinite(verticalVelocity) ? verticalVelocity : 0;
  let targetDeg = 0;
  if (airborne) {
    if (vy > VY_DEADZONE) {
      targetDeg = NEUTRAL_PITCH_DEG + clamp01((vy - VY_DEADZONE) / VY_FULL) * RISE_PITCH_DEG;
    } else if (vy >= -VY_DEADZONE) {
      targetDeg = NEUTRAL_PITCH_DEG;
    } else {
      targetDeg = NEUTRAL_PITCH_DEG - clamp01((-vy - VY_DEADZONE) / VY_FULL) * FALL_PITCH_DEG;
    }
  }
  const target = (targetDeg * Math.PI) / 180;
  const rate = airborne ? AIRBORNE_RATE : GROUNDED_RATE;
  const next = current + (target - current) * (1 - Math.exp(-rate * step));
  return Math.abs(next) < 1e-5 ? 0 : next;
}

/**
 * Where the rider's seat lands once the vehicle tips by `pitch` radians.
 *
 * The rider is a SEPARATE root parented alongside the mount rather than under
 * it, so a nose-up cart would otherwise leave the rider sitting level and
 * floating off the seat. Rotating the seat offset about the same vehicle origin
 * keeps pelvis and seat locked together through the whole arc.
 */
export function mountRiderPivot(
  seatY: number,
  seatFwd: number,
  pitch: number,
): { y: number; z: number } {
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  return { y: seatY * cos + seatFwd * sin, z: seatFwd * cos - seatY * sin };
}

/**
 * The whole per-frame attitude pass for a tipping mount.
 *
 * Lives here rather than inline in the entity loop because it is mount
 * behavior, not coordinator work, and renderer.ts is a named monolith under the
 * line-count ratchet (root CLAUDE.md, Modularity).
 *
 * `tips` false still runs, so a mount that does not tip relaxes any residual
 * pitch to zero through the same damped path instead of snapping.
 */
export function applyMountJumpAttitude(
  view: { mountJumpPitch: number; mountLift: number },
  mountRoot: THREE.Object3D,
  riderRoot: THREE.Object3D,
  spec: MountVisualSpec,
  time: number,
  moving: boolean,
  airborne: boolean,
  verticalVelocity: number,
  dt: number,
): void {
  // The rider floats WITH the procedural bob, not just the mount body.
  const bob = mountBobY(spec, time, moving);
  const seatLift = view.mountLift + bob;
  view.mountJumpPitch = stepMountJumpPitch(
    view.mountJumpPitch,
    spec.jumpTips && airborne,
    verticalVelocity,
    dt,
  );
  const pitch = view.mountJumpPitch;
  const rotationX = -pitch;
  mountRoot.rotation.x = rotationX;
  mountRoot.position.y = bob;
  // Carry the separately-rooted rider around the same vehicle origin, or a
  // nose-up cart leaves them sitting level and off the seat.
  const seat = mountRiderPivot(seatLift, spec.seatFwd, pitch);
  riderRoot.rotation.x = rotationX;
  riderRoot.position.y = seat.y;
  riderRoot.position.z = seat.z;
}
