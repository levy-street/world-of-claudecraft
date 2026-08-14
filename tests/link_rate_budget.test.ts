import { describe, expect, it } from 'vitest';
import {
  awaitSubmissionBudget,
  createLinkRateBudget,
  createPrewarmPacing,
  type LinkRateBudgetClock,
  parseSubmissionPacingKnobs,
} from '../src/render/link_rate_budget';

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
    });
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
