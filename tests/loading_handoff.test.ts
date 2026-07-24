import { describe, expect, it, vi } from 'vitest';
import { createLoadingHandoff } from '../src/game/loading_handoff';

function handoffHarness() {
  const animationCallbacks: Array<() => void> = [];
  const watchdogCallbacks = new Map<number, () => void>();
  const clearedWatchdogs: number[] = [];
  const watchdogDelays: number[] = [];
  let nextWatchdogId = 1;

  const handoff = createLoadingHandoff({
    requestAnimationFrame: (callback) => {
      animationCallbacks.push(callback);
    },
    setTimeout: (callback, delayMs) => {
      const id = nextWatchdogId++;
      watchdogCallbacks.set(id, callback);
      watchdogDelays.push(delayMs);
      return id;
    },
    clearTimeout: (id) => {
      clearedWatchdogs.push(id);
      watchdogCallbacks.delete(id);
    },
  });

  return {
    animationCallbacks,
    clearedWatchdogs,
    handoff,
    watchdogCallbacks,
    watchdogDelays,
  };
}

describe('loading handoff', () => {
  it('hands off on the paint after the first completed gameplay frame', () => {
    const harness = handoffHarness();
    const onHandoff = vi.fn();

    harness.handoff.start(onHandoff);
    harness.handoff.markFirstRenderedFrame();

    expect(onHandoff).not.toHaveBeenCalled();
    expect(harness.animationCallbacks).toHaveLength(1);
    expect(harness.clearedWatchdogs).toEqual([]);

    harness.animationCallbacks.shift()?.();
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(harness.clearedWatchdogs).toEqual([1]);
  });

  it('completes startup through a second bounded watchdog after gameplay keeps throwing', () => {
    const harness = handoffHarness();
    const onHandoff = vi.fn();
    const onWatchdog = vi.fn();
    harness.animationCallbacks.push(() => {
      throw new Error('renderer failed');
    });

    harness.handoff.start(onHandoff, onWatchdog);
    expect(harness.watchdogDelays).toEqual([5_000]);
    expect(() => harness.animationCallbacks.shift()?.()).toThrow('renderer failed');
    expect(onHandoff).not.toHaveBeenCalled();

    harness.watchdogCallbacks.get(1)?.();

    expect(harness.animationCallbacks).toHaveLength(0);
    expect(onWatchdog).toHaveBeenCalledTimes(1);
    expect(onHandoff).not.toHaveBeenCalled();
    expect(harness.watchdogDelays).toEqual([5_000, 5_000]);

    harness.watchdogCallbacks.get(2)?.();

    expect(onHandoff).toHaveBeenCalledTimes(1);
  });

  it('keeps the watchdog armed until the queued paint completes', () => {
    const harness = handoffHarness();
    const onHandoff = vi.fn();
    const onWatchdog = vi.fn();

    harness.handoff.start(onHandoff, onWatchdog);
    harness.handoff.markFirstRenderedFrame();

    expect(harness.animationCallbacks).toHaveLength(1);
    expect(harness.clearedWatchdogs).toEqual([]);

    harness.watchdogCallbacks.get(1)?.();
    expect(onWatchdog).toHaveBeenCalledTimes(1);
    expect(onHandoff).not.toHaveBeenCalled();
    expect(harness.watchdogDelays).toEqual([5_000, 5_000]);

    harness.animationCallbacks.shift()?.();
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(harness.clearedWatchdogs).toEqual([2]);
  });

  it('hands off once when the completion watchdog beats the queued paint', () => {
    const harness = handoffHarness();
    const onHandoff = vi.fn();
    const onWatchdog = vi.fn();

    harness.handoff.start(onHandoff, onWatchdog);
    harness.handoff.markFirstRenderedFrame();
    harness.watchdogCallbacks.get(1)?.();

    expect(onWatchdog).toHaveBeenCalledTimes(1);
    expect(harness.animationCallbacks).toHaveLength(1);

    harness.watchdogCallbacks.get(2)?.();
    expect(onHandoff).toHaveBeenCalledTimes(1);

    harness.animationCallbacks.shift()?.();

    expect(onHandoff).toHaveBeenCalledTimes(1);
  });

  it('finishes startup even when animation callbacks never resume', () => {
    const harness = handoffHarness();
    const onHandoff = vi.fn();
    const onWatchdog = vi.fn();

    harness.handoff.start(onHandoff, onWatchdog);
    harness.watchdogCallbacks.get(1)?.();

    expect(onWatchdog).toHaveBeenCalledTimes(1);
    expect(onHandoff).not.toHaveBeenCalled();
    expect(harness.animationCallbacks).toHaveLength(0);

    harness.watchdogCallbacks.get(2)?.();

    expect(onHandoff).toHaveBeenCalledTimes(1);
  });
});
