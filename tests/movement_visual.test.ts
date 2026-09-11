import { describe, expect, it } from 'vitest';
import {
  diagonalMovementVisualFacing,
  diagonalMovementVisualOffset,
  easeMovementVisualOffset,
} from '../src/game/movement_visual';

describe('diagonalMovementVisualFacing', () => {
  it('points into forward diagonals relative to the base facing', () => {
    expect(
      diagonalMovementVisualFacing(
        { forward: true, back: false, strafeLeft: false, strafeRight: true },
        0,
      ),
    ).toBeCloseTo(-Math.PI / 4);

    expect(
      diagonalMovementVisualFacing(
        { forward: true, back: false, strafeLeft: true, strafeRight: false },
        0,
      ),
    ).toBeCloseTo(Math.PI / 4);
  });

  it('keeps pure forward, pure strafe, and pure back presentation unchanged', () => {
    expect(
      diagonalMovementVisualFacing(
        { forward: true, back: false, strafeLeft: false, strafeRight: false },
        0,
      ),
    ).toBeNull();
    expect(
      diagonalMovementVisualFacing(
        { forward: false, back: false, strafeLeft: false, strafeRight: true },
        0,
      ),
    ).toBeNull();
    expect(
      diagonalMovementVisualFacing(
        { forward: false, back: true, strafeLeft: false, strafeRight: false },
        0,
      ),
    ).toBeNull();
  });

  it('wraps back diagonals onto the shortest yaw range', () => {
    expect(
      diagonalMovementVisualFacing(
        { forward: false, back: true, strafeLeft: false, strafeRight: true },
        Math.PI,
      ),
    ).toBeCloseTo(Math.PI / 4);
  });
});

describe('easing the diagonal turn', () => {
  it('reports the offset as a step, which is why it must be eased', () => {
    // The raw signal is three fixed values, and applying it directly is what
    // made the character snap between headings on A/D.
    expect(
      diagonalMovementVisualOffset({
        forward: true,
        back: false,
        strafeLeft: false,
        strafeRight: false,
      }),
    ).toBeNull();
    expect(
      diagonalMovementVisualOffset({
        forward: false,
        back: false,
        strafeLeft: false,
        strafeRight: true,
      }),
    ).toBeNull();
    const diag = diagonalMovementVisualOffset({
      forward: true,
      back: false,
      strafeLeft: false,
      strafeRight: true,
    });
    expect(diag).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('walks toward the target instead of jumping to it, and settles there', () => {
    let v = 0;
    const target = -Math.PI / 4;
    const first = easeMovementVisualOffset(v, target, 1 / 60);
    expect(Math.abs(first)).toBeGreaterThan(0); // it moves...
    expect(Math.abs(first)).toBeLessThan(Math.abs(target) * 0.5); // ...but not all at once
    v = first;
    for (let i = 0; i < 60; i++) v = easeMovementVisualOffset(v, target, 1 / 60);
    expect(v).toBeCloseTo(target, 3); // and it arrives
  });

  it('turns the SHORT way across the wrap, not the long way round', () => {
    // +170 to -170 degrees is a 20 degree flick. A plain lerp of the two
    // numbers would animate 340 degrees the other way.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const next = easeMovementVisualOffset(from, to, 1 / 60);
    // One step must take it FURTHER from zero (past +180 and round), never back
    // down through the middle.
    expect(Math.abs(next)).toBeGreaterThan(Math.abs(from) - 1e-9);
  });

  it('is frame-rate independent: the same wall time lands in the same place', () => {
    const target = 1;
    let slow = 0;
    for (let i = 0; i < 6; i++) slow = easeMovementVisualOffset(slow, target, 1 / 60);
    let fast = 0;
    for (let i = 0; i < 12; i++) fast = easeMovementVisualOffset(fast, target, 1 / 120);
    expect(slow).toBeCloseTo(fast, 3);
  });
});
