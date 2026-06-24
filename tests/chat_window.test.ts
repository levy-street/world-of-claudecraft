import { describe, it, expect } from 'vitest';
import {
  clampChatBox,
  serializeChatBox,
  parseChatBox,
  CHAT_BOX_LIMITS,
  type ChatBoxGeometry,
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
