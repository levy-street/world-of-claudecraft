import { describe, expect, it } from 'vitest';
import { courierFacing, courierVisualPoseInto } from '../src/render/courier_visual_core';

describe('courier visual presentation', () => {
  it('runs before takeoff and after landing on both journey legs', () => {
    const out = { lift: 0, flight: 0, moving: false };
    for (const phase of ['outbound', 'returning'] as const) {
      for (const [travelDistance, remainingDistance, lift] of [
        [0, 30, 0],
        [3, 30, 0],
        [5.5, 30, 1],
        [8, 30, 2],
        [8, 5.5, 1],
        [8, 3, 0],
      ]) {
        courierVisualPoseInto(out, { phase, x: 0, z: 0, travelDistance, remainingDistance }, false);
        expect(out.lift).toBe(lift);
        expect(out.moving).toBe(true);
      }
    }
  });
  it('keeps short trips grounded and has no local elapsed-time flight guess', () => {
    const out = { lift: 2, flight: 1, moving: true };
    for (let travelled = 0; travelled <= 6; travelled++) {
      courierVisualPoseInto(
        out,
        {
          phase: 'outbound',
          x: 0,
          z: 0,
          travelDistance: travelled,
          remainingDistance: 6 - travelled,
        },
        false,
      );
      expect(out.lift).toBe(0);
    }
    courierVisualPoseInto(out, { phase: 'returning', x: 0, z: 0 }, false);
    expect(out).toEqual({ lift: 0, flight: 0, moving: false });
  });
  it('idles on the ground while ready or waiting, but runs when following its owner', () => {
    const out = { lift: 2, flight: 1, moving: true };
    for (const phase of ['ready', 'waiting'] as const) {
      courierVisualPoseInto(
        out,
        { phase, x: 0, z: 0, travelDistance: 8, remainingDistance: 50 },
        false,
      );
      expect(out).toEqual({ lift: 0, flight: 0, moving: false });
      courierVisualPoseInto(out, { phase, x: 0, z: 0 }, true);
      expect(out).toEqual({ lift: 0, flight: 0, moving: true });
    }
  });
  it('faces observed movement and holds facing when stationary', () => {
    expect(courierFacing(0, 0, 1, 0, 0)).toBe(Math.PI / 2);
    expect(courierFacing(1, 2, 1, 2, 1.2)).toBe(1.2);
    expect(courierFacing(0, 1, 0, 0, 0)).toBe(Math.PI);
  });
});
