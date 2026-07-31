import { describe, expect, it } from 'vitest';
import { tooltipPlacement } from '../../src/admin/tooltip_placement';

const viewport = { width: 1440, height: 900 };

describe('tooltip placement', () => {
  it('opens below the anchor and right-aligns on it when there is room', () => {
    const placement = tooltipPlacement({ top: 200, bottom: 220, right: 1200 }, viewport);
    expect(placement).toEqual({ side: 'below', right: 240, offset: 227, arrowRight: 14 });
  });

  it('flips above the anchor when the viewport bottom is close', () => {
    // 40px of room below cannot hold the details list, so the tooltip opens upward
    // anchored on the row top instead of hanging off the bottom edge.
    const placement = tooltipPlacement({ top: 840, bottom: 860, right: 1200 }, viewport);
    expect(placement.side).toBe('above');
    expect(placement.offset).toBe(viewport.height - 840 + 7);
  });

  it('keeps the tooltip inside both viewport edges', () => {
    // An anchor at the very right edge: the tooltip still leaves a margin.
    expect(tooltipPlacement({ top: 10, bottom: 30, right: 1440 }, viewport).right).toBe(8);
    // An anchor near the left edge: right-aligning would push the tooltip off screen,
    // so it is pulled back to the widest offset that still fits its min-width.
    expect(tooltipPlacement({ top: 10, bottom: 30, right: 40 }, viewport).right).toBe(
      1440 - 210 - 8,
    );
  });

  it('still returns an on-screen offset on a viewport narrower than the tooltip', () => {
    const narrow = { width: 180, height: 700 };
    expect(tooltipPlacement({ top: 10, bottom: 30, right: 170 }, narrow).right).toBe(8);
  });

  it('walks the arrow back so a clamped tooltip still points at its anchor', () => {
    // The left-edge guard pulls the tooltip 178px right of where the anchor would put
    // it, so the arrow moves the same 178px left of its resting inset and lands 14px
    // inside the anchor's right edge, exactly where it sits when nothing is clamped.
    const anchor = { top: 10, bottom: 30, right: 40 };
    const placement = tooltipPlacement(anchor, viewport);
    expect(placement.right).toBe(1222);
    expect(placement.arrowRight).toBe(192);
    const tooltipRightEdge = viewport.width - placement.right;
    expect(tooltipRightEdge - placement.arrowRight).toBe(anchor.right - 14);
  });

  it('keeps the arrow inside the tooltip when the anchor sits past either edge', () => {
    // Hard against the right edge: the 8px margin would put the arrow 6px in, which
    // would clip the rounded corner, so it stops at the arrow's own width.
    expect(tooltipPlacement({ top: 10, bottom: 30, right: 1440 }, viewport).arrowRight).toBe(8);
    // Hard against the left edge: the arrow stops short of the far side of a tooltip
    // rendered at its 210px min-width instead of running out of the box.
    expect(tooltipPlacement({ top: 10, bottom: 30, right: 0 }, viewport).arrowRight).toBe(194);
  });
});
