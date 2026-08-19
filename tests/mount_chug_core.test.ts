// The vehicle-mount engine cadence: src/render/mount_chug_core.ts.
//
// The behaviour under test is the whole point of the module: an engine is not a
// gait, so its cue rate, pitch, and level all follow the throttle rather than
// the stride, and it keeps running at a standstill and in mid-air where a stride
// accumulator emits nothing at all.

import { describe, expect, it } from 'vitest';
import {
  createMountChugState,
  type MountChugInput,
  mountThrottle,
  mountTopSpeed,
  stepMountChug,
} from '../src/render/mount_chug_core';
import { MOUNTS } from '../src/sim/content/mounts';
import { RUN_SPEED } from '../src/sim/types';

/** Run the engine for `seconds` at a fixed input and count the cues emitted. */
function chugsOver(seconds: number, input: Omit<MountChugInput, 'dt'>, dt = 1 / 60): number {
  const state = createMountChugState();
  let total = 0;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    total += stepMountChug(state, { ...input, dt }).chugs;
  }
  return total;
}

const TRUCK_TOP = mountTopSpeed('weirdo_cream_truck');

describe('mount engine throttle', () => {
  it('is 0 at rest and 1 at top speed', () => {
    expect(mountThrottle(0, 12)).toBe(0);
    expect(mountThrottle(12, 12)).toBe(1);
  });

  it('clamps above top speed instead of running away', () => {
    expect(mountThrottle(40, 12)).toBe(1);
  });

  it('rises monotonically between the ends', () => {
    let previous = -1;
    for (let speed = 0; speed <= 12; speed += 0.5) {
      const value = mountThrottle(speed, 12);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('opens up faster than linearly, so the low speed range is expressive', () => {
    // Half speed should already be well past half throttle; that curve is what
    // keeps the engine responding where players actually ride.
    expect(mountThrottle(6, 12)).toBeGreaterThan(0.55);
  });

  it('is 0 for a nonsensical top speed rather than dividing by zero', () => {
    expect(mountThrottle(5, 0)).toBe(0);
    expect(mountThrottle(5, Number.NaN)).toBe(0);
  });
});

describe('mount top speed', () => {
  it('is the mounted top speed, NOT the gait reference', () => {
    // Pinned against the real catalog: the truck is an 80% mount, so its top
    // speed is RUN_SPEED * 1.8. Normalizing by the VISUALS runRef (a much lower
    // foot-match number) would peg the throttle before half speed.
    expect(MOUNTS.weirdo_cream_truck.moveSpeedPct).toBe(0.8);
    expect(TRUCK_TOP).toBeCloseTo(RUN_SPEED * 1.8, 10);
    expect(TRUCK_TOP).toBeGreaterThan(10);
  });

  it('falls back to unmounted run speed for an unknown key', () => {
    expect(mountTopSpeed('not_a_mount')).toBeCloseTo(RUN_SPEED, 10);
  });
});

describe('engine cadence', () => {
  it('keeps firing at a standstill: an idling engine still turns over', () => {
    const chugs = chugsOver(1, { speed: 0, topSpeed: TRUCK_TOP, airborne: false });
    expect(chugs).toBeGreaterThanOrEqual(4);
    expect(chugs).toBeLessThanOrEqual(5);
  });

  it('fires roughly three times as often at full throttle as at idle', () => {
    const idle = chugsOver(1, { speed: 0, topSpeed: TRUCK_TOP, airborne: false });
    const flat = chugsOver(1, { speed: TRUCK_TOP, topSpeed: TRUCK_TOP, airborne: false });
    expect(flat).toBeGreaterThan(idle * 2.5);
    expect(flat).toBeLessThanOrEqual(14);
  });

  it('raises pitch and level with speed', () => {
    const state = createMountChugState();
    const idle = stepMountChug(state, {
      speed: 0,
      topSpeed: TRUCK_TOP,
      airborne: false,
      dt: 1 / 60,
    });
    const flat = stepMountChug(createMountChugState(), {
      speed: TRUCK_TOP,
      topSpeed: TRUCK_TOP,
      airborne: false,
      dt: 1 / 60,
    });
    expect(flat.rate).toBeGreaterThan(idle.rate);
    expect(flat.gain).toBeGreaterThan(idle.gain);
    // Both ends stay inside a sane playback range: a rate far from 1 reads as a
    // different vehicle rather than as the same engine working harder.
    expect(idle.rate).toBeGreaterThan(0.5);
    expect(flat.rate).toBeLessThan(2);
  });

  it('revs up and thins out off the ground', () => {
    const input = { speed: TRUCK_TOP * 0.5, topSpeed: TRUCK_TOP, dt: 1 / 60 };
    const grounded = stepMountChug(createMountChugState(), { ...input, airborne: false });
    const flying = stepMountChug(createMountChugState(), { ...input, airborne: true });
    expect(flying.rate).toBeGreaterThan(grounded.rate);
    expect(flying.gain).toBeLessThan(grounded.gain);
  });

  it('never machine-guns after a long frame', () => {
    const state = createMountChugState();
    // A two-second hitch owes ~27 chugs at full throttle; it must not pay them
    // all out in one step as a burst of overlapping one-shots.
    const tick = stepMountChug(state, {
      speed: TRUCK_TOP,
      topSpeed: TRUCK_TOP,
      airborne: false,
      dt: 2,
    });
    expect(tick.chugs).toBeLessThanOrEqual(2);
    // And the debt is dropped rather than banked for the following frames.
    expect(state.accum).toBeLessThan(1);
  });

  it('banks no debt from a negative or zero dt', () => {
    const state = createMountChugState();
    expect(
      stepMountChug(state, { speed: 5, topSpeed: TRUCK_TOP, airborne: false, dt: -3 }).chugs,
    ).toBe(0);
    expect(state.accum).toBe(0);
  });

  it('responds to a speed change on the very next step, with no smoothing lag', () => {
    const state = createMountChugState();
    const slow = stepMountChug(state, {
      speed: 0,
      topSpeed: TRUCK_TOP,
      airborne: false,
      dt: 1 / 60,
    });
    const fast = stepMountChug(state, {
      speed: TRUCK_TOP,
      topSpeed: TRUCK_TOP,
      airborne: false,
      dt: 1 / 60,
    });
    expect(fast.rate).toBeGreaterThan(slow.rate + 0.3);
  });
});
