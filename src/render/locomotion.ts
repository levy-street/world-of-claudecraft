// Locomotion-state derivation for the character animation state machine,
// factored out of the renderer so it can be reasoned about and tested without
// a WebGL context. Render-space speed is sampled per frame and is noisy:
// frame-time jitter, snapshot interpolation stalls, and vertical bob over
// uneven terrain all make a steadily-walking entity momentarily read as
// stopped. Without leeway that single-frame dip flips the anim state to idle
// and resets the walk clip the next frame — visible leg jitter. So we enter
// the moving state above a low speed, latch it for a grace window after speed
// dips, smooth the cadence-driving speed, and hold the travel direction.

import { MAX_FRAME_DT as SELF_TURN_MAX_FRAME_DT } from './facing_smooth';

export const MOVE_ENTER_SPEED = 0.4; // u/s above which an entity is "moving"
export const MOVE_HOLD_TIME = 0.22; // s to keep "moving" latched after speed dips
export const SPEED_SMOOTH_RATE = 12; // EMA rate for the cadence-driving speed
// Gait (walk vs run) double threshold over the SMOOTHED speed, plus a minimum
// dwell between gait/direction switches. A single enter==exit threshold made
// the run/walk pick flip on every noisy frame under load hitches, and each
// flip crossfades Running<->Walking: the visible "the animation keeps
// replaying" glitch of the first seconds after world entry. Sim anchors: the
// player run is 7 u/s, backpedal 4.55, mob walk/wander sits well below 3.
export const GAIT_RUN_ENTER = 5.2; // u/s smoothed speed to switch the gait to run
export const GAIT_RUN_EXIT = 3.6; // u/s smoothed speed to drop the gait to walk
export const GAIT_HOLD_TIME = 0.25; // s minimum dwell between gait/direction switches
const TELEPORT_SPEED = 25; // u/s above this is a snap, not locomotion
// Strafe: a Q/E strafe keeps facing and slides the body sideways at the full
// run speed (only the backpedal is slowed, player_motion.ts). A frame whose
// displacement lies at least this far along the body's own left/right axis
// (|lateral| >= 0.85: about 58 deg or more off the facing axis) reads as
// sideways. A forward diagonal (W+Q, 45 deg, lateral 0.71) stays a plain run,
// and a backpedal is never a strafe.
export const STRAFE_LATERAL_MIN = 0.85;
// Consecutive frames a backpedal change must hold before it latches, see the
// direction block in updateLocomotionInto.
const DIR_CONFIRM_FRAMES = 3;
// Seconds of sideways travel a strafe change must hold before it latches. Time,
// not frames: the displayed facing is smoothed, so when mouse steering swings
// the travel onto a new heading the model turns after it (facing_smooth.ts,
// SELF_TURN_MAX_RATE) and the travel reads sideways across the still-turning
// model for a moment (the whole sideways band, 58 to 107 deg off, takes that
// turn ~0.09 s). Three frames is 21 ms at 144 Hz; 0.12 s outlasts any such turn
// and still latches a real strafe well inside the first stride. Each frame
// counts at most the turn limiter's own frame clamp (TURN_FRAME_DT): below
// 30 fps, or on one hitch frame, the model turns no further per frame, so a
// raw frame time would latch the side run mid-turn.
export const STRAFE_CONFIRM_SEC = 0.12;
const TURN_FRAME_DT = SELF_TURN_MAX_FRAME_DT;

/** A rig's authored walk/run coverage, using the same shared dwell and smoothing. */
export interface LocoGaitThresholds {
  runEnter: number;
  runExit: number;
}

/** Which way a body travels sideways across its own facing, or null. */
export type LocoStrafe = 'left' | 'right' | null;

/** Per-entity hysteresis state; the renderer keeps one of these per view. */
export interface LocoTrack {
  moveHold: number;
  smoothSpeed: number;
  movingBackwards: boolean;
  runGait: boolean;
  gaitHold: number;
  dirPendingFrames: number;
  /** latched strafe direction, confirmed over STRAFE_CONFIRM_SEC of agreeing frames */
  strafe: LocoStrafe;
  /** the direction the pending strafe frames agree on */
  strafePending: LocoStrafe;
  /** seconds the pending direction has held (STRAFE_CONFIRM_SEC) */
  strafePendingTime: number;
}

export interface LocoState {
  speed: number; // smoothed, for footstep cadence matching
  moving: boolean;
  backwards: boolean;
  /** Sideways travel across facing (a Q/E strafe): which way, else null.
   *  Never set together with `backwards`: a backpedal is never a strafe. */
  strafe: LocoStrafe;
  /** gait-hysteresis run pick (replaces a raw speed-threshold comparison) */
  running: boolean;
}

export function newLocoTrack(): LocoTrack {
  return {
    moveHold: 0,
    smoothSpeed: 0,
    movingBackwards: false,
    runGait: false,
    gaitHold: 0,
    dirPendingFrames: 0,
    strafe: null,
    strafePending: null,
    strafePendingTime: 0,
  };
}

export function newLocoState(): LocoState {
  return { speed: 0, moving: false, backwards: false, strafe: null, running: false };
}

/** One frame's strafe read from the displacement's lateral fraction (positive
 *  = toward the body's right): null unless the travel is mostly sideways and
 *  the frame is not a backpedal. */
function strafeOf(lateral: number, backwards: boolean): LocoStrafe {
  if (backwards || Math.abs(lateral) < STRAFE_LATERAL_MIN) return null;
  return lateral > 0 ? 'right' : 'left';
}

/**
 * Advance the locomotion hysteresis by one frame.
 * @param t      per-entity track (mutated in place)
 * @param vx,vz  render-space horizontal displacement since last frame
 * @param facing entity facing (radians, 0 = +Z) for backpedal detection
 * @param dt     frame delta in seconds
 */
export function updateLocomotion(
  t: LocoTrack,
  vx: number,
  vz: number,
  facing: number,
  dt: number,
  gait?: LocoGaitThresholds,
): LocoState {
  return updateLocomotionInto(newLocoState(), t, vx, vz, facing, dt, gait);
}

/** Fill a caller-owned state while advancing one entity's locomotion track. */
export function updateLocomotionInto(
  out: LocoState,
  t: LocoTrack,
  vx: number,
  vz: number,
  facing: number,
  dt: number,
  gait?: LocoGaitThresholds,
): LocoState {
  const dist = Math.hypot(vx, vz);
  let speed = dist / Math.max(dt, 1e-4);
  if (speed > TELEPORT_SPEED) speed = 0; // teleport snap, not locomotion

  if (speed > MOVE_ENTER_SPEED) t.moveHold = MOVE_HOLD_TIME;
  else t.moveHold = Math.max(0, t.moveHold - dt);
  const moving = t.moveHold > 0;

  // smooth cadence speed; while latched-but-stalled keep the last value so
  // footsteps don't lurch toward zero on a stalled frame. The blend is capped
  // at 0.5 so one long load-hitch frame can never fully overwrite the average
  // with a single noisy sample.
  if (speed > MOVE_ENTER_SPEED || !moving) {
    t.smoothSpeed += (speed - t.smoothSpeed) * Math.min(0.5, dt * SPEED_SMOOTH_RATE);
  }

  if (t.gaitHold > 0) t.gaitHold -= dt;

  // only re-judge direction on frames with real displacement; a stalled frame
  // keeps the last direction so walkBack doesn't flip to walk and reset. A
  // direction CHANGE needs 3 consecutive confirming frames: a one-frame
  // backwards read (a correction nudge on a hitchy frame) must not flash the
  // walkBack clip, while a real backpedal confirms in ~50ms.
  if (speed > MOVE_ENTER_SPEED && dist > 1e-6) {
    // The sim's convention (player_motion.ts): facing f points along
    // (sin f, cos f), and the body's RIGHT is the world vector (-cos f, sin f).
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    const backwards = (vx * sin + vz * cos) / dist < -0.3;
    if (backwards !== t.movingBackwards) {
      t.dirPendingFrames++;
      if (t.dirPendingFrames >= DIR_CONFIRM_FRAMES) {
        t.movingBackwards = backwards;
        t.dirPendingFrames = 0;
      }
    } else {
      t.dirPendingFrames = 0;
    }
    // The strafe side, on the same discipline but held for a TIME
    // (STRAFE_CONFIRM_SEC). It has three values, so the confirming frames must
    // agree on ONE of them: a left/right flutter never latches either side, and
    // a sideways blip mid-run (or a steering turn) never flips it.
    const strafe = strafeOf((vz * sin - vx * cos) / dist, backwards);
    if (strafe === t.strafe) {
      t.strafePendingTime = 0;
    } else {
      const held = Math.min(dt, TURN_FRAME_DT);
      t.strafePendingTime = strafe === t.strafePending ? t.strafePendingTime + held : held;
      t.strafePending = strafe;
      if (t.strafePendingTime >= STRAFE_CONFIRM_SEC) {
        t.strafe = strafe;
        t.strafePendingTime = 0;
      }
    }
  } else if (!moving) {
    t.movingBackwards = false;
    t.dirPendingFrames = 0;
    t.strafe = null;
    t.strafePending = null;
    t.strafePendingTime = 0;
  }

  // gait pick over the smoothed speed: double threshold + dwell
  if (!moving) {
    t.runGait = false;
    t.gaitHold = 0;
  } else {
    const want = t.runGait
      ? t.smoothSpeed > (gait?.runExit ?? GAIT_RUN_EXIT)
      : t.smoothSpeed >= (gait?.runEnter ?? GAIT_RUN_ENTER);
    if (want !== t.runGait && t.gaitHold <= 0) {
      t.runGait = want;
      t.gaitHold = GAIT_HOLD_TIME;
    }
  }

  out.speed = t.smoothSpeed;
  out.moving = moving;
  out.backwards = moving && t.movingBackwards;
  out.strafe = moving && !t.movingBackwards ? t.strafe : null;
  out.running = moving && t.runGait;
  return out;
}
