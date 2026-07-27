// Directed camera moves: the Unreal-camera-manager equivalent, scoped to the
// two moves this game wants and built the spawn_cinematic.ts way (pure pose
// math, eased, always cancellable). Unlike the spawn intro, a directive never
// writes the player's camera state: it produces a blended OFFSET over the live
// yaw/pitch/dist mirrors each frame, so releasing (or the player touching the
// camera) glides straight back to exactly what the player had.
//
//  - vista: on entering a new zone, the camera eases up and out and sweeps a
//    slow fraction of a turn over the landscape, then settles home.
//  - deathDrift: while the player lies dead (pre-release), a slow elevated
//    drift; ends the moment they release or resurrect.
//
// The caller reports `disturbed` (any manual camera input / follow adjustment
// since the directive started); the core then blends out fast. Pure math, no
// Three/DOM; renderer.ts owns one state and steps it in updateCamera.

export type CameraDirectiveKind = 'vista' | 'deathDrift';

export interface CameraDirectorPose {
  yaw: number;
  pitch: number;
  dist: number;
}

export interface CameraDirectorState {
  kind: CameraDirectiveKind | null;
  t: number;
  releasing: boolean;
  /** Weight captured when the release began, for a continuous blend-out. */
  releaseFrom: number;
  releaseT: number;
  /** Last applied weight (0..1); 0 = the live pose passes through untouched. */
  weight: number;
}

export const VISTA_DURATION = 5.2;
export const VISTA_RAMP_IN = 1.4;
export const VISTA_RAMP_OUT = 1.3;
/** rad/s of the slow sweep across the vista. */
export const VISTA_SWEEP_RATE = 0.09;
export const VISTA_PITCH = 0.55;
export const VISTA_DIST_PUSH = 6;
export const VISTA_DIST_CAP = 18;
export const DRIFT_RAMP_IN = 2.2;
export const DRIFT_SWEEP_RATE = 0.07;
export const DRIFT_PITCH = 0.62;
export const DRIFT_DIST_PUSH = 4;
export const DRIFT_DIST_CAP = 20;
/** Blend-out time on cancel/interrupt (seconds). */
export const DIRECTOR_RELEASE_TIME = 0.8;
const MAX_STEP = 0.25;

export function createCameraDirector(): CameraDirectorState {
  return { kind: null, t: 0, releasing: false, releaseFrom: 0, releaseT: 0, weight: 0 };
}

function start(s: CameraDirectorState, kind: CameraDirectiveKind): void {
  s.kind = kind;
  s.t = 0;
  s.releasing = false;
  s.releaseFrom = 0;
  s.releaseT = 0;
  s.weight = 0;
}

/** Begin the zone-entry vista sweep (no-op while any directive is running). */
export function startVista(s: CameraDirectorState): void {
  if (s.kind === null) start(s, 'vista');
}

/** Begin the dead-body drift (no-op while any directive is running). */
export function startDeathDrift(s: CameraDirectorState): void {
  if (s.kind === null) start(s, 'deathDrift');
}

/** Blend out early (player input, state change). Safe to call repeatedly. */
export function cancelCameraDirective(s: CameraDirectorState): void {
  if (s.kind === null || s.releasing) return;
  s.releasing = true;
  s.releaseFrom = s.weight;
  s.releaseT = 0;
}

export function cameraDirectiveActive(s: CameraDirectorState): boolean {
  return s.kind !== null;
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// Weight envelope while running normally (not releasing).
function envelope(s: CameraDirectorState): number {
  if (s.kind === 'vista') {
    const rampIn = smooth(s.t / VISTA_RAMP_IN);
    const rampOut = smooth((VISTA_DURATION - s.t) / VISTA_RAMP_OUT);
    return Math.min(rampIn, rampOut);
  }
  return smooth(s.t / DRIFT_RAMP_IN);
}

/**
 * Advance and apply the directive over the live player pose. Returns the pose
 * to render this frame; equals `live` exactly once the directive has fully
 * released. `disturbed` = manual camera input since the directive started.
 */
export function stepCameraDirector(
  s: CameraDirectorState,
  live: CameraDirectorPose,
  dt: number,
  disturbed: boolean,
): CameraDirectorPose {
  if (s.kind === null) return live;
  const step = Math.min(Math.max(dt, 0), MAX_STEP);
  if (disturbed) cancelCameraDirective(s);
  s.t += step;

  if (s.releasing) {
    s.releaseT += step;
    const k = 1 - smooth(s.releaseT / DIRECTOR_RELEASE_TIME);
    s.weight = s.releaseFrom * k;
    if (s.weight <= 1e-3) {
      s.kind = null;
      s.weight = 0;
      return live;
    }
  } else {
    s.weight = envelope(s);
    if (s.kind === 'vista' && s.t >= VISTA_DURATION) {
      s.kind = null;
      s.weight = 0;
      return live;
    }
  }

  // `kind` is preserved all the way through a release, so this stays the
  // shape selector for the blend-out too.
  const vista = s.kind === 'vista';
  const sweepRate = vista ? VISTA_SWEEP_RATE : DRIFT_SWEEP_RATE;
  const pitchTarget = vista ? VISTA_PITCH : DRIFT_PITCH;
  const distPush = vista ? VISTA_DIST_PUSH : DRIFT_DIST_PUSH;
  const distCap = vista ? VISTA_DIST_CAP : DRIFT_DIST_CAP;
  const w = s.weight;
  const distTarget = Math.min(Math.max(live.dist, Math.min(live.dist + distPush, distCap)), 55);
  return {
    yaw: live.yaw + sweepRate * s.t * w,
    pitch: live.pitch + (pitchTarget - live.pitch) * w,
    dist: live.dist + (distTarget - live.dist) * w,
  };
}
