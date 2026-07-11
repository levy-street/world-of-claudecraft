import { describe, expect, it } from 'vitest';
import {
  clampMobileChatPanel,
  defaultMobileChatWidth,
  MOBILE_CHAT_PANEL_LIMITS,
  type MobileChatPanelGeom,
  migrateMobileChatBottomInset,
  parseMobileChatPanel,
  serializeMobileChatPanel,
} from '../src/ui/chat_mobile_panel';

// A typical landscape phone (the primary mobile viewport) and its portrait flip.
const LANDSCAPE = { w: 900, h: 430 };
const PORTRAIT = { w: 430, h: 900 };
const { margin, minTop, minHeight } = MOBILE_CHAT_PANEL_LIMITS;

describe('defaultMobileChatWidth', () => {
  it('is about 58vw on a landscape phone, capped at 500px', () => {
    // 0.58 * 900 = 522 -> the 500px cap wins (about 56% of the viewport).
    expect(defaultMobileChatWidth(900)).toBe(500);
    // 0.58 * 800 = 464 -> under the cap, the fraction wins.
    expect(defaultMobileChatWidth(800)).toBe(464);
  });

  it('keeps a usable floor on narrow portrait widths', () => {
    // 0.58 * 430 = 249.4 -> the 320px floor wins.
    expect(defaultMobileChatWidth(430)).toBe(320);
  });

  it('never exceeds the viewport minus the edge margins', () => {
    // 320 wide viewport: the floor (320) would overflow; viewport - 2 * margin wins.
    expect(defaultMobileChatWidth(320)).toBe(320 - margin * 2);
  });
});

describe('clampMobileChatPanel', () => {
  const width = defaultMobileChatWidth(LANDSCAPE.w);

  it('leaves an in-bounds panel untouched', () => {
    const geo: MobileChatPanelGeom = { left: 40, top: 100, height: 220 };
    expect(clampMobileChatPanel(geo, LANDSCAPE, width)).toEqual(geo);
  });

  it('pulls the panel back inside the right/bottom edges', () => {
    const out = clampMobileChatPanel({ left: 5000, top: 5000, height: 220 }, LANDSCAPE, width);
    expect(out.left).toBe(LANDSCAPE.w - width - margin);
    expect(out.top).toBe(LANDSCAPE.h - 220 - margin);
  });

  it('never lets left go below the margin', () => {
    const out = clampMobileChatPanel({ left: -999, top: 100, height: 220 }, LANDSCAPE, width);
    expect(out.left).toBe(margin);
  });

  it('reserves the top band so the Chat button trio stays tappable above the panel', () => {
    // The Chat button is the ONLY close affordance; a panel dragged over the
    // top-left trio would trap the player in chat. minTop keeps that band clear.
    const out = clampMobileChatPanel({ left: 40, top: -999, height: 220 }, LANDSCAPE, width);
    expect(out.top).toBe(minTop);
  });

  it('enforces the minimum usable height (composer + tabs + a few log lines)', () => {
    const out = clampMobileChatPanel({ left: 40, top: 100, height: 10 }, LANDSCAPE, width);
    expect(out.height).toBe(minHeight);
  });

  it('caps height so the panel never runs past the bottom edge from the reserved top', () => {
    const out = clampMobileChatPanel({ left: 40, top: minTop, height: 9999 }, LANDSCAPE, width);
    expect(out.height).toBe(LANDSCAPE.h - minTop - margin);
  });

  it('re-clamps a landscape-saved spot fully onto a portrait viewport (rotation)', () => {
    // Saved bottom-right on landscape; after rotating, the panel must be pulled
    // fully back on-viewport rather than left hanging off the (now narrower) edge.
    const saved = clampMobileChatPanel({ left: 5000, top: 5000, height: 220 }, LANDSCAPE, width);
    const pw = defaultMobileChatWidth(PORTRAIT.w);
    const out = clampMobileChatPanel(saved, PORTRAIT, pw);
    expect(out.left + pw).toBeLessThanOrEqual(PORTRAIT.w - margin);
    expect(out.top + out.height).toBeLessThanOrEqual(PORTRAIT.h - margin);
    expect(out.left).toBeGreaterThanOrEqual(margin);
    expect(out.top).toBeGreaterThanOrEqual(minTop);
  });

  it('prefers the minimum height on a degenerate tiny viewport', () => {
    // max height falls below min height: the min wins (mirrors CSS clamp()),
    // and the top still respects the reserved band.
    const tiny = { w: 300, h: 200 };
    const out = clampMobileChatPanel({ left: 0, top: 0, height: 500 }, tiny, 280);
    expect(out.height).toBe(minHeight);
    expect(out.top).toBe(minTop);
  });
});

describe('serialize/parse round-trip', () => {
  it('round-trips a geometry', () => {
    const geo: MobileChatPanelGeom = { left: 12, top: 96, height: 240 };
    expect(parseMobileChatPanel(serializeMobileChatPanel(geo))).toEqual(geo);
  });

  it('returns null for empty/missing input', () => {
    expect(parseMobileChatPanel(null)).toBeNull();
    expect(parseMobileChatPanel(undefined)).toBeNull();
    expect(parseMobileChatPanel('')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    expect(parseMobileChatPanel('{not json')).toBeNull();
  });

  it('returns null when a field is missing or not a finite number', () => {
    expect(parseMobileChatPanel('{"left":12,"top":96}')).toBeNull();
    expect(parseMobileChatPanel('{"left":"12","top":96,"height":240}')).toBeNull();
    expect(parseMobileChatPanel('{"left":12,"top":null,"height":240}')).toBeNull();
    // JSON has no Infinity literal, but a null-parsed NaN path must still reject.
    expect(parseMobileChatPanel('{"left":12,"top":96,"height":1e999}')).toBeNull();
  });
});

describe('migrateMobileChatBottomInset (legacy woc_mobile_chat_bottom)', () => {
  it('converts the old bottom inset into an equivalent height at the default seat', () => {
    // Old model: top fixed at the reserved band, bottom inset dragged. height =
    // viewport - minTop - bottom, so the panel keeps the size the player chose.
    const out = migrateMobileChatBottomInset('120px', LANDSCAPE);
    expect(out).not.toBeNull();
    expect(out?.height).toBe(LANDSCAPE.h - minTop - 120);
    // Position lands on the new defaults (left margin seat, reserved top).
    expect(out?.top).toBe(minTop);
  });

  it('clamps a migrated size to the current viewport', () => {
    const out = migrateMobileChatBottomInset('0', { w: 900, h: 260 });
    expect(out?.height).toBe(minHeight);
  });

  it('returns null for missing or unparseable legacy values', () => {
    expect(migrateMobileChatBottomInset(null, LANDSCAPE)).toBeNull();
    expect(migrateMobileChatBottomInset('', LANDSCAPE)).toBeNull();
    expect(migrateMobileChatBottomInset('junk', LANDSCAPE)).toBeNull();
  });
});
