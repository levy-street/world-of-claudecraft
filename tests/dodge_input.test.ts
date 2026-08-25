import { describe, expect, it } from 'vitest';
import {
  DodgeDoubleTapTracker,
  dodgeDirectionForAction,
  heldDodgeDirection,
  localDodgeToWorld,
} from '../src/game/dodge_input';

describe('dodge input', () => {
  it('requires press, release, press inside the double-tap window', () => {
    const tracker = new DodgeDoubleTapTracker(250);

    expect(tracker.press('KeyW', 1000)).toBe(false);
    expect(tracker.press('KeyW', 1100)).toBe(false);
    tracker.release('KeyW');
    expect(tracker.press('KeyW', 1200)).toBe(true);
    expect(tracker.press('KeyW', 1250)).toBe(false);
  });

  it('expires old taps and clears transient history on focus loss', () => {
    const tracker = new DodgeDoubleTapTracker(250);
    expect(tracker.press('KeyA', 100)).toBe(false);
    tracker.release('KeyA');
    expect(tracker.press('KeyA', 351)).toBe(false);
    tracker.release('KeyA');
    tracker.clear();
    expect(tracker.press('KeyA', 400)).toBe(false);
  });

  it('maps turn and strafe keys to the same lateral dodge directions', () => {
    expect(dodgeDirectionForAction('forward')).toEqual({ x: 0, z: 1 });
    expect(dodgeDirectionForAction('turnLeft')).toEqual({ x: -1, z: 0 });
    expect(dodgeDirectionForAction('strafeLeft')).toEqual({ x: -1, z: 0 });
    expect(dodgeDirectionForAction('turnRight')).toEqual({ x: 1, z: 0 });
    expect(dodgeDirectionForAction('jump')).toBeNull();
  });

  it('uses the held diagonal for the dedicated bind and falls back backward while idle', () => {
    const diagonal = heldDodgeDirection({
      forward: true,
      back: false,
      turnLeft: true,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
    });
    expect(diagonal.x).toBeCloseTo(-Math.SQRT1_2);
    expect(diagonal.z).toBeCloseTo(Math.SQRT1_2);
    expect(
      heldDodgeDirection({
        forward: false,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
      }),
    ).toEqual({ x: 0, z: -1 });
  });

  it('rotates local dodge intent into the character facing frame', () => {
    expect(localDodgeToWorld({ x: 0, z: 1 }, Math.PI / 2)).toEqual(
      expect.objectContaining({ x: expect.closeTo(1), z: expect.closeTo(0) }),
    );
    expect(localDodgeToWorld({ x: 1, z: 0 }, 0)).toEqual(
      expect.objectContaining({ x: expect.closeTo(-1), z: expect.closeTo(0) }),
    );
  });
});
