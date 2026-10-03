// The shared dungeon floor telegraph look (src/render/floor_telegraph): one
// threat palette across every dungeon's cones, rings, lanes and kick glyphs,
// a footprint (tint, fill, fill front, outline) that reads on every graphics
// tier, cosmetic layers that shed on the low tier, and a warning pulse only
// over the bar's last stretch. Presentation only: the fill IS the sim's bar.
import { describe, expect, it } from 'vitest';
import {
  TELEGRAPH_THREAT_COLORS,
  TELEGRAPH_WARN_FROM,
  telegraphFillOf,
  telegraphLook,
  telegraphOutline,
} from '../src/render/floor_telegraph/telegraph_look_core';
import { cryptTelegraphSpecs } from '../src/render/hollow_crypt/crypt_trash_fx_core';
import { bastionTelegraphSpecs } from '../src/render/sunken_bastion/bastion_fx_core';

const PALETTE = new Set<number>(Object.values(TELEGRAPH_THREAT_COLORS));

describe('the floor telegraph look', () => {
  it('has four distinct threat colours', () => {
    expect(PALETTE.size).toBe(4);
  });

  it('fills exactly as the cast bar runs', () => {
    expect(telegraphFillOf(2, 2)).toBe(0);
    expect(telegraphFillOf(0.5, 2)).toBeCloseTo(0.75, 9);
    expect(telegraphFillOf(0, 2)).toBe(1);
    expect(telegraphFillOf(0, 0)).toBe(1);
  });

  it('keeps the footprint readable on every tier and sheds only cosmetics', () => {
    for (const fill of [0.05, 0.4, 0.9]) {
      const high = telegraphLook(fill, 1.3, true);
      const low = telegraphLook(fill, 1.3, false);
      expect(low.detail).toBe(0);
      expect(high.detail).toBe(1);
      // Everything a player reads is identical on both tiers.
      for (const key of ['base', 'filled', 'front', 'rim', 'warn'] as const) {
        expect(low[key], key).toBe(high[key]);
      }
      expect(low.rim).toBeGreaterThanOrEqual(0.85);
      expect(low.front).toBeGreaterThan(0.5);
    }
  });

  it('warns only over the last stretch of the bar, faster as it ends', () => {
    for (let t = 0; t < 3; t += 0.05) {
      expect(telegraphLook(TELEGRAPH_WARN_FROM - 0.01, t, true).warn).toBe(0);
    }
    let peakMid = 0;
    let peakEnd = 0;
    for (let t = 0; t < 3; t += 0.01) {
      peakMid = Math.max(peakMid, telegraphLook(0.8, t, true).warn);
      peakEnd = Math.max(peakEnd, telegraphLook(0.99, t, true).warn);
    }
    expect(peakMid).toBeGreaterThan(0);
    expect(peakEnd).toBeGreaterThan(peakMid);
  });

  it('outlines a cone with its flanks and closes a ring', () => {
    const cone = telegraphOutline(90, 24, 6);
    expect(Math.hypot(...cone.points[0])).toBe(0);
    expect(cone.points.at(-1)?.[0]).toBeCloseTo(0, 9);
    expect(cone.points.at(-1)?.[1]).toBeCloseTo(0, 9);
    expect(cone.points).toHaveLength(6 + 1 + 24 + 6);
    // Arc length: two flanks of one unit and a quarter-circle arc.
    expect(cone.along.at(-1)).toBeCloseTo(2 + Math.PI / 2, 2);
    const ring = telegraphOutline(360, 24, 6);
    expect(ring.points).toHaveLength(25);
    expect(ring.points[0][0]).toBeCloseTo(ring.points[24][0], 9);
    expect(ring.points[0][1]).toBeCloseTo(ring.points[24][1], 9);
    expect(ring.along.at(-1)).toBeCloseTo(Math.PI * 2, 1);
  });
});

describe('every dungeon telegraph speaks the one threat palette', () => {
  const all = [
    ...Object.entries(cryptTelegraphSpecs()).map(([id, s]) => ({ id, ...s })),
    ...Object.entries(bastionTelegraphSpecs()).map(([id, s]) => ({ id, ...s })),
  ];

  it('colours every cone, ring, lane and glyph by its threat', () => {
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) expect(PALETTE.has(s.color), s.id).toBe(true);
  });

  it('marks every kickable cast with the interrupt colour', () => {
    const glyphs = all.filter((s) => s.shape === 'sigil');
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    for (const s of glyphs) expect(s.color, s.id).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
  });

  it('never paints a damage shape in the kick colour', () => {
    for (const s of all) {
      if (s.shape === 'sigil') continue;
      expect(s.color, s.id).not.toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
  });
});
