import { describe, expect, it } from 'vitest';
import {
  type PropPathEase,
  type PropPathSegment,
  propPathPoseAt,
} from '../src/render/prop_path_core';
import {
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
} from '../src/sim/content/last_bell_cinematics';

const GLIDE: PropPathSegment = {
  start: { x: 3, y: -2, z: 7, yaw: -0.8 },
  end: { x: -9, y: 5, z: 18, yaw: 2.4 },
  duration: 6,
  ease: 'easeInOutSine',
};

const EASES: readonly PropPathEase[] = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutSine'];

describe('propPathPoseAt', () => {
  it('is continuous within a segment under dense sampling', () => {
    const span = Math.hypot(
      GLIDE.end.x - GLIDE.start.x,
      GLIDE.end.y - GLIDE.start.y,
      GLIDE.end.z - GLIDE.start.z,
      GLIDE.end.yaw - GLIDE.start.yaw,
    );
    for (const ease of EASES) {
      const segment = { ...GLIDE, ease };
      let previous = propPathPoseAt(segment, 0);
      let maxStep = 0;
      for (let i = 1; i <= 1200; i++) {
        const current = propPathPoseAt(segment, (segment.duration * i) / 1200);
        maxStep = Math.max(
          maxStep,
          Math.hypot(
            current.x - previous.x,
            current.y - previous.y,
            current.z - previous.z,
            current.yaw - previous.yaw,
          ),
        );
        previous = current;
      }
      expect(maxStep, ease).toBeLessThan(span / 400);
    }
  });

  it('clamps before the segment start and past its end', () => {
    expect(propPathPoseAt(GLIDE, -100)).toEqual({ ...GLIDE.start, done: false });
    expect(propPathPoseAt(GLIDE, GLIDE.duration + 100)).toEqual({
      ...GLIDE.end,
      done: true,
    });
  });

  it('lands exactly on both endpoints for every easing mode', () => {
    for (const ease of EASES) {
      const segment = { ...GLIDE, ease };
      expect(propPathPoseAt(segment, 0)).toEqual({ ...segment.start, done: false });
      expect(propPathPoseAt(segment, segment.duration)).toEqual({
        ...segment.end,
        done: true,
      });
    }
  });

  it('treats zero duration as an instantaneous cut at t=0', () => {
    const segment = { ...GLIDE, duration: 0 };
    expect(propPathPoseAt(segment, -0.001)).toEqual({ ...segment.start, done: false });
    expect(propPathPoseAt(segment, 0)).toEqual({ ...segment.end, done: true });
    expect(propPathPoseAt(segment, 20)).toEqual({ ...segment.end, done: true });
  });

  it('holds an identical start and end pose throughout the segment', () => {
    const pose = { x: 12, y: 4, z: -3, yaw: 1.2 };
    const segment: PropPathSegment = {
      start: pose,
      end: pose,
      duration: 5,
      ease: 'easeOutQuad',
    };
    for (const elapsed of [-2, 0, 1.25, 4.999, 5, 20]) {
      const sample = propPathPoseAt(segment, elapsed);
      expect({ x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw }).toEqual(pose);
    }
  });

  it('starts each segment from its own authored pose without cross-segment continuity', () => {
    const cut: PropPathSegment = {
      start: { x: 80, y: 1, z: -40, yaw: -2.2 },
      end: { x: 90, y: 1, z: -12, yaw: -1.7 },
      duration: 4,
      ease: 'linear',
    };
    expect(propPathPoseAt(cut, 0)).toEqual({ ...cut.start, done: false });
  });
});

describe('Last Bell outbound cast-off segment', () => {
  const segment: PropPathSegment =
    LAST_BELL_PROP_PATH_SEGMENTS[LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff];

  // These are authored berth-local values. Changing this pin changes the
  // shipped voyage clearance or visible motion.
  it('pins the shipped cast-off segment values', () => {
    expect(LAST_BELL_PROP_PATH_SEGMENTS[LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff]).toEqual({
      start: { x: 0, y: 0.5, z: 4, yaw: 0 },
      end: { x: 22, y: 0.5, z: 7, yaw: 0 },
      duration: 4,
      ease: 'linear',
    });
  });

  it('starts at the authored seaward pose and is clamped below zero', () => {
    expect(propPathPoseAt(segment, 0)).toEqual({ x: 0, y: 0.5, z: 4, yaw: 0, done: false });
    expect(propPathPoseAt(segment, -3).x).toBe(0);
  });

  it('covers equal distance in every quarter of the visible glide', () => {
    const poses = Array.from({ length: 5 }, (_, index) =>
      propPathPoseAt(segment, (segment.duration * index) / 4),
    );
    const distances = poses.slice(1).map((pose, index) => {
      const previous = poses[index];
      return Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z);
    });
    for (const distance of distances.slice(1)) {
      expect(distance).toBeCloseTo(distances[0], 10);
    }
  });

  it('grows monotonically and holds its final pose past the duration', () => {
    let last = -1;
    for (let t = 0; t <= segment.duration; t += 0.5) {
      const pose = propPathPoseAt(segment, t);
      expect(pose.x).toBeGreaterThanOrEqual(last);
      last = pose.x;
    }
    const end = propPathPoseAt(segment, segment.duration);
    const past = propPathPoseAt(segment, segment.duration + 30);
    expect(end.done).toBe(true);
    expect(past.x).toBe(end.x);
    expect(past.yaw).toBe(end.yaw);
  });

  it('writes into the reused container on the per-frame path', () => {
    const out = { x: 0, y: 0, z: 0, yaw: 0, done: false };
    const returned = propPathPoseAt(segment, 3, out);
    expect(returned).toBe(out);
    expect(out.x).toBeGreaterThan(0);
  });
});
