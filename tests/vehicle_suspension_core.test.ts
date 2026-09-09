import { describe, expect, it } from 'vitest';

import {
  createSuspension,
  landSuspension,
  type SuspensionEnvelope,
  type SuspensionState,
  stepSuspension,
} from '../src/render/vehicle_suspension_core';

const LIMITS = { bump: 0.3, droop: 0.22 };
/** A symmetric stand-in; the real one is measured off the mesh. */
const ENV: SuspensionEnvelope = {
  corner: { fl: LIMITS, fr: LIMITS, rl: LIMITS, rr: LIMITS },
  pitchUp: 0.25,
  pitchDown: 0.25,
  roll: 0.25,
};
const flat = { fl: 0, fr: 0, rl: 0, rr: 0 };

/** Run to steady state, so damping is not what the assertions are measuring. */
const settle = (
  s: SuspensionState,
  heights: Record<'fl' | 'fr' | 'rl' | 'rr', number>,
  grounded = true,
) => {
  for (let i = 0; i < 200; i++) stepSuspension(s, heights, 2, 1.2, ENV, grounded, 1 / 60);
  return s;
};

describe('stepSuspension attitude', () => {
  it('stays neutral on flat ground', () => {
    const s = settle(createSuspension(), flat);
    expect(s.pitch).toBeCloseTo(0, 5);
    expect(s.roll).toBeCloseTo(0, 5);
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) expect(s.travel[c]).toBeCloseTo(0, 5);
  });

  it('lifts the nose when the ground rises ahead', () => {
    const s = settle(createSuspension(), { fl: 0.5, fr: 0.5, rl: 0, rr: 0 });
    expect(s.pitch).toBeGreaterThan(0.1);
    expect(s.roll).toBeCloseTo(0, 5);
  });

  it('drops the nose cresting onto a downslope', () => {
    const s = settle(createSuspension(), { fl: -0.5, fr: -0.5, rl: 0, rr: 0 });
    expect(s.pitch).toBeLessThan(-0.1);
  });

  it('rolls toward the low side across a slope', () => {
    const s = settle(createSuspension(), { fl: 0, fr: 0.5, rl: 0, rr: 0.5 });
    expect(s.roll).toBeGreaterThan(0.1);
    expect(s.pitch).toBeCloseTo(0, 5);
  });

  it('never exceeds the clamp on absurd terrain', () => {
    const s = settle(createSuspension(), { fl: 40, fr: 40, rl: -40, rr: -40 });
    expect(Math.abs(s.pitch)).toBeLessThanOrEqual(ENV.pitchUp + 1e-9);
  });

  it('clamps nose-up and nose-down separately, as the real overhangs differ', () => {
    // A car with a long front overhang and a short tail: it may rear up freely
    // but must not drop its nose far.
    const asym: SuspensionEnvelope = { ...ENV, pitchUp: 0.4, pitchDown: 0.05 };
    const up = createSuspension();
    const down = createSuspension();
    for (let i = 0; i < 200; i++) {
      stepSuspension(up, { fl: 9, fr: 9, rl: -9, rr: -9 }, 2, 1.2, asym, true, 1 / 60);
      stepSuspension(down, { fl: -9, fr: -9, rl: 9, rr: 9 }, 2, 1.2, asym, true, 1 / 60);
    }
    expect(up.pitch).toBeCloseTo(0.4, 4);
    expect(down.pitch).toBeCloseTo(-0.05, 4);
  });

  it('clamps roll on its own limit', () => {
    const s = settle(createSuspension(), { fl: -9, fr: 9, rl: -9, rr: 9 });
    expect(s.roll).toBeCloseTo(ENV.roll, 4);
  });
});

describe('stepSuspension springs', () => {
  it('leaves the springs alone on a uniform slope, which the BODY absorbs', () => {
    // a plane through all four wheels: pitch takes it, no corner is special
    const s = settle(createSuspension(), { fl: 0.4, fr: 0.4, rl: 0, rr: 0 });
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(Math.abs(s.travel[c])).toBeLessThan(0.08);
    }
  });

  it('compresses only the corner that meets a rock', () => {
    const s = settle(createSuspension(), { fl: 0, fr: 0, rl: 0, rr: 0.25 });
    expect(s.travel.rr).toBeGreaterThan(0.05);
    expect(s.travel.fl).toBeLessThan(s.travel.rr);
  });

  it('honours a per-corner limit, so a tight arch binds only its own wheel', () => {
    const tight: SuspensionEnvelope = {
      ...ENV,
      corner: { ...ENV.corner, fl: { bump: 0.02, droop: 0.22 } },
    };
    const s = createSuspension();
    for (let i = 0; i < 200; i++) {
      stepSuspension(s, { fl: 9, fr: 9, rl: 0, rr: 0 }, 2, 1.2, tight, true, 1 / 60);
    }
    expect(s.travel.fl).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(s.travel.fr).toBeGreaterThan(0.02);
  });

  it('honours the bump and droop limits', () => {
    const s = settle(createSuspension(), { fl: 9, fr: 0, rl: 0, rr: 0 });
    expect(s.travel.fl).toBeLessThanOrEqual(LIMITS.bump + 1e-9);
    const d = settle(createSuspension(), { fl: -9, fr: 0, rl: 0, rr: 0 });
    expect(d.travel.fl).toBeGreaterThanOrEqual(-LIMITS.droop - 1e-9);
  });

  it('hangs the wheels and levels the body once airborne', () => {
    const s = settle(createSuspension(), { fl: 0.5, fr: 0, rl: 0, rr: 0 });
    settle(s, flat, false);
    expect(s.pitch).toBeCloseTo(0, 4);
    expect(s.roll).toBeCloseTo(0, 4);
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(s.travel[c]).toBeCloseTo(-LIMITS.droop, 4);
    }
  });
});

describe('stepSuspension stepping', () => {
  it('damps rather than snapping to a new attitude', () => {
    const s = createSuspension();
    stepSuspension(s, { fl: 0.5, fr: 0.5, rl: 0, rr: 0 }, 2, 1.2, ENV, true, 1 / 60);
    const afterOneFrame = s.pitch;
    const settled = settle(createSuspension(), { fl: 0.5, fr: 0.5, rl: 0, rr: 0 }).pitch;
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(settled * 0.5);
  });

  it('ignores a zero or negative frame time', () => {
    const s = createSuspension();
    stepSuspension(s, { fl: 1, fr: 1, rl: 0, rr: 0 }, 2, 1.2, ENV, true, 0);
    expect(s.pitch).toBe(0);
  });
});

describe('landing squat', () => {
  /** Fly, then land at one impact strength, and report the curve at a corner.
   *  The flight matters: a landing starts with the wheel hanging at full droop,
   *  and the swing up off that hang is half of what makes the squat read. */
  const drop = (impact: number, frames = 120, heights = flat) => {
    const s = createSuspension();
    settle(s, heights);
    settle(s, heights, false);
    const rest = s.travel.fl;
    landSuspension(s, impact, ENV);
    const curve: number[] = [];
    for (let i = 0; i < frames; i++) {
      stepSuspension(s, heights, 2, 1.2, ENV, true, 1 / 60);
      curve.push(s.travel.fl);
    }
    const peak = Math.max(...curve);
    return { s, curve, peak, peakAt: curve.indexOf(peak), rest };
  };

  it('compresses the springs and then evens back out', () => {
    const { curve, peak, peakAt, rest } = drop(1);
    // It compresses, rather than the body simply arriving at rest.
    expect(peak).toBeGreaterThan(rest + LIMITS.bump * 0.5);
    // And the peak is a moment, not a pose: it arrives fast and is gone.
    expect(peakAt).toBeGreaterThan(0);
    expect(peakAt).toBeLessThan(15);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 4);
  });

  it('closes most of the arch gap on a hard landing', () => {
    // The whole point: the gap between the tire and the wheel well has to
    // visibly shrink. Creeping back up to neutral is what the first version
    // did, and it read as nothing happening at all.
    expect(drop(1).peak).toBeGreaterThan(LIMITS.bump * 0.5);
  });

  it('never pushes a tire past the arch, whatever the impact', () => {
    // The clamp is the bump stop. A landing harder than the scale allows pins
    // there rather than putting rubber through sheet metal.
    expect(drop(1).peak).toBeLessThanOrEqual(LIMITS.bump + 1e-9);
    expect(drop(4).peak).toBeLessThanOrEqual(LIMITS.bump + 1e-9);
  });

  it('squats the same whatever the frame rate', () => {
    // The squat is advanced by its closed form for this reason. Stepping the
    // acceleration explicitly bleeds amplitude per step, so the same landing
    // would compress noticeably less on a slower machine.
    const peakAt = (dt: number) => {
      const s = createSuspension();
      landSuspension(s, 1, ENV);
      let peak = 0;
      for (let t = 0; t < 1; t += dt) {
        stepSuspension(s, flat, 2, 1.2, ENV, true, dt);
        peak = Math.max(peak, s.travel.fl);
      }
      return peak;
    };
    const sixty = peakAt(1 / 60);
    expect(peakAt(1 / 30)).toBeCloseTo(sixty, 2);
    expect(peakAt(1 / 144)).toBeCloseTo(sixty, 2);
  });

  it('squats further for a harder landing', () => {
    expect(drop(1).peak).toBeGreaterThan(drop(0.4).peak * 1.5);
  });

  it('does nothing for a touchdown too gentle to feel', () => {
    // The caller normalizes the real fall speed, so anything at or under the
    // soft-landing threshold arrives here as zero or less. The wheels still
    // ease up out of their droop, but nothing compresses.
    expect(drop(0).peak).toBeLessThanOrEqual(0);
    expect(drop(-3).peak).toBeLessThanOrEqual(0);
  });

  it('cannot put a corner past its limits on rough ground', () => {
    // Terrain already asking for full compression with a hard landing on top.
    // One clamp over the sum is what keeps the two out of the bodywork.
    const { curve } = drop(1, 120, { fl: 1.5, fr: 0, rl: 0, rr: 0 });
    for (const v of curve) {
      expect(v).toBeLessThanOrEqual(LIMITS.bump + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-LIMITS.droop - 1e-9);
    }
  });

  it('keeps easing out after a takeoff mid-recovery', () => {
    const s = createSuspension();
    settle(s, flat, false);
    landSuspension(s, 1, ENV);
    for (let i = 0; i < 3; i++) stepSuspension(s, flat, 2, 1.2, ENV, true, 1 / 60);
    expect(s.squat.fl).not.toBe(0);
    // Leaving the ground again must not freeze the body mid-compression.
    for (let i = 0; i < 120; i++) stepSuspension(s, flat, 2, 1.2, ENV, false, 1 / 60);
    expect(s.squat.fl).toBeCloseTo(0, 4);
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(s.travel[c]).toBeCloseTo(-ENV.corner[c].droop, 4);
    }
  });
});
