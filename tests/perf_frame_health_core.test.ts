import { describe, expect, it } from 'vitest';
import { isBadFrameWindow } from '../src/game/perf_frame_health_core';

const win = (fps: number, p95: number, long50 = 0, frames = 300) => ({
  frames,
  fps,
  frameMs: { p95, long50 },
});

describe('frame health window', () => {
  it('keeps the rule with no ceiling: under 45 fps, a 28 ms p95, or three long frames', () => {
    expect(isBadFrameWindow(win(60, 17))).toBe(false);
    expect(isBadFrameWindow(win(44.9, 17))).toBe(true);
    expect(isBadFrameWindow(win(60, 28))).toBe(true);
    expect(isBadFrameWindow(win(60, 17, 3))).toBe(true);
    expect(isBadFrameWindow(win(60, 17, 2))).toBe(false);
    expect(isBadFrameWindow(win(0, 0, 0, 0))).toBe(false);
  });

  it('reads a held chosen 30 as healthy, where the display rule calls it bad', () => {
    const held = win(30, 34.5);
    expect(isBadFrameWindow(held)).toBe(true);
    expect(isBadFrameWindow(held, { targetIntervalMs: 33.3, missShare: 0 })).toBe(false);
  });

  it('still flags a ceiling the machine cannot hold', () => {
    const cadence = { targetIntervalMs: 33.3, missShare: 0 };
    expect(isBadFrameWindow(win(22, 34.5), cadence)).toBe(true);
    expect(isBadFrameWindow(win(30, 56), cadence)).toBe(true);
    expect(isBadFrameWindow(win(30, 34.5), { targetIntervalMs: 33.3, missShare: 0.1 })).toBe(true);
  });

  it('counts missed slots, not 50 ms frames, under a ceiling', () => {
    // One missed slot at a ceiling of 30 IS a 50 ms frame: three of them in ten
    // seconds is a 1 percent miss share, not a bad window.
    expect(isBadFrameWindow(win(30, 34.5, 3), { targetIntervalMs: 33.3, missShare: 0.01 })).toBe(
      false,
    );
  });

  it('keeps the advice coming when the automatic mode engaged the ceiling', () => {
    const held = win(30, 34.5);
    expect(isBadFrameWindow(held, { targetIntervalMs: 33.3, missShare: 0, auto: true })).toBe(true);
    expect(isBadFrameWindow(held, { targetIntervalMs: 33.3, missShare: 0, auto: false })).toBe(
      false,
    );
  });

  it('reads a fast automatic ceiling as a good session: a steady 72 on a 144 Hz display', () => {
    const steady72 = win(72, 14.2);
    expect(
      isBadFrameWindow(steady72, { targetIntervalMs: 1000 / 72, missShare: 0, auto: true }),
    ).toBe(false);
    const steady60 = win(60, 17);
    expect(
      isBadFrameWindow(steady60, { targetIntervalMs: 1000 / 60, missShare: 0, auto: true }),
    ).toBe(false);
    // Just above the line is not: 60 asked for on a 100 Hz display is a steady 50.
    expect(
      isBadFrameWindow(win(50, 20.2), { targetIntervalMs: 1000 / 50, missShare: 0, auto: true }),
    ).toBe(false);
    // The line itself is evidence: 60 asked for on a 90 Hz display is exactly 45.
    expect(
      isBadFrameWindow(win(45, 22.4), { targetIntervalMs: 1000 / 45, missShare: 0, auto: true }),
    ).toBe(true);
    // It still answers to the chosen-cadence rules.
    expect(
      isBadFrameWindow(steady72, { targetIntervalMs: 1000 / 72, missShare: 0.2, auto: true }),
    ).toBe(true);
  });

  it('treats an inactive ceiling as none', () => {
    expect(isBadFrameWindow(win(30, 34.5), { targetIntervalMs: 0, missShare: 0 })).toBe(true);
    expect(isBadFrameWindow(win(30, 34.5), null)).toBe(true);
  });
});
