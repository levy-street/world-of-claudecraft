import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import { absorbBarView, absorbTotal } from '../src/ui/absorb_bar';

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
    expect(v.startFrac).toBeCloseTo(0.8);
    expect(v.sizeFrac).toBeCloseTo(0.15);
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
