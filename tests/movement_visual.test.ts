import { describe, expect, it } from 'vitest';
import { diagonalMovementVisualFacing } from '../src/game/movement_visual';

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
