import { describe, expect, it } from 'vitest';
import {
  OCCLUDER_FADE_ALPHA,
  occluderFadeSettled,
  occluderSegmentHitsBox,
  stepOccluderFade,
} from '../src/render/occluder_fade_core';

const DT = 1 / 60;

describe('stepOccluderFade', () => {
  it('reveals subjects immediately when an occluder enters the camera ray', () => {
    expect(stepOccluderFade(1, true, DT)).toBe(OCCLUDER_FADE_ALPHA);
  });

  it('eases back to exactly 1 once the occluder clears', () => {
    let alpha = OCCLUDER_FADE_ALPHA;
    const first = stepOccluderFade(alpha, false, DT);
    expect(first).toBeGreaterThan(OCCLUDER_FADE_ALPHA);
    expect(first).toBeLessThan(1);
    alpha = first;
    for (let i = 0; i < 300; i++) alpha = stepOccluderFade(alpha, false, DT);
    expect(alpha).toBe(1);
  });

  it('is monotonic in both directions', () => {
    let down = 1;
    for (let i = 0; i < 50; i++) {
      const next = stepOccluderFade(down, true, DT);
      expect(next).toBeLessThanOrEqual(down);
      down = next;
    }
    let up = OCCLUDER_FADE_ALPHA;
    for (let i = 0; i < 50; i++) {
      const next = stepOccluderFade(up, false, DT);
      expect(next).toBeGreaterThanOrEqual(up);
      up = next;
    }
  });

  it('snaps both directions when reduced motion is active', () => {
    expect(stepOccluderFade(1, true, DT, true)).toBe(OCCLUDER_FADE_ALPHA);
    expect(stepOccluderFade(OCCLUDER_FADE_ALPHA, false, DT, true)).toBe(1);
  });

  it('settles in one step given a large dt', () => {
    expect(stepOccluderFade(1, true, 10)).toBe(OCCLUDER_FADE_ALPHA);
    expect(stepOccluderFade(OCCLUDER_FADE_ALPHA, false, 10)).toBe(1);
  });

  it('holds position on a zero or negative dt', () => {
    expect(stepOccluderFade(0.5, true, 0)).toBe(0.5);
    expect(stepOccluderFade(0.5, false, -1)).toBe(0.5);
  });

  it('recovers a non-finite alpha to the clamped range', () => {
    expect(stepOccluderFade(Number.NaN, false, DT)).toBe(1);
    expect(stepOccluderFade(Number.POSITIVE_INFINITY, true, DT)).toBeLessThanOrEqual(1);
  });
});

describe('occluderFadeSettled', () => {
  it('is at rest only at the exact target for the current occlusion state', () => {
    expect(occluderFadeSettled(1, false)).toBe(true);
    expect(occluderFadeSettled(1, true)).toBe(false);
    expect(occluderFadeSettled(OCCLUDER_FADE_ALPHA, true)).toBe(true);
    expect(occluderFadeSettled(OCCLUDER_FADE_ALPHA, false)).toBe(false);
    expect(occluderFadeSettled(0.5, true)).toBe(false);
    expect(occluderFadeSettled(0.5, false)).toBe(false);
  });
});

describe('occluderSegmentHitsBox', () => {
  // A 2x2 wall footprint at the origin, 5 units tall.
  const hits = (eye: [number, number, number], cam: [number, number, number], topY = 5): boolean =>
    occluderSegmentHitsBox(0, 0, 1, 1, topY, eye[0], eye[1], eye[2], cam[0], cam[1], cam[2]);

  it('hits when the segment crosses the footprint below the top', () => {
    expect(hits([-5, 2, 0], [5, 2, 0])).toBe(true);
    expect(hits([0, 2, -5], [0, 2, 5])).toBe(true);
  });

  it('misses when the segment passes beside or fully over the box', () => {
    expect(hits([-5, 2, 3], [5, 2, 3])).toBe(false);
    expect(hits([-5, 8, 0], [5, 8, 0])).toBe(false);
  });

  it('hits when either endpoint stands inside the footprint below the top', () => {
    expect(hits([0.5, 2, 0.5], [5, 2, 5])).toBe(true);
    expect(hits([5, 2, 5], [0.5, 2, 0.5])).toBe(true);
    expect(hits([0.5, 8, 0.5], [5, 8, 5])).toBe(false);
  });

  it('misses when the box sits behind the eye rather than between the endpoints', () => {
    expect(hits([3, 2, 0], [5, 2, 0])).toBe(false);
  });

  it('uses the height at the wall entry point, not the endpoints alone', () => {
    // Rising ray: enters the footprint above the top even though the eye is low.
    expect(hits([-2, 4.9, 0], [4, 11, 0])).toBe(false);
    // Descending ray: enters below the top.
    expect(hits([-2, 4.5, 0], [4, 2, 0])).toBe(true);
  });
});
