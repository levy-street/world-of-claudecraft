import { describe, expect, it } from 'vitest';
import {
  fitDistance,
  hashHue,
  THUMB_FIT_MARGIN,
  THUMB_PITCH_RAD,
  THUMB_YAW_RAD,
  ThumbBook,
  thumbPose,
} from '../src/editor/asset_thumbs_core';

describe('fitDistance (bounding-sphere frustum fit)', () => {
  it('fits the vertical fov exactly at aspect >= 1 (vertical is the tight axis)', () => {
    const fov = 35;
    const d = fitDistance(2, fov, 4 / 3, 1);
    const vHalf = (fov * Math.PI) / 360;
    // At distance d the sphere subtends exactly the half-angle: r = d * sin(vHalf).
    expect(d * Math.sin(vHalf)).toBeCloseTo(2, 10);
  });

  it('uses the narrower horizontal fov for portrait aspects', () => {
    const fov = 35;
    const landscape = fitDistance(2, fov, 4 / 3, 1);
    const portrait = fitDistance(2, fov, 0.5, 1);
    // A narrow frame must back the camera off further than a wide one.
    expect(portrait).toBeGreaterThan(landscape);
    const hHalf = Math.atan(Math.tan((fov * Math.PI) / 360) * 0.5);
    expect(portrait * Math.sin(hHalf)).toBeCloseTo(2, 10);
  });

  it('scales linearly with radius and applies the margin', () => {
    const base = fitDistance(1, 35, 4 / 3, 1);
    expect(fitDistance(3, 35, 4 / 3, 1)).toBeCloseTo(base * 3, 10);
    expect(fitDistance(1, 35, 4 / 3, 1.15)).toBeCloseTo(base * 1.15, 10);
    expect(THUMB_FIT_MARGIN).toBeGreaterThan(1);
  });

  it('clamps degenerate radii (zero, negative, NaN) to a sane minimum', () => {
    const min = fitDistance(0, 35, 4 / 3);
    expect(min).toBeGreaterThan(0);
    expect(Number.isFinite(min)).toBe(true);
    expect(fitDistance(-5, 35, 4 / 3)).toBe(min);
    expect(fitDistance(Number.NaN, 35, 4 / 3)).toBe(min);
  });
});

describe('thumbPose (3/4 top-down framing)', () => {
  it('looks at the bbox center from above the horizon at fit distance', () => {
    const center = { x: 3, y: 1, z: -2 };
    const pose = thumbPose(center, 2, 35, 4 / 3);
    expect(pose.target).toEqual(center);
    const dx = pose.position.x - center.x;
    const dy = pose.position.y - center.y;
    const dz = pose.position.z - center.z;
    const dist = Math.hypot(dx, dy, dz);
    expect(dist).toBeCloseTo(fitDistance(2, 35, 4 / 3), 10);
    // Above the horizon by the pitch angle, yawed off the +Z front.
    expect(dy / dist).toBeCloseTo(Math.sin(THUMB_PITCH_RAD), 10);
    expect(Math.atan2(dx, dz)).toBeCloseTo(THUMB_YAW_RAD, 10);
    expect(dy).toBeGreaterThan(0);
  });

  it('returns a fresh target object (no aliasing of the caller center)', () => {
    const center = { x: 0, y: 0, z: 0 };
    const pose = thumbPose(center, 1, 35, 1);
    expect(pose.target).not.toBe(center);
  });
});

describe('hashHue', () => {
  it('is deterministic and in [0, 360)', () => {
    for (const id of ['props/well', 'user/abc', '', 'foliage/tree_pine_a']) {
      const hue = hashHue(id);
      expect(hue).toBe(hashHue(id));
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });
});

describe('ThumbBook (cache + queue bookkeeping)', () => {
  it('caches values and evicts the oldest entry past the cap (FIFO)', () => {
    const book = new ThumbBook<string>(2, 2);
    book.put('a', 'A');
    book.put('b', 'B');
    book.put('c', 'C');
    expect(book.get('a')).toBeUndefined();
    expect(book.get('b')).toBe('B');
    expect(book.get('c')).toBe('C');
    expect(book.size).toBe(2);
  });

  it('re-putting an existing id does not evict a neighbor', () => {
    const book = new ThumbBook<string>(2, 2);
    book.put('a', 'A');
    book.put('b', 'B');
    book.put('a', 'A2');
    expect(book.get('a')).toBe('A2');
    expect(book.get('b')).toBe('B');
  });

  it('enqueue dedupes queued, in-flight, cached, and failed ids', () => {
    const book = new ThumbBook<string>(10, 2);
    expect(book.enqueue('a')).toBe(true);
    expect(book.enqueue('a')).toBe(false); // already queued
    expect(book.takeNext(() => true)).toBe('a');
    expect(book.enqueue('a')).toBe(false); // in flight
    book.settle('a');
    book.put('a', 'A');
    expect(book.enqueue('a')).toBe(false); // cached
    book.markFailed('b');
    expect(book.enqueue('b')).toBe(false); // failed: no retry storm
    expect(book.pendingCount).toBe(0);
  });

  it('takeNext skips stale entries cheaply and preserves FIFO order', () => {
    const book = new ThumbBook<string>(10, 3);
    book.enqueue('a');
    book.enqueue('b');
    book.enqueue('c');
    const wanted = new Set(['b', 'c']);
    expect(book.takeNext((id) => wanted.has(id))).toBe('b'); // a skipped
    expect(book.takeNext((id) => wanted.has(id))).toBe('c');
    expect(book.takeNext((id) => wanted.has(id))).toBeNull();
    // A skipped id can be re-queued later (it was never marked failed).
    expect(book.enqueue('a')).toBe(true);
    expect(book.takeNext(() => true)).toBe('a');
  });

  it('takeNext skips ids that resolved or failed while queued', () => {
    const book = new ThumbBook<string>(10, 3);
    book.enqueue('done');
    book.enqueue('broken');
    book.enqueue('live');
    book.put('done', 'D');
    book.markFailed('broken');
    expect(book.takeNext(() => true)).toBe('live');
    expect(book.takeNext(() => true)).toBeNull();
  });

  it('canStart enforces the concurrency cap until settle()', () => {
    const book = new ThumbBook<string>(10, 2);
    book.enqueue('a');
    book.enqueue('b');
    book.enqueue('c');
    expect(book.canStart()).toBe(true);
    book.takeNext(() => true);
    expect(book.canStart()).toBe(true);
    book.takeNext(() => true);
    expect(book.canStart()).toBe(false);
    expect(book.inFlightCount).toBe(2);
    book.settle('a');
    expect(book.canStart()).toBe(true);
    expect(book.takeNext(() => true)).toBe('c');
  });

  it('clearPending drops all queued work (dead GL context)', () => {
    const book = new ThumbBook<string>(10, 2);
    book.enqueue('a');
    book.enqueue('b');
    book.clearPending();
    expect(book.pendingCount).toBe(0);
    expect(book.takeNext(() => true)).toBeNull();
    // The ids were not failed: a fresh session-level decision could re-queue.
    expect(book.enqueue('a')).toBe(true);
  });
});
