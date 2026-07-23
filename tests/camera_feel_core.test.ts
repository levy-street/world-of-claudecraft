import { describe, expect, it } from 'vitest';
import {
  cameraFovOffset,
  createCameraFeel,
  LEAD_MAX,
  LEAD_TIME,
  punchCameraFov,
  SPEED_FOV_MAX,
  stepCameraFeel,
  stepLandingDetector,
} from '../src/render/camera_feel_core';
import { RUN_SPEED } from '../src/sim/types';

// The camera feel layer: look-ahead lead, speed/impulse FOV, and the
// display-derived landing detector.

describe('look-ahead lead', () => {
  it('converges toward the capped velocity lead and recenters at rest', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 240; i++) stepCameraFeel(s, 0, RUN_SPEED, 1 / 60);
    const expected = Math.min(LEAD_MAX, RUN_SPEED * LEAD_TIME);
    expect(s.leadZ).toBeGreaterThan(expected * 0.9);
    expect(s.leadZ).toBeLessThanOrEqual(expected + 1e-6);
    expect(Math.abs(s.leadX)).toBeLessThan(1e-6);
    for (let i = 0; i < 240; i++) stepCameraFeel(s, 0, 0, 1 / 60);
    expect(Math.abs(s.leadZ)).toBeLessThan(0.02);
  });

  it('eases home when disabled (reduced motion)', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 120; i++) stepCameraFeel(s, RUN_SPEED, 0, 1 / 60);
    expect(s.leadX).toBeGreaterThan(0.5);
    for (let i = 0; i < 240; i++) stepCameraFeel(s, RUN_SPEED, 0, 1 / 60, false);
    expect(Math.abs(s.leadX)).toBeLessThan(0.02);
  });
});

describe('FOV kicks', () => {
  it('gives no speed kick at base run speed, near-max at travel-form speed', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED, 1 / 60);
    expect(s.speedKick).toBeLessThan(0.3);
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60);
    expect(s.speedKick).toBeGreaterThan(SPEED_FOV_MAX * 0.85);
  });

  it('punch impulses decay on their own and the total offset stays clamped', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 3);
    expect(cameraFovOffset(s)).toBeCloseTo(3, 5);
    for (let i = 0; i < 90; i++) stepCameraFeel(s, 0, 0, 1 / 60); // 1.5 s
    expect(Math.abs(cameraFovOffset(s))).toBeLessThan(0.1);
    punchCameraFov(s, 100);
    expect(cameraFovOffset(s)).toBeLessThanOrEqual(12);
    punchCameraFov(s, -300);
    expect(cameraFovOffset(s)).toBeGreaterThanOrEqual(-8);
  });
});

describe('landing detector', () => {
  const fall = (s: ReturnType<typeof createCameraFeel>, vy: number, frames: number): number => {
    let y = 10;
    let thump = 0;
    for (let i = 0; i < frames; i++) {
      y += vy / 60;
      thump = Math.max(thump, stepLandingDetector(s, y, 1 / 60));
    }
    // settle: height stops changing (landed)
    for (let i = 0; i < 5; i++) thump = Math.max(thump, stepLandingDetector(s, y, 1 / 60));
    return thump;
  };

  it('thumps once on a hard landing, scaled by fall speed', () => {
    const s = createCameraFeel();
    stepLandingDetector(s, 10, 1 / 60); // arm
    const hard = fall(s, -14, 20);
    expect(hard).toBeGreaterThan(0.3);
    expect(hard).toBeLessThanOrEqual(1);
    // settled: no further thumps
    expect(stepLandingDetector(s, 10 - (14 * 20) / 60, 1 / 60)).toBe(0);
  });

  it('ignores gentle landings and teleports', () => {
    const gentle = createCameraFeel();
    stepLandingDetector(gentle, 10, 1 / 60);
    expect(fall(gentle, -5, 20)).toBe(0);

    const tp = createCameraFeel();
    stepLandingDetector(tp, 10, 1 / 60);
    stepLandingDetector(tp, 10, 1 / 60);
    // A 50 yd drop in one frame is a teleport, not a landing.
    expect(stepLandingDetector(tp, -40, 1 / 60)).toBe(0);
    expect(stepLandingDetector(tp, -40, 1 / 60)).toBe(0);
  });

  it('never thumps on an instant one-frame drop (sitting down, short relocations)', () => {
    const s = createCameraFeel();
    stepLandingDetector(s, 10, 1 / 60);
    stepLandingDetector(s, 10, 1 / 60);
    // A 0.5 yd pose drop lands in ONE frame: fast "fall speed" but not a
    // sustained fall, so the settle must not kick the camera.
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
  });
});
