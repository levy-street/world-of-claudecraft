// The proc overlay's drag persistence (pure half): viewport-fraction clamping
// and the localStorage round-trip parsing. The DOM attacher is the thin
// consumer (src/ui/proc_overlay_drag.ts).
import { describe, expect, it } from 'vitest';
import {
  clampOverlayAnchor,
  nudgeOverlayAnchor,
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

  it('keeps the whole element clear of asymmetric mobile safe areas', () => {
    const safeArea = { top: 0, right: 44, bottom: 21, left: 12 };
    const bottomLeft = clampOverlayAnchor(0, 1, 72, 72, 844, 390, safeArea);
    expect(bottomLeft.fx).toBeCloseTo((12 + 36) / 844);
    expect(bottomLeft.fy).toBeCloseTo((390 - 21 - 36) / 390);
    const topRight = clampOverlayAnchor(1, 0, 72, 72, 844, 390, safeArea);
    expect(topRight.fx).toBeCloseTo((844 - 44 - 36) / 844);
    expect(topRight.fy).toBeCloseTo(36 / 390);
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    const a = clampOverlayAnchor(Number.NaN, 0.5, 300, 232, 0, 0);
    expect(a.fx).toBe(0.5);
    expect(Number.isFinite(a.fy)).toBe(true);
  });
});

describe('nudgeOverlayAnchor', () => {
  it('moves one keyboard step in every arrow direction', () => {
    const start = { fx: 0.5, fy: 0.5 };
    expect(nudgeOverlayAnchor(start, 'ArrowLeft', 10, 300, 232, 1000, 800)).toEqual({
      fx: 0.49,
      fy: 0.5,
    });
    expect(nudgeOverlayAnchor(start, 'ArrowRight', 10, 300, 232, 1000, 800)).toEqual({
      fx: 0.51,
      fy: 0.5,
    });
    expect(nudgeOverlayAnchor(start, 'ArrowUp', 10, 300, 232, 1000, 800)).toEqual({
      fx: 0.5,
      fy: 0.4875,
    });
    expect(nudgeOverlayAnchor(start, 'ArrowDown', 10, 300, 232, 1000, 800)).toEqual({
      fx: 0.5,
      fy: 0.5125,
    });
    expect(nudgeOverlayAnchor(start, 'Enter', 10, 300, 232, 1000, 800)).toBeNull();
  });

  it('keeps keyboard movement inside the viewport', () => {
    expect(nudgeOverlayAnchor({ fx: 0, fy: 0 }, 'ArrowLeft', 10, 300, 232, 1000, 800)).toEqual({
      fx: 0.15,
      fy: 0.145,
    });
  });

  it('clamps a nudge into an inset region, mirroring the pointer-drop clamp', () => {
    // attachOverlayDrag's pointer-drop path (`apply`) already passes safeArea()
    // to clampOverlayAnchor; the keyboard path must clamp against the same
    // inset, not the bare viewport edge, or an arrow-key move can park the
    // overlay under a notch/home-indicator safe-area cutout (#pr3050).
    const safeArea = { top: 0, right: 44, bottom: 21, left: 12 };
    const nudgedLeft = nudgeOverlayAnchor(
      { fx: 0.1, fy: 0.5 },
      'ArrowLeft',
      500,
      72,
      72,
      844,
      390,
      safeArea,
    );
    expect(nudgedLeft?.fx).toBeCloseTo((12 + 36) / 844);
    const nudgedRight = nudgeOverlayAnchor(
      { fx: 0.9, fy: 0.5 },
      'ArrowRight',
      500,
      72,
      72,
      844,
      390,
      safeArea,
    );
    expect(nudgedRight?.fx).toBeCloseTo((844 - 44 - 36) / 844);
  });

  it('defaults to no safe area when the caller omits one', () => {
    // Backward compatible with every pre-existing call above (none pass a
    // safeArea argument): the pure function still behaves exactly like the
    // bare-viewport clamp when there is nothing to avoid.
    expect(nudgeOverlayAnchor({ fx: 0, fy: 0 }, 'ArrowLeft', 10, 300, 232, 1000, 800)).toEqual(
      nudgeOverlayAnchor({ fx: 0, fy: 0 }, 'ArrowLeft', 10, 300, 232, 1000, 800, {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    );
  });
});
