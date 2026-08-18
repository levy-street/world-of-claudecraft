import { describe, expect, it } from 'vitest';
import type { AnimState, BaseState } from '../src/render/characters/anim_state';
import { desiredBaseState, locomotionTimeScale } from '../src/render/characters/anim_state';
import { applyStandingRider, STANDING_WALK_MIN_SPEED } from '../src/render/mount_ride_view';
import {
  advanceRoll,
  ROLL_FORWARD,
  rollDelta,
  rollPivotOffset,
  topSurfaceSpeed,
} from '../src/render/mount_roll_core';

// A dismounted rider standing still: the baseline every case below perturbs.
const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  backwards: false,
  airborne: false,
  falling: false,
  sitting: false,
  casting: false,
  spinning: false,
  swimming: false,
  submerged: false,
  wading: false,
  swimPitch: 0,
} as unknown as AnimState;

describe('rolling-mount motion math', () => {
  it('rolls without slipping: arc travelled equals ground distance', () => {
    // The defining property. For any radius, the arc swept (angle * r) must
    // equal the distance covered, or the contact patch moves and the mount
    // visibly skates.
    for (const radius of [0.4, 0.75, 1.2, 3.4]) {
      for (const distance of [0.1, 1, 7.5, 123.75]) {
        expect(rollDelta(distance, radius) * radius).toBeCloseTo(distance, 10);
      }
    }
  });

  it('turns in the sense that carries the top surface FORWARD', () => {
    // Not merely "non-zero": the SIGN is the whole feature. A forward-moving
    // mount must roll forward, which is what forces the rider to backpedal.
    expect(ROLL_FORWARD).toBe(1);
    expect(rollDelta(1, 0.5)).toBeGreaterThan(0);
    // ...and reversing travel reverses the roll rather than freezing it.
    expect(rollDelta(-1, 0.5)).toBeLessThan(0);
    expect(rollDelta(-1, 0.5)).toBeCloseTo(-rollDelta(1, 0.5), 12);
  });

  it('scales the rate with speed and inversely with radius', () => {
    // omega = v / r, checked on both arms: twice the distance is twice the
    // angle, twice the radius is half the angle.
    expect(rollDelta(2, 1)).toBeCloseTo(2 * rollDelta(1, 1), 12);
    expect(rollDelta(1, 2)).toBeCloseTo(0.5 * rollDelta(1, 1), 12);
    // A small mount spins faster than a big one over the same ground.
    expect(rollDelta(1, 0.5)).toBeGreaterThan(rollDelta(1, 1.5));
  });

  it('treats a missing or degenerate radius as "does not roll", never a divide', () => {
    for (const radius of [0, -1, Number.NaN]) expect(rollDelta(5, radius)).toBe(0);
    expect(rollDelta(Number.NaN, 1)).toBe(0);
    expect(Number.isFinite(rollDelta(5, 0))).toBe(true);
  });

  it('wraps the accumulated angle into [0, 2pi) without losing the pose', () => {
    const TAU = Math.PI * 2;
    // A full turn returns to the same pose, not to a growing number.
    const full = advanceRoll(0, TAU * 0.5, 0.5);
    expect(full).toBeCloseTo(0, 10);
    // Long rides stay bounded rather than drifting toward float mush.
    let angle = 0;
    for (let i = 0; i < 10_000; i++) angle = advanceRoll(angle, 0.35, 0.6);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(TAU);
    // Backwards travel wraps to the positive side rather than going negative.
    expect(advanceRoll(0, -0.1, 1)).toBeGreaterThan(Math.PI);
  });

  it('reports the top surface at twice body speed, which the rider walks against', () => {
    // A rider standing on top is carried at 2v, so their backwards stride is
    // played against 2v; matching body speed alone would slip visibly.
    expect(topSurfaceSpeed(0)).toBe(0);
    expect(topSurfaceSpeed(7)).toBe(14);
    expect(topSurfaceSpeed(12.6)).toBeCloseTo(25.2, 10);
  });
});

describe('a standing rider actually plays a BACKWARDS walk', () => {
  // The point of applyStandingRider is not the flag, it is the clip the engine
  // then picks. These assert against the engine's own selector rather than
  // trusting the flag, and against the real player ClipMap, which ships
  // 'Walking_Backwards' (kaykit() in src/render/characters/manifest.ts).
  const baseState = (over: Partial<AnimState>): BaseState =>
    desiredBaseState({ ...IDLE, ...over } as AnimState, true);

  it('selects walkBack, not a forward walk, once applyStandingRider has run', () => {
    const st = { ...IDLE } as AnimState;
    applyStandingRider(st, 7);
    expect(st.backwards).toBe(true);
    expect(st.moving).toBe(true);
    // running would pick the run clip, which has no backwards variant
    expect(st.running).toBe(false);
    expect(baseState(st)).toBe('walkBack');
  });

  it('walks the rider against the SURFACE speed, not the body speed', () => {
    const st = { ...IDLE } as AnimState;
    applyStandingRider(st, 7);
    // 2x body speed: matching body speed would slip the feet on a log whose
    // top travels twice as fast as the mount does over the ground.
    expect(st.speed).toBe(14);
    expect(st.speed).toBe(topSurfaceSpeed(7));
  });

  it('is a real backwards clip, never a reversed forward one', () => {
    const st = { ...IDLE } as AnimState;
    applyStandingRider(st, 7);
    // reverseBackpedal is the ghost-wolf trick (play walk at negative
    // timeScale). The player rig has a genuine Walking_Backwards, so the
    // standing rider must NOT take that path: a reversed forward walk reads
    // as a moonwalk.
    expect(st.reverseBackpedal ?? false).toBe(false);
    expect(locomotionTimeScale('walkBack', st)).toBeGreaterThan(0);
  });

  it('still sits an ordinary rider: the override is opt-in', () => {
    // A seated rider never reaches applyStandingRider, and their state picks
    // the sit loop that reads as riding.
    expect(baseState({ sitting: true, moving: true })).toBe('sit');
  });
});

describe('a parked rolling mount stands its rider still', () => {
  it('does not backpedal a rider on a motionless log', () => {
    // The gag needs the log to be ROLLING. Walking on the spot beside a parked
    // one reads as a bug, and it is the same reason these mounts carry no idle
    // bob: parked junk sits dead still.
    const st = { ...IDLE } as AnimState;
    expect(applyStandingRider(st, 0)).toBe(false);
    expect(st.moving).toBe(false);
    expect(st.backwards).toBe(false);
    expect(desiredBaseState(st, true)).toBe('idle');
  });

  it('ignores the residual speed left on the frame a key is released', () => {
    const st = { ...IDLE } as AnimState;
    expect(applyStandingRider(st, STANDING_WALK_MIN_SPEED)).toBe(false);
    expect(st.moving).toBe(false);
  });

  it('still walks the moment the mount actually rolls', () => {
    const st = { ...IDLE } as AnimState;
    expect(applyStandingRider(st, STANDING_WALK_MIN_SPEED + 0.01)).toBe(true);
    expect(st.moving).toBe(true);
    expect(st.backwards).toBe(true);
    expect(desiredBaseState(st, true)).toBe('walkBack');
  });
});

describe('a rolling cylinder pivots on its axle, not its base', () => {
  // The asset pipeline puts a prop's origin at its BASE. Turning the body about
  // that point swings it through the floor in a circle once per revolution.
  const AXLE = (roll: number, r: number) => {
    const o = rollPivotOffset(roll, r);
    return { y: r * Math.cos(roll) + o.y, z: r * Math.sin(roll) + o.z };
  };

  it('holds the axle perfectly still through a whole revolution', () => {
    for (const r of [0.75, 1.2]) {
      for (let i = 0; i <= 16; i++) {
        const roll = (i / 16) * Math.PI * 2;
        const axle = AXLE(roll, r);
        expect(axle.y, `axle height at ${roll.toFixed(2)} r=${r}`).toBeCloseTo(r, 10);
        expect(axle.z, `axle drift at ${roll.toFixed(2)} r=${r}`).toBeCloseTo(0, 10);
      }
    }
  });

  it('never lets the body dip below the ground', () => {
    const r = 0.75;
    for (let i = 0; i <= 32; i++) {
      const axle = AXLE((i / 32) * Math.PI * 2, r);
      expect(axle.y - r).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('is a no-op for a mount that does not roll', () => {
    expect(rollPivotOffset(1.2, 0)).toEqual({ y: 0, z: 0 });
    expect(rollPivotOffset(Number.NaN, 1)).toEqual({ y: 0, z: 0 });
  });
});
