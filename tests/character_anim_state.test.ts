import { describe, expect, it } from 'vitest';
import {
  ANIM_REPAIR_FRAMES,
  type AnimActionWeight,
  type AnimState,
  advanceSwimPitch,
  advanceTreadBlend,
  desiredBaseState,
  drivesPose,
  isWadingAtDepth,
  locomotionTimeScale,
  needsAnimRepair,
  SWIM_PITCH_FULL_SPEED,
  SWIM_PITCH_MAX,
  scanAnimRepair,
  shouldPlayLanding,
} from '../src/render/characters/anim_state';

// A three.js SkinnedMesh renders BIND POSE (arms out, the T-pose) whenever the
// summed effective weight of the mixer's scheduled actions is below 1: the
// PropertyMixer blends the deficit back toward the bind transform. These
// helpers are the pure half of the watchdog that catches a rig left with no
// action driving it at all.

const driving = (effectiveWeight: number): AnimActionWeight => ({
  scheduled: true,
  effectiveWeight,
});
/** stop()ped actions keep a stale effective weight; the mixer ignores them */
const stopped = (effectiveWeight: number): AnimActionWeight => ({
  scheduled: false,
  effectiveWeight,
});

const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

describe('drivesPose', () => {
  it('accepts a scheduled action at full weight', () => {
    expect(drivesPose(driving(1))).toBe(true);
  });

  it('rejects a stopped action even though its last weight is stale at full', () => {
    expect(drivesPose(stopped(1))).toBe(false);
  });

  it('rejects a scheduled action whose fade-out has completed', () => {
    expect(drivesPose(driving(0))).toBe(false);
    expect(drivesPose(driving(0.01))).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(drivesPose(null)).toBe(false);
  });
});

describe('needsAnimRepair', () => {
  it('flags a rig whose only action was stopped (bind pose with no way back)', () => {
    expect(needsAnimRepair([stopped(1), stopped(0)], false)).toBe(true);
  });

  it('flags a rig whose actions all faded out to zero', () => {
    expect(needsAnimRepair([driving(0), driving(0)], false)).toBe(true);
  });

  it('does not flag a normal crossfade, whose halves still sum to one', () => {
    expect(needsAnimRepair([driving(0.6), driving(0.4)], false)).toBe(false);
  });

  it('does not flag the first frame of a partnered fade-in', () => {
    expect(needsAnimRepair([driving(0.93), driving(0.07)], false)).toBe(false);
  });

  it('does not flag a clamped-hold one-shot (a statue at full weight, not a T-pose)', () => {
    // A finished LoopOnce action with clampWhenFinished is PAUSED, so three's
    // isRunning() is false, yet it still accumulates at weight 1. The predicate
    // must key off scheduling + weight, never off isRunning().
    expect(needsAnimRepair([driving(1), stopped(0)], false)).toBe(false);
  });

  it('does not flag a dead-locked rig (the death clip clamps by design)', () => {
    expect(needsAnimRepair([stopped(1)], true)).toBe(false);
    // the same rig, alive, is starved: dead-lock is what suppresses it
    expect(needsAnimRepair([stopped(1)], false)).toBe(true);
  });

  it('does not flag a rig that has no actions at all (clip-less prop rigs)', () => {
    expect(needsAnimRepair([], false)).toBe(false);
  });
});

describe('scanAnimRepair', () => {
  it('does not repair on the first starved frame (a legitimate fade-in starts at zero)', () => {
    const scan = scanAnimRepair(0, [driving(0)], false);
    expect(scan.starvedFrames).toBe(1);
    expect(scan.repair).toBe(false);
  });

  it('repairs on the third consecutive starved frame, not before', () => {
    expect(ANIM_REPAIR_FRAMES).toBe(3);
    const first = scanAnimRepair(0, [driving(0)], false);
    const second = scanAnimRepair(first.starvedFrames, [driving(0)], false);
    const third = scanAnimRepair(second.starvedFrames, [driving(0)], false);
    expect([first.repair, second.repair, third.repair]).toEqual([false, false, true]);
    expect([first.starvedFrames, second.starvedFrames]).toEqual([1, 2]);
  });

  it('forgets a starved run interrupted by a driven frame', () => {
    const first = scanAnimRepair(0, [driving(0)], false);
    const second = scanAnimRepair(first.starvedFrames, [driving(0)], false);
    const driven = scanAnimRepair(second.starvedFrames, [driving(1)], false);
    const third = scanAnimRepair(driven.starvedFrames, [driving(0)], false);
    const fourth = scanAnimRepair(third.starvedFrames, [driving(0)], false);
    expect([driven.repair, third.repair, fourth.repair]).toEqual([false, false, false]);
  });

  it('re-arms after a repair so a rig that is still starved is driven again', () => {
    const scan = scanAnimRepair(ANIM_REPAIR_FRAMES - 1, [driving(0)], false);
    expect(scan.repair).toBe(true);
    expect(scan.starvedFrames).toBe(0);
  });

  it('resets the counter as soon as an action drives the pose again', () => {
    const starved = scanAnimRepair(ANIM_REPAIR_FRAMES - 1, [driving(1)], false);
    expect(starved.starvedFrames).toBe(0);
    expect(starved.repair).toBe(false);
  });

  it('never repairs a dead-locked rig, however long it holds', () => {
    let starvedFrames = 0;
    for (let i = 0; i < ANIM_REPAIR_FRAMES * 3; i++) {
      const scan = scanAnimRepair(starvedFrames, [stopped(1)], true);
      starvedFrames = scan.starvedFrames;
      expect(scan.repair).toBe(false);
    }
    expect(starvedFrames).toBe(0);
  });

  it('never repairs a crossfading rig, however long it runs', () => {
    let starvedFrames = 0;
    for (let i = 0; i < ANIM_REPAIR_FRAMES * 3; i++) {
      const scan = scanAnimRepair(starvedFrames, [driving(0.5), driving(0.5)], false);
      starvedFrames = scan.starvedFrames;
      expect(scan.repair).toBe(false);
    }
  });
});

describe('desiredBaseState', () => {
  it('never asks for walkBack when the loaded rig has no such action', () => {
    // The mixer falls back to the plain walk action when walkBack is missing
    // (baseAction), so a state machine that still believes it is in walkBack
    // desyncs from what is actually playing.
    const backwards = anim({ moving: true, backwards: true });
    expect(desiredBaseState(backwards, false)).toBe('walk');
    expect(desiredBaseState({ ...backwards, running: true }, false)).toBe('run');
  });

  it('asks for walkBack when the rig really has the clip', () => {
    expect(desiredBaseState(anim({ moving: true, backwards: true }), true)).toBe('walkBack');
  });

  it('keeps the forward clip for a rig that backpedals by reversing it', () => {
    expect(
      desiredBaseState(anim({ moving: true, backwards: true, reverseBackpedal: true }), true),
    ).toBe('walk');
  });

  it('keeps the documented precedence over locomotion', () => {
    const moving = { moving: true, backwards: true };
    expect(desiredBaseState(anim({ ...moving, swimming: true }), true)).toBe('swimSurface');
    expect(desiredBaseState(anim({ ...moving, swimming: true, submerged: true }), true)).toBe(
      'swim',
    );
    expect(desiredBaseState(anim({ ...moving, airborne: true }), true)).toBe('jump');
    expect(desiredBaseState(anim({ ...moving, spinning: true }), true)).toBe('spin');
    expect(desiredBaseState(anim({ ...moving, casting: true }), true)).toBe('cast');
    expect(desiredBaseState(anim({ ...moving, sitting: true }), true)).toBe('sit');
    expect(desiredBaseState(anim(), true)).toBe('idle');
  });
});

describe('locomotionTimeScale', () => {
  it('matches foot speed against the walk reference, clamped', () => {
    expect(locomotionTimeScale('walk', { speed: 2.2, backwards: false })).toBeCloseTo(1);
    expect(locomotionTimeScale('walk', { speed: 0.1, backwards: false })).toBeCloseTo(0.6);
    expect(locomotionTimeScale('walk', { speed: 99, backwards: false })).toBeCloseTo(1.8);
  });

  it('matches foot speed against the run reference, clamped', () => {
    expect(locomotionTimeScale('run', { speed: 7, backwards: false })).toBeCloseTo(1);
    expect(locomotionTimeScale('run', { speed: 99, backwards: false })).toBeCloseTo(1.6);
  });

  it('returns null for every non-locomotion pose', () => {
    for (const state of ['idle', 'cast', 'spin', 'sit', 'jump'] as const) {
      expect(locomotionTimeScale(state, { speed: 4, backwards: false }), state).toBeNull();
    }
  });

  it('paces both swim strokes off swim speed, and never reverses them', () => {
    for (const state of ['swim', 'swimSurface'] as const) {
      // clamped either side, so a drifting swimmer still strokes
      expect(locomotionTimeScale(state, { speed: 0, backwards: false }), state).toBeCloseTo(0.55);
      expect(locomotionTimeScale(state, { speed: 3.2, backwards: false }), state).toBeCloseTo(1);
      expect(locomotionTimeScale(state, { speed: 99, backwards: false }), state).toBeCloseTo(1.4);
      // a backpedalling swimmer pulls slower, it never plays the stroke backwards
      const value = locomotionTimeScale(state, {
        speed: 2,
        backwards: true,
        reverseBackpedal: true,
      });
      expect(value, state).toBeGreaterThan(0);
    }
  });

  it('reverses the forward clip only for a backpedalling reverse rig', () => {
    const back = { speed: 2.2, backwards: true, reverseBackpedal: true };
    expect(locomotionTimeScale('walk', back)).toBeCloseTo(-1);
    // an authored walkBack clip plays FORWARD; only the reversed fallback negates
    expect(locomotionTimeScale('walkBack', back)).toBeCloseTo(1);
    expect(locomotionTimeScale('walk', { ...back, backwards: false })).toBeCloseTo(1);
  });
});

// A swimmer noses over toward wherever they are actually travelling, so the
// stroke reads as aimed rather than as a flat body sliding down a lift shaft.
// It follows MOTION, not the local camera, so peers pitch too and the pose can
// never contradict the descent it is drawn against.
describe('swim pitch follow', () => {
  /** Run the ease to rest at a held vertical speed. */
  const settle = (verticalSpeed: number, swimming = true, from = 0): number => {
    let pitch = from;
    for (let i = 0; i < 240; i++) pitch = advanceSwimPitch(pitch, verticalSpeed, swimming, 1 / 60);
    return pitch;
  };

  it('holds level when the body holds its depth', () => {
    expect(settle(0)).toBeCloseTo(0, 5);
  });

  it('noses DOWN while descending and UP while climbing', () => {
    expect(settle(-SWIM_PITCH_FULL_SPEED)).toBeCloseTo(SWIM_PITCH_MAX, 4);
    expect(settle(SWIM_PITCH_FULL_SPEED)).toBeCloseTo(-SWIM_PITCH_MAX, 4);
  });

  it('clamps, so a fast lift cannot stand the body on its head', () => {
    expect(settle(-40)).toBeCloseTo(SWIM_PITCH_MAX, 4);
    expect(settle(40)).toBeCloseTo(-SWIM_PITCH_MAX, 4);
  });

  it('eases rather than snapping: one frame moves a fraction of the way', () => {
    const oneFrame = advanceSwimPitch(0, -SWIM_PITCH_FULL_SPEED, true, 1 / 60);
    expect(oneFrame).toBeGreaterThan(0);
    expect(oneFrame).toBeLessThan(SWIM_PITCH_MAX * 0.2);
  });

  it('unwinds to level on leaving the water, even mid-dive', () => {
    expect(settle(-SWIM_PITCH_FULL_SPEED, false, SWIM_PITCH_MAX)).toBeCloseTo(0, 5);
  });

  it('survives a NaN carried in from a divide by a zero frame time', () => {
    expect(Number.isFinite(advanceSwimPitch(Number.NaN, -1, true, 1 / 60))).toBe(true);
  });
});

// The water lane has four phases now, and which one plays is the whole point:
// stroke while moving, tread while still, wade while the ground is still there.
describe('water base states', () => {
  const swimming = (over: Partial<AnimState> = {}) =>
    anim({ swimming: true, moving: true, speed: 3, ...over });

  it('treads water when a swimmer stops, at any depth', () => {
    expect(desiredBaseState(swimming({ moving: false }), true)).toBe('swimIdle');
    expect(desiredBaseState(swimming({ moving: false, submerged: true }), true)).toBe('swimIdle');
  });

  it('strokes while moving, picking the stroke by depth', () => {
    expect(desiredBaseState(swimming(), true)).toBe('swimSurface');
    expect(desiredBaseState(swimming({ submerged: true }), true)).toBe('swim');
  });

  it('wades instead of walking or running when the feet are in water', () => {
    const wading = anim({ moving: true, wading: true, speed: 5, running: true });
    // one cycle covers both gaits...
    expect(desiredBaseState(wading, true)).toBe('wade');
    expect(desiredBaseState({ ...wading, running: false }, true)).toBe('wade');
    // ...and it is the WATER that picks it, not the pace
    expect(desiredBaseState({ ...wading, wading: false }, true)).toBe('run');
  });

  it('does not wade while standing still, or while swimming', () => {
    expect(desiredBaseState(anim({ wading: true }), true)).toBe('idle');
    expect(desiredBaseState(swimming({ wading: true }), true)).toBe('swimSurface');
  });

  it('holds the tread at its own tempo but matches the wade to the pace', () => {
    expect(locomotionTimeScale('swimIdle', { speed: 0.4, backwards: false })).toBeNull();
    const slow = locomotionTimeScale('wade', { speed: 2, backwards: false });
    const fast = locomotionTimeScale('wade', { speed: 6, backwards: false });
    expect(slow).not.toBeNull();
    expect(slow!).toBeLessThan(fast!);
    expect(fast!).toBeLessThanOrEqual(1.45);
    expect(slow!).toBeGreaterThanOrEqual(0.65);
  });
});

describe('the wade latch', () => {
  it('needs the water over the ankle, and lets go later than it caught', () => {
    expect(isWadingAtDepth(false, false, false, 0.1)).toBe(false);
    expect(isWadingAtDepth(false, false, false, 0.3)).toBe(true);
    // hysteresis: still wading just under the enter depth, dry well below it
    expect(isWadingAtDepth(true, false, false, 0.15)).toBe(true);
    expect(isWadingAtDepth(true, false, false, 0.05)).toBe(false);
  });

  it('is off while swimming, while dead, and out of the water entirely', () => {
    expect(isWadingAtDepth(true, true, false, 2)).toBe(false);
    expect(isWadingAtDepth(true, false, true, 2)).toBe(false);
    expect(isWadingAtDepth(true, false, false, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

// The tread swaps the body between two water poses that sit a third of a yard
// apart vertically, so the OFFSET has to ease even though the clips crossfade
// on their own. This is the half a unit test can hold: that no single frame
// moves a large share of that distance, at any frame rate.
describe('tread blend', () => {
  it('starts at rest and settles at the target', () => {
    expect(advanceTreadBlend(0, false, 1 / 60)).toBeCloseTo(0, 6);
    let b = 0;
    for (let i = 0; i < 240; i++) b = advanceTreadBlend(b, true, 1 / 60);
    expect(b).toBeCloseTo(1, 4);
    for (let i = 0; i < 240; i++) b = advanceTreadBlend(b, false, 1 / 60);
    expect(b).toBeCloseTo(0, 4);
  });

  it('never jumps: one frame covers only a slice of the remaining gap', () => {
    expect(advanceTreadBlend(0, true, 1 / 60)).toBeLessThan(0.12);
    expect(advanceTreadBlend(0, true, 1 / 30)).toBeLessThan(0.22);
  });

  it('is frame-rate independent: the same wall-clock lands in the same place', () => {
    let fast = 0;
    for (let i = 0; i < 60; i++) fast = advanceTreadBlend(fast, true, 1 / 120);
    let slow = 0;
    for (let i = 0; i < 15; i++) slow = advanceTreadBlend(slow, true, 1 / 30);
    expect(fast).toBeCloseTo(slow, 3); // both are half a second in
  });

  it('shrugs off a NaN and a negative frame time', () => {
    expect(Number.isFinite(advanceTreadBlend(Number.NaN, true, 1 / 60))).toBe(true);
    expect(advanceTreadBlend(0.5, true, -1)).toBeCloseTo(0.5, 6);
  });
});

describe('shouldPlayLanding', () => {
  // (wasAirborne, airborne, dead, hasLandClip)
  it('fires exactly on the airborne -> grounded edge', () => {
    expect(shouldPlayLanding(true, false, false, true)).toBe(true);
  });

  it('stays silent while still airborne, so the jump pose keeps its hold', () => {
    expect(shouldPlayLanding(true, true, false, true)).toBe(false);
  });

  it('stays silent on the ground and on the takeoff edge', () => {
    expect(shouldPlayLanding(false, false, false, true)).toBe(false);
    expect(shouldPlayLanding(false, true, false, true)).toBe(false);
  });

  it('does nothing for a rig with no landing clip (every pre-existing rig)', () => {
    expect(shouldPlayLanding(true, false, false, false)).toBe(false);
  });

  it('yields to death: a body killed mid-air collapses, it does not stick a landing', () => {
    expect(shouldPlayLanding(true, false, true, true)).toBe(false);
  });
});
