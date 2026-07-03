import { describe, expect, it } from 'vitest';
import { visualFacingForMove } from '../src/game/movement_visual';
import { emptyMoveInput } from '../src/sim/types';

describe('movement visual facing', () => {
  it('keeps straight forward movement on the authoritative facing', () => {
    expect(visualFacingForMove({ ...emptyMoveInput(), forward: true }, 0)).toBeNull();
  });

  it('turns the local model toward forward-right diagonal movement', () => {
    expect(
      visualFacingForMove({ ...emptyMoveInput(), forward: true, strafeRight: true }, 0),
    ).toBeCloseTo(-Math.PI / 4);
  });

  it('turns the local model toward forward-left diagonal movement', () => {
    expect(
      visualFacingForMove({ ...emptyMoveInput(), forward: true, strafeLeft: true }, 0),
    ).toBeCloseTo(Math.PI / 4);
  });

  it('turns the local model toward backward-right diagonal movement', () => {
    expect(
      visualFacingForMove({ ...emptyMoveInput(), back: true, strafeRight: true }, 0),
    ).toBeCloseTo((-3 * Math.PI) / 4);
  });

  it('turns the local model toward backward-left diagonal movement', () => {
    expect(
      visualFacingForMove({ ...emptyMoveInput(), back: true, strafeLeft: true }, 0),
    ).toBeCloseTo((3 * Math.PI) / 4);
  });
  it('rotates diagonal facing relative to the current camera/player heading', () => {
    expect(
      visualFacingForMove({ ...emptyMoveInput(), forward: true, strafeRight: true }, Math.PI / 2),
    ).toBeCloseTo(Math.PI / 4);
  });
});
