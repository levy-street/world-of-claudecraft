import { describe, expect, it } from 'vitest';
import {
  BLOCKER_ERASE_THRESHOLD,
  nearestBlockerIndex,
  pointSegmentDistance,
} from '../src/editor/blocker_core';
import { effectiveCollideRadius, placementsToPlayAssets } from '../src/editor/custom_map';
import {
  clampBlockerSegment,
  collideRadiusFor,
  MAX_BLOCKER_LENGTH,
  MIN_BLOCKER_LENGTH,
} from '../src/sim/map_doc';
import type { BlockerDef } from '../src/sim/types';

// The pure blocker/collision helpers behind the editor's blocker tool and the
// per-placement radius override: segment length clamping (shared with the
// sanitizer), the erase nearest-segment hit test, and the ONE effective-radius
// resolution both the footprint rings and the playtest colliders read.

describe('clampBlockerSegment', () => {
  it('drops a segment shorter than the minimum length', () => {
    expect(clampBlockerSegment(0, 0, 0.3, 0)).toBeNull();
    expect(clampBlockerSegment(5, 5, 5, 5)).toBeNull();
  });

  it('keeps an in-range segment unchanged', () => {
    expect(clampBlockerSegment(1, 2, 11, 2)).toEqual({ x1: 1, z1: 2, x2: 11, z2: 2 });
  });

  it('keeps a segment exactly at the minimum', () => {
    expect(clampBlockerSegment(0, 0, MIN_BLOCKER_LENGTH, 0)).toEqual({
      x1: 0,
      z1: 0,
      x2: MIN_BLOCKER_LENGTH,
      z2: 0,
    });
  });

  it('truncates the far end of an over-long segment toward the anchor', () => {
    const seg = clampBlockerSegment(0, 0, 500, 0);
    expect(seg).toEqual({ x1: 0, z1: 0, x2: MAX_BLOCKER_LENGTH, z2: 0 });
    const diag = clampBlockerSegment(0, 0, 300, 400); // length 500 at 3-4-5
    expect(diag?.x1).toBe(0);
    expect(diag?.z1).toBe(0);
    const len = Math.hypot((diag?.x2 ?? 0) - 0, (diag?.z2 ?? 0) - 0);
    expect(len).toBeCloseTo(MAX_BLOCKER_LENGTH, 6);
    // Direction preserved: still along (3, 4).
    expect((diag?.z2 ?? 0) / (diag?.x2 ?? 1)).toBeCloseTo(4 / 3, 6);
  });
});

describe('pointSegmentDistance', () => {
  it('measures perpendicular distance inside the segment span', () => {
    expect(pointSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 6);
  });

  it('measures to the nearest endpoint beyond the span', () => {
    expect(pointSegmentDistance(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5, 6);
    expect(pointSegmentDistance(13, -4, 0, 0, 10, 0)).toBeCloseTo(5, 6);
  });

  it('degenerates to point distance for a zero-length segment', () => {
    expect(pointSegmentDistance(3, 4, 1, 1, 1, 1)).toBeCloseTo(Math.hypot(2, 3), 6);
  });
});

describe('nearestBlockerIndex', () => {
  const blockers: BlockerDef[] = [
    { x1: 0, z1: 0, x2: 10, z2: 0 },
    { x1: 0, z1: 5, x2: 10, z2: 5 },
  ];

  it('picks the nearest segment within the threshold', () => {
    expect(nearestBlockerIndex(blockers, 5, 1)).toBe(0);
    expect(nearestBlockerIndex(blockers, 5, 4.2)).toBe(1);
  });

  it('returns -1 when nothing is within the threshold', () => {
    expect(nearestBlockerIndex(blockers, 5, 2.5)).toBe(-1); // midway, both > 2yd away
    expect(nearestBlockerIndex([], 0, 0)).toBe(-1);
    expect(BLOCKER_ERASE_THRESHOLD).toBe(2);
  });

  it('honours an explicit threshold', () => {
    expect(nearestBlockerIndex(blockers, 5, 2.4, 3)).toBe(0);
  });
});

describe('effectiveCollideRadius', () => {
  it('prefers the override and falls back to the derived radius', () => {
    expect(effectiveCollideRadius({ scale: 2, collideRadius: 5 })).toBe(5);
    expect(effectiveCollideRadius({ scale: 2 })).toBe(collideRadiusFor(2));
  });

  it('flows into the playtest PlacedAssets (both paths read the same record)', () => {
    const base = { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 2, collide: true };
    const [derived, overridden] = placementsToPlayAssets([
      { ...base },
      { ...base, collideRadius: 7.5 },
    ]);
    expect(derived.collideRadius).toBe(collideRadiusFor(2));
    expect(overridden.collideRadius).toBe(7.5);
    // A non-colliding placement carries no radius, override or not.
    const [walkThrough] = placementsToPlayAssets([{ ...base, collide: false, collideRadius: 7.5 }]);
    expect(walkThrough.collideRadius).toBeUndefined();
  });
});
