// The Knotted Gale's look (breath_heart_fx_core.ts): what the sim's numbers paint, the
// floor rungs untied, the throw's arc, the burst. And BreathFightFx really takes the
// mechanic's objects and marks: the same fight state a player acts on.

import { describe, expect, it } from 'vitest';
import {
  burstLook,
  HEART_FLOOR,
  heartObjectKind,
  heartRungs,
  knotLook,
  liveFuse,
  markFill,
  portalLink,
  THROW_ARC,
  throwHeading,
  throwOffset,
} from '../src/render/smith_heart_fx/breath_heart_fx_core';
import {
  BREATH_OBJECTS,
  knotTemplate,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';

describe('Knotted Gale: the look', () => {
  it('knows its objects and nothing else', () => {
    expect(heartObjectKind(knotTemplate('held', 3))).toBe('knot');
    expect(heartObjectKind(BREATH_OBJECTS.portalA)).toBe('portalA');
    expect(heartObjectKind(BREATH_OBJECTS.portalB)).toBe('portalB');
    expect(heartObjectKind(BREATH_OBJECTS.vortex)).toBeNull();
  });

  it('the ring shrinks to the pick-up as the ball grows and rages', () => {
    const full = knotLook(T.heartFuse);
    const end = knotLook(0);
    expect(end.ringR).toBeCloseTo(T.heartPickR, 5);
    expect(full.ringR).toBeGreaterThan(end.ringR + 4);
    expect(end.radius).toBeGreaterThan(full.radius);
    expect(end.crackle).toBeGreaterThan(full.crackle);
    expect(end.spin).toBeGreaterThan(full.spin);
    expect(full.danger).toBe(0);
    expect(end.danger).toBe(1);
    expect(full.throb).toBe(0);
    expect(knotLook(1).throb).toBeGreaterThan(0);
    let last = Number.POSITIVE_INFINITY;
    for (let f = T.heartFuse; f >= 0; f -= 1) {
      const r = knotLook(f).ringR;
      expect(r).toBeLessThan(last);
      last = r;
    }
    expect(liveFuse(10, 0.25)).toBeCloseTo(9.75, 6);
    expect(liveFuse(0.5, 3)).toBe(0);
  });

  it('every floor rung is its own, above the fight footprints', () => {
    const rungs = heartRungs();
    expect(new Set(rungs).size).toBe(rungs.length);
    for (const r of rungs) expect(r).toBeGreaterThan(30);
    expect(HEART_FLOOR.ring).toBeGreaterThan(HEART_FLOOR.disc);
  });

  it('the link, the marks, the throw and the burst', () => {
    const l = portalLink(0, 0, 0, 10);
    expect(l.len).toBe(10);
    expect(l.mz).toBe(5);
    expect(markFill(5, 5)).toBe(0);
    expect(markFill(0, 5)).toBe(1);
    const h = throwHeading(14, 221);
    expect(Math.hypot(h.x, h.z)).toBeCloseTo(1, 6);
    expect(h.z).toBeGreaterThan(0);
    const out = { x: 0, y: 0, z: 0 };
    expect(throwOffset(THROW_ARC.seconds * 0.3, h, out)).toBe(true);
    expect(out.y).toBeGreaterThan(0);
    expect(throwOffset(THROW_ARC.seconds * 0.95, h, out)).toBe(true);
    expect(out.y).toBeLessThan(0);
    expect(throwOffset(THROW_ARC.seconds, h, out)).toBe(false);
    const a = burstLook(0.1);
    const b = burstLook(1);
    expect(b?.radius ?? 0).toBeGreaterThan(a?.radius ?? 0);
    expect(burstLook(5)).toBeNull();
  });
});
