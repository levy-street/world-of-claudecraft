import { describe, expect, it } from 'vitest';
import {
  type AnimState,
  desiredBaseState,
  locomotionTimeScale,
  pickProxyHeight,
} from '../src/render/characters/anim_state';
import { MOVE_HOLD_TIME, newLocoTrack, updateLocomotion } from '../src/render/locomotion';

const FPS = 1 / 60;
const BASE_ANIM_STATE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
};

// steady forward walk: ~2.2 u/s gives ~0.0367u of travel per 60fps frame
function walkStep(t: ReturnType<typeof newLocoTrack>, dt = FPS, speed = 2.2) {
  return updateLocomotion(t, 0, speed * dt, 0, dt);
}

describe('locomotion hysteresis', () => {
  it('a steady walk reports moving', () => {
    const t = newLocoTrack();
    let s = walkStep(t);
    for (let i = 0; i < 30; i++) s = walkStep(t);
    expect(s.moving).toBe(true);
    expect(s.backwards).toBe(false);
    expect(s.speed).toBeGreaterThan(1.5); // smoothed toward ~2.2
  });

  it('a single stalled frame mid-walk does NOT drop the moving state', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // interpolation stall / terrain bob: one frame with zero horizontal travel
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true); // latched through the dip — no reset
  });

  it('several consecutive stalled frames within the grace window stay moving', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // ~0.15s of stall, under MOVE_HOLD_TIME (0.22s)
    let s = { moving: true } as ReturnType<typeof updateLocomotion>;
    for (let i = 0; i < 9; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(9 * FPS).toBeLessThan(MOVE_HOLD_TIME);
    expect(s.moving).toBe(true);
  });

  it('a genuine stop transitions to idle after the grace window', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    let s = updateLocomotion(t, 0, 0, 0, FPS);
    // run well past the hold window with no movement
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('keeps the backpedal direction through a stalled frame', () => {
    const t = newLocoTrack();
    // facing +Z (0); travel toward -Z is backwards
    for (let i = 0; i < 10; i++) updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    const moving = updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    expect(moving.backwards).toBe(true);
    // a stalled frame must not flip walkBack -> walk
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true);
    expect(stalled.backwards).toBe(true);
  });

  it('treats a teleport snap as not moving', () => {
    const t = newLocoTrack();
    // 50u in one frame = 3000 u/s, far above the teleport cutoff
    const s = updateLocomotion(t, 50, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('jitter scenario: alternating walk/stall frames never lose moving', () => {
    const t = newLocoTrack();
    walkStep(t);
    let everStopped = false;
    for (let i = 0; i < 60; i++) {
      // every other frame stalls (worst-case interp/terrain noise)
      const s = i % 2 === 0 ? updateLocomotion(t, 0, 0, 0, FPS) : walkStep(t);
      if (!s.moving) everStopped = true;
    }
    expect(everStopped).toBe(false);
  });
});

describe('gait hysteresis (run vs walk)', () => {
  const run = (t: ReturnType<typeof newLocoTrack>, dt = FPS, speed = 7) =>
    updateLocomotion(t, 0, speed * dt, 0, dt);

  it('a steady run settles into the run gait quickly', () => {
    const t = newLocoTrack();
    let s = run(t);
    for (let i = 0; i < 20; i++) s = run(t);
    expect(s.running).toBe(true);
  });

  it('noisy per-frame speed around the old threshold NEVER flips the gait', () => {
    // the world-entry glitch: load-hitch frames make the sampled speed swing
    // wildly around 4.5 u/s; the run/walk pick used a bare compare and
    // crossfaded Running<->Walking on nearly every frame
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t); // settle into run
    let flips = 0;
    let last = true;
    for (let i = 0; i < 120; i++) {
      // alternate starved and burst frames: 3 u/s then 8 u/s samples
      const s = run(t, i % 2 === 0 ? 0.017 : 0.25, i % 2 === 0 ? 3 : 8);
      if (s.running !== last) flips++;
      last = s.running;
    }
    expect(flips).toBe(0);
  });

  it('a snared runner keeps the run gait until well below the exit threshold', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t);
    let s = run(t, FPS, 4.2); // 40% snare: between exit (3.6) and enter (5.2)
    for (let i = 0; i < 30; i++) s = run(t, FPS, 4.2);
    expect(s.running).toBe(true); // no gait pop mid-snare
    for (let i = 0; i < 60; i++) s = run(t, FPS, 2.0); // hard snare: drop to walk
    expect(s.running).toBe(false);
  });

  it('a one-frame backwards read cannot flash the walkBack direction', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t); // forward run, direction latched
    // a correction nudge reads one frame of backward displacement
    let s = updateLocomotion(t, 0, -7 * FPS, 0, FPS);
    expect(s.backwards).toBe(false); // dwell holds the direction
    // a REAL sustained backpedal still switches once the dwell elapses
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, -4.5 * FPS, 0, FPS);
    expect(s.backwards).toBe(true);
  });
});

describe('locomotion animation state', () => {
  it('uses authored walkBack for normal humanoid backpedal', () => {
    const state = { ...BASE_ANIM_STATE, moving: true, backwards: true, speed: 3 };
    expect(desiredBaseState(state, true)).toBe('walkBack');
    expect(locomotionTimeScale('walkBack', state)).toBeGreaterThan(0);
  });

  it('reverses forward locomotion for Ghost Wolf-style backpedal', () => {
    const state = {
      ...BASE_ANIM_STATE,
      moving: true,
      running: true,
      backwards: true,
      reverseBackpedal: true,
      speed: 7,
    };
    expect(desiredBaseState(state, true)).toBe('run');
    expect(locomotionTimeScale('run', state)).toBeLessThan(0);
  });
});

describe('pickProxyHeight (corpse pick-capsule flatten, issue 1486)', () => {
  it('uses the full standing height while alive', () => {
    expect(pickProxyHeight(1.8, 0.4, false)).toBe(1.8);
    expect(pickProxyHeight(3.0, 1.2, false)).toBe(3.0);
  });

  it('collapses a dead entity to a low, ground-hugging profile well under standing height', () => {
    // A humanoid: standing 1.8, radius 0.4 -> flat ~0.8, far below the upright column
    // that caused the phantom hitbox.
    const flat = pickProxyHeight(1.8, 0.4, true);
    expect(flat).toBeLessThan(1.8);
    expect(flat).toBe(0.8);
  });

  it('never exceeds the standing height for a wide, short creature', () => {
    // radius*2 would be 2.4 but standing height is only 1.0: clamp to the height so
    // the dead proxy is never TALLER than the living one.
    expect(pickProxyHeight(1.0, 1.2, true)).toBe(1.0);
  });

  it('scales the flat profile with body radius (long/wide creatures stay clickable)', () => {
    // A larger creature keeps a proportionally larger (but still sub-standing) flat
    // footprint so its corpse is not an unclickable sliver.
    expect(pickProxyHeight(3.0, 1.0, true)).toBe(2.0);
  });
});
