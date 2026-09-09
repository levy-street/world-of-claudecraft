// The gate that decides whether an airborne mount's engine is polled at all.
//
// This exists because of a bug worth remembering. `mountEngineBendRate` has
// computed a correct airborne pitch bend the whole time (+3 semitones for a
// mount with a parked idle take, +4 reversing), and it was unreachable: the
// renderer only passed `airborne: true` for the rocket sled, so every other
// mount held its phase through a jump and was never asked. The table was right,
// the caller never called. Jamie noticed by ear that the cart's loop did not
// lift when it left the ground.
//
// The renderer's caution was sound in itself. A mount whose engine goes quiet
// when parked would read a hop polled with moving=false as a stop, and run a
// full winddown and windup for every bump in the road. The distinction is not
// "is it the sled", it is "does this engine ever go quiet", and a parked idle
// take is exactly that answer.

import { describe, expect, it } from 'vitest';
import { sfx } from '../src/game/sfx';

describe('mountEngineIdles', () => {
  it('is true for a mount authored with a parked idle take', () => {
    // Never silent while summoned, so a mid-jump poll cannot be mistaken for a
    // stop and the airborne bend can actually be applied.
    expect(sfx.mountEngineIdles('rallycart_rxt')).toBe(true);
  });

  it('is false for an engine mount with no idle take', () => {
    // The tank runs windup/loop/winddown and IS silent parked, so it has to
    // hold its phase through a hop rather than be polled.
    expect(sfx.mountEngineIdles('terrorspark_groundshaker')).toBe(false);
  });

  it('is false for a mount with no engine at all, and for no mount', () => {
    expect(sfx.mountEngineIdles('valorsteed')).toBe(false);
    expect(sfx.mountEngineIdles('')).toBe(false);
  });
});
