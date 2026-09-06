import { describe, expect, it } from 'vitest';
import {
  advanceInterruptibleMountEngine,
  advanceMountEngine,
  type MountEngineEntry,
  mountEngineLoopActive,
} from '../src/game/mount_engine_state';

const START_DURATION = 0.9;

describe('mount_engine_state', () => {
  it('idle stays idle while not moving', () => {
    const { next, action } = advanceMountEngine(undefined, false, 0, START_DURATION);
    expect(next.state).toBe('idle');
    expect(action).toBeNull();
  });

  it('idle to starting plays the windup one-shot on the moving edge', () => {
    const { next, action } = advanceMountEngine(undefined, true, 10, START_DURATION);
    expect(next).toEqual({ state: 'starting', phaseStartedAt: 10 });
    expect(action).toBe('playStart');
  });

  it('starting holds with no action until the windup duration elapses', () => {
    const entry: MountEngineEntry = { state: 'starting', phaseStartedAt: 10 };
    const { next, action } = advanceMountEngine(entry, true, 10.5, START_DURATION);
    expect(next).toEqual(entry);
    expect(action).toBeNull();
  });

  it('starting transitions to moving (loop) once the windup ends while still moving', () => {
    const entry: MountEngineEntry = { state: 'starting', phaseStartedAt: 10 };
    const { next, action } = advanceMountEngine(entry, true, 10 + START_DURATION, START_DURATION);
    expect(next).toEqual({ state: 'moving', phaseStartedAt: 10 + START_DURATION });
    expect(action).toBeNull();
    expect(mountEngineLoopActive(next.state)).toBe(true);
  });

  it('a quick tap lets the windup finish, then chains straight into the winddown, no loop', () => {
    const start = advanceMountEngine(undefined, true, 0, START_DURATION);
    expect(start.action).toBe('playStart');
    // Movement stops well before the windup's known duration elapses.
    const held = advanceMountEngine(start.next, false, 0.1, START_DURATION);
    expect(held.action).toBeNull();
    expect(held.next.state).toBe('starting');
    // At the windup's natural end, moving is now false: chain to winddown.
    const finished = advanceMountEngine(held.next, false, START_DURATION, START_DURATION);
    expect(finished.next).toEqual({ state: 'stopping', phaseStartedAt: START_DURATION });
    expect(finished.action).toBe('playStop');
    expect(mountEngineLoopActive(finished.next.state)).toBe(false);
  });

  it('moving to stopping plays the winddown one-shot on the stop edge', () => {
    const entry: MountEngineEntry = { state: 'moving', phaseStartedAt: 5 };
    const { next, action } = advanceMountEngine(entry, false, 20, START_DURATION);
    expect(next).toEqual({ state: 'stopping', phaseStartedAt: 20 });
    expect(action).toBe('playStop');
  });

  it('moving holds the loop while still moving', () => {
    const entry: MountEngineEntry = { state: 'moving', phaseStartedAt: 5 };
    const { next, action } = advanceMountEngine(entry, true, 20, START_DURATION);
    expect(next).toEqual(entry);
    expect(action).toBeNull();
  });

  it('stopping settles to idle once movement stays off (no explicit idle transition needed)', () => {
    const entry: MountEngineEntry = { state: 'stopping', phaseStartedAt: 20 };
    const { next, action } = advanceMountEngine(entry, false, 25, START_DURATION);
    expect(next).toEqual(entry);
    expect(action).toBeNull();
  });

  it('a re-tap mid-winddown restarts the windup immediately', () => {
    const entry: MountEngineEntry = { state: 'stopping', phaseStartedAt: 20 };
    const { next, action } = advanceMountEngine(entry, true, 20.2, START_DURATION);
    expect(next).toEqual({ state: 'starting', phaseStartedAt: 20.2 });
    expect(action).toBe('playStart');
  });
});

describe('interruptible mount engine state', () => {
  it('cuts start directly to stop on a quick release', () => {
    const start = advanceInterruptibleMountEngine(undefined, true, 0, START_DURATION);
    const stop = advanceInterruptibleMountEngine(start.next, false, 0.1, START_DURATION);
    expect(stop).toEqual({
      next: { state: 'stopping', phaseStartedAt: 0.1 },
      action: 'playStop',
    });
  });

  it('cuts stop directly back to start on a re-press', () => {
    const stopping: MountEngineEntry = { state: 'stopping', phaseStartedAt: 0.1 };
    const restart = advanceInterruptibleMountEngine(stopping, true, 0.2, START_DURATION);
    expect(restart).toEqual({
      next: { state: 'starting', phaseStartedAt: 0.2 },
      action: 'playStart',
    });
  });

  it('hard-splices to the sustain state only after the full start duration', () => {
    const start = advanceInterruptibleMountEngine(undefined, true, 0, START_DURATION);
    expect(advanceInterruptibleMountEngine(start.next, true, 0.8, START_DURATION).next.state).toBe(
      'starting',
    );
    expect(advanceInterruptibleMountEngine(start.next, true, 0.9, START_DURATION).next.state).toBe(
      'moving',
    );
  });
});
