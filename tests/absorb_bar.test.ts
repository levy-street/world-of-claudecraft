import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import { absorbBarView, absorbSegmentTransform, absorbTotal } from '../src/ui/absorb_bar';

function shield(value: number): Aura {
  return {
    id: 'power_word_shield',
    name: 'Power Word: Shield',
    kind: 'absorb',
    remaining: 30,
    duration: 30,
    value,
    sourceId: 1,
    school: 'holy',
  };
}

function dot(value: number): Aura {
  return {
    id: 'shadow_word_pain',
    name: 'Shadow Word: Pain',
    kind: 'dot',
    remaining: 18,
    duration: 18,
    value,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('absorb_bar view', () => {
  it('reports no shield when there are no absorb auras', () => {
    const v = absorbBarView({ hp: 60, maxHp: 100, auras: [dot(20)] });
    expect(v.total).toBe(0);
    expect(v.overshield).toBe(false);
    // zero-width segment starts at the health edge, so nothing extra is drawn
    expect(v.fillFrac).toBeCloseTo(0.6);
    expect(v.startFrac).toBeCloseTo(0.6);
    expect(v.sizeFrac).toBe(0);
  });

  it('sums only absorb auras and extends the overlay past current health', () => {
    const v = absorbBarView({ hp: 50, maxHp: 100, auras: [shield(20), shield(10), dot(5)] });
    expect(v.total).toBe(30);
    expect(v.fillFrac).toBeCloseTo(0.8); // (50 + 30) / 100
    expect(v.startFrac).toBeCloseTo(0.5);
    expect(v.sizeFrac).toBeCloseTo(0.3);
    expect(v.overshield).toBe(false);
  });

  it('clamps the overlay and flags an overshield when absorb covers the bar', () => {
    const v = absorbBarView({ hp: 90, maxHp: 100, auras: [shield(48)] });
    expect(v.fillFrac).toBe(1); // clamped, not 1.38
    expect(v.startFrac).toBeCloseTo(0.52);
    expect(v.sizeFrac).toBeCloseTo(0.48);
    expect(v.overshield).toBe(true);
  });

  it('right-aligns a full-health shield so it stays visible', () => {
    const v = absorbBarView({ hp: 100, maxHp: 100, auras: [shield(25)] });
    expect(v.fillFrac).toBe(1);
    expect(v.startFrac).toBeCloseTo(0.75);
    expect(v.sizeFrac).toBeCloseTo(0.25);
    expect(v.overshield).toBe(true);
  });

  it('accepts a compact shield total for party snapshots', () => {
    const v = absorbBarView({ hp: 80, maxHp: 100, total: 15 });
    expect(v.total).toBe(15);
    expect(v.fillFrac).toBeCloseTo(0.95);
    expect(v.startFrac).toBeCloseTo(0.8);
    expect(v.sizeFrac).toBeCloseTo(0.15);
    expect(v.overshield).toBe(false);
  });

  it('ignores spent shields (value <= 0)', () => {
    expect(absorbTotal([shield(0), shield(-5), shield(15)])).toBe(15);
  });

  it('guards a zero maxHp against divide-by-zero', () => {
    const v = absorbBarView({ hp: 0, maxHp: 0, auras: [shield(10)] });
    expect(Number.isFinite(v.fillFrac)).toBe(true);
    expect(v.overshield).toBe(true);
  });
});

describe('absorbSegmentTransform', () => {
  it('collapses to a zero-width segment with no shield, so an unshielded bar carries no hatch', () => {
    const v = absorbBarView({ hp: 615, maxHp: 615, auras: [] });
    expect(absorbSegmentTransform(v.startFrac, v.sizeFrac)).toBe('translateX(100%) scaleX(0)');
    expect(absorbSegmentTransform(0.5, 0)).toBe('translateX(50%) scaleX(0)');
    expect(absorbSegmentTransform(0.5, -1)).toBe('translateX(50%) scaleX(0)');
  });

  it('keeps a constant two-function list shape so the CSS transition interpolates in place', () => {
    const shape = (t: string) => t.replace(/[-\d.]+/g, 'N');
    expect(shape(absorbSegmentTransform(0.5, 0))).toBe(shape(absorbSegmentTransform(0.5, 0.25)));
  });

  it('quantizes the translate to three decimals for a stable elision cache key', () => {
    expect(absorbSegmentTransform(37 / 100, 11 / 100)).toBe('translateX(37%) scaleX(0.11)');
    expect(absorbSegmentTransform(5 / 12, 1 / 12)).toBe(`translateX(41.667%) scaleX(${1 / 12})`);
    expect(absorbSegmentTransform(5 / 12, 1 / 12, (f) => `scaleX(${f.toFixed(3)})`)).toBe(
      'translateX(41.667%) scaleX(0.083)',
    );
  });

  it('places the segment at the health edge spanning only the shield width', () => {
    // 3000 hp tank with a 300 shield: 10% of the bar, starting where health ends.
    const v = absorbBarView({ hp: 2700, maxHp: 3000, auras: [shield(300)] });
    expect(absorbSegmentTransform(v.startFrac, v.sizeFrac)).toBe('translateX(90%) scaleX(0.1)');
  });

  it('right-aligns an overshield so the segment stays inside the bar', () => {
    const v = absorbBarView({ hp: 100, maxHp: 100, auras: [shield(25)] });
    expect(absorbSegmentTransform(v.startFrac, v.sizeFrac)).toBe('translateX(75%) scaleX(0.25)');
  });

  it('lists the translate BEFORE the scale (CSS application order)', () => {
    const t = absorbSegmentTransform(0.25, 0.5);
    expect(t.indexOf('translateX')).toBeLessThan(t.indexOf('scaleX'));
  });
});
