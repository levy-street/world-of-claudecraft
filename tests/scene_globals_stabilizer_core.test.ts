import { describe, expect, it } from 'vitest';
import {
  COLOR_BAND,
  deadbandCommit,
  deadbandScalar,
  emptyCommitted,
} from '../src/render/scene_globals_stabilizer_core';

describe('deadbandCommit', () => {
  it('always commits into an empty slot', () => {
    const c = emptyCommitted(3);
    expect(deadbandCommit(c, [0.5, 0.25, 1], COLOR_BAND)).toBe(true);
    expect([...c]).toEqual([0.5, 0.25, 1]);
  });

  it('holds inside the band and commits every component once one leaves it', () => {
    const c = emptyCommitted(3);
    deadbandCommit(c, [0.5, 0.5, 0.5], 0.01);
    expect(deadbandCommit(c, [0.505, 0.495, 0.509], 0.01)).toBe(false);
    expect([...c]).toEqual([0.5, 0.5, 0.5]);
    // Only the last component crosses; the whole vector moves together.
    expect(deadbandCommit(c, [0.505, 0.495, 0.52], 0.01)).toBe(true);
    expect([...c]).toEqual([0.505, 0.495, 0.52]);
  });

  it('bounds the error of a slow drift by the band and commits only now and then', () => {
    // The day/night ease measured on the tablet: about 2e-5 per frame.
    const c = emptyCommitted(1);
    let live = 0.6;
    let commits = 0;
    let worst = 0;
    for (let frame = 0; frame < 600; frame++) {
      live += 2e-5;
      if (deadbandCommit(c, [live], COLOR_BAND)) commits++;
      worst = Math.max(worst, Math.abs(live - c[0]));
    }
    expect(worst).toBeLessThanOrEqual(COLOR_BAND);
    // 600 frames of drift (0.012) over a 1/4096 band: about 50 commits, not 600.
    expect(commits).toBeGreaterThan(40);
    expect(commits).toBeLessThan(60);
  });

  it('does not flip on a value hovering around a fixed point (unlike grid rounding)', () => {
    const c = emptyCommitted(1);
    deadbandCommit(c, [0.5], COLOR_BAND);
    let commits = 0;
    for (let frame = 0; frame < 100; frame++) {
      const noise = (frame % 2 === 0 ? 1 : -1) * 1e-6;
      if (deadbandCommit(c, [0.5 + noise], COLOR_BAND)) commits++;
    }
    expect(commits).toBe(0);
  });

  it('never hides a non-finite live value', () => {
    const c = emptyCommitted(2);
    deadbandCommit(c, [1, 1], 0.1);
    expect(deadbandCommit(c, [Number.NaN, 1], 0.1)).toBe(true);
    expect(Number.isNaN(c[0])).toBe(true);
    // ...and recovers on the next finite value.
    expect(deadbandCommit(c, [1, 1], 0.1)).toBe(true);
    expect([...c]).toEqual([1, 1]);
  });
});

describe('deadbandScalar', () => {
  it('holds relative to the magnitude, absolute below 1', () => {
    expect(deadbandScalar(4, 4.001, 1 / 2048)).toBe(4);
    expect(deadbandScalar(4, 4.003, 1 / 2048)).toBe(4.003);
    expect(deadbandScalar(0.2, 0.2004, 1 / 2048)).toBe(0.2);
    expect(deadbandScalar(0.2, 0.2006, 1 / 2048)).toBe(0.2006);
  });
});
