import { describe, expect, it } from 'vitest';
import { CLICK_MOVE_FORWARD_CONE, angleDelta, clickMoveShouldWalk, clickMoveStep, facingToward, latencyAdjustedStopDistance, manualMovementOverrides, resolveClickMoveAction, stepAngleToward } from '../src/game/click_move';

const NO_INPUT = { forward: false, back: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, jump: false };

describe('click-to-move math (#95)', () => {
  it('walks forward and faces the destination while far away', () => {
    const step = clickMoveStep({ x: 0, z: 0 }, { x: 0, z: 10 }, 0.5);
    expect(step.forward).toBe(true);
    expect(step.arrived).toBe(false);
    expect(step.facing).toBeCloseTo(facingToward({ x: 0, z: 0 }, { x: 0, z: 10 }));
  });

  it('stops once within the stop distance (e.g. melee approach)', () => {
    const step = clickMoveStep({ x: 0, z: 0 }, { x: 0, z: 4 }, 5);
    expect(step.forward).toBe(false);
    expect(step.arrived).toBe(true);
  });

  it('expands the online stop distance by capped input echo latency', () => {
    expect(latencyAdjustedStopDistance(0.5, 0, 7, 1.6)).toBeCloseTo(0.5);
    expect(latencyAdjustedStopDistance(0.5, 100, 7, 1.6)).toBeCloseTo(1.2);
    expect(latencyAdjustedStopDistance(0.5, 1000, 7, 1.6)).toBeCloseTo(2.1);
    expect(latencyAdjustedStopDistance(0.5, -20, 7, 1.6)).toBeCloseTo(0.5);
  });

  it('faces +z and +x correctly (sim atan2(dx, dz) convention)', () => {
    expect(facingToward({ x: 0, z: 0 }, { x: 0, z: 1 })).toBeCloseTo(0); // due north
    expect(facingToward({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2); // due east
  });

  it('manual movement input cancels click-to-move', () => {
    expect(manualMovementOverrides(NO_INPUT)).toBe(false);
    expect(manualMovementOverrides({ ...NO_INPUT, forward: true })).toBe(true);
    expect(manualMovementOverrides({ ...NO_INPUT, strafeLeft: true })).toBe(true);
  });

  it('jump does not cancel click-to-move, you keep travelling through the hop', () => {
    expect(manualMovementOverrides({ ...NO_INPUT, jump: true })).toBe(false);
    expect(resolveClickMoveAction({ ...NO_INPUT, jump: true }, {
      mouselook: false,
      movementSuspended: false,
      playerDead: false,
      enabled: true,
    })).toBe('continue');
  });

  it('cancels click-to-move when the player dies', () => {
    expect(resolveClickMoveAction(NO_INPUT, {
      mouselook: false,
      movementSuspended: false,
      playerDead: true,
      enabled: true,
    })).toBe('cancel');
  });

  it('keeps click-to-move active while enabled and uninterrupted', () => {
    expect(resolveClickMoveAction(NO_INPUT, {
      mouselook: false,
      movementSuspended: false,
      playerDead: false,
      enabled: true,
    })).toBe('continue');
  });

  // Opening the Esc/game menu suspends movement. That must PAUSE the run (keep the
  // destination so it resumes when the menu closes), not silently cancel it.
  it('pauses (does not cancel) click-to-move while movement is suspended by a menu', () => {
    expect(resolveClickMoveAction(NO_INPUT, {
      mouselook: false,
      movementSuspended: true,
      playerDead: false,
      enabled: true,
    })).toBe('pause');
  });

  it('a real interrupt still cancels even while suspended (cancel wins over pause)', () => {
    expect(resolveClickMoveAction({ ...NO_INPUT, forward: true }, {
      mouselook: false,
      movementSuspended: true,
      playerDead: false,
      enabled: true,
    })).toBe('cancel');
    expect(resolveClickMoveAction(NO_INPUT, {
      mouselook: false,
      movementSuspended: true,
      playerDead: true,
      enabled: true,
    })).toBe('cancel');
  });

  it('only walks forward when aimed within the cone, else turns in place', () => {
    expect(clickMoveShouldWalk(0, 0)).toBe(true); // dead on
    expect(clickMoveShouldWalk(0, CLICK_MOVE_FORWARD_CONE - 0.01)).toBe(true);
    expect(clickMoveShouldWalk(0, CLICK_MOVE_FORWARD_CONE + 0.01)).toBe(false);
    expect(clickMoveShouldWalk(0, Math.PI / 2)).toBe(false); // target to the side
    expect(clickMoveShouldWalk(0, Math.PI)).toBe(false); // target behind
    // shortest-arc aware, sign-independent
    expect(clickMoveShouldWalk(0, -(CLICK_MOVE_FORWARD_CONE + 0.01))).toBe(false);
  });

  it('converges instead of orbiting at close range (regression)', () => {
    // Reproduces the orbit bug: full-speed walk along a turn-rate-capped facing
    // orbits the target forever when speed/distance exceeds the turn rate. With
    // the forward gate the player turns in place and converges. Mirrors the
    // main.ts loop: smooth facing toward the bearing, walk only when aligned.
    const DT = 1 / 20;
    const SPEED = 5.6; // RUN_SPEED yd/s
    const TURN_RATE = 4.2; // CLICK_MOVE_TURN_RATE rad/s
    const STOP = 0.5;
    const target = { x: 0, z: 0 };
    // Start close and offset so the naive version would orbit.
    let pos = { x: 1.2, z: 0 };
    let facing = facingToward(pos, target) + Math.PI / 2; // initially sideways
    let arrived = false;
    for (let i = 0; i < 20 * 10 && !arrived; i++) {
      const step = clickMoveStep(pos, target, STOP);
      if (step.arrived) { arrived = true; break; }
      facing = stepAngleToward(facing, step.facing, TURN_RATE * DT);
      if (clickMoveShouldWalk(facing, step.facing)) {
        pos = { x: pos.x + Math.sin(facing) * SPEED * DT, z: pos.z + Math.cos(facing) * SPEED * DT };
      }
    }
    expect(arrived).toBe(true);
  });

  it('steps facing toward the destination along the shortest arc', () => {
    expect(stepAngleToward(0, Math.PI, 0.25)).toBeCloseTo(0.25);
    expect(stepAngleToward(0, -Math.PI / 2, 0.25)).toBeCloseTo(-0.25);
    expect(stepAngleToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});
