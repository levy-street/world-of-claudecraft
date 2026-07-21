import { describe, expect, it } from 'vitest';
import { FLEE_MAX_SPEED, FLEE_SPEED_MULT, fleeSpeed } from '../src/sim/flee_speed';
import { RUN_SPEED } from '../src/sim/types';

describe('fleeSpeed', () => {
  it('caps the final flee speed at 65% of the player base run speed', () => {
    expect(FLEE_MAX_SPEED).toBeCloseTo(RUN_SPEED * 0.65);
    // The player always outruns a fleeing mob and can catch it.
    expect(FLEE_MAX_SPEED).toBeLessThan(RUN_SPEED);
    // A slow (unbuffed) mob still flees at base * FLEE_SPEED_MULT, below the cap.
    expect(fleeSpeed(2, 1)).toBeCloseTo(2 * FLEE_SPEED_MULT);
    expect(fleeSpeed(6, 1)).toBe(FLEE_MAX_SPEED); // 6 * 1.4 = 8.4 -> capped
  });

  it('never lets a speed-buffed fleeing mob outrun the player (the bug)', () => {
    // buff_speed / form_travel carry a >1 multiplier. The flee speed must STILL
    // be capped well below the player's base run speed, not multiplied past it.
    expect(fleeSpeed(5, 1.4)).toBeLessThanOrEqual(FLEE_MAX_SPEED);
    expect(fleeSpeed(7, 1.4)).toBe(FLEE_MAX_SPEED);
    // Even a fast mob with a big haste buff cannot exceed the cap.
    expect(fleeSpeed(7, 2)).toBe(FLEE_MAX_SPEED);
  });

  it('still slows a fleeing mob below the cap when it is snared', () => {
    // A slow aura (mult < 1) brings the mob below the cap; the cap is only a ceiling.
    expect(fleeSpeed(2, 0.5)).toBeCloseTo(2 * FLEE_SPEED_MULT * 0.5);
    expect(fleeSpeed(2, 0.5)).toBeLessThan(FLEE_MAX_SPEED);
  });

  it('is deterministic for the same inputs', () => {
    expect(fleeSpeed(5, 1.4)).toEqual(fleeSpeed(5, 1.4));
  });
});
