import { describe, expect, it } from 'vitest';
import {
  OCCLUDER_FADE_ALPHA,
  OCCLUDER_FADE_PREFETCH_YD,
  occluderFadeSettled,
  occluderKeepsInstances,
  occluderSegmentHitsBox,
  occluderSegmentHitsObb,
  stepOccluderFade,
  withinOccluderFadePrefetch,
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

describe('occluderSegmentHitsObb', () => {
  // A 2x2 footprint at the origin (hw=1, hd=1), unrotated, 5 units tall.
  const hits = (eye: [number, number, number], cam: [number, number, number], topY = 5): boolean =>
    occluderSegmentHitsObb(0, 0, 1, 1, 0, topY, eye[0], eye[1], eye[2], cam[0], cam[1], cam[2]);

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

  it('uses the height at the entry point, not the endpoints alone', () => {
    // Rising ray: enters the footprint above the top even though the eye is low.
    expect(hits([-5, 4.9, 0], [5, 11, 0])).toBe(false);
    // Descending ray, entry well clear of the eye-clearance guard: enters below the top.
    expect(hits([-3, 4.5, 0], [4, 2, 0])).toBe(true);
  });

  it('rotates the footprint with rot, three.js rotation.y convention', () => {
    // hw=1 (local x half-width), hd=2 (local z half-depth): unrotated, the
    // footprint spans world z in (-2, 2), so a segment at z=1.5 crosses it.
    const hitsAt = (rot: number): boolean =>
      occluderSegmentHitsObb(0, 0, 1, 2, rot, 5, -5, 2, 1.5, 5, 2, 1.5);
    expect(hitsAt(0)).toBe(true);
    // Rotated a quarter turn, the local axes swap: the footprint now spans
    // world z in (-1, 1), and z=1.5 falls outside it.
    expect(hitsAt(Math.PI / 2)).toBe(false);
  });

  it('suppresses a hit whose entry sits within the eye-clearance guard', () => {
    // A body standing pressed to the wall: the entry point is ~0.05 units
    // from the eye, well inside OCCLUDER_HIDE_EYE_CLEARANCE.
    const hitsFrom = (eyeX: number): boolean =>
      occluderSegmentHitsObb(0, 0, 1, 1, 0, 5, eyeX, 2, 0, 5, 2, 0);
    expect(hitsFrom(-1.05)).toBe(false);
    // Backed off a couple of units, the same approach hits normally.
    expect(hitsFrom(-3)).toBe(true);
  });
});

describe('occluder fade prefetch reach', () => {
  it('is the literal reach, inclusive at the boundary, on the XZ distance', () => {
    expect(OCCLUDER_FADE_PREFETCH_YD).toBe(60);
    expect(withinOccluderFadePrefetch(0, 0, 0, 59.9)).toBe(true);
    expect(withinOccluderFadePrefetch(0, 0, 0, 60)).toBe(true);
    expect(withinOccluderFadePrefetch(0, 0, 0, 60.1)).toBe(false);
    expect(withinOccluderFadePrefetch(60.1, 0, 0, 0)).toBe(false);
    // Both axes count: 50 on each is 70.7 apart.
    expect(withinOccluderFadePrefetch(50, 50, 0, 0)).toBe(false);
    expect(withinOccluderFadePrefetch(40, 40, 0, 0)).toBe(true);
    // Camera-relative, not origin-relative.
    expect(withinOccluderFadePrefetch(1000, 1000, 1010, 990)).toBe(true);
  });
});

describe('occluderKeepsInstances', () => {
  const pool = (ready: boolean, log: string[] = []) => ({
    allReady(parts: string): boolean {
      log.push(parts);
      return ready;
    },
  });

  it('keeps the instances unless the tree occludes AND its ghost programs are ready', () => {
    expect(occluderKeepsInstances(false, false, pool(true), 'p')).toBe(true);
    expect(occluderKeepsInstances(false, false, pool(false), 'p')).toBe(true);
    expect(occluderKeepsInstances(true, false, pool(false), 'p')).toBe(true);
    expect(occluderKeepsInstances(true, false, pool(true), 'p')).toBe(false);
    // Already ghosted: the fade owns the swap back, never this predicate.
    expect(occluderKeepsInstances(true, true, pool(true), 'p')).toBe(false);
    expect(occluderKeepsInstances(false, true, pool(true), 'p')).toBe(false);
    expect(occluderKeepsInstances(false, true, pool(false), 'p')).toBe(false);
  });

  it('consults the pool only for an occluding, not-yet-ghosted tree (a consult requests a compile)', () => {
    const log: string[] = [];
    const ghosts = pool(true, log);
    occluderKeepsInstances(false, false, ghosts, 'idle');
    occluderKeepsInstances(false, true, ghosts, 'ghosted-clear');
    occluderKeepsInstances(true, true, ghosts, 'ghosted-occluding');
    expect(log).toEqual([]);
    occluderKeepsInstances(true, false, ghosts, 'edge');
    expect(log).toEqual(['edge']);
  });
});
