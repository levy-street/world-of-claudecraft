// Pure prop path evaluation for scene cues. Segments are independent authored
// pose-to-pose glides, so a cut may start from any pose while every individual
// segment stays continuous and clamped. Three transforms and the mirrored
// simulation clock remain in the render consumer.

export interface PropPathPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Authored yaw in radians. Values interpolate directly without wrapping. */
  readonly yaw: number;
}

export type PropPathEase = 'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutSine';

export interface PropPathSegment {
  readonly start: PropPathPose;
  readonly end: PropPathPose;
  readonly duration: number;
  readonly ease: PropPathEase;
}

export interface PropPathSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** True once the segment has reached its clamped end pose. */
  done: boolean;
}

function easeProgress(t: number, ease: PropPathEase): number {
  switch (ease) {
    case 'easeInQuad':
      return t * t;
    case 'easeOutQuad':
      return t * (2 - t);
    case 'easeInOutSine':
      return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'linear':
      return t;
  }
}

/** Evaluate a segment at elapsed seconds. Non-positive durations cut to the
 * end pose at t=0. Writes into `out` when given for allocation-free frame use. */
export function propPathPoseAt(
  segment: PropPathSegment,
  elapsed: number,
  out?: PropPathSample,
): PropPathSample {
  const pose = out ?? { x: 0, y: 0, z: 0, yaw: 0, done: false };
  const progress =
    segment.duration > 0
      ? Math.min(1, Math.max(0, elapsed / segment.duration))
      : elapsed < 0
        ? 0
        : 1;
  if (progress <= 0) {
    pose.x = segment.start.x;
    pose.y = segment.start.y;
    pose.z = segment.start.z;
    pose.yaw = segment.start.yaw;
  } else if (progress >= 1) {
    pose.x = segment.end.x;
    pose.y = segment.end.y;
    pose.z = segment.end.z;
    pose.yaw = segment.end.yaw;
  } else {
    const eased = easeProgress(progress, segment.ease);
    pose.x = segment.start.x + (segment.end.x - segment.start.x) * eased;
    pose.y = segment.start.y + (segment.end.y - segment.start.y) * eased;
    pose.z = segment.start.z + (segment.end.z - segment.start.z) * eased;
    pose.yaw = segment.start.yaw + (segment.end.yaw - segment.start.yaw) * eased;
  }
  pose.done = progress >= 1;
  return pose;
}
