import { describe, expect, it } from 'vitest';
import {
  createGroundTilt,
  GROUND_TILT_BLEND,
  GROUND_TILT_MAX,
  resetGroundTilt,
  stepGroundTilt,
} from '../src/render/ground_tilt_core';

// Terrain lean: the body tips toward the surface it stands on, in its OWN
// frame, so the same hillside reads as a backward lean walking up it and a
// sideways bank crossing it.

const DT = 1 / 60;
const settle = (s: ReturnType<typeof createGroundTilt>, gx: number, gz: number, facing: number) => {
  for (let i = 0; i < 240; i++) stepGroundTilt(s, gx, gz, facing, true, DT);
};

describe('ground tilt', () => {
  it('stays upright on flat ground', () => {
    const s = createGroundTilt();
    settle(s, 0, 0, 0);
    expect(s.pitch).toBeCloseTo(0, 6);
    expect(s.roll).toBeCloseTo(0, 6);
  });

  it('leans BACK facing uphill and FORWARD facing downhill', () => {
    // Ground rises toward +z; facing 0 is +z, so this is uphill ahead.
    const up = createGroundTilt();
    settle(up, 0, 0.5, 0);
    expect(up.pitch).toBeLessThan(-0.05); // head back
    expect(Math.abs(up.roll)).toBeLessThan(1e-6); // no bank, slope is dead ahead

    // Same hill, facing the other way: now it falls away ahead.
    const down = createGroundTilt();
    settle(down, 0, 0.5, Math.PI);
    expect(down.pitch).toBeGreaterThan(0.05); // head forward, down the slope
    expect(Math.abs(down.roll)).toBeLessThan(1e-6);
  });

  it('banks sideways when the same slope is crossed', () => {
    // Facing +x (half pi) across a slope that rises toward +z.
    const s = createGroundTilt();
    settle(s, 0, 0.5, Math.PI / 2);
    expect(Math.abs(s.pitch)).toBeLessThan(1e-6); // nothing ahead or behind
    expect(Math.abs(s.roll)).toBeGreaterThan(0.05); // all of it is a bank
  });

  it('takes only a fraction of the true angle, and never exceeds the clamp', () => {
    const s = createGroundTilt();
    const slope = 0.5;
    settle(s, 0, slope, 0);
    const trueAngle = Math.atan(slope);
    expect(Math.abs(s.pitch)).toBeCloseTo(trueAngle * GROUND_TILT_BLEND, 4);
    expect(Math.abs(s.pitch)).toBeLessThan(trueAngle); // partial, not full

    const cliff = createGroundTilt();
    settle(cliff, 0, 40, 0); // absurd wall
    expect(Math.abs(cliff.pitch)).toBeLessThanOrEqual(GROUND_TILT_MAX + 1e-9);
  });

  it('eases rather than snapping when the surface changes', () => {
    // Cresting a ridge must roll the body over, not cut to the new pose. A
    // snap would reach the target on frame one; this must take real frames.
    const s = createGroundTilt();
    settle(s, 0, 0, 0);
    const target = -GROUND_TILT_MAX; // a wall, so the target is the clamp
    let frames = 0;
    while (Math.abs(s.pitch) < Math.abs(target) * 0.9 && frames < 600) {
      stepGroundTilt(s, 0, 1.2, 0, true, DT);
      frames++;
    }
    expect(frames).toBeGreaterThan(8);
    expect(frames).toBeLessThan(40); // but still responsive, under 2/3 s
  });

  it('returns upright when airborne or standing on a flat prop', () => {
    const s = createGroundTilt();
    settle(s, 0, 0.8, 0);
    expect(Math.abs(s.pitch)).toBeGreaterThan(0.05);
    for (let i = 0; i < 240; i++) stepGroundTilt(s, 0, 0.8, 0, false, DT);
    expect(Math.abs(s.pitch)).toBeLessThan(0.01);
  });

  it('is frame-rate independent and resettable', () => {
    const a = createGroundTilt();
    const b = createGroundTilt();
    stepGroundTilt(a, 0, 0, 0, true, 1 / 60);
    stepGroundTilt(b, 0, 0, 0, true, 1 / 240);
    for (let i = 0; i < 12; i++) stepGroundTilt(a, 0, 0.6, 0, true, 1 / 60);
    for (let i = 0; i < 48; i++) stepGroundTilt(b, 0, 0.6, 0, true, 1 / 240);
    expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(0.01);
    resetGroundTilt(a);
    expect(a.pitch).toBe(0);
    expect(a.active).toBe(false);
  });
});
