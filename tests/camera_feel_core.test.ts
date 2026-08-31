import { describe, expect, it } from 'vitest';
import {
  cameraFovOffset,
  createCameraFeel,
  punchCameraFov,
  resolveCameraFov,
  stepCameraFeel,
  stepLandingDetector,
} from '../src/render/camera_feel_core';
import { RUN_SPEED } from '../src/sim/types';

describe('FOV kicks', () => {
  it('gives no speed kick at base run speed, near-max at travel-form speed', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED, 1 / 60);
    expect(s.speedKick).toBeLessThan(0.3);
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60);
    expect(s.speedKick).toBeGreaterThan(5.1);
    expect(s.speedKick).toBeLessThanOrEqual(6);
  });

  it('eases a running speed kick to zero when reduced motion is enabled', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60);
    expect(s.speedKick).toBeGreaterThan(5.1);
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60, false);
    expect(Math.abs(s.speedKick)).toBeLessThan(0.001);
  });

  it('punch impulses decay on their own and the total offset stays clamped', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 3);
    expect(cameraFovOffset(s)).toBeCloseTo(3, 5);
    for (let i = 0; i < 90; i++) stepCameraFeel(s, 0, 0, 1 / 60); // 1.5 s
    expect(Math.abs(cameraFovOffset(s))).toBeLessThan(0.1);
    punchCameraFov(s, 100);
    expect(cameraFovOffset(s)).toBe(12);
    punchCameraFov(s, -300);
    expect(cameraFovOffset(s)).toBe(-8);
  });
});

describe('resolveCameraFov (the player-configured FOV slider)', () => {
  it('honors a non-default base FOV at rest, instead of snapping back to a hard-coded 60', () => {
    const s = createCameraFeel();
    expect(resolveCameraFov(80, s)).toBeCloseTo(80, 5);
    expect(resolveCameraFov(55, s)).toBeCloseTo(55, 5);
    expect(resolveCameraFov(100, s)).toBeCloseTo(100, 5);
  });

  it('applies the feel kicks on top of the configured base, not on top of a fixed default', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 5);
    expect(resolveCameraFov(70, s)).toBeCloseTo(75, 5);
    expect(resolveCameraFov(60, s)).toBeCloseTo(65, 5);
  });

  it('still clamps the combined result to the 50..100 envelope at either extreme', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 50);
    expect(resolveCameraFov(100, s)).toBe(100);
    punchCameraFov(s, -200);
    expect(resolveCameraFov(55, s)).toBe(50);
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
    expect(hard).toBeCloseTo(7 / 13, 5);
    // settled: no further thumps
    expect(stepLandingDetector(s, 10 - (14 * 20) / 60, 1 / 60)).toBe(0);
  });

  it('scales landing thumps with sustained fall speed', () => {
    const medium = createCameraFeel();
    stepLandingDetector(medium, 10, 1 / 60);
    const hard = createCameraFeel();
    stepLandingDetector(hard, 10, 1 / 60);
    expect(fall(hard, -18, 20)).toBeGreaterThan(fall(medium, -10, 20));
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
