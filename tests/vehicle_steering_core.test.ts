// Steering: the measurement that keeps the front wheels out of the bodywork,
// and the rack that drives them there.
//
// The measurement is the part worth testing hard. A steering lock that is too
// generous does not throw, it just saws the tire through the fender, and only a
// human looking at the car would ever notice.

import { describe, expect, it } from 'vitest';
import {
  buildBodyBands,
  createSteering,
  measureSteerLimits,
  pivotWheelRate,
  STEER_FULL_LOCK_YAW,
  type SteerLimits,
  stepSteering,
  wheelSilhouette,
  wrapAngle,
} from '../src/render/vehicle_steering_core';
import { TURN_SPEED } from '../src/sim/types';

const CAP = 0.7;

/** A slab of bodywork crossing the circle of radius 1 at `theta`, tall enough
 *  to cover the heights a test asks about. */
function wallAt(theta: number, yLo = -1, yHi = 1): number[] {
  const ux = Math.sin(theta);
  const uz = Math.cos(theta);
  const at = (k: number, y: number) => [ux * k, y, uz * k];
  // Two triangles making a radial quad from r=0.5 to r=1.5.
  return [
    ...at(0.5, yLo),
    ...at(1.5, yLo),
    ...at(1.5, yHi),
    ...at(0.5, yLo),
    ...at(1.5, yHi),
    ...at(0.5, yHi),
  ];
}

/** One wheel point: radius 1, height 0, straight ahead. */
const AHEAD = [1, 0, 0];

function measure(tris: number[], lo = 0, hi = 0, silhouette = AHEAD): SteerLimits {
  return measureSteerLimits(silhouette, buildBodyBands(tris, 0.1), lo, hi, CAP);
}

describe('wrapAngle', () => {
  it('brings an angle back into (-PI, PI]', () => {
    expect(wrapAngle(0.3)).toBeCloseTo(0.3, 12);
    expect(wrapAngle(2 * Math.PI + 0.3)).toBeCloseTo(0.3, 12);
    expect(wrapAngle(-2 * Math.PI - 0.3)).toBeCloseTo(-0.3, 12);
    // The short way round, which is the whole reason this exists: a car that
    // crosses the +PI seam is turning a little, not spinning most of a circle.
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
  });
});

describe('steering lock measurement', () => {
  it('finds the angle at which the tire reaches the bodywork', () => {
    const limits = measure(wallAt(0.5));
    expect(limits.pos).toBeCloseTo(0.5, 2);
    // Nothing on the other side, so that way is only capped.
    expect(limits.neg).toBeCloseTo(CAP, 6);
  });

  it('measures the two directions separately', () => {
    const limits = measure([...wallAt(0.5), ...wallAt(-0.2)]);
    expect(limits.pos).toBeCloseTo(0.5, 2);
    expect(limits.neg).toBeCloseTo(0.2, 2);
  });

  it('never reports more than the cap, whatever the bodywork leaves', () => {
    const limits = measure([]);
    expect(limits.pos).toBe(CAP);
    expect(limits.neg).toBe(CAP);
  });

  it('catches bodywork the tire only reaches once the suspension compresses', () => {
    // A wall that exists only well above the wheel's resting height.
    const high = wallAt(0.25, 0.3, 0.5);
    // At rest the tire is nowhere near it.
    expect(measure(high).pos).toBeCloseTo(CAP, 6);
    // Swept up through bump travel, it binds. This is the case that would
    // otherwise ship a car that steers cleanly on flat ground and cuts through
    // its own arch on the first rise.
    expect(measure(high, 0, 0.4).pos).toBeCloseTo(0.25, 2);
  });

  it('measures against surfaces, not against body vertices', () => {
    // One enormous triangle whose vertices are all far from the tire's ring.
    // A vertex-proximity test would find no obstacle at all here and hand back
    // the cap; the tire would then swing straight through the middle of it.
    const at = (k: number, y: number) => [Math.sin(0.4) * k, y, Math.cos(0.4) * k];
    const far = [...at(4, -6), ...at(0.02, -6), ...at(0.2, 6)];
    // Its three corners sit at radius 4, 0.02 and 0.2 and at heights six units
    // away, so nothing about them is near the tire's ring. The face still
    // sweeps across it.
    expect(measure(far).pos).toBeCloseTo(0.4, 2);
  });
});

describe('wheelSilhouette', () => {
  /** An arc of wheel material from `from` to `to` at radius 1. */
  const arc = (from: number, to: number, n = 24): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      out.push(Math.sin(t), 0, Math.cos(t));
    }
    return out;
  };

  const thetasOf = (pts: number[]) => {
    const out: number[] = [];
    for (let i = 2; i < pts.length; i += 3) out.push(pts[i]);
    return out.sort((a, b) => a - b);
  };
  const near = (values: number[], target: number) =>
    values.some((v) => Math.abs(v - target) < 0.05);

  it('keeps the ends of a span of material', () => {
    const pts = thetasOf(wheelSilhouette(arc(-0.4, 0.4), 0.25));
    expect(pts[0]).toBeCloseTo(-0.4, 6);
    expect(pts[pts.length - 1]).toBeCloseTo(0.4, 6);
  });

  it('keeps far fewer points than the mesh has vertices', () => {
    // The whole reason the reduction exists: this runs when a mount is summoned.
    const pts = wheelSilhouette(arc(-0.4, 0.4, 400), 0.25);
    expect(pts.length / 3).toBeLessThan(40);
  });

  it('keeps the ends of BOTH spans when a ring holds two', () => {
    // A tire at hub height has material fore and aft and none at the sides.
    // Extremes taken across the whole ring would span the empty sides and lose
    // the two inner ends, which are exactly the ones that bind first.
    const pts = thetasOf(wheelSilhouette([...arc(-0.3, 0.3), ...arc(2.6, 3.2)], 0.25));
    expect(near(pts, -0.3)).toBe(true);
    expect(near(pts, 0.3)).toBe(true);
    expect(near(pts, 2.6)).toBe(true);
    expect(near(pts, 3.2 - 2 * Math.PI)).toBe(true);
  });

  it('feeds a measurement that finds the nearer of two obstacles', () => {
    const silhouette = wheelSilhouette(arc(-0.3, 0.3), 0.25);
    const limits = measureSteerLimits(
      silhouette,
      buildBodyBands([...wallAt(0.9), ...wallAt(-0.6)], 0.1),
      0,
      0,
      CAP,
    );
    // From the leading end at +0.3 to the wall at +0.9, and from the trailing
    // end at -0.3 to the wall at -0.6.
    expect(limits.pos).toBeCloseTo(0.6, 2);
    expect(limits.neg).toBeCloseTo(0.3, 2);
  });
});

describe('stepSteering', () => {
  const limits: SteerLimits = { pos: 0.4, neg: 0.3 };
  const run = (fraction: number, frames: number, state = createSteering()) => {
    let angle = 0;
    for (let i = 0; i < frames; i++) angle = stepSteering(state, fraction, limits, 1 / 60);
    return { angle, state };
  };

  it('commands full lock at the keyboard turn rate and no further', () => {
    // Holding a turn key is a yaw rate of exactly TURN_SPEED, so fraction 1.
    expect(run(1, 240).angle).toBeCloseTo(limits.pos, 6);
    expect(run(4, 240).angle).toBeCloseTo(limits.pos, 6);
  });

  it('uses the measured limit for the side being turned toward', () => {
    expect(run(-1, 240).angle).toBeCloseTo(-limits.neg, 6);
  });

  it('takes time to get there rather than snapping', () => {
    expect(run(1, 1).angle).toBeGreaterThan(0);
    expect(run(1, 1).angle).toBeLessThan(limits.pos * 0.5);
  });

  it('returns to center when the turn stops', () => {
    const held = run(1, 240);
    const released = run(0, 240, held.state);
    expect(released.angle).toBeCloseTo(0, 6);
  });

  it('holds still on a zero-length frame', () => {
    const { state } = run(1, 30);
    const before = state.angle;
    expect(stepSteering(state, 1, limits, 0)).toBe(before);
    expect(Number.isNaN(state.angle)).toBe(false);
  });
});

describe('full lock signal', () => {
  it('is the keyboard turn rate, so a held turn key is exactly full lock', () => {
    // If TURN_SPEED ever moves, this is the line that says so, since the core
    // deliberately does not import the sim layer.
    expect(STEER_FULL_LOCK_YAW).toBe(TURN_SPEED);
  });
});

describe('pivotWheelRate', () => {
  // A pivot turn is a tank turn: the wheel on the side you are turning toward
  // runs backwards while the other runs forward. Getting this backwards does
  // not throw, it just makes the car look like it is screwing itself into the
  // ground, so the sign is pinned here in both directions.
  const HALF_TRACK = 0.2564;
  const RADIUS = 0.1061;

  it('counter-rotates the two wheels of an axle', () => {
    const left = pivotWheelRate(1, -HALF_TRACK, RADIUS);
    const right = pivotWheelRate(1, HALF_TRACK, RADIUS);
    expect(Math.sign(left)).toBe(-Math.sign(right));
    expect(Math.abs(left)).toBeCloseTo(Math.abs(right), 12);
  });

  it('runs the wheel on the inside of the turn backwards', () => {
    // Positive yaw swings the nose toward +x, so the +x wheel is the inside one
    // and has to roll backwards, exactly as a tank track does.
    expect(pivotWheelRate(1, HALF_TRACK, RADIUS)).toBeLessThan(0);
    expect(pivotWheelRate(1, -HALF_TRACK, RADIUS)).toBeGreaterThan(0);
    // And the whole thing mirrors when the car turns the other way.
    expect(pivotWheelRate(-1, HALF_TRACK, RADIUS)).toBeGreaterThan(0);
    expect(pivotWheelRate(-1, -HALF_TRACK, RADIUS)).toBeLessThan(0);
  });

  it('turns the wheel by the ground it actually covers', () => {
    // One full rotation of the car rolls each rear wheel through its own
    // circumference exactly as many times as the circle it traced. This is the
    // whole reason the rate is derived rather than dialled: get it wrong and
    // the tire visibly skates.
    const turns = Math.abs(pivotWheelRate(2 * Math.PI, HALF_TRACK, RADIUS)) / (2 * Math.PI);
    expect(turns).toBeCloseTo((2 * Math.PI * HALF_TRACK) / (2 * Math.PI * RADIUS), 9);
  });

  it('stays well under the spoke-alias ceiling at full turn speed', () => {
    // The wheel has 9 spokes and reads identically every 40 degrees, so past
    // about 20 degrees per frame it appears to run BACKWARDS. That trap already
    // cost a pass on the Run clip; this checks the pivot cannot walk into it.
    const perFrame = (Math.abs(pivotWheelRate(Math.PI, HALF_TRACK, RADIUS)) * (180 / Math.PI)) / 60;
    expect(perFrame).toBeLessThan(20);
  });

  it('is silent for a degenerate wheel', () => {
    expect(pivotWheelRate(1, HALF_TRACK, 0)).toBe(0);
  });
});
