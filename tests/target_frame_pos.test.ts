import { describe, expect, it } from 'vitest';
import {
  clampTargetFramePos,
  parseTargetFramePos,
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
