import { describe, expect, it } from 'vitest';
import {
  anchorAdjustedPos,
  anchorAxis,
  boxFromEdgeDrag,
  clampFrameScale,
  clampTargetFramePos,
  cursorForFrameEdge,
  edgeBandFor,
  FRAME_EDGE_BAND,
  FRAME_LABEL_CLEARANCE,
  FRAME_SCALE_KEY_FINE_STEP,
  FRAME_SCALE_KEY_STEP,
  FRAME_SCALE_MAX,
  FRAME_SCALE_MIN,
  FRAME_SNAP_GRID,
  type FrameEdge,
  frameEdgeAtPoint,
  frameScales,
  labelBelowFrame,
  MAX_FRAME_BOX,
  MIN_FRAME_BOX,
  parseTargetFramePos,
  placeTargetFrame,
  posFromEdgeResize,
  scaleFromGripDrag,
  scaleFromKeyStep,
  serializeTargetFramePos,
  sizeFromEdgeDrag,
  snapFrameCoord,
  snapFrameSize,
  snapScaleToGrid,
  stepCoordToGridLine,
  TARGET_FRAME_MARGIN,
} from '../src/ui/target_frame_pos';

const viewport = { w: 1000, h: 800 };
const size = { w: 220, h: 92 };

// One literal pin per exported constant. The behavioral suites below express
// their expectations in terms of these constants on purpose (they hold the
// RELATIONSHIPS), which also means an accidental constant edit would move the
// expectation with it and never fail; these pins are what makes such an edit
// visible. Change a value here only when the change is intentional.
describe('exported constants (literal pins)', () => {
  it('pins the persisted-band and geometry constants to their shipped values', () => {
    expect(TARGET_FRAME_MARGIN).toBe(8);
    expect(MIN_FRAME_BOX).toBe(24);
    expect(MAX_FRAME_BOX).toBe(4096);
    expect(FRAME_SCALE_MIN).toBe(0.4);
    expect(FRAME_SCALE_MAX).toBe(2);
    expect(FRAME_SCALE_KEY_STEP).toBe(0.05);
    expect(FRAME_SCALE_KEY_FINE_STEP).toBe(0.01);
    expect(FRAME_EDGE_BAND).toBe(8);
    expect(FRAME_LABEL_CLEARANCE).toBe(22);
    expect(FRAME_SNAP_GRID).toBe(16);
  });
});

describe('snapFrameCoord', () => {
  it('rounds onto the arrange-mode grid, both directions', () => {
    expect(snapFrameCoord(0)).toBe(0);
    expect(snapFrameCoord(7)).toBe(0);
    expect(snapFrameCoord(8)).toBe(16);
    expect(snapFrameCoord(23)).toBe(16);
    expect(snapFrameCoord(24)).toBe(32);
    expect(snapFrameCoord(-9)).toBe(-16);
  });

  it('honors an explicit grid and refuses degenerate inputs', () => {
    expect(snapFrameCoord(13, 10)).toBe(10);
    expect(snapFrameCoord(13, 0)).toBe(13);
    expect(snapFrameCoord(Number.NaN)).toBeNaN();
  });
});

describe('snapFrameSize', () => {
  it('quantizes a size onto the pitch with a one-cell floor', () => {
    expect(snapFrameSize(649)).toBe(656);
    expect(snapFrameSize(23)).toBe(16);
    // A resize can never snap a frame to nothing.
    expect(snapFrameSize(3)).toBe(16);
    expect(snapFrameSize(0)).toBe(16);
    expect(snapFrameSize(Number.NaN)).toBeNaN();
  });
});

describe('stepCoordToGridLine', () => {
  it('steps to the next grid line in the pressed direction', () => {
    expect(stepCoordToGridLine(105, 1)).toBe(112);
    expect(stepCoordToGridLine(105, -1)).toBe(96);
    // A value already on a line moves one full cell, so repeated presses
    // keep walking instead of sticking.
    expect(stepCoordToGridLine(112, 1)).toBe(128);
    expect(stepCoordToGridLine(112, -1)).toBe(96);
    expect(stepCoordToGridLine(8, -1)).toBe(0);
  });

  it('honors an explicit grid and refuses degenerate inputs', () => {
    expect(stepCoordToGridLine(13, 1, 10)).toBe(20);
    expect(stepCoordToGridLine(13, 1, 0)).toBe(13);
    expect(stepCoordToGridLine(Number.NaN, 1)).toBeNaN();
  });
});

describe('snapScaleToGrid', () => {
  it('returns the scale whose visual extent lands on the grid', () => {
    // 612 visual at scale 1: a candidate 1.0604 (visual 649) snaps to 656.
    expect(snapScaleToGrid(612, 1, 649 / 612) * 612).toBeCloseTo(656, 9);
    // Under a pre-existing zoom the unscaled base divides back out first.
    expect(snapScaleToGrid(765, 1.25, 1.3) * 612).toBeCloseTo(snapFrameSize(612 * 1.3), 9);
  });

  it('passes degenerate starts through unchanged', () => {
    expect(snapScaleToGrid(0, 1, 1.2)).toBe(1.2);
    expect(snapScaleToGrid(612, 0, 1.2)).toBe(1.2);
    expect(snapScaleToGrid(612, 1, Number.NaN)).toBeNaN();
  });
});

describe('clampTargetFramePos', () => {
  it('leaves an in-bounds position untouched', () => {
    expect(clampTargetFramePos({ left: 300, top: 200 }, viewport, size)).toEqual({
      left: 300,
      top: 200,
    });
  });

  it('clamps a negative position to the top-left margin', () => {
    expect(clampTargetFramePos({ left: -50, top: -50 }, viewport, size)).toEqual({
      left: TARGET_FRAME_MARGIN,
      top: TARGET_FRAME_MARGIN,
    });
  });

  it('keeps the whole frame on-screen at the bottom-right', () => {
    const clamped = clampTargetFramePos({ left: 9999, top: 9999 }, viewport, size);
    expect(clamped.left).toBe(viewport.w - size.w - TARGET_FRAME_MARGIN);
    expect(clamped.top).toBe(viewport.h - size.h - TARGET_FRAME_MARGIN);
  });

  it('falls back to the margin when the viewport is too small for the frame', () => {
    const clamped = clampTargetFramePos({ left: 500, top: 500 }, { w: 100, h: 60 }, size);
    expect(clamped).toEqual({ left: TARGET_FRAME_MARGIN, top: TARGET_FRAME_MARGIN });
  });
});

describe('placeTargetFrame (UI Scale compensation)', () => {
  // The frame lives inside #ui, which carries `zoom: var(--ui-scale)`. Pointer /
  // rect coordinates are post-zoom (visual), but style.left/top are author lengths
  // the browser re-multiplies by the zoom, so the css write is visual / scale.
  it('at scale 1 the css write equals the clamped visual position', () => {
    const p = placeTargetFrame({ left: 300, top: 200 }, viewport, size, 1);
    expect(p.pos).toEqual({ left: 300, top: 200 });
    expect(p.css).toEqual({ left: 300, top: 200 });
  });

  it('divides the css write by the scale while persisting the visual position', () => {
    for (const scale of [0.8, 1.25, 1.4]) {
      const p = placeTargetFrame({ left: 400, top: 240 }, viewport, size, scale);
      // Persisted (pos) stays in visual space: identical across every scale.
      expect(p.pos).toEqual({ left: 400, top: 240 });
      // css is the author length the #ui zoom re-multiplies back to the visual spot.
      expect(p.css.left).toBeCloseTo(400 / scale, 9);
      expect(p.css.top).toBeCloseTo(240 / scale, 9);
      // Round-trip: css written to style.left, times the zoom, lands under the cursor.
      expect(p.css.left * scale).toBeCloseTo(400, 9);
      expect(p.css.top * scale).toBeCloseTo(240, 9);
    }
  });

  it('dragging N visual px moves the css write by N / scale (1:1 cursor tracking)', () => {
    const scale = 1.25;
    const before = placeTargetFrame({ left: 400, top: 240 }, viewport, size, scale);
    const after = placeTargetFrame({ left: 500, top: 300 }, viewport, size, scale);
    expect(after.pos.left - before.pos.left).toBe(100); // visual delta unchanged
    expect(after.css.left - before.css.left).toBeCloseTo(100 / scale, 9);
    expect(after.css.top - before.css.top).toBeCloseTo(60 / scale, 9);
  });

  it('clamps the whole frame on screen in visual space before dividing', () => {
    const scale = 1.25;
    const p = placeTargetFrame({ left: 9999, top: 9999 }, viewport, size, scale);
    // The clamp keeps the visual box inside the viewport margin ...
    expect(p.pos.left).toBe(viewport.w - size.w - TARGET_FRAME_MARGIN);
    expect(p.pos.top).toBe(viewport.h - size.h - TARGET_FRAME_MARGIN);
    // ... and the css write is that clamped visual position divided by the scale.
    expect(p.css.left).toBeCloseTo(p.pos.left / scale, 9);
    expect(p.css.top).toBeCloseTo(p.pos.top / scale, 9);
  });

  it('treats a non-positive / non-finite scale as 1 (never blanks the frame)', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = placeTargetFrame({ left: 120, top: 90 }, viewport, size, bad);
      expect(p.css).toEqual({ left: 120, top: 90 });
    }
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips a position', () => {
    const pos = { left: 123, top: 456 };
    expect(parseTargetFramePos(serializeTargetFramePos(pos))).toEqual(pos);
  });

  it('returns null for missing / empty input', () => {
    expect(parseTargetFramePos(null)).toBeNull();
    expect(parseTargetFramePos(undefined)).toBeNull();
    expect(parseTargetFramePos('')).toBeNull();
  });

  it('returns null for corrupt or non-finite data', () => {
    expect(parseTargetFramePos('not json')).toBeNull();
    expect(parseTargetFramePos('{"left":1}')).toBeNull();
    expect(parseTargetFramePos('{"left":"x","top":2}')).toBeNull();
    expect(parseTargetFramePos('{"left":null,"top":2}')).toBeNull();
    expect(parseTargetFramePos(JSON.stringify({ left: Infinity, top: 2 }))).toBeNull();
    expect(parseTargetFramePos(JSON.stringify({ left: Number.NaN, top: 2 }))).toBeNull();
  });

  it('omits `scale` entirely for a move-only frame, so the stored payload is unchanged', () => {
    expect(serializeTargetFramePos({ left: 123, top: 456 })).toBe('{"left":123,"top":456}');
    expect(parseTargetFramePos('{"left":123,"top":456}')).toEqual({ left: 123, top: 456 });
  });

  it('round-trips a scaled frame and clamps a saved multiplier into the legal band', () => {
    const scaled = { left: 40, top: 60, scale: 1.5 };
    expect(parseTargetFramePos(serializeTargetFramePos(scaled))).toEqual(scaled);
    expect(parseTargetFramePos(JSON.stringify({ left: 1, top: 2, scale: 99 }))).toEqual({
      left: 1,
      top: 2,
      scale: FRAME_SCALE_MAX,
    });
    expect(parseTargetFramePos(JSON.stringify({ left: 1, top: 2, scale: 0.01 }))).toEqual({
      left: 1,
      top: 2,
      scale: FRAME_SCALE_MIN,
    });
  });

  it('drops a corrupt scale without losing the position', () => {
    for (const bad of ['x', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseTargetFramePos(JSON.stringify({ left: 7, top: 8, scale: bad }))).toEqual({
        left: 7,
        top: 8,
      });
    }
  });
});

describe('clampFrameScale', () => {
  it('passes an in-band multiplier through and clamps the rest', () => {
    expect(clampFrameScale(1)).toBe(1);
    expect(clampFrameScale(1.3)).toBe(1.3);
    expect(clampFrameScale(FRAME_SCALE_MAX + 5)).toBe(FRAME_SCALE_MAX);
    expect(clampFrameScale(FRAME_SCALE_MIN - 0.5)).toBe(FRAME_SCALE_MIN);
  });

  it('falls back to 1 on a non-finite read rather than a degenerate transform', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampFrameScale(bad)).toBe(1);
    }
  });
});

describe('scaleFromGripDrag', () => {
  const start = { w: 200, h: 100 };

  it('grows by the larger axis ratio and shrinks when the grip is pulled inward', () => {
    // +100px on a 200px width is 1.5x; +10px on a 100px height is only 1.1x.
    expect(scaleFromGripDrag(1, start, 100, 10)).toBeCloseTo(1.5, 9);
    expect(scaleFromGripDrag(1, start, -50, -50)).toBeCloseTo(0.75, 9);
  });

  it('compounds onto the multiplier the frame already carries', () => {
    expect(scaleFromGripDrag(1.2, start, 100, 0)).toBeCloseTo(1.8, 9);
  });

  it('clamps the result into the legal band at both ends', () => {
    expect(scaleFromGripDrag(1, start, 5000, 5000)).toBe(FRAME_SCALE_MAX);
    expect(scaleFromGripDrag(1, start, -199, -99)).toBe(FRAME_SCALE_MIN);
  });

  it('returns the start multiplier when the frame was measured with no box', () => {
    // A frame grabbed while display:none has a 0x0 rect: no ratio exists, and
    // dividing by it would hand the frame a NaN transform.
    expect(scaleFromGripDrag(1.25, { w: 0, h: 0 }, 80, 80)).toBe(1.25);
  });
});

// The keyboard half of the grip: the arrow-key resize a keyboard-only player has
// as their ONLY route to a frame's size (the pointer drag above is unreachable).
describe('scaleFromKeyStep', () => {
  it('grows and shrinks by the coarse step, and by the fine step with Shift', () => {
    expect(scaleFromKeyStep(1, 1, false)).toBeCloseTo(1 + FRAME_SCALE_KEY_STEP, 9);
    expect(scaleFromKeyStep(1, -1, false)).toBeCloseTo(1 - FRAME_SCALE_KEY_STEP, 9);
    expect(scaleFromKeyStep(1, 1, true)).toBeCloseTo(1 + FRAME_SCALE_KEY_FINE_STEP, 9);
    expect(scaleFromKeyStep(1, -1, true)).toBeCloseTo(1 - FRAME_SCALE_KEY_FINE_STEP, 9);
    // The two steps are genuinely different sizes, so Shift is a real fine mode
    // rather than a second name for the coarse one.
    expect(FRAME_SCALE_KEY_FINE_STEP).toBeLessThan(FRAME_SCALE_KEY_STEP);
  });

  it('clamps at both ends of the legal band instead of running past it', () => {
    expect(scaleFromKeyStep(FRAME_SCALE_MAX, 1, false)).toBe(FRAME_SCALE_MAX);
    expect(scaleFromKeyStep(FRAME_SCALE_MIN, -1, false)).toBe(FRAME_SCALE_MIN);
    // A multiplier already outside the band is pulled back in, not stepped further out.
    expect(scaleFromKeyStep(FRAME_SCALE_MAX + 3, 1, false)).toBe(FRAME_SCALE_MAX);
    expect(scaleFromKeyStep(Number.NaN, 1, false)).toBeCloseTo(1 + FRAME_SCALE_KEY_STEP, 9);
  });

  it('round-trips exactly, so grow-then-shrink returns to the starting size', () => {
    let scale = 1;
    for (let i = 0; i < 8; i++) scale = scaleFromKeyStep(scale, 1, false);
    for (let i = 0; i < 8; i++) scale = scaleFromKeyStep(scale, -1, false);
    // Strict equality on purpose: an unrounded additive walk drifts into float
    // dust (0.9999999999999999) and never comes home to its own start value.
    expect(scale).toBe(1);
  });

  it('walks the whole band in a bounded number of presses', () => {
    let scale = FRAME_SCALE_MIN;
    let presses = 0;
    while (scale < FRAME_SCALE_MAX && presses < 100) {
      scale = scaleFromKeyStep(scale, 1, false);
      presses++;
    }
    expect(scale).toBe(FRAME_SCALE_MAX);
    expect(presses).toBe(Math.round((FRAME_SCALE_MAX - FRAME_SCALE_MIN) / FRAME_SCALE_KEY_STEP));
  });
});

// The desktop-window edge-resize half: which border a pointer is on, the cursor
// that border shows, the scale an edge drag produces, and where the top-left
// lands so the OPPOSITE border stays anchored.
describe('frameEdgeAtPoint', () => {
  const rect = { left: 100, top: 200, width: 300, height: 120 };

  it('reports null in the frame body and anywhere outside the frame', () => {
    expect(frameEdgeAtPoint(rect, 250, 260)).toBe(null);
    // The band is strictly INSIDE the box. An outer halo used to overlap the
    // frame stacked next to this one (the action bars sit 4px apart), and the
    // neighbour won the hit test, which left those bars resizable only from
    // their corners.
    expect(frameEdgeAtPoint(rect, 99, 260)).toBe(null);
    expect(frameEdgeAtPoint(rect, 250, 321)).toBe(null);
  });

  it('reports each side inside its band, and corners where two bands meet', () => {
    expect(frameEdgeAtPoint(rect, 250, 200 + FRAME_EDGE_BAND)).toBe('n');
    expect(frameEdgeAtPoint(rect, 250, 320 - FRAME_EDGE_BAND)).toBe('s');
    expect(frameEdgeAtPoint(rect, 100 + FRAME_EDGE_BAND, 260)).toBe('w');
    expect(frameEdgeAtPoint(rect, 400 - FRAME_EDGE_BAND, 260)).toBe('e');
    expect(frameEdgeAtPoint(rect, 102, 202)).toBe('nw');
    expect(frameEdgeAtPoint(rect, 398, 202)).toBe('ne');
    expect(frameEdgeAtPoint(rect, 102, 318)).toBe('sw');
    expect(frameEdgeAtPoint(rect, 398, 318)).toBe('se');
  });

  it('keeps a graspable middle on a frame thinner than two bands', () => {
    // A 10px-tall bar (the XP bar) cannot spare 8px at each end AND a middle to
    // drag from, so the band shrinks to a third of the axis: n at the top, s at
    // the bottom, and a move strip between them.
    const thin = { left: 100, top: 200, width: 300, height: 10 };
    expect(edgeBandFor(thin.height)).toBe(3);
    expect(frameEdgeAtPoint(thin, 250, 202)).toBe('n');
    expect(frameEdgeAtPoint(thin, 250, 205)).toBe(null); // the move strip
    expect(frameEdgeAtPoint(thin, 250, 209)).toBe('s');
  });
});

describe('edgeBandFor', () => {
  it('uses the full band on a frame with room for it', () => {
    expect(edgeBandFor(300)).toBe(FRAME_EDGE_BAND);
    expect(edgeBandFor(FRAME_EDGE_BAND * 3)).toBe(FRAME_EDGE_BAND);
  });

  it('shrinks to a third on a thin frame, never past 1px', () => {
    expect(edgeBandFor(12)).toBe(4);
    expect(edgeBandFor(10)).toBe(3);
    expect(edgeBandFor(2)).toBe(1);
    expect(edgeBandFor(0)).toBe(FRAME_EDGE_BAND);
  });
});

// Side edges are the horizontal-only / vertical-only adjustments: each stretches
// exactly the axis it owns. Corners (the SE grip included) stay the
// proportional whole-frame zoom, multiplying both axes by the larger ratio so
// a stretched frame keeps its chosen aspect.
describe('sizeFromEdgeDrag', () => {
  const start = { w: 200, h: 100 };
  const one = { sx: 1, sy: 1 };

  it('a side edge stretches ONLY its own axis, away-from-body grows', () => {
    expect(sizeFromEdgeDrag('e', one, start, 100, 0)).toEqual({ sx: 1.5, sy: 1 });
    expect(sizeFromEdgeDrag('e', one, start, -50, 0)).toEqual({ sx: 0.75, sy: 1 });
    // A west pull LEFTWARD (negative dx) grows: away from the body.
    expect(sizeFromEdgeDrag('w', one, start, -100, 0)).toEqual({ sx: 1.5, sy: 1 });
    expect(sizeFromEdgeDrag('s', one, start, 0, 50)).toEqual({ sx: 1, sy: 1.5 });
    expect(sizeFromEdgeDrag('n', one, start, 0, -50)).toEqual({ sx: 1, sy: 1.5 });
    // and the cross axis is ignored entirely
    expect(sizeFromEdgeDrag('e', one, start, 0, 500)).toEqual({ sx: 1, sy: 1 });
  });

  it('a corner multiplies BOTH axes by the larger ratio, like the SE grip', () => {
    expect(sizeFromEdgeDrag('se', one, start, 100, 10)).toEqual({ sx: 1.5, sy: 1.5 });
    expect(sizeFromEdgeDrag('nw', one, start, -100, -10)).toEqual({ sx: 1.5, sy: 1.5 });
    const grip = scaleFromGripDrag(1, start, 60, 30);
    expect(sizeFromEdgeDrag('se', one, start, 60, 30)).toEqual({ sx: grip, sy: grip });
  });

  it('a corner drag on a stretched frame keeps the stretch ratio', () => {
    const stretched = { sx: 1.6, sy: 0.8 };
    const next = sizeFromEdgeDrag('se', stretched, start, 20, 10);
    expect(next.sx / next.sy).toBeCloseTo(1.6 / 0.8, 9);
  });

  it('compounds a side stretch onto the axis the frame already carries', () => {
    const next = sizeFromEdgeDrag('e', { sx: 1.2, sy: 0.9 }, start, 100, 0);
    expect(next.sx).toBeCloseTo(1.8, 9);
    expect(next.sy).toBe(0.9);
  });

  it('clamps each axis into the legal band and survives a degenerate start box', () => {
    expect(sizeFromEdgeDrag('e', one, start, 100000, 0)).toEqual({ sx: FRAME_SCALE_MAX, sy: 1 });
    expect(sizeFromEdgeDrag('w', one, start, 100000, 0)).toEqual({ sx: FRAME_SCALE_MIN, sy: 1 });
    expect(sizeFromEdgeDrag('e', { sx: 1.2, sy: 1.1 }, { w: 0, h: 0 }, 50, 50)).toEqual({
      sx: 1.2,
      sy: 1.1,
    });
  });
});

// Box mode survives for the two frames whose contents genuinely re-wrap.
describe('boxFromEdgeDrag (the reflowing frames)', () => {
  const start = { w: 200, h: 100 };

  it('stretches only the axis the border owns, as real px', () => {
    expect(boxFromEdgeDrag('e', start, 100, 0, 1)).toEqual({ w: 300, h: 100 });
    expect(boxFromEdgeDrag('w', start, -100, 0, 1)).toEqual({ w: 300, h: 100 });
    expect(boxFromEdgeDrag('s', start, 0, 50, 1)).toEqual({ w: 200, h: 150 });
    expect(boxFromEdgeDrag('n', start, 0, -50, 1)).toEqual({ w: 200, h: 150 });
    expect(boxFromEdgeDrag('e', start, 0, 500, 1)).toEqual({ w: 200, h: 100 });
  });

  it('divides visual travel by the zoom factor into author px', () => {
    expect(boxFromEdgeDrag('e', start, 100, 0, 2)).toEqual({ w: 250, h: 100 });
  });

  it('clamps into the sane box band and survives a degenerate factor', () => {
    expect(boxFromEdgeDrag('w', start, 100000, 0, 1)).toEqual({ w: MIN_FRAME_BOX, h: 100 });
    expect(boxFromEdgeDrag('e', start, 1e9, 0, 1)).toEqual({ w: MAX_FRAME_BOX, h: 100 });
    expect(boxFromEdgeDrag('e', start, 100, 0, 0)).toEqual(start);
    expect(boxFromEdgeDrag('e', start, 100, 0, Number.NaN)).toEqual(start);
  });
});

describe('cursorForFrameEdge', () => {
  it('maps every edge to the game-styled token with its window-manager fallback', () => {
    const expected: Record<FrameEdge, string> = {
      n: 'var(--cursor-resize-ns, ns-resize)',
      s: 'var(--cursor-resize-ns, ns-resize)',
      e: 'var(--cursor-resize-ew, ew-resize)',
      w: 'var(--cursor-resize-ew, ew-resize)',
      ne: 'var(--cursor-resize-nesw, nesw-resize)',
      sw: 'var(--cursor-resize-nesw, nesw-resize)',
      nw: 'var(--cursor-resize-nwse, nwse-resize)',
      se: 'var(--cursor-resize-nwse, nwse-resize)',
    };
    for (const [edge, cursor] of Object.entries(expected)) {
      expect(cursorForFrameEdge(edge as FrameEdge)).toBe(cursor);
    }
  });
});

describe('posFromEdgeResize', () => {
  const start = { left: 100, top: 200, w: 200, h: 100 };

  it('anchors the right border for a west resize and the bottom for a north one', () => {
    expect(posFromEdgeResize('w', start, { w: 300, h: 100 })).toEqual({ left: 0, top: 200 });
    expect(posFromEdgeResize('n', start, { w: 200, h: 150 })).toEqual({ left: 100, top: 150 });
    expect(posFromEdgeResize('nw', start, { w: 300, h: 150 })).toEqual({ left: 0, top: 150 });
  });

  it('holds the top-left still for east and south resizes (origin is top-left)', () => {
    expect(posFromEdgeResize('e', start, { w: 300, h: 100 })).toEqual({ left: 100, top: 200 });
    expect(posFromEdgeResize('s', start, { w: 200, h: 80 })).toEqual({ left: 100, top: 200 });
    expect(posFromEdgeResize('se', start, { w: 400, h: 200 })).toEqual({ left: 100, top: 200 });
  });

  it('shrinking from the west walks the top-left right, keeping the right border put', () => {
    expect(posFromEdgeResize('w', start, { w: 160, h: 100 })).toEqual({ left: 140, top: 200 });
  });
});

describe('stretched-box persistence (w/h round-trip)', () => {
  it('round-trips a stretched frame through the store', () => {
    const stretched = { left: 40, top: 60, scale: 1.5, w: 700, h: 90 };
    expect(parseTargetFramePos(serializeTargetFramePos(stretched))).toEqual(stretched);
    // one axis alone stays one axis alone
    const wide = { left: 40, top: 60, w: 700 };
    expect(parseTargetFramePos(serializeTargetFramePos(wide))).toEqual(wide);
  });

  it('clamps a stored box into the sane band and drops a corrupt axis', () => {
    expect(parseTargetFramePos(JSON.stringify({ left: 1, top: 2, w: 1, h: 1e9 }))).toEqual({
      left: 1,
      top: 2,
      w: MIN_FRAME_BOX,
      h: MAX_FRAME_BOX,
    });
    expect(parseTargetFramePos(JSON.stringify({ left: 1, top: 2, w: 'x', h: 90 }))).toEqual({
      left: 1,
      top: 2,
      h: 90,
    });
  });
});

// The name chip renders ABOVE the frame, where it never covers the frame's own
// contents. A frame parked against the viewport top has no room up there, and a
// chip clipped off-screen is exactly what leaves a frame looking nameless, so
// those flip below instead.
describe('labelBelowFrame', () => {
  it('keeps the chip above a frame with room for it', () => {
    expect(labelBelowFrame(200)).toBe(false);
    expect(labelBelowFrame(FRAME_LABEL_CLEARANCE)).toBe(false);
  });

  it('flips the chip below a frame parked against the viewport top', () => {
    expect(labelBelowFrame(0)).toBe(true);
    expect(labelBelowFrame(FRAME_LABEL_CLEARANCE - 1)).toBe(true);
    // the buff rows and minimap sit at top: 14px, the case that read as nameless
    expect(labelBelowFrame(14)).toBe(true);
  });
});

describe('frameScales + axis persistence', () => {
  it('resolves axis fields over the uniform field, defaulting to 1', () => {
    expect(frameScales(null)).toEqual({ sx: 1, sy: 1 });
    expect(frameScales({ scale: 1.3 })).toEqual({ sx: 1.3, sy: 1.3 });
    expect(frameScales({ scaleX: 1.5, scaleY: 0.8 })).toEqual({ sx: 1.5, sy: 0.8 });
    expect(frameScales({ scale: 1.3, scaleX: 1.5 })).toEqual({ sx: 1.5, sy: 1.3 });
  });

  it('round-trips a side-stretched frame and collapses matching axes to scale', () => {
    const stretched = { left: 40, top: 60, scaleX: 1.5, scaleY: 0.8 };
    expect(parseTargetFramePos(serializeTargetFramePos(stretched))).toEqual(stretched);
    expect(serializeTargetFramePos({ left: 1, top: 2, scaleX: 1.5, scaleY: 1.5 })).toBe(
      '{"left":1,"top":2,"scale":1.5}',
    );
  });

  it('a half-corrupt axis falls back to the uniform field for the missing side', () => {
    expect(
      parseTargetFramePos(
        JSON.stringify({ left: 1, top: 2, scale: 1.2, scaleX: 1.4, scaleY: 'x' }),
      ),
    ).toEqual({ left: 1, top: 2, scaleX: 1.4, scaleY: 1.2 });
  });

  it('clamps stored axis multipliers into the legal band', () => {
    expect(
      parseTargetFramePos(JSON.stringify({ left: 1, top: 2, scaleX: 99, scaleY: 0.01 })),
    ).toEqual({ left: 1, top: 2, scaleX: FRAME_SCALE_MAX, scaleY: FRAME_SCALE_MIN });
  });
});

// The viewport re-anchoring behind "the UI does not move when the resolution
// changes": each axis keeps its distance to whichever of start / center / end
// it sat closest to when saved, and the saved viewport rides the serializer.
describe('anchorAxis + anchorAdjustedPos (viewport re-anchoring)', () => {
  it('keeps the nearest anchor per axis: start, end, or center', () => {
    // Near the start edge: the absolute offset is the intent.
    expect(anchorAxis(8, 100, 1600, 1200)).toBe(8);
    // Near the end edge: the distance to the end is the intent.
    expect(anchorAxis(1492, 100, 1600, 1200)).toBe(1092);
    // Dead center: stays centered.
    expect(anchorAxis(750, 100, 1600, 1200)).toBe(550);
  });

  it('snaps to center only inside the tight band; a merely-near-mid row keeps its edge', () => {
    // The centered cast bar (about 15px off center) stays centered.
    expect(anchorAxis(815, 300, 1920, 1600)).toBe(655);
    // A debuff row 38px above mid-height is NOT centered: it anchors to its
    // nearest edge (the top) and stays exactly where it was (issue: the row
    // was dragged toward center on every resize, tearing it off the minimap).
    expect(anchorAxis(401, 32, 911, 1080)).toBe(401);
  });

  it('a tall rail whose lower end is its nearest edge rides the bottom, top intact rule-free', () => {
    // The ~418px menu rail at top 452 of 1080: its bottom gap (210) is its
    // nearest edge, so losing 169px of height slides it up by exactly that.
    // A brief tall-frame special case pinned its TOP instead, and the rail
    // visibly floated to mid-screen whenever the window gained height.
    expect(anchorAxis(452, 418, 1080, 911)).toBe(283);
    expect(anchorAxis(283, 418, 911, 1080)).toBe(452);
  });

  it('adjusts only when a saved viewport is present and differs', () => {
    const size = { w: 100, h: 50 };
    // No saved viewport (an older payload): returned unchanged.
    expect(anchorAdjustedPos({ left: 700, top: 800 }, size, { w: 1200, h: 700 })).toEqual({
      left: 700,
      top: 800,
    });
    // Same viewport: untouched.
    expect(
      anchorAdjustedPos({ left: 700, top: 820, vw: 1600, vh: 900 }, size, { w: 1600, h: 900 }),
    ).toEqual({ left: 700, top: 820, vw: 1600, vh: 900 });
    // A bottom-parked spot rides the bottom edge when the height changes.
    expect(
      anchorAdjustedPos({ left: 700, top: 820, vw: 1600, vh: 900 }, size, { w: 1600, h: 700 }),
    ).toMatchObject({ top: 620 });
  });

  it('round-trips the saved viewport through the serializer, both fields or neither', () => {
    expect(
      parseTargetFramePos(serializeTargetFramePos({ left: 1, top: 2, vw: 1600, vh: 900 })),
    ).toEqual({ left: 1, top: 2, vw: 1600, vh: 900 });
    // A lone axis cannot re-anchor honestly, so it is dropped on parse.
    expect(parseTargetFramePos('{"left":1,"top":2,"vw":1600}')).toEqual({ left: 1, top: 2 });
  });
});
