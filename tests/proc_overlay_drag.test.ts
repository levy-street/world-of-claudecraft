// The proc overlay's drag persistence (pure half): viewport-fraction clamping
// and the localStorage round-trip parsing. The DOM attacher is the thin
// consumer (src/ui/proc_overlay_drag.ts).
import { describe, expect, it } from 'vitest';
import {
  clampOverlayAnchor,
  parseOverlayAnchor,
  serializeOverlayAnchor,
} from '../src/ui/proc_overlay_drag';

describe('clampOverlayAnchor', () => {
  it('keeps the whole element on screen', () => {
    // 300x232 element in a 1600x900 viewport: half-width = 150/1600.
    expect(clampOverlayAnchor(0, 0, 300, 232, 1600, 900)).toEqual({
      fx: 150 / 1600,
      fy: 116 / 900,
    });
    expect(clampOverlayAnchor(1, 1, 300, 232, 1600, 900)).toEqual({
      fx: 1 - 150 / 1600,
      fy: 1 - 116 / 900,
    });
  });

  it('passes an in-bounds anchor through unchanged', () => {
    expect(clampOverlayAnchor(0.5, 0.42, 300, 232, 1600, 900)).toEqual({ fx: 0.5, fy: 0.42 });
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    const a = clampOverlayAnchor(Number.NaN, 0.5, 300, 232, 0, 0);
    expect(a.fx).toBe(0.5);
    expect(Number.isFinite(a.fy)).toBe(true);
  });
});

describe('parse / serialize round-trip', () => {
  it('round-trips a stored anchor', () => {
    const a = { fx: 0.31, fy: 0.77 };
    expect(parseOverlayAnchor(serializeOverlayAnchor(a))).toEqual(a);
  });

  it('rejects garbage and out-of-band values', () => {
    expect(parseOverlayAnchor(null)).toBeNull();
    expect(parseOverlayAnchor('not json')).toBeNull();
    expect(parseOverlayAnchor('{"fx":"a","fy":0.5}')).toBeNull();
    expect(parseOverlayAnchor('{"fx":null,"fy":0.5}')).toBeNull();
    // A finite but out-of-range stored value is clamped into 0..1.
    expect(parseOverlayAnchor('{"fx":7,"fy":-3}')).toEqual({ fx: 1, fy: 0 });
  });
});
