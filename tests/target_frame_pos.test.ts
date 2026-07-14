import { describe, expect, it } from 'vitest';
import {
  clampTargetFramePos,
  parseTargetFramePos,
  placeTargetFrame,
  serializeTargetFramePos,
  TARGET_FRAME_MARGIN,
} from '../src/ui/target_frame_pos';

const viewport = { w: 1000, h: 800 };
const size = { w: 220, h: 92 };

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
});
