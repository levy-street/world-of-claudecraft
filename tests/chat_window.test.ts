import { describe, expect, it } from 'vitest';
import {
  CHAT_BOX_LIMITS,
  type ChatBoxGeometry,
  clampChatBox,
  parseChatBox,
  placeChatBox,
  serializeChatBox,
} from '../src/ui/chat_window';

const VP = { w: 1280, h: 720 };
const CHROME = 22; // tab strip height

describe('clampChatBox', () => {
  it('leaves an in-bounds box untouched', () => {
    const geo: ChatBoxGeometry = { left: 100, top: 80, width: 370, height: 184 };
    expect(clampChatBox(geo, VP, CHROME)).toEqual(geo);
  });

  it('pulls a box back inside the right/bottom edges with the margin', () => {
    const geo: ChatBoxGeometry = { left: 5000, top: 5000, width: 370, height: 184 };
    const out = clampChatBox(geo, VP, CHROME);
    expect(out.left).toBe(VP.w - 370 - CHAT_BOX_LIMITS.margin);
    // bottom edge accounts for the tab strip chrome sitting above the frame
    expect(out.top).toBe(VP.h - (184 + CHROME) - CHAT_BOX_LIMITS.margin);
  });

  it('never lets left/top go below the margin', () => {
    const out = clampChatBox({ left: -999, top: -999, width: 370, height: 184 }, VP, CHROME);
    expect(out.left).toBe(CHAT_BOX_LIMITS.margin);
    expect(out.top).toBe(CHAT_BOX_LIMITS.margin);
  });

  it('keeps optional UI attached above chat inside the top margin', () => {
    const reservedAbove = (width: number) => width * 0.59 + 10;
    const out = clampChatBox(
      { left: 100, top: -999, width: 370, height: 184 },
      VP,
      CHROME,
      CHAT_BOX_LIMITS,
      reservedAbove,
    );
    expect(out.top - reservedAbove(out.width)).toBeCloseTo(CHAT_BOX_LIMITS.margin, 9);
  });

  it('enforces min width/height', () => {
    const out = clampChatBox({ left: 100, top: 100, width: 10, height: 10 }, VP, CHROME);
    expect(out.width).toBe(CHAT_BOX_LIMITS.minWidth);
    expect(out.height).toBe(CHAT_BOX_LIMITS.minHeight);
  });

  it('enforces max width/height (own limit)', () => {
    const out = clampChatBox({ left: 8, top: 8, width: 9999, height: 9999 }, VP, CHROME);
    expect(out.width).toBe(CHAT_BOX_LIMITS.maxWidth);
    expect(out.height).toBe(CHAT_BOX_LIMITS.maxHeight);
  });

  it('caps size to the viewport on small screens', () => {
    const small = { w: 320, h: 240 };
    const out = clampChatBox({ left: 8, top: 8, width: 760, height: 600 }, small, CHROME);
    expect(out.width).toBe(small.w - CHAT_BOX_LIMITS.margin * 2);
    expect(out.height).toBe(small.h - CHAT_BOX_LIMITS.margin * 2 - CHROME);
  });

  it('subtracts reserved-above space when capping pane height', () => {
    const reservedAbove = 120;
    const out = clampChatBox(
      { left: 8, top: 200, width: 370, height: 9999 },
      VP,
      CHROME,
      CHAT_BOX_LIMITS,
      reservedAbove,
    );
    expect(out.height).toBe(VP.h - CHAT_BOX_LIMITS.margin * 2 - CHROME - reservedAbove);
  });
});

describe('placeChatBox (UI Scale compensation)', () => {
  // #chatlog-wrap / #chatlog-frame live inside #ui (`zoom: var(--ui-scale)`).
  // Pointer / rect coordinates are post-zoom (visual), but style left/top/width/
  // height are author lengths the browser re-multiplies by the zoom, so the css
  // writes are visual / scale. (#chat-input is a sibling of #ui, outside the zoom,
  // so hud.ts keeps its writes in visual space, undivided; see applyChatBoxGeometry.)
  it('at scale 1 the css writes equal the clamped visual geometry', () => {
    const geo: ChatBoxGeometry = { left: 100, top: 80, width: 370, height: 184 };
    const p = placeChatBox(geo, VP, CHROME, 1);
    expect(p.geo).toEqual(geo);
    expect(p.css).toEqual(geo);
  });

  it('divides every css write by the scale while persisting the visual geometry', () => {
    const geo: ChatBoxGeometry = { left: 200, top: 120, width: 400, height: 200 };
    for (const scale of [0.8, 1.25, 1.4]) {
      const p = placeChatBox(geo, VP, CHROME, scale);
      // Persisted (geo) stays in visual space: identical across every scale.
      expect(p.geo).toEqual(geo);
      // Each css value re-multiplied by the zoom lands at the visual value.
      expect(p.css.left).toBeCloseTo(geo.left / scale, 9);
      expect(p.css.top).toBeCloseTo(geo.top / scale, 9);
      expect(p.css.width).toBeCloseTo(geo.width / scale, 9);
      expect(p.css.height).toBeCloseTo(geo.height / scale, 9);
      expect(p.css.width * scale).toBeCloseTo(geo.width, 9);
    }
  });

  it('clamps the whole box on screen in visual space before dividing', () => {
    const scale = 1.25;
    const p = placeChatBox({ left: 5000, top: 5000, width: 370, height: 184 }, VP, CHROME, scale);
    expect(p.geo.left).toBe(VP.w - 370 - CHAT_BOX_LIMITS.margin);
    expect(p.geo.top).toBe(VP.h - (184 + CHROME) - CHAT_BOX_LIMITS.margin);
    expect(p.css.left).toBeCloseTo(p.geo.left / scale, 9);
    expect(p.css.top).toBeCloseTo(p.geo.top / scale, 9);
  });

  it('reserves attached-above space using the clamped visual width', () => {
    const scale = 1.25;
    const reservedAbove = (width: number) => width * 0.59 + 10 * scale;
    const p = placeChatBox(
      { left: 100, top: -500, width: 9999, height: 184 },
      VP,
      CHROME,
      scale,
      CHAT_BOX_LIMITS,
      reservedAbove,
    );
    expect(p.geo.width).toBe(CHAT_BOX_LIMITS.maxWidth);
    expect(p.geo.top - reservedAbove(p.geo.width)).toBeCloseTo(CHAT_BOX_LIMITS.margin, 9);
    expect(p.css.top * scale).toBeCloseTo(p.geo.top, 9);
  });

  it('treats a non-positive / non-finite scale as 1 (never blanks the box)', () => {
    const geo: ChatBoxGeometry = { left: 100, top: 80, width: 370, height: 184 };
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(placeChatBox(geo, VP, CHROME, bad).css).toEqual(geo);
    }
  });
});

describe('serialize/parse round-trip', () => {
  it('round-trips a geometry', () => {
    const geo: ChatBoxGeometry = { left: 12, top: 34, width: 400, height: 200 };
    expect(parseChatBox(serializeChatBox(geo))).toEqual(geo);
  });

  it('returns null for empty/missing input', () => {
    expect(parseChatBox(null)).toBeNull();
    expect(parseChatBox(undefined)).toBeNull();
    expect(parseChatBox('')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    expect(parseChatBox('{not json')).toBeNull();
  });

  it('returns null when a field is missing or non-finite', () => {
    expect(parseChatBox('{"left":1,"top":2,"width":3}')).toBeNull();
    expect(parseChatBox('{"left":1,"top":2,"width":3,"height":"x"}')).toBeNull();
    expect(parseChatBox('{"left":1,"top":2,"width":3,"height":null}')).toBeNull();
    expect(parseChatBox('{"left":1,"top":2,"width":3,"height":1e999}')).toBeNull();
  });
});
