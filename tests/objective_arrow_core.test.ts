// The on-screen objective pointer's placement math. Shared by both onboardings, so
// a bug here is a bug in two features at once.

import { describe, expect, it } from 'vitest';
import { ARROW_MARGIN, objectiveArrowPlacement } from '../src/ui/objective_arrow_core';

const W = 1000;
const H = 600;

describe('objective arrow placement', () => {
  it('points from screen centre toward the target', () => {
    // Target dead right of centre: the arrow points along +x (angle 0).
    const right = objectiveArrowPlacement({ x: 900, y: 300, behind: false }, W, H);
    expect(right.angle).toBeCloseTo(0, 6);

    // Target dead below centre: +y is down in screen space, so that is +PI/2.
    const below = objectiveArrowPlacement({ x: 500, y: 550, behind: false }, W, H);
    expect(below.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('mirrors a target that is behind the camera', () => {
    // A point behind the camera projects INVERTED. Taken at face value the arrow
    // would point at the exact opposite of the objective, which is worse than no
    // arrow. The same raw projection must come out pointing opposite ways depending
    // on `behind`.
    const ahead = objectiveArrowPlacement({ x: 900, y: 300, behind: false }, W, H);
    const behind = objectiveArrowPlacement({ x: 900, y: 300, behind: true }, W, H);
    expect(Math.abs(behind.angle - ahead.angle)).toBeCloseTo(Math.PI, 6);
  });

  it('clamps to the screen margin but keeps the true direction', () => {
    // Far off-screen up and to the left.
    const p = objectiveArrowPlacement({ x: -4000, y: -3000, behind: false }, W, H);
    expect(p.x).toBe(ARROW_MARGIN);
    expect(p.y).toBe(ARROW_MARGIN);
    // The angle is taken BEFORE clamping: clamping first would flatten every
    // off-screen target's direction against the corner it was clamped into.
    const cx = W / 2;
    const cy = H / 2;
    expect(p.angle).toBeCloseTo(Math.atan2(-3000 - cy, -4000 - cx), 6);
    expect(p.angle).not.toBeCloseTo(Math.atan2(ARROW_MARGIN - cy, ARROW_MARGIN - cx), 3);
  });

  it('leaves an on-screen target where it is', () => {
    const p = objectiveArrowPlacement({ x: 640, y: 380, behind: false }, W, H);
    expect(p.x).toBe(640);
    expect(p.y).toBe(380);
  });
});
