// Pure motion math for the harbor ship's cast-off scene cue (H3): given the
// seconds since the cue started, the ship's pose offset in its OWN frame
// (forward yards along the bow axis, yaw drift away from the pier). Three-
// free and clock-free so a Vitest drives any moment directly; harbor.ts owns
// the wall clock and the THREE transforms.

/** The drift keeps easing until the scene's fade has long covered it. */
export const CAST_OFF_DURATION = 16;
const CAST_OFF_DISTANCE = 26; // yards of way on by the end of the cue
const CAST_OFF_YAW_DRIFT = 0.09; // radians of slow bow swing seaward

export interface CastOffPose {
  /** Yards traveled along the ship's local bow (+x) axis. */
  forward: number;
  /** Radians added to the berthed heading. */
  yawDrift: number;
  /** True once the cue has fully played out (the pose holds there). */
  done: boolean;
}

/** Resolve the cue pose at `elapsed` seconds (clamped both ends). Writes into
 *  `out` when given (per-frame path: no allocation). */
export function castOffPose(elapsed: number, out?: CastOffPose): CastOffPose {
  const pose = out ?? { forward: 0, yawDrift: 0, done: false };
  const t = Math.min(1, Math.max(0, elapsed / CAST_OFF_DURATION));
  // A ship leaves slowly: ease-in keeps the first seconds at a crawl.
  const g = t * t;
  pose.forward = CAST_OFF_DISTANCE * g;
  pose.yawDrift = CAST_OFF_YAW_DRIFT * g;
  pose.done = t >= 1;
  return pose;
}
