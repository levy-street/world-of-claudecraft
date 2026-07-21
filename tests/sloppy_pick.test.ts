import { describe, expect, it } from 'vitest';
import { distanceToSegmentPx, nearestSloppyPickId } from '../src/render/sloppy_pick';

// Bug: clicking a party member's nameplate (the floating name above the head)
// did not select the unit. The forgiving "sloppy pick" only measured distance to
// the body MIDPOINT, but the nameplate floats well above the head, so name clicks
// fell outside the radius and missed. Anchoring the pick to the whole column from
// body midpoint up to the nameplate makes clicking the name register.
describe('distanceToSegmentPx', () => {
  it('is zero on the segment endpoints', () => {
    expect(distanceToSegmentPx(0, 0, 0, 0, 0, 10)).toBe(0);
    expect(distanceToSegmentPx(0, 10, 0, 0, 0, 10)).toBe(0);
  });

  it('measures perpendicular distance to the column, not the nearest endpoint', () => {
    // a point beside the middle of a vertical segment
    expect(distanceToSegmentPx(5, 5, 0, 0, 0, 10)).toBe(5);
  });

  it('clamps past the ends to the endpoint distance', () => {
    // above the top endpoint: distance is to the top, not an infinite line
    expect(distanceToSegmentPx(0, 14, 0, 0, 0, 10)).toBe(4);
  });

  it('degenerates to point distance when both anchors coincide', () => {
    expect(distanceToSegmentPx(3, 4, 2, 2, 2, 2)).toBeCloseTo(Math.hypot(1, 2), 6);
  });
});

describe('nearestSloppyPickId', () => {
  const mid = { midX: 100, midY: 200, topX: 100, topY: 140 }; // column from y=140 (name) to y=200 (body)

  it('selects a unit when clicking near its nameplate, well above the body', () => {
    // click at the name height (y=140); body midpoint is 60px below at y=200
    const id = nearestSloppyPickId(105, 140, [{ id: 7, ...mid }], 26);
    expect(id).toBe(7);
  });

  it('still selects when clicking the body midpoint', () => {
    expect(nearestSloppyPickId(100, 200, [{ id: 7, ...mid }], 26)).toBe(7);
  });

  it('returns null when the click is outside the radius of the whole column', () => {
    expect(nearestSloppyPickId(140, 140, [{ id: 7, ...mid }], 26)).toBeNull();
  });

  it('picks the nearest column among several overlapping units', () => {
    const a = { id: 1, midX: 100, midY: 200, topX: 100, topY: 140 };
    const b = { id: 2, midX: 118, midY: 200, topX: 118, topY: 140 };
    expect(nearestSloppyPickId(112, 150, [a, b], 26)).toBe(2);
  });

  it('collapses to point distance when the top anchor equals the mid (guard fallback)', () => {
    // The renderer collapses the column to the body point when the nameplate
    // anchor is behind the camera; the pick then behaves like the old body-only
    // radius rather than trusting a bogus projected top.
    const c = { id: 9, midX: 100, midY: 200, topX: 100, topY: 200 };
    expect(nearestSloppyPickId(100, 170, [c], 26)).toBeNull(); // 30px up, no column reach
    expect(nearestSloppyPickId(100, 178, [c], 26)).toBe(9); // within 26px of the point
  });

  it('uses a strict radius: a click exactly at the threshold is rejected', () => {
    expect(nearestSloppyPickId(126, 140, [{ id: 7, ...mid }], 26)).toBeNull();
    expect(nearestSloppyPickId(125, 140, [{ id: 7, ...mid }], 26)).toBe(7);
  });
});
