import { describe, expect, it } from 'vitest';
import {
  wheelSegments,
  pointerFractionAfter,
  segmentAtFraction,
  landingRotation,
  segmentProbability,
  fitsLabel,
  WheelInput,
} from '../src/ui/spin_wheel_core';

const ITEMS: WheelInput[] = [
  { key: 'none', weight: 600 },
  { key: 'dust_s', weight: 250 },
  { key: 'dust_m', weight: 100 },
  { key: 'dust_l', weight: 40 },
  { key: 'shard', weight: 9 },
  { key: 'jackpot', weight: 1 },
];

describe('wheelSegments', () => {
  it('lays out contiguous segments covering [0,1) proportional to weight', () => {
    const segs = wheelSegments(ITEMS);
    expect(segs[0].startFraction).toBe(0);
    expect(segs[segs.length - 1].endFraction).toBeCloseTo(1, 12);
    for (let i = 1; i < segs.length; i++) expect(segs[i].startFraction).toBeCloseTo(segs[i - 1].endFraction, 12);
    expect(segs[0].endFraction).toBeCloseTo(0.6, 12); // 600/1000
    expect(segs.find((s) => s.key === 'jackpot')!.endFraction - segs.find((s) => s.key === 'jackpot')!.startFraction).toBeCloseTo(0.001, 12);
  });

  it('throws on empty input or a non-positive weight', () => {
    expect(() => wheelSegments([])).toThrow(/no items/);
    expect(() => wheelSegments([{ key: 'x', weight: 0 }])).toThrow(/bad weight/);
    expect(() => wheelSegments([{ key: 'x', weight: -1 }])).toThrow(/bad weight/);
  });
});

describe('pointerFractionAfter', () => {
  it('normalizes any rotation into [0,1)', () => {
    expect(pointerFractionAfter(0)).toBe(0);
    expect(pointerFractionAfter(5.25)).toBeCloseTo(0.25, 12);
    expect(pointerFractionAfter(-0.25)).toBeCloseTo(0.75, 12);
  });
});

describe('segmentAtFraction', () => {
  const segs = wheelSegments(ITEMS);
  it('maps fractions to the owning segment, boundary to the next', () => {
    expect(segmentAtFraction(segs, 0).key).toBe('none');
    expect(segmentAtFraction(segs, 0.59).key).toBe('none');
    expect(segmentAtFraction(segs, 0.6).key).toBe('dust_s'); // boundary -> next
    expect(segmentAtFraction(segs, 0.9999).key).toBe('jackpot');
  });
});

describe('landingRotation', () => {
  const segs = wheelSegments(ITEMS);

  it('lands the pointer inside the target segment for every key and jitter', () => {
    for (const seg of segs) {
      for (const jitter of [-1, -0.5, 0, 0.5, 1]) {
        const rot = landingRotation(segs, seg.key, 5, jitter);
        const landed = pointerFractionAfter(rot);
        expect(landed).toBeGreaterThanOrEqual(seg.startFraction);
        expect(landed).toBeLessThan(seg.endFraction);
        expect(segmentAtFraction(segs, landed).key).toBe(seg.key);
        expect(rot).toBeGreaterThanOrEqual(5); // the full spins are included
      }
    }
  });

  it('throws for a key not on the wheel', () => {
    expect(() => landingRotation(segs, 'nope', 3)).toThrow(/no segment/);
  });
});

describe('segmentProbability', () => {
  const segs = wheelSegments(ITEMS);
  it('equals the weight share and sums to 1 across the wheel', () => {
    const total = ITEMS.reduce((s, i) => s + i.weight, 0);
    segs.forEach((seg, i) => expect(segmentProbability(seg)).toBeCloseTo(ITEMS[i].weight / total, 12));
    expect(segs.reduce((s, seg) => s + segmentProbability(seg), 0)).toBeCloseTo(1, 12);
  });
});

describe('fitsLabel', () => {
  const segs = wheelSegments(ITEMS);
  it('keeps labels on wide slices and drops them on thin ones (default 7%)', () => {
    const fit = (key: string) => fitsLabel(segs.find((s) => s.key === key)!);
    expect(fit('none')).toBe(true); // 60%
    expect(fit('dust_s')).toBe(true); // 25%
    expect(fit('dust_m')).toBe(true); // 10%
    expect(fit('dust_l')).toBe(false); // 4%
    expect(fit('shard')).toBe(false); // 0.9%
    expect(fit('jackpot')).toBe(false); // 0.1%
  });

  it('honors a custom minimum at the boundary', () => {
    const dustL = segs.find((s) => s.key === 'dust_l')!; // exactly 0.04
    expect(fitsLabel(dustL, 0.04)).toBe(true);
    expect(fitsLabel(dustL, 0.0401)).toBe(false);
  });
});
