import { describe, expect, it } from 'vitest';
import {
  ANIM_REPAIR_FRAMES,
  type AnimActionWeight,
  type AnimState,
  desiredBaseState,
  drivesPose,
  locomotionTimeScale,
  needsAnimRepair,
  scanAnimRepair,
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
    expect(desiredBaseState(anim({ ...moving, swimming: true }), true)).toBe('swim');
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
    for (const state of ['idle', 'cast', 'spin', 'swim', 'sit', 'jump'] as const) {
      expect(locomotionTimeScale(state, { speed: 4, backwards: false }), state).toBeNull();
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
