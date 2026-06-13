// Locomotion-state derivation for the character animation state machine,
// factored out of the renderer so it can be reasoned about and tested without
// a WebGL context. Render-space speed is sampled per frame and is noisy:
// frame-time jitter, snapshot interpolation stalls, and vertical bob over
// uneven terrain all make a steadily-walking entity momentarily read as
// stopped. Without leeway that single-frame dip flips the anim state to idle
// and resets the walk clip the next frame — visible leg jitter. So we enter
// the moving state above a low speed, latch it for a grace window after speed
// dips, smooth the cadence-driving speed, and hold the travel direction.

export const MOVE_ENTER_SPEED = 0.4; // u/s above which an entity is "moving"
export const MOVE_HOLD_TIME = 0.22; // s to keep "moving" latched after speed dips
export const SPEED_SMOOTH_RATE = 12; // EMA rate for the cadence-driving speed
const TELEPORT_SPEED = 25; // u/s above this is a snap, not locomotion

/** Per-entity hysteresis state; the renderer keeps one of these per view. */
export interface LocoTrack {
  moveHold: number;
  smoothSpeed: number;
  movingBackwards: boolean;
}

export interface LocoState {
  speed: number; // smoothed, for footstep cadence matching
  moving: boolean;
  backwards: boolean;
}

export function newLocoTrack(): LocoTrack {
  return { moveHold: 0, smoothSpeed: 0, movingBackwards: false };
}

/**
 * Advance the locomotion hysteresis by one frame.
 * @param t      per-entity track (mutated in place)
 * @param vx,vz  render-space horizontal displacement since last frame
 * @param facing entity facing (radians, 0 = +Z) for backpedal detection
 * @param dt     frame delta in seconds
 */
export function updateLocomotion(
  t: LocoTrack, vx: number, vz: number, facing: number, dt: number,
): LocoState {
  const dist = Math.hypot(vx, vz);
  let speed = dist / Math.max(dt, 1e-4);
  if (speed > TELEPORT_SPEED) speed = 0; // teleport snap, not locomotion

  if (speed > MOVE_ENTER_SPEED) t.moveHold = MOVE_HOLD_TIME;
  else t.moveHold = Math.max(0, t.moveHold - dt);
  const moving = t.moveHold > 0;

  // smooth cadence speed; while latched-but-stalled keep the last value so
  // footsteps don't lurch toward zero on a stalled frame
  if (speed > MOVE_ENTER_SPEED || !moving) {
    t.smoothSpeed += (speed - t.smoothSpeed) * Math.min(1, dt * SPEED_SMOOTH_RATE);
  }

  // only re-judge direction on frames with real displacement; a stalled frame
  // keeps the last direction so walkBack doesn't flip to walk and reset
  if (speed > MOVE_ENTER_SPEED && dist > 1e-6) {
    t.movingBackwards = (vx * Math.sin(facing) + vz * Math.cos(facing)) / dist < -0.3;
  } else if (!moving) {
    t.movingBackwards = false;
  }

  return { speed: t.smoothSpeed, moving, backwards: moving && t.movingBackwards };
}
