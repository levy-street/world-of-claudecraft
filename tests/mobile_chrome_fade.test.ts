import { describe, expect, it, vi } from 'vitest';
import {
  CHROME_FADE_IDLE_CLASS,
  CHROME_FADE_IDLE_MS,
  startChromeFade,
} from '../src/game/mobile_chrome_fade';

function fakeTarget() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
  };
}

function fakeTimers() {
  vi.useFakeTimers();
  return { setTimeout, clearTimeout };
}

describe('startChromeFade', () => {
  it('dims the target after the idle threshold', () => {
    const timers = fakeTimers();
    const target = fakeTarget();
    startChromeFade(target, timers);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(CHROME_FADE_IDLE_MS - 1);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(true);
    vi.useRealTimers();
  });

  it('touch() un-dims and restarts the timer', () => {
    const timers = fakeTimers();
    const target = fakeTarget();
    const handle = startChromeFade(target, timers, 1000);
    vi.advanceTimersByTime(1000);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(true);

    handle.touch();
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(999);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(true);
    vi.useRealTimers();
  });

  it('dispose() stops further dimming', () => {
    const timers = fakeTimers();
    const target = fakeTarget();
    const handle = startChromeFade(target, timers, 500);
    handle.dispose();
    vi.advanceTimersByTime(5000);
    expect(target.classes.has(CHROME_FADE_IDLE_CLASS)).toBe(false);
    vi.useRealTimers();
  });
});
