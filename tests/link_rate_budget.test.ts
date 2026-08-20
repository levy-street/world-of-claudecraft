import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  gpuPrepEventsSnapshot,
  resetGpuPrepEventsForTest,
  setGpuPrepClockForTest,
} from '../src/render/gpu_prep_events';
import {
  ADAPTIVE_PREWARM_LINK_CONFIG,
  awaitSubmissionBudget,
  createLinkRateBudget,
  createPrewarmPacing,
  type LinkRateBudgetClock,
  parseSubmissionPacingKnobs,
} from '../src/render/link_rate_budget';
import {
  PREWARM_SUBMIT_LANE_MAX_MS,
  PREWARM_SUBMIT_NO_USEFUL_LINK_MS,
  PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
} from '../src/render/prewarm_submit_stop_core';

function virtualClock(): LinkRateBudgetClock & {
  sleep: (ms: number) => Promise<void>;
  at: () => number;
  sleeps: number[];
} {
  let nowMs = 0;
  const sleeps: number[] = [];
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    at: () => nowMs,
    sleeps,
  };
}

beforeEach(() => {
  resetGpuPrepEventsForTest();
  setGpuPrepClockForTest(() => 0);
});

afterEach(() => {
  setGpuPrepClockForTest(null);
  resetGpuPrepEventsForTest();
});

describe('link rate budget', () => {
  it('preserves release behavior when unlimited', async () => {
    const clock = virtualClock();
    const budget = createLinkRateBudget(
      { linksPerSecond: Number.POSITIVE_INFINITY, burst: 8 },
      clock,
    );
    budget.charge(500);
    await budget.awaitToken();
    expect(budget.unlimited).toBe(true);
    expect(budget.charged).toBe(500);
    expect(clock.sleeps).toEqual([]);
  });

  it('charges unknown link counts after submission and repays overshoot', async () => {
    const clock = virtualClock();
    const budget = createLinkRateBudget({ linksPerSecond: 10, burst: 2 }, clock);
    budget.charge(5);
    expect(budget.tokens()).toBeCloseTo(-3, 6);
    expect(budget.waitMs()).toBe(400);
    await budget.awaitToken();
    expect(clock.sleeps).toEqual([400]);
  });

  it('checks the deadline on both sides of a budget wait', async () => {
    const clock = virtualClock();
    const budget = createLinkRateBudget({ linksPerSecond: 10, burst: 1 }, clock);
    budget.charge(20);
    expect(await awaitSubmissionBudget(budget, () => clock.at() >= 500)).toBe(false);
    expect(clock.at()).toBeGreaterThanOrEqual(500);
    const noWait = virtualClock();
    expect(
      await awaitSubmissionBudget(
        createLinkRateBudget({ linksPerSecond: 10, burst: 1 }, noWait),
        () => true,
      ),
    ).toBe(false);
    expect(noWait.sleeps).toEqual([]);
  });

  it('rechecks a debt deadline between short interruptible waits', async () => {
    const clock = virtualClock();
    const budget = createLinkRateBudget({ linksPerSecond: 1, burst: 1 }, clock);
    budget.charge(1_000);

    expect(await awaitSubmissionBudget(budget, () => clock.at() >= 25)).toBe(false);
    expect(clock.sleeps.length).toBeGreaterThan(1);
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(16);
    expect(clock.at()).toBeLessThanOrEqual(32);
  });
});

describe('submission pacing knobs', () => {
  it('defaults to adaptive lifecycle pacing', () => {
    const knobs = parseSubmissionPacingKnobs('');
    expect(knobs.source).toBe('default');
    expect(knobs.mode).toBe('adaptive');
    expect(knobs.linksPerSecond).toBe(Number.POSITIVE_INFINITY);
    expect(knobs.burst).toBe(8);
  });

  it('distinguishes an explicit unpaced control from positive candidate rates', () => {
    expect(parseSubmissionPacingKnobs('?perf&linkrate=0')).toMatchObject({
      source: 'query',
      mode: 'unlimited',
      linksPerSecond: Number.POSITIVE_INFINITY,
    });
    expect(parseSubmissionPacingKnobs('?perf&linkrate=12&linkburst=4')).toMatchObject({
      source: 'query',
      mode: 'limited',
      linksPerSecond: 12,
      burst: 4,
    });
  });

  it('keeps adaptive pacing as the default outside the perf gate', () => {
    expect(parseSubmissionPacingKnobs('?perf&linkmode=adaptive')).toMatchObject({
      source: 'query',
      mode: 'adaptive',
      linksPerSecond: Number.POSITIVE_INFINITY,
    });
    expect(parseSubmissionPacingKnobs('?linkmode=adaptive')).toMatchObject({
      source: 'default',
      mode: 'adaptive',
    });
    expect(parseSubmissionPacingKnobs('?perf')).toMatchObject({
      source: 'default',
      mode: 'adaptive',
    });
    expect(parseSubmissionPacingKnobs('?perf&linkmode=adaptive&linkrate=24')).toMatchObject({
      source: 'query',
      mode: 'adaptive',
    });
  });

  it('ignores experimental overrides without ?perf', () => {
    expect(
      parseSubmissionPacingKnobs('?linkrate=12&linkburst=4&compileroots=2&prewarmdeadline=1'),
    ).toEqual({
      source: 'default',
      mode: 'adaptive',
      linksPerSecond: Number.POSITIVE_INFINITY,
      burst: 8,
      compileBatchRoots: null,
      hardMaxMs: null,
    });
  });

  it('normalizes burst and compile roots to effective positive integers', () => {
    expect(
      parseSubmissionPacingKnobs('?perf&linkrate=12&linkburst=4.9&compileroots=0.2'),
    ).toMatchObject({
      burst: 4,
      compileBatchRoots: 1,
    });
    expect(
      parseSubmissionPacingKnobs('?perf&linkrate=12&linkburst=0&compileroots=0'),
    ).toMatchObject({
      burst: 8,
      compileBatchRoots: null,
    });
  });

  it('runs lifecycle feedback by default without claiming ignored query pacing', async () => {
    const clock = virtualClock();
    const pacing = createPrewarmPacing('?linkrate=24&linkburst=2&compileroots=0.5', clock);
    pacing.markSubmitted('scene:0');
    pacing.markSyncEnd('scene:0', 8);
    await clock.sleep(800);
    pacing.markSettled('scene:0');
    expect(pacing.receipt(4.9, 15_000)).toMatchObject({
      source: 'default',
      mode: 'adaptive',
      linksPerSecond: null,
      burst: null,
      compileBatchRoots: 4,
      scope: 'compile-unit-lifecycle',
      adaptive: {
        state: 'ramp',
        settledUnits: 1,
        inFlightUnits: 0,
      },
    });
  });

  it('publishes the effective controlled scope and final renderer values', () => {
    const pacing = createPrewarmPacing('?perf&linkrate=24&compileroots=4', virtualClock());
    pacing.markSubmitted('scene:0');
    pacing.markSyncEnd('scene:0', 17);
    expect(pacing.receipt(4, 15_000)).toEqual({
      available: true,
      source: 'query',
      mode: 'limited',
      linksPerSecond: 24,
      burst: 8,
      compileBatchRoots: 4,
      hardMaxMs: 15_000,
      chargedLinks: 17,
      scope: 'compile-unit-sync-prologue',
      // The hard stop runs on the static-rate arm too: nothing about a
      // ?linkrate lane makes it safe to submit to the wall.
      submitStop: {
        submissions: 1,
        usefulSettles: 0,
        zeroDeltaSettles: 0,
        zeroDeltaStreak: 0,
        syncEnds: 1,
        zeroDeltaSyncEnds: 0,
        elapsedMs: 0,
        sinceUsefulMs: 0,
        stopped: false,
        reason: null,
      },
    });
  });

  it('stops the lane on its own wall clock and stamps the receipt with the reason', async () => {
    const clock = virtualClock();
    // The wall clock ships disarmed; arm it explicitly for this case.
    const pacing = createPrewarmPacing('?perf&linkmode=adaptive', clock, {
      laneMaxMs: PREWARM_SUBMIT_LANE_MAX_MS,
    });
    // 20 s of manifest before the lane's first unit: the lane owns none of it.
    await clock.sleep(20_000);
    pacing.markSubmitted('scene:0');
    pacing.markSyncEnd('scene:0', 12);
    await clock.sleep(PREWARM_SUBMIT_LANE_MAX_MS - 1);
    expect(pacing.shouldStop().stop).toBe(false);
    await clock.sleep(1);
    expect(pacing.shouldStop()).toMatchObject({
      stop: true,
      reason: 'lane-max',
      elapsedMs: PREWARM_SUBMIT_LANE_MAX_MS,
      submissions: 1,
    });
    expect(pacing.receipt(16, 15_000).submitStop).toMatchObject({
      stopped: true,
      reason: 'lane-max',
      elapsedMs: PREWARM_SUBMIT_LANE_MAX_MS,
    });
  });

  it('feeds the stop from its own marks and records ONE submit-stop event', () => {
    const clock = virtualClock();
    const pacing = createPrewarmPacing('?perf&linkmode=adaptive', clock);
    // The instant-settle runaway: every unit links nothing and comes straight
    // back, so the lane stops on the zero-delta streak, not on the clock.
    for (let index = 0; index < 40; index++) {
      if (pacing.shouldStop().stop) break;
      const id = `hidden:${index}`;
      pacing.markSubmitted(id);
      pacing.markSyncEnd(id, 0);
      pacing.markSettled(id);
    }
    const verdict = pacing.shouldStop();
    expect(verdict).toMatchObject({
      stop: true,
      reason: 'no-useful-link',
      submissions: PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
    });
    const receipt = pacing.receipt(16, 15_000);
    expect(receipt.submitStop).toMatchObject({
      submissions: PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
      usefulSettles: 0,
      zeroDeltaSettles: PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
      zeroDeltaSyncEnds: PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
      stopped: true,
      reason: 'no-useful-link',
    });
    // The AIMD blind spot the same run closes: instant settles that linked
    // nothing bought no window at all.
    expect(receipt.adaptive?.windowLinks).toBe(ADAPTIVE_PREWARM_LINK_CONFIG.initialWindowLinks);
    // Exactly one event, however often the loop consults the verdict.
    const events = gpuPrepEventsSnapshot();
    expect(events.counts['submit-stop']).toBe(1);
    expect(events.events[0]).toMatchObject({
      kind: 'submit-stop',
      key: 'no-useful-link',
      ageMs: 0,
      units: PREWARM_SUBMIT_ZERO_DELTA_STREAK_LIMIT,
    });
  });

  it('never scores a settle whose sync prologue never reported a delta', async () => {
    // The accounting hole: markSyncEnd never landed for that id (a duplicate
    // id, a unit whose prologue threw), so the lane has no measurement for it.
    // Scoring it as a zero-delta settle fed BOTH stop rules evidence nobody
    // observed, and the lane latched dead on it.
    const clock = virtualClock();
    const pacing = createPrewarmPacing('?perf&linkmode=adaptive', clock);
    for (let index = 0; index < 40; index++) {
      const id = `unmeasured:${index}`;
      pacing.markSubmitted(id);
      pacing.markSettled(id);
      expect(pacing.shouldStop().stop).toBe(false);
    }
    await clock.sleep(PREWARM_SUBMIT_NO_USEFUL_LINK_MS * 2);
    expect(pacing.shouldStop().stop).toBe(false);
    expect(pacing.receipt(16, 15_000).submitStop).toMatchObject({
      usefulSettles: 0,
      zeroDeltaSettles: 0,
      zeroDeltaStreak: 0,
      stopped: false,
      reason: null,
    });
    expect(gpuPrepEventsSnapshot().counts['submit-stop']).toBe(0);
  });

  it('keeps a lane that links real programs running', () => {
    const clock = virtualClock();
    const pacing = createPrewarmPacing('?perf&linkmode=adaptive', clock);
    for (let index = 0; index < 40; index++) {
      const id = `scene:${index}`;
      pacing.markSubmitted(id);
      pacing.markSyncEnd(id, 6);
      pacing.markSettled(id);
      expect(pacing.shouldStop().stop).toBe(false);
    }
    expect(pacing.receipt(16, 15_000).submitStop).toMatchObject({
      usefulSettles: 40,
      zeroDeltaSettles: 0,
      stopped: false,
      reason: null,
    });
    expect(gpuPrepEventsSnapshot().counts['submit-stop']).toBe(0);
  });

  it('publishes adaptive configuration and lifecycle feedback without a fake rate', () => {
    const clock = virtualClock();
    const pacing = createPrewarmPacing('?perf&linkmode=adaptive', clock);
    pacing.markSubmitted('scene:0');
    pacing.markSyncEnd('scene:0', 8);
    clock.sleep(800);
    pacing.markSettled('scene:0');

    expect(pacing.receipt(4, 15_000)).toMatchObject({
      available: true,
      source: 'query',
      mode: 'adaptive',
      linksPerSecond: null,
      burst: null,
      compileBatchRoots: 4,
      hardMaxMs: 15_000,
      chargedLinks: 8,
      scope: 'compile-unit-lifecycle',
      adaptive: {
        state: 'ramp',
        windowLinks: 20,
        minWindowLinks: 8,
        maxWindowLinks: 32,
        settledUnits: 1,
        inFlightUnits: 0,
      },
    });
  });
});
