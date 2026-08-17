import { describe, expect, it } from 'vitest';
import {
  createMetamorphWingPose,
  metamorphWingPoseInto,
} from '../src/render/characters/metamorph_wing_motion_core';

describe('Metamorphosis wing motion', () => {
  it('unfolds over the transformation window without continuous large flapping', () => {
    const start = createMetamorphWingPose();
    const settled = createMetamorphWingPose();
    const later = createMetamorphWingPose();

    metamorphWingPoseInto(0.05, false, false, false, false, false, start);
    metamorphWingPoseInto(0.55, false, false, false, false, false, settled);
    metamorphWingPoseInto(1.2, false, false, false, false, false, later);

    expect(start.unfold).toBeLessThan(0.2);
    expect(settled.unfold).toBe(1);
    expect(later.unfold).toBe(1);
    expect(Math.abs(later.breath)).toBeLessThanOrEqual(0.035);
    for (let elapsed = 0.5; elapsed <= 8; elapsed += 0.125) {
      metamorphWingPoseInto(elapsed, false, false, false, false, false, later);
      expect(Math.abs(later.breath)).toBeLessThanOrEqual(0.028);
    }
  });

  it('draws the wings back while running and opens them for casts and attacks', () => {
    const idle = createMetamorphWingPose();
    const walking = createMetamorphWingPose();
    const running = createMetamorphWingPose();
    const casting = createMetamorphWingPose();
    const attacking = createMetamorphWingPose();
    const castAttack = createMetamorphWingPose();
    const airborne = createMetamorphWingPose();

    metamorphWingPoseInto(1, false, false, false, false, false, idle);
    metamorphWingPoseInto(1, true, false, false, false, false, walking);
    metamorphWingPoseInto(1, true, true, false, false, false, running);
    metamorphWingPoseInto(1, false, false, false, true, false, casting);
    metamorphWingPoseInto(1, false, false, false, false, true, attacking);
    metamorphWingPoseInto(1, false, false, false, true, true, castAttack);
    metamorphWingPoseInto(1, true, true, true, false, false, airborne);

    expect(walking.sweepBack).toBeGreaterThan(idle.sweepBack);
    expect(running.sweepBack).toBeGreaterThan(idle.sweepBack);
    expect(running.sweepBack).toBeGreaterThan(walking.sweepBack);
    expect(casting.open).toBeGreaterThan(idle.open);
    expect(attacking.open).toBeGreaterThan(idle.open);
    expect(castAttack.open).toBe(casting.open);
    expect(airborne.open).toBeGreaterThan(casting.open);
    expect(airborne.sweepBack).toBeLessThan(running.sweepBack);
  });

  it('settles immediately into a static readable pose with reduced motion', () => {
    const first = createMetamorphWingPose();
    const later = createMetamorphWingPose();

    metamorphWingPoseInto(0.02, false, false, false, false, true, first, true);
    metamorphWingPoseInto(5, false, false, false, false, true, later, true);

    expect(first).toEqual(later);
    expect(first.unfold).toBe(1);
    expect(first.breath).toBe(0);
  });
});
