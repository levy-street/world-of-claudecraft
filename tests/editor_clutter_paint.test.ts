// Paint Clutter brush stroke logic (editor/clutter_paint_core.ts): stamps land
// every half radius, freeze the brush settings, dedupe inside same-brush
// cover, erase lifts whole stamps, and the document cap stops the stroke.

import { describe, expect, it } from 'vitest';
import {
  applyClutterBrush,
  type ClutterBrush,
  clutterStampDue,
  DEFAULT_CLUTTER_BRUSH,
  makeClutterStamp,
} from '../src/editor/clutter_paint_core';
import { CLUTTER_ALL_KINDS, type ClutterStamp, MAX_CLUTTER_STAMPS } from '../src/sim/city_clutter';

const brush = (over: Partial<ClutterBrush> = {}): ClutterBrush => ({
  ...DEFAULT_CLUTTER_BRUSH,
  ...over,
});

describe('Paint Clutter brush', () => {
  it('lays a stamp every half radius along a drag', () => {
    expect(clutterStampDue(null, 0, 0, 6)).toBe(true);
    expect(clutterStampDue({ x: 0, z: 0 }, 2.9, 0, 6)).toBe(false);
    expect(clutterStampDue({ x: 0, z: 0 }, 3, 0, 6)).toBe(true);
  });

  it('freezes the brush settings into the stamp, clamped and rounded', () => {
    const s = makeClutterStamp(
      brush({ density: 30, minScale: 3, maxScale: 0.5, clumps: -2, kinds: 0 }),
      1.234,
      5.678,
      7.26,
      42,
    );
    expect(s).toEqual({
      x: 1.23,
      z: 5.68,
      r: 7.3,
      kinds: CLUTTER_ALL_KINDS,
      density: 10,
      minScale: 0.5,
      maxScale: 3,
      clumps: 0,
      seed: 42,
    });
  });

  it('adds, dedupes, and erases through one brush event', () => {
    let stamps: readonly ClutterStamp[] = [];
    let r = applyClutterBrush(stamps, brush(), 0, 0, 6, 1);
    expect(r.stamps).toHaveLength(1);
    stamps = r.stamps;
    // a same-brush stamp wholly inside the first: nothing changes (same array)
    r = applyClutterBrush(stamps, brush(), 1, 0, 3, 2);
    expect(r.stamps).toBe(stamps);
    // a different brush in the same place is its own stamp
    r = applyClutterBrush(stamps, brush({ clumps: 5 }), 1, 0, 3, 3);
    expect(r.stamps).toHaveLength(2);
    stamps = r.stamps;
    // erase lifts the stamps under the brush
    r = applyClutterBrush(stamps, brush({ erase: true }), 0.5, 0, 2, 4);
    expect(r.stamps).toHaveLength(0);
    expect(r.capped).toBe(false);
  });

  it('stops at the document cap and says so', () => {
    const full: ClutterStamp[] = Array.from({ length: MAX_CLUTTER_STAMPS }, (_, i) =>
      makeClutterStamp(brush(), i * 100, 0, 1, i),
    );
    const r = applyClutterBrush(full, brush(), 5, 5, 1, 9);
    expect(r.capped).toBe(true);
    expect(r.stamps).toBe(full);
    // erasing still works when full
    expect(applyClutterBrush(full, brush({ erase: true }), 0, 0, 2, 9).stamps).toHaveLength(
      MAX_CLUTTER_STAMPS - 1,
    );
  });
});
