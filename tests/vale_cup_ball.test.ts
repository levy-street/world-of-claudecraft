// Pure unit tests for the boarball physics leaf (src/sim/vale_cup_ball.ts):
// friction, wall banking, ground bounce, the speed cap, goal-plane crossing,
// pocket settling, and the dribble nudge. No Sim, no rng, no clocks.

import { describe, expect, it } from 'vitest';
import { DT } from '../src/sim/types';
import {
  applyBodyTrap,
  applyDribbleNudge,
  launchBall,
  settleBallInPocket,
  stepBallPhysics,
  VC_BALL_GROUND_RESTITUTION,
  VC_BALL_MAX_SPEED,
  VC_BALL_RADIUS,
  VC_BALL_ROLL_DECEL,
  VC_BALL_WALL_RESTITUTION,
  VC_TRAP_MIN_BALL_SPEED,
  VC_TRAP_ROLL_SPEED,
  type VcBallKinematics,
} from '../src/sim/vale_cup_ball';
import {
  GOAL_DEPTH,
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  GOAL_Z_MAX,
  GOAL_Z_MIN,
  PITCH,
  PITCH_CENTER,
} from '../src/sim/vale_cup_layout';

const GROUND = 0;

function ball(over: Partial<VcBallKinematics> = {}): VcBallKinematics {
  return {
    x: PITCH_CENTER.x,
    y: GROUND,
    z: PITCH_CENTER.z,
    vx: 0,
    vy: 0,
    vz: 0,
    ...over,
  };
}

function speed(b: VcBallKinematics): number {
  return Math.hypot(b.vx, b.vz);
}

describe('rolling friction', () => {
  it('decelerates a grounded roll at the roll rate', () => {
    const b = ball({ vx: 10 });
    for (let i = 0; i < 20; i++) stepBallPhysics(b, GROUND); // one second
    expect(speed(b)).toBeCloseTo(10 - VC_BALL_ROLL_DECEL, 1);
  });

  it('brakes harder once nearly stopped and comes to a dead stop', () => {
    const b = ball({ vx: 1.5 });
    for (let i = 0; i < 8; i++) stepBallPhysics(b, GROUND); // 0.4s at the slow decel
    expect(speed(b)).toBe(0);
  });

  it('does not decelerate while airborne', () => {
    const b = ball({ vx: 10, y: 3, vy: 2 });
    stepBallPhysics(b, GROUND);
    expect(b.vx).toBeCloseTo(10, 6);
  });
});

describe('wall banking', () => {
  it('reflects off the north board: normal component flips, speed scales by the restitution', () => {
    // Airborne so rolling friction stays out of the arithmetic.
    const b = ball({ z: PITCH.zMax - VC_BALL_RADIUS - 0.05, y: 1.5, vx: 3, vz: 8 });
    const s0 = speed(b);
    const goal = stepBallPhysics(b, GROUND);
    expect(goal).toBe(null);
    expect(b.vz).toBeLessThan(0); // flipped
    expect(b.vx).toBeGreaterThan(0); // tangential keeps its sign
    expect(speed(b)).toBeCloseTo(s0 * VC_BALL_WALL_RESTITUTION, 6);
    expect(b.z).toBeLessThanOrEqual(PITCH.zMax - VC_BALL_RADIUS);
  });

  it('reflects off the west board OUTSIDE the goal mouth', () => {
    const b = ball({
      x: PITCH.xMin + VC_BALL_RADIUS + 0.05,
      z: GOAL_Z_MIN - 1.5, // below the mouth: board, not goal
      vx: -9,
      vz: 0,
    });
    const goal = stepBallPhysics(b, GROUND);
    expect(goal).toBe(null);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(PITCH.xMin + VC_BALL_RADIUS);
  });
});

describe('ground bounce', () => {
  it('a falling ball bounces with the ground restitution, then tiny bounces settle', () => {
    const b = ball({ y: 3, vy: 0 });
    let lastVyDown = 0;
    // fall to the floor
    while (b.vy <= 0 && b.y > GROUND) {
      lastVyDown = b.vy;
      stepBallPhysics(b, GROUND);
      if (b.vy > 0) break;
    }
    expect(b.vy).toBeGreaterThan(0);
    expect(b.vy).toBeCloseTo(-lastVyDown * VC_BALL_GROUND_RESTITUTION, 0);
    // run it out: bounces decay until it rests on the ground
    for (let i = 0; i < 20 * 6; i++) stepBallPhysics(b, GROUND);
    expect(b.y).toBe(GROUND);
    expect(b.vy).toBe(0);
  });
});

describe('speed cap', () => {
  it('caps the ground speed at the maximum', () => {
    const b = ball({ vx: 40, vz: 30 });
    stepBallPhysics(b, GROUND);
    expect(speed(b)).toBeLessThanOrEqual(VC_BALL_MAX_SPEED + 1e-9);
  });

  it('launchBall clamps kick power to the cap', () => {
    const b = ball();
    launchBall(b, 1, 0, 99, 4);
    expect(speed(b)).toBeCloseTo(VC_BALL_MAX_SPEED, 9);
    expect(b.vy).toBe(4);
  });
});

describe('goal plane crossing', () => {
  it('a center crossing the west line inside the mouth scores for B', () => {
    const b = ball({ x: GOAL_LINE_WEST_X + 0.3, z: PITCH_CENTER.z, vx: -12 });
    expect(stepBallPhysics(b, GROUND)).toBe('B');
  });

  it('a center crossing the east line inside the mouth scores for A', () => {
    const b = ball({ x: GOAL_LINE_EAST_X - 0.3, z: PITCH_CENTER.z, vx: 12 });
    expect(stepBallPhysics(b, GROUND)).toBe('A');
  });

  it('crossing EXACTLY at the post z still counts (inclusive posts)', () => {
    const b = ball({ x: GOAL_LINE_WEST_X + 0.3, z: GOAL_Z_MIN, vx: -12 });
    expect(stepBallPhysics(b, GROUND)).toBe('B');
  });

  it('crossing just outside the post banks off the board instead', () => {
    const b = ball({ x: GOAL_LINE_WEST_X + VC_BALL_RADIUS + 0.05, z: GOAL_Z_MIN - 0.2, vx: -12 });
    expect(stepBallPhysics(b, GROUND)).toBe(null);
    expect(b.vx).toBeGreaterThan(0);
  });
});

describe('pocket settle', () => {
  it('a scored ball settles dead inside the west pocket, no bank back out', () => {
    const b = ball({ x: GOAL_LINE_WEST_X - 0.2, z: PITCH_CENTER.z, vx: -14, vz: 3 });
    for (let i = 0; i < 20 * 3; i++) settleBallInPocket(b, 'west', GROUND);
    expect(speed(b)).toBe(0);
    expect(b.x).toBeGreaterThanOrEqual(GOAL_LINE_WEST_X - GOAL_DEPTH);
    expect(b.x).toBeLessThanOrEqual(GOAL_LINE_WEST_X);
    expect(b.z).toBeGreaterThanOrEqual(GOAL_Z_MIN);
    expect(b.z).toBeLessThanOrEqual(GOAL_Z_MAX);
  });
});

describe('dribble nudge', () => {
  it('a mover overlapping a slower ball carries it along its own direction', () => {
    const b = ball({ vx: 1, vz: 0 });
    const step = 7 * DT; // a 7 yd/s runner heading +x
    expect(applyDribbleNudge(b, step, 0)).toBe(true);
    expect(b.vx).toBeCloseTo(7 * 1.15, 6);
    expect(b.vz).toBeCloseTo(0, 6);
  });

  it('never slows a ball already faster than the mover', () => {
    const b = ball({ vx: 15 });
    expect(applyDribbleNudge(b, 7 * DT, 0)).toBe(false);
    expect(b.vx).toBe(15);
  });

  it('a stationary mover does not nudge', () => {
    const b = ball({ vx: 0.5 });
    expect(applyDribbleNudge(b, 0, 0)).toBe(false);
  });
});

describe('body trap (a fast ball never sails through a fighter)', () => {
  it('a fast ball into a still fighter collapses to a slow roll along their facing', () => {
    // a hard shot coming from the west, moving +x fast
    const b = ball({ vx: VC_TRAP_MIN_BALL_SPEED + 6, vz: 0, vy: 4 });
    // fighter standing still, facing north (+z): f=0 -> (sin0, cos0) = (0, 1)
    expect(applyBodyTrap(b, 0, 0, 0)).toBe(true);
    expect(speed(b)).toBeCloseTo(VC_TRAP_ROLL_SPEED, 6);
    expect(b.vx).toBeCloseTo(0, 6);
    expect(b.vz).toBeCloseTo(VC_TRAP_ROLL_SPEED, 6);
    expect(b.vy).toBeLessThan(4); // vertical damped, drops playable at their feet
  });

  it('a moving fighter traps the ball along their own run direction', () => {
    const b = ball({ vx: VC_TRAP_MIN_BALL_SPEED + 10, vz: 0 });
    // fighter running +z faster than the dribble floor
    expect(applyBodyTrap(b, 0, 8 * DT, 0)).toBe(true);
    expect(b.vx).toBeCloseTo(0, 6);
    expect(b.vz).toBeCloseTo(VC_TRAP_ROLL_SPEED, 6);
  });

  it('leaves a ball below the trap threshold alone (that is the dribble regime)', () => {
    const b = ball({ vx: VC_TRAP_MIN_BALL_SPEED - 1, vz: 0 });
    expect(applyBodyTrap(b, 0, 0, 0)).toBe(false);
    expect(b.vx).toBeCloseTo(VC_TRAP_MIN_BALL_SPEED - 1, 6);
  });
});
