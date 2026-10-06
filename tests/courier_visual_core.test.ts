import { describe, expect, it } from 'vitest';
import { courierFacing, courierVisualPoseInto } from '../src/render/courier_visual_core';

describe('courier visual presentation', () => {
  it('keeps the reduced-motion pose still through every journey phase', () => {
    const out = { lift: 0, wing: 0, pitch: 0 };
    for (const phase of ['ready', 'outbound', 'returning', 'waiting'] as const) {
      for (const elapsed of [0, 0.14, 50]) {
        courierVisualPoseInto(out, phase, elapsed, true);
        expect(out).toEqual({ lift: 2, wing: 0.2, pitch: 0 });
      }
    }
  });
  it('animates wings with bounded lift and tilts only during travel', () => {
    const out = { lift: 0, wing: 0, pitch: 0 };
    const wings = new Set<number>();
    for (let i = 0; i < 100; i++) {
      courierVisualPoseInto(out, 'outbound', i / 60, false);
      expect(out.lift).toBeGreaterThanOrEqual(1.93);
      expect(out.lift).toBeLessThanOrEqual(2.07);
      expect(out.pitch).toBe(-0.08);
      wings.add(out.wing);
    }
    expect(wings.size).toBeGreaterThan(20);
    courierVisualPoseInto(out, 'waiting', 1, false);
    expect(out.pitch).toBe(0);
  });
  it('faces observed movement and holds facing when stationary', () => {
    expect(courierFacing(0, 0, 1, 0, 0)).toBe(Math.PI / 2);
    expect(courierFacing(1, 2, 1, 2, 1.2)).toBe(1.2);
    expect(courierFacing(0, 1, 0, 0, 0)).toBe(Math.PI);
  });
});
