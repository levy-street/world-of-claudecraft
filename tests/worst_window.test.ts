import { describe, expect, it } from 'vitest';
import { createWorstWindow, type WorstWindowFrameSample } from '../src/game/worst_window';

// A run of frames at a fixed per-frame duration ending at `endAt`.
function run(
  endAt: number,
  frameMs: number,
  count: number,
  stepMs = 100,
): WorstWindowFrameSample[] {
  const out: WorstWindowFrameSample[] = [];
  for (let i = count - 1; i >= 0; i--) out.push({ at: endAt - i * stepMs, ms: frameMs });
  return out;
}

describe('worst window tracking', () => {
  it('summarizes the trailing window with hand-computed values', () => {
    const w = createWorstWindow();
    // 96 healthy frames at 16 ms plus 4 hitches at 120 ms inside the window:
    // p95 over the 100 sorted samples is the 95th value, still 16; p99 is 120.
    const samples = [...run(9_500, 16, 96, 90), ...run(9_960, 120, 4, 10)];
    w.observe(samples, 10_000);
    const worst = w.current();
    expect(worst?.frames).toBe(100);
    expect(worst?.frameMs.p95).toBe(16);
    expect(worst?.frameMs.p99).toBe(120);
    expect(worst?.frameMs.max).toBe(120);
    expect(worst?.frameMs.long50).toBe(4);
    expect(worst?.frameMs.p50).toBe(16);
    expect(worst?.frameMs.avg).toBe(20.16);
    expect(worst?.atMs).toBe(10_000);
  });

  it('excludes samples older than the 10 s window', () => {
    const w = createWorstWindow();
    // The hitch storm sits more than 10 s before `now`; only healthy frames
    // remain in the window, so the retained p95 must be the healthy value.
    const samples = [...run(4_000, 200, 20), ...run(30_000, 16, 50)];
    w.observe(samples, 30_000);
    expect(w.current()?.frameMs.p95).toBe(16);
    expect(w.current()?.frames).toBe(50);
  });

  it('retains the worst window across later healthy evaluations', () => {
    const w = createWorstWindow();
    w.observe(run(10_000, 200, 50), 10_000);
    for (let t = 30_000; t <= 90_000; t += 1000) {
      w.observe(run(t, 16, 60), t);
    }
    const worst = w.current();
    expect(worst?.frameMs.p95).toBe(200);
    expect(worst?.atMs).toBe(10_000);
  });

  it('replaces the retained window when a worse one arrives', () => {
    const w = createWorstWindow();
    w.observe(run(10_000, 60, 50), 10_000);
    w.observe(run(40_000, 180, 50), 40_000);
    expect(w.current()?.frameMs.p95).toBe(180);
    expect(w.current()?.atMs).toBe(40_000);
  });

  it('drains to null and restarts the interval fresh', () => {
    const w = createWorstWindow();
    w.observe(run(10_000, 200, 50), 10_000);
    expect(w.current()).not.toBeNull();
    w.drain();
    expect(w.current()).toBeNull();
    // The next interval's worst is the healthy window, not the pre-drain storm.
    w.observe(run(40_000, 16, 50), 40_000);
    expect(w.current()?.frameMs.p95).toBe(16);
  });

  it('ignores an evaluation with no samples in the window', () => {
    const w = createWorstWindow();
    w.observe([], 10_000);
    expect(w.current()).toBeNull();
    w.observe(run(10_000, 90, 30), 10_000);
    w.observe([], 20_000);
    expect(w.current()?.frameMs.p95).toBe(90);
  });
});
