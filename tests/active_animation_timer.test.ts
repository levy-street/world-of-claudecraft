import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_ANIMATION_WALL_CAP_MULTIPLIER,
  type ActiveAnimationScheduler,
  afterActiveAnimationMs,
} from '../src/game/active_animation_timer';

function schedulerHarness() {
  let now = 0;
  const frames: Array<(at: number) => void> = [];
  const scheduler: ActiveAnimationScheduler = {
    now: () => now,
    requestFrame: (callback) => {
      frames.push(callback);
    },
  };
  return {
    scheduler,
    frame(at: number) {
      now = at;
      const callback = frames.shift();
      if (!callback) throw new Error('expected a pending animation frame');
      callback(at);
    },
    pending: () => frames.length,
  };
}

describe('afterActiveAnimationMs', () => {
  it('waits for the requested amount of active animation time', () => {
    const harness = schedulerHarness();
    const callback = vi.fn();

    afterActiveAnimationMs(100, callback, harness.scheduler);
    harness.frame(30);
    harness.frame(70);
    expect(callback).not.toHaveBeenCalled();
    harness.frame(100);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(harness.pending()).toBe(0);
  });

  it('escapes after three times the requested wall time when frames are heavily throttled', () => {
    const harness = schedulerHarness();
    const callback = vi.fn();

    expect(ACTIVE_ANIMATION_WALL_CAP_MULTIPLIER).toBe(3);
    afterActiveAnimationMs(100, callback, harness.scheduler);
    harness.frame(299);
    expect(callback).not.toHaveBeenCalled();
    harness.frame(300);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(harness.pending()).toBe(0);
  });

  it('runs non-positive waits immediately without scheduling a frame', () => {
    const harness = schedulerHarness();
    const callback = vi.fn();

    afterActiveAnimationMs(-1, callback, harness.scheduler);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(harness.pending()).toBe(0);
  });
});
