import { describe, it, expect } from 'vitest';
import {
  clickMarkerAnim,
  clickMarkerColor,
  CLICK_MARKER_LIFETIME,
  CLICK_MARKER_COLOR_NEUTRAL,
  CLICK_MARKER_COLOR_HOSTILE,
} from '../src/render/click_marker';

describe('clickMarkerColor', () => {
  it('picks red for a hostile click and gold otherwise', () => {
    expect(clickMarkerColor(true)).toBe(CLICK_MARKER_COLOR_HOSTILE);
    expect(clickMarkerColor(false)).toBe(CLICK_MARKER_COLOR_NEUTRAL);
  });
});

describe('clickMarkerAnim', () => {
  it('is inactive before spawn and after the lifetime elapses', () => {
    expect(clickMarkerAnim(-0.1).active).toBe(false);
    expect(clickMarkerAnim(CLICK_MARKER_LIFETIME).active).toBe(false);
    expect(clickMarkerAnim(CLICK_MARKER_LIFETIME + 1).active).toBe(false);
  });

  it('is active throughout the lifetime', () => {
    expect(clickMarkerAnim(0).active).toBe(true);
    expect(clickMarkerAnim(CLICK_MARKER_LIFETIME / 2).active).toBe(true);
    expect(clickMarkerAnim(CLICK_MARKER_LIFETIME * 0.99).active).toBe(true);
  });

  it('keeps all alpha/scale values in sane ranges', () => {
    for (let i = 0; i <= 20; i++) {
      const a = clickMarkerAnim((CLICK_MARKER_LIFETIME * i) / 20);
      expect(a.ringAlpha).toBeGreaterThanOrEqual(0);
      expect(a.ringAlpha).toBeLessThanOrEqual(1);
      expect(a.crossAlpha).toBeGreaterThanOrEqual(0);
      expect(a.crossAlpha).toBeLessThanOrEqual(1);
      expect(a.ringScale).toBeGreaterThan(0);
      expect(a.crossScale).toBeGreaterThan(0);
    }
  });

  it('grows the ring from ~0.55x up toward its documented 1.5x ceiling', () => {
    // Pins the curve to its comment (starts a touch inside the base radius, eases out
    // to 1.5x), so the two cannot silently drift apart again.
    expect(clickMarkerAnim(0).ringScale).toBeCloseTo(0.55, 5);
    const late = clickMarkerAnim(CLICK_MARKER_LIFETIME * 0.999).ringScale;
    expect(late).toBeGreaterThan(1.4);
    expect(late).toBeLessThanOrEqual(1.5);
  });

  it('expands the ring outward and fades it monotonically', () => {
    let prevScale = -Infinity;
    let prevAlpha = Infinity;
    for (let i = 0; i < 20; i++) {
      const a = clickMarkerAnim((CLICK_MARKER_LIFETIME * i) / 20);
      expect(a.ringScale).toBeGreaterThanOrEqual(prevScale);
      expect(a.ringAlpha).toBeLessThanOrEqual(prevAlpha + 1e-9);
      prevScale = a.ringScale;
      prevAlpha = a.ringAlpha;
    }
  });

  it('stamps the X in (grows then holds full) and holds opacity before fading', () => {
    const early = clickMarkerAnim(CLICK_MARKER_LIFETIME * 0.02);
    const mid = clickMarkerAnim(CLICK_MARKER_LIFETIME * 0.4);
    expect(early.crossScale).toBeLessThan(mid.crossScale);
    expect(mid.crossScale).toBeCloseTo(1, 5);
    // opacity holds full through the early/mid life, then fades to ~0 at the end.
    expect(mid.crossAlpha).toBeCloseTo(1, 5);
    expect(clickMarkerAnim(CLICK_MARKER_LIFETIME * 0.99).crossAlpha).toBeLessThan(0.2);
  });
});
