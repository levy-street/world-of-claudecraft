import { describe, it, expect } from 'vitest';
import {
  portraitBackingPx,
  overscanRect,
  crestIdForEntity,
  PORTRAIT_CSS_SIZE,
  CREST_OVERSCAN,
  MAX_PORTRAIT_DPR,
} from '../src/ui/unit_portrait';

describe('portraitBackingPx', () => {
  it('matches the CSS size at dpr 1', () => {
    expect(portraitBackingPx(54, 1)).toBe(54);
  });

  it('scales the backing store up for HiDPI (the crispness fix)', () => {
    expect(portraitBackingPx(54, 2)).toBe(108);
    expect(portraitBackingPx(54, 2.5)).toBe(135);
  });

  it('rounds to whole device pixels', () => {
    // 54 * 1.5 = 81 exactly; 54 * 1.333.. rounds.
    expect(portraitBackingPx(54, 1.5)).toBe(81);
    expect(portraitBackingPx(50, 1.333)).toBe(67); // 66.65 -> 67
  });

  it('clamps the scale to [1, MAX_PORTRAIT_DPR]', () => {
    expect(portraitBackingPx(54, 0.5)).toBe(54); // never downscale below 1x
    expect(portraitBackingPx(54, 8)).toBe(54 * MAX_PORTRAIT_DPR);
  });

  it('falls back to 1x for non-finite / non-positive dpr', () => {
    expect(portraitBackingPx(54, NaN)).toBe(54);
    expect(portraitBackingPx(54, Infinity)).toBe(54);
    expect(portraitBackingPx(54, 0)).toBe(54);
    expect(portraitBackingPx(54, -2)).toBe(54);
  });

  it('never returns less than one pixel', () => {
    expect(portraitBackingPx(0, 1)).toBe(1);
  });
});

describe('overscanRect', () => {
  it('is the identity rect at overscan 1', () => {
    expect(overscanRect(54, 1)).toEqual({ dx: 0, dy: 0, dw: 54, dh: 54 });
  });

  it('centres an oversized draw (negative offsets) so the rim lands off-canvas', () => {
    const r = overscanRect(100, 1.2);
    expect(r.dw).toBe(120);
    expect(r.dh).toBe(120);
    expect(r.dx).toBe(-10);
    expect(r.dy).toBe(-10);
    // Symmetric: the drawn image is centred in the canvas.
    expect(r.dx + r.dw).toBe(110);
  });

  it('keeps the centre fixed regardless of overscan', () => {
    const size = 54;
    for (const k of [1, 1.1, CREST_OVERSCAN, 1.5]) {
      const r = overscanRect(size, k);
      expect(r.dx + r.dw / 2).toBeCloseTo(size / 2, 9);
      expect(r.dy + r.dh / 2).toBeCloseTo(size / 2, 9);
    }
  });

  it('CREST_OVERSCAN actually zooms in (fills the circular clip)', () => {
    expect(CREST_OVERSCAN).toBeGreaterThan(1);
    const r = overscanRect(PORTRAIT_CSS_SIZE, CREST_OVERSCAN);
    expect(r.dw).toBeGreaterThan(PORTRAIT_CSS_SIZE);
    expect(r.dx).toBeLessThan(0);
  });
});

describe('crestIdForEntity', () => {
  it('maps NPCs to the status emblem', () => {
    expect(crestIdForEntity('npc', undefined)).toBe('status_npc');
    // Family is irrelevant for NPCs.
    expect(crestIdForEntity('npc', 'beast')).toBe('status_npc');
  });

  it('maps mobs to their creature-family crest', () => {
    expect(crestIdForEntity('mob', 'beast')).toBe('family_beast'); // the Wild Boar case
    expect(crestIdForEntity('mob', 'undead')).toBe('family_undead');
  });

  it('falls back to humanoid when a mob family is unknown', () => {
    expect(crestIdForEntity('mob', undefined)).toBe('family_humanoid');
  });
});
