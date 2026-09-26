// Action Cam: an opt-in over-the-shoulder framing for the chase camera. When
// on, the look pivot slides sideways off the avatar (right or left shoulder),
// drops a touch toward shoulder height, and the FOV opens a few degrees, so
// the character sits off-center and the view reads closer and more kinetic.
//
// It never changes the camera DISTANCE (the player's zoom stays theirs, the
// graphics-overhaul pin) and never hides anything: the offset is a pivot shift
// like the look-ahead lead, applied to both the camera and its aim point.
// Enabling, disabling and swapping shoulders all glide rather than snap.
// While running on foot it also adds a subtle stride bob: a vertical dip at
// step rate plus a gentle sideways sway at stride rate, eased in and out with
// ground speed and dropped in the air, underwater, and under reduced motion.
// Pure math, no Three/DOM; renderer.ts owns one state and steps it per frame.

import { RUN_SPEED } from '../sim/types';

/** Shoulder offset: -1 = full left, 0 = centered, 1 = full right. */
export type ActionCamSide = number;

function clampSide(side: number): number {
  return Number.isFinite(side) ? Math.max(-1, Math.min(1, side)) : 1;
}

export interface ActionCamState {
  /** Requested mode: the player's toggle. */
  enabled: boolean;
  /** Requested shoulder offset, -1..1. */
  targetSide: ActionCamSide;
  /** False until the first request: that one lands instantly, so a boot or
   *  renderer rebuild with the cam already on never sweeps into place. */
  primed: boolean;
  /** Blend toward the action framing, 0 (classic) to 1 (full). */
  weight: number;
  /** Smoothed shoulder offset, -1 (full left) to 1 (full right). */
  side: number;
  /** Stride phase (radians); one full turn is two footfalls. */
  bobPhase: number;
  /** Smoothed bob strength, 0 (still) to 1 (full run). */
  bobAmp: number;
  /** Last display height, for the airborne check; NaN before the first step. */
  bobLastY: number;
}

/** Lateral pivot shift at zero zoom (yards). */
export const ACTION_CAM_SIDE_BASE = 0.6;
/** Extra lateral shift per yard of zoom, so the framing holds as you pull out. */
export const ACTION_CAM_SIDE_PER_DIST = 0.085;
/** Lateral shift cap (yards). */
export const ACTION_CAM_SIDE_MAX = 1.8;
/** How far the aim drops from head height toward the shoulder (yards). */
export const ACTION_CAM_DROP = 0.5;
/** FOV widen at full weight (degrees). */
export const ACTION_CAM_FOV = 5;
/** Enable/disable blend rate (1/s). */
export const ACTION_CAM_BLEND_RATE = 5;
/** Shoulder swap rate (1/s). */
export const ACTION_CAM_SWAP_RATE = 7;
/** Vertical bob amplitude at a full run (yards), at step rate. */
export const ACTION_CAM_BOB_Y = 0.07;
/** Sideways sway amplitude at a full run (yards), at stride rate. */
export const ACTION_CAM_BOB_X = 0.05;
/** Stride phase rate per yard/s of ground speed: 2.5 footfalls/s at a run. */
export const ACTION_CAM_BOB_RATE = (2.5 * Math.PI) / RUN_SPEED;
/** Phase-rate cap in yards/s: a fast mount strides, it does not buzz. */
export const ACTION_CAM_BOB_MAX_SPEED = RUN_SPEED * 1.4;
/** Vertical display speed (yd/s) above which the body counts as airborne. */
export const ACTION_CAM_BOB_AIR_VY = 2;
/** Bob ease rate (1/s) in and out. */
export const ACTION_CAM_BOB_EASE = 6;
const MAX_STEP = 0.25;

export function createActionCam(): ActionCamState {
  return {
    enabled: false,
    targetSide: 1,
    primed: false,
    weight: 0,
    side: 1,
    bobPhase: 0,
    bobAmp: 0,
    bobLastY: Number.NaN,
  };
}

/** Record the player's choice. The first call snaps; later ones glide. */
export function setActionCamTarget(s: ActionCamState, enabled: boolean, side: ActionCamSide): void {
  s.enabled = enabled;
  s.targetSide = clampSide(side);
  if (!s.primed) {
    s.primed = true;
    s.weight = enabled ? 1 : 0;
    s.side = s.targetSide;
  }
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Advance the blend toward the requested mode. `snap` (reduced motion) lands
 * on the target immediately. A disabled cam keeps easing its side toward the
 * chosen shoulder so turning it back on never sweeps across the avatar.
 */
export function stepActionCam(s: ActionCamState, dt: number, snap: boolean): void {
  const side = s.targetSide;
  const target = s.enabled ? 1 : 0;
  if (snap) {
    s.weight = target;
    s.side = side;
    return;
  }
  const step = Math.min(Math.max(0, dt), MAX_STEP);
  s.weight = approach(s.weight, target, ACTION_CAM_BLEND_RATE, step);
  s.side = s.weight < 1e-3 ? side : approach(s.side, side, ACTION_CAM_SWAP_RATE, step);
  if (Math.abs(s.weight - target) < 1e-4) s.weight = target;
  if (Math.abs(s.side - side) < 1e-4) s.side = side;
}

/**
 * Advance the stride bob from the display motion: horizontal ground speed and
 * display height. `still` forces it out (swimming, dead, reduced motion). The
 * phase only advances with distance travelled, so a stop freezes it mid-step
 * while the amplitude eases out, never snapping the view.
 */
export function stepActionCamBob(
  s: ActionCamState,
  speedXZ: number,
  y: number,
  dt: number,
  still: boolean,
): void {
  const step = Math.min(Math.max(0, dt), MAX_STEP);
  const vy = Number.isFinite(s.bobLastY) && step > 0 ? (y - s.bobLastY) / step : 0;
  s.bobLastY = y;
  if (still) {
    s.bobAmp = 0;
    return;
  }
  const speed = Math.max(0, speedXZ);
  const airborne = Math.abs(vy) > ACTION_CAM_BOB_AIR_VY;
  const target = airborne ? 0 : Math.min(1, speed / RUN_SPEED);
  s.bobAmp = approach(s.bobAmp, target, ACTION_CAM_BOB_EASE, step);
  if (s.bobAmp < 1e-4) s.bobAmp = 0;
  s.bobPhase =
    (s.bobPhase + Math.min(speed, ACTION_CAM_BOB_MAX_SPEED) * ACTION_CAM_BOB_RATE * step) %
    (2 * Math.PI);
}

export interface ActionCamOffset {
  /** World-space pivot shift (yards), added to both camera and aim. */
  x: number;
  z: number;
  /** Aim height drop (yards), subtracted from the eye height. */
  drop: number;
  /** FOV widen (degrees). */
  fov: number;
}

/**
 * The pivot shift for the current blend. The chase camera sits at
 * `pivot - (sin yaw, cos yaw) * dist` looking along +(sin yaw, cos yaw), so the
 * screen-right vector is (-cos yaw, 0, sin yaw): a right-shoulder cam shifts
 * the pivot that way, leaving the avatar left of center. Writes into `out`.
 */
export function actionCamOffset(
  s: ActionCamState,
  yaw: number,
  dist: number,
  out: ActionCamOffset,
): ActionCamOffset {
  const w = s.weight;
  if (w <= 0) {
    out.x = 0;
    out.z = 0;
    out.drop = 0;
    out.fov = 0;
    return out;
  }
  const lateral =
    Math.min(
      ACTION_CAM_SIDE_MAX,
      ACTION_CAM_SIDE_BASE + ACTION_CAM_SIDE_PER_DIST * Math.max(0, dist),
    ) *
    w *
    s.side;
  // Stride bob: |sin| gives one dip per footfall (the head is highest mid
  // stride), the sway leans toward the planted foot once per stride.
  const bob = s.bobAmp * w;
  const sway = ACTION_CAM_BOB_X * bob * Math.sin(s.bobPhase);
  const dip = ACTION_CAM_BOB_Y * bob * (1 - Math.abs(Math.sin(s.bobPhase)));
  out.x = -Math.cos(yaw) * (lateral + sway);
  out.z = Math.sin(yaw) * (lateral + sway);
  out.drop = ACTION_CAM_DROP * w + dip;
  out.fov = ACTION_CAM_FOV * w;
  return out;
}

/** The renderer's one Action Cam: the state plus the reused offset it fills.
 *  Keeps the renderer a two-call consumer (step, then offset) per frame. */
export class ActionCamRig {
  readonly state = createActionCam();
  private readonly out: ActionCamOffset = { x: 0, z: 0, drop: 0, fov: 0 };

  /** The player's toggle and shoulder offset (-1 left .. 1 right). */
  set(enabled: boolean, side: ActionCamSide): void {
    setActionCamTarget(this.state, enabled, side);
  }

  /** Advance the blend and the stride bob. `still` (swimming, dead) drops the
   *  bob; reduced motion snaps the blend and drops the bob too. */
  step(dt: number, reduce: boolean, still: boolean, velX: number, velZ: number, y: number): void {
    stepActionCam(this.state, dt, reduce);
    stepActionCamBob(this.state, Math.hypot(velX, velZ), y, dt, reduce || still);
  }

  /** This frame's pivot shift for the camera yaw and distance. */
  offset(yaw: number, dist: number): ActionCamOffset {
    return actionCamOffset(this.state, yaw, dist, this.out);
  }
}
