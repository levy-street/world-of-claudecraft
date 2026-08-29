// The shader warm worker's relative settlement judge
// (src/render/shader_warm_settle_judge_core.ts): a link's settle is read
// against what this driver costs for a COMPARABLE link it has to itself,
// per thousand characters of GLSL, never against a millisecond bound. The
// driver profiles measured on 2026-08-30 (an RTX 3060 under Chrome 152 for
// ANGLE D3D11 and ANGLE OpenGL; this box's Mesa Intel iGPU headless) are the
// cases the bounds exist to separate, so they are the cases here, in the
// probe's own numbers.

import { describe, expect, it } from 'vitest';
import type { SettlementVerdict } from '../src/render/adaptive_link_budget_core';
import {
  createRelativeSettleJudge,
  RELATIVE_SETTLE_JUDGE_CONFIG,
  type RelativeSettleJudge,
  type RelativeSettleJudgeConfig,
} from '../src/render/shader_warm_settle_judge_core';

/** A settle of `settlementMs` at `concurrency`; weight 1 and a window equal
 *  to the concurrency unless given. */
function settle(
  judge: RelativeSettleJudge,
  settlementMs: number,
  concurrency: number,
  weight = 1,
  windowLinks = concurrency,
): SettlementVerdict {
  return judge.judge({ settlementMs, weight, concurrency, windowLinks });
}

/** Two solo links at `ms` each, with the window at one: the etalon, and the
 *  request for company. */
function taught(ms: number, judge = createRelativeSettleJudge()): RelativeSettleJudge {
  settle(judge, ms, 1);
  settle(judge, ms, 1);
  return judge;
}

describe('the bounds the judge reads a ratio against', () => {
  it('pins them, with the profiles they separate', () => {
    // D3D11 at four in flight read 1.3 (grow), NVIDIA GL at two 1.3 (grow)
    // and at four 2.1 (halve), Mesa at two 2.4 (halve). Two readings before
    // a verdict: one reading is a coincidence. Seven solo samples under the
    // median. A factor of two either way is "comparable": size predicts link
    // time within a class, not across (a fixed floor dominates small
    // programs on OpenGL and Vulkan). A solo settle under a quarter of the
    // etalon is a cache hit. Seven samples of cooldown after a halving.
    // Solo evidence lifts the window to two and no further.
    expect(RELATIVE_SETTLE_JUDGE_CONFIG).toEqual({
      growBelowRatio: 1.5,
      shrinkAboveRatio: 2,
      agreeingSamples: 2,
      etalonSamples: 7,
      comparableWeightFactor: 2,
      hitBelowRatio: 0.25,
      cooldownSamples: 7,
      soloWindowCap: 2,
    });
  });
});

describe('what a solo link teaches', () => {
  it('sets the etalon from a link the driver had to itself, and asks for company', () => {
    const judge = createRelativeSettleJudge();
    expect(judge.snapshot().etalonMsPerWeight).toBeNull();

    // One reading is not a verdict yet; the second agreeing one is.
    expect(settle(judge, 40, 1)).toBe('mid');
    expect(judge.snapshot()).toMatchObject({ etalonMsPerWeight: 40, soloSamples: 1 });
    expect(settle(judge, 40, 1)).toBe('fast');
    expect(judge.snapshot()).toMatchObject({
      soloSamples: 2,
      streak: { verdict: 'fast', count: 2 },
    });
  });

  it('lifts the window to two on solo evidence, and never past it', () => {
    // A trickle of one-at-a-time requests sees no concurrency: it may open
    // the first step that can, and nothing more.
    const judge = createRelativeSettleJudge();
    expect(settle(judge, 40, 1, 1, 1)).toBe('mid');
    expect(settle(judge, 40, 1, 1, 1)).toBe('fast');
    for (let i = 0; i < 6; i++) expect(settle(judge, 40, 1, 1, 2)).toBe('mid');
    expect(settle(judge, 40, 1, 1, 3)).toBe('mid');
    // Back at one (a halving), solo evidence may open two again.
    settle(judge, 40, 1, 1, 1);
    expect(settle(judge, 40, 1, 1, 1)).toBe('fast');
  });

  it('prices the link per unit of weight, so a heavy program and a light one agree', () => {
    // 80 ms for two thousand characters is the same driver as 40 ms for one.
    const judge = createRelativeSettleJudge();
    settle(judge, 80, 1, 2);
    expect(judge.snapshot().etalonMsPerWeight).toBe(40);
    settle(judge, 600, 1, 15);
    // Median of 40 and 40.
    expect(judge.snapshot().etalonMsPerWeight).toBe(40);
  });

  it('keeps the etalon a median, so one heavy outlier cannot move it', () => {
    // A program the driver choked on comes back at ten times the cost.
    const judge = createRelativeSettleJudge();
    for (const ms of [40, 42, 38, 400, 41]) settle(judge, ms, 1);
    expect(judge.snapshot().etalonMsPerWeight).toBe(41);
  });

  it('sets a cache hit aside: a solo settle far under the etalon teaches nothing', () => {
    // The main thread linked the program cold (a hold expired), then asked
    // again: the worker's link is a 5 ms hit. Four of those would collapse
    // a median of seven toward the hit and read every real link as slow.
    const judge = taught(40);
    for (let i = 0; i < 4; i++) expect(settle(judge, 5, 1, 1, 2)).toBe('mid');
    expect(judge.snapshot()).toMatchObject({ etalonMsPerWeight: 40, hits: 4, soloSamples: 2 });
    // Exactly a quarter is a link, not a hit.
    settle(judge, 10, 1, 1, 2);
    expect(judge.snapshot()).toMatchObject({ hits: 4, soloSamples: 3 });
  });

  it('forgets solo samples past the window, so a driver that warmed up is re-read', () => {
    // 30 against 100 is a faster driver (a hit would be under 25).
    const judge = createRelativeSettleJudge();
    for (let i = 0; i < 7; i++) settle(judge, 100, 1);
    for (let i = 0; i < 7; i++) settle(judge, 30, 1);
    expect(judge.snapshot().etalonMsPerWeight).toBe(30);
  });

  it('keeps exactly the last seven solo samples under the median', () => {
    const judge = createRelativeSettleJudge();
    for (let i = 0; i < 7; i++) settle(judge, 100, 1);
    for (let i = 0; i < 3; i++) settle(judge, 30, 1);
    // Seven kept: four at 100 and three at 30, the median is 100 (six kept
    // would read 65).
    expect(judge.snapshot().etalonMsPerWeight).toBe(100);
    settle(judge, 30, 1);
    // Three at 100 and four at 30: 30 (eight kept would read 65).
    expect(judge.snapshot().etalonMsPerWeight).toBe(30);
  });

  it('never divides by a weight of zero, and reads a weight that is not a number as one', () => {
    const judge = createRelativeSettleJudge();
    settle(judge, 10, 1, 0);
    expect(judge.snapshot().etalonMsPerWeight).toBe(200);
    // The same floor on both sides: the ratio is 1, a fast reading.
    expect(settle(judge, 10, 2, 0)).toBe('fast');

    const nan = createRelativeSettleJudge();
    settle(nan, 40, 1, Number.NaN);
    expect(nan.snapshot().etalonMsPerWeight).toBe(40);
  });

  it('reads a settle in company as mid, and drops the streak, while the etalon is zero', () => {
    // A solo link that settled in no time at all teaches nothing to divide by.
    const judge = createRelativeSettleJudge();
    settle(judge, 0, 1);
    expect(judge.snapshot().streak).toEqual({ verdict: 'fast', count: 1 });
    expect(settle(judge, 100, 2)).toBe('mid');
    expect(judge.snapshot()).toMatchObject({ etalonMsPerWeight: 0, streak: null });
  });
});

describe('like is compared with like', () => {
  it('reads a settle only against solo samples of comparable weight', () => {
    // On Vulkan a 15 kchar program costs 3 ms per kchar and a 2.5 kchar one
    // 10: judged against each other, size alone would move the window.
    const judge = taught(10);
    expect(settle(judge, 45, 2, 15)).toBe('mid');
    expect(settle(judge, 45, 2, 15)).toBe('mid');
    expect(judge.snapshot().lastRatio).toBeNull();

    // A solo sample of that class teaches the class; the window is at two,
    // so it grows nothing itself.
    expect(settle(judge, 45, 1, 15, 2)).toBe('mid');
    expect(settle(judge, 50, 2, 15)).toBe('mid');
    expect(settle(judge, 50, 2, 15)).toBe('fast');
    expect(judge.snapshot().lastRatio).toBeCloseTo(50 / 45, 6);
  });

  it('counts a factor of two either way as comparable, inclusive', () => {
    const judge = taught(40);
    // Weight 2 against weight 1: comparable; 2.5 is not.
    expect(settle(judge, 84, 2, 2)).toBe('fast');
    expect(settle(judge, 84, 2, 2)).toBe('fast');
    expect(settle(judge, 100, 2, 2.5)).toBe('mid');
    expect(settle(judge, 100, 2, 2.5)).toBe('mid');
    // Weight 0.5 against weight 1: comparable (two readings, as always).
    expect(settle(judge, 21, 2, 0.5)).toBe('mid');
    expect(settle(judge, 21, 2, 0.5)).toBe('fast');
  });
});

describe('what a link in company says, on the measured profiles', () => {
  it('D3D11: links in company settle near the solo cost, so the window grows to the cap', () => {
    // The probe: 37 ms alone, 42 at two in flight, 48 at four, throughput
    // 26.7 -> 42.2 -> 75.2 links/s. The driver overlaps; every reading is
    // under the grow bound.
    const judge = taught(37);
    expect(settle(judge, 42, 2)).toBe('fast');
    expect(settle(judge, 42, 2)).toBe('fast');
    expect(settle(judge, 48, 4)).toBe('fast');
    expect(settle(judge, 48, 4)).toBe('fast');
    expect(judge.snapshot().lastRatio).toBeCloseTo(48 / 37, 6);
  });

  it('NVIDIA OpenGL: two overlap, four queue, so the window settles between', () => {
    // 34 ms alone, 45 at two (1.3: grow), 72 at four (2.1: halve).
    const judge = taught(34);
    expect(settle(judge, 45, 2)).toBe('fast');
    expect(settle(judge, 45, 2)).toBe('fast');
    expect(settle(judge, 72, 4)).toBe('mid');
    expect(settle(judge, 72, 4)).toBe('slow');
  });

  it('Mesa Intel: two already queue, so the window comes back down at once', () => {
    // 22 ms alone, 52 at two (2.4): the second reading halves.
    const judge = taught(22);
    expect(settle(judge, 52, 2)).toBe('mid');
    expect(settle(judge, 52, 2)).toBe('slow');
  });

  it('leaves the window alone between the two bounds', () => {
    const judge = taught(40);
    expect(settle(judge, 70, 2)).toBe('mid');
    expect(settle(judge, 70, 2)).toBe('mid');
    expect(judge.snapshot().lastRatio).toBeCloseTo(1.75, 6);
  });

  it('counts both bounds as their own side: exactly 1.5 grows, exactly 2 halves', () => {
    const grow = taught(40);
    expect(settle(grow, 60, 2)).toBe('fast');
    expect(settle(grow, 60, 2)).toBe('fast');
    const halve = taught(40);
    expect(settle(halve, 80, 2)).toBe('mid');
    expect(settle(halve, 80, 2)).toBe('slow');
  });
});

describe('one reading is a coincidence', () => {
  it('returns a verdict only once two raw readings in a row agree', () => {
    const judge = taught(40);
    // slow, then fast, then slow: no two in a row agree, nothing moves.
    expect(settle(judge, 100, 2)).toBe('mid');
    expect(settle(judge, 40, 2)).toBe('mid');
    expect(settle(judge, 100, 2)).toBe('mid');
    // The second slow in a row is the verdict.
    expect(settle(judge, 100, 2)).toBe('slow');
    // And a third keeps it: sustained evidence keeps moving the window.
    expect(settle(judge, 100, 2)).toBe('slow');
  });

  it('reads a settle in company as mid until a comparable solo link taught the etalon', () => {
    // Nothing to compare against: neither grow nor halve on it, and the
    // streak starts over once there is.
    const judge = createRelativeSettleJudge();
    expect(settle(judge, 400, 2)).toBe('mid');
    expect(settle(judge, 400, 2)).toBe('mid');
    expect(judge.snapshot()).toMatchObject({
      etalonMsPerWeight: null,
      lastRatio: null,
      streak: null,
    });
  });

  it('carries a streak across solo and company readings of the same verdict', () => {
    // The second solo reading is fast; the first company reading that is
    // also fast extends that streak rather than starting a new count.
    const judge = createRelativeSettleJudge();
    settle(judge, 40, 1);
    settle(judge, 40, 1);
    expect(settle(judge, 42, 2)).toBe('fast');
  });
});

describe('the cooldown after a halving', () => {
  it('answers mid to growth for seven samples after a confirmed slow, then probes again', () => {
    // A serializing driver halved to one would otherwise be grown back to
    // two by the very next pair of solo settles, and spend half its links
    // at the concurrency it just proved harmful.
    const judge = taught(40);
    settle(judge, 100, 2);
    expect(settle(judge, 100, 2)).toBe('slow');
    expect(judge.snapshot().cooldown).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(settle(judge, 40, 1, 1, 1)).toBe('mid');
    }
    expect(judge.snapshot().cooldown).toBe(0);
    expect(settle(judge, 40, 1, 1, 1)).toBe('fast');
  });

  it('still halves during the cooldown: only growth waits', () => {
    const judge = taught(40);
    settle(judge, 100, 2);
    expect(settle(judge, 100, 2)).toBe('slow');
    expect(settle(judge, 100, 2)).toBe('slow');
  });
});

describe('the config it was given', () => {
  it('reads its bounds and its persistence off the config', () => {
    const config: RelativeSettleJudgeConfig = {
      growBelowRatio: 1.1,
      shrinkAboveRatio: 1.2,
      agreeingSamples: 1,
      etalonSamples: 1,
      comparableWeightFactor: 1,
      hitBelowRatio: 0.5,
      cooldownSamples: 0,
      soloWindowCap: 3,
    };
    const judge = createRelativeSettleJudge(config);
    // One sample is a verdict here, and the etalon is the last solo sample.
    expect(settle(judge, 40, 1, 1, 2)).toBe('fast');
    settle(judge, 50, 1);
    expect(judge.snapshot().etalonMsPerWeight).toBe(50);
    expect(settle(judge, 55, 2)).toBe('fast');
    expect(settle(judge, 58, 2)).toBe('mid');
    expect(settle(judge, 60, 2)).toBe('slow');
    // No cooldown: growth is allowed at once.
    expect(settle(judge, 50, 2)).toBe('fast');
    // A factor of one: only the same weight is comparable.
    expect(settle(judge, 60, 2, 1.5)).toBe('mid');
    // A hit is anything under half.
    expect(settle(judge, 24, 1, 1, 3)).toBe('mid');
    expect(judge.snapshot().hits).toBe(1);
  });
});
