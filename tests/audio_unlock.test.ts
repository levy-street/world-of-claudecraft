import { describe, expect, it } from 'vitest';
import { createAudioUnlockLatch } from '../src/game/audio_unlock';

type Listener = () => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  const capture = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof options === 'boolean' ? options : Boolean(options?.capture);
  const key = (
    type: string,
    options?: boolean | AddEventListenerOptions | EventListenerOptions,
  ): string => `${type}:${capture(options)}`;
  return {
    addEventListener(
      type: string,
      fn: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      const listenerKey = key(type, options);
      const set = listeners.get(listenerKey) ?? new Set<Listener>();
      set.add(fn as Listener);
      listeners.set(listenerKey, set);
    },
    removeEventListener(
      type: string,
      fn: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void {
      listeners.get(key(type, options))?.delete(fn as Listener);
    },
    fire(type: string): void {
      for (const fn of listeners.get(key(type, false)) ?? []) fn();
      for (const fn of listeners.get(key(type, true)) ?? []) fn();
    },
    count(type: string): number {
      return (
        (listeners.get(key(type, false))?.size ?? 0) + (listeners.get(key(type, true))?.size ?? 0)
      );
    },
  };
}

function fakeContext(state: AudioContextState | 'interrupted') {
  let calls = 0;
  return {
    state,
    resume(): Promise<void> {
      calls += 1;
      return Promise.resolve();
    },
    get calls(): number {
      return calls;
    },
  };
}

describe('audio unlock latch', () => {
  it('does not call resume before a gesture, which is what prints the console warning', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    const ctx = fakeContext('suspended');
    latch.resumeWhenAllowed(ctx);
    latch.resumeWhenAllowed(ctx);
    latch.resumeWhenAllowed(ctx);
    expect(ctx.calls).toBe(0);
    expect(latch.unlocked).toBe(false);
  });

  it('resumes a queued context on the first gesture, once', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    const ctx = fakeContext('suspended');
    latch.resumeWhenAllowed(ctx);
    latch.resumeWhenAllowed(ctx);
    target.fire('pointerdown');
    expect(ctx.calls).toBe(1);
    expect(latch.unlocked).toBe(true);
  });

  it('resumes immediately once unlocked', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    target.fire('keydown');
    const ctx = fakeContext('suspended');
    latch.resumeWhenAllowed(ctx);
    expect(ctx.calls).toBe(1);
  });

  it('never resumes a context that is already running', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    target.fire('pointerdown');
    const ctx = fakeContext('running');
    latch.resumeWhenAllowed(ctx);
    expect(ctx.calls).toBe(0);
  });

  it('never resumes a context that is already closed', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    target.fire('pointerdown');
    const ctx = fakeContext('closed');
    latch.resumeWhenAllowed(ctx);
    expect(ctx.calls).toBe(0);
  });

  it('resumes an interrupted WebKit context once unlocked', () => {
    const target = fakeTarget();
    const latch = createAudioUnlockLatch(target);
    target.fire('pointerdown');
    const ctx = fakeContext('interrupted');
    latch.resumeWhenAllowed(ctx);
    expect(ctx.calls).toBe(1);
  });

  it('drops its gesture listeners after unlocking', () => {
    const target = fakeTarget();
    createAudioUnlockLatch(target);
    expect(target.count('pointerdown')).toBe(1);
    target.fire('touchend');
    expect(target.count('pointerdown')).toBe(0);
    expect(target.count('keydown')).toBe(0);
    expect(target.count('touchend')).toBe(0);
  });

  it('treats a headless target as already unlocked so Node callers still resume', () => {
    const latch = createAudioUnlockLatch(null);
    const ctx = fakeContext('suspended');
    latch.resumeWhenAllowed(ctx);
    expect(latch.unlocked).toBe(true);
    expect(ctx.calls).toBe(1);
  });
});
