import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS,
  type AdaptiveLinkBudgetClock,
  type AdaptiveLinkBudgetConfig,
  createAdaptiveLinkBudget,
} from '../src/render/adaptive_link_budget_core';

const CONFIG: AdaptiveLinkBudgetConfig = {
  initialWindowLinks: 16,
  minWindowLinks: 8,
  maxWindowLinks: 32,
  initialLinkEstimate: 8,
  increaseLinks: 4,
  fastSettlementMs: 1_200,
  slowSettlementMs: 2_000,
  noProgressMs: 3_000,
  maxSleepMs: 16,
};

function virtualClock(onSleep?: (nowMs: number) => void): AdaptiveLinkBudgetClock & {
  advance: (ms: number) => void;
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
      onSleep?.(nowMs);
    },
    advance: (ms) => {
      nowMs += ms;
    },
    at: () => nowMs,
    sleeps,
  };
}

describe('adaptive link budget core', () => {
  it('admits one estimated unit initially and accounts for its real link charge', () => {
    const budget = createAdaptiveLinkBudget(CONFIG, virtualClock());

    expect(budget.canSubmit()).toBe(true);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);

    expect(budget.canSubmit()).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      state: 'ramp',
      windowLinks: 16,
      inFlightLinks: 12,
      peakInFlightLinks: 12,
      estimatedLinksPerUnit: 12,
      submittedUnits: 1,
    });
  });

  it('keeps a bounded transition trace and records the peak global in-flight links', () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);
    budget.markSubmitted('scene:1');
    budget.markSyncEnd('scene:1', 8);
    clock.advance(CONFIG.slowSettlementMs);
    budget.markSettled('scene:0');
    budget.markReveal();

    expect(budget.snapshot()).toMatchObject({
      peakInFlightLinks: 24,
      transitions: [
        expect.objectContaining({ from: 'ramp', to: 'backoff', reason: 'slow-settlement' }),
        expect.objectContaining({ from: 'backoff', to: 'revealed', reason: 'reveal' }),
      ],
    });
    expect(budget.snapshot().transitions.length).toBeLessThanOrEqual(
      ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS,
    );
  });

  it('bounds transition history when the adaptive state oscillates', () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);
    let id = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      for (const duration of [1_500, 800, 2_500]) {
        const unitId = `oscillating:${id++}`;
        budget.markSubmitted(unitId);
        budget.markSyncEnd(unitId, 8);
        clock.advance(duration);
        budget.markSettled(unitId);
      }
    }

    expect(budget.snapshot().transitions).toHaveLength(ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS);
    expect(ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS).toBe(32);
  });

  it('records the fast, mid, failed, and no-progress transition reasons', async () => {
    const fastClock = virtualClock();
    const fast = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 28 }, fastClock);
    fast.markSubmitted('fast');
    fast.markSyncEnd('fast', 8);
    fastClock.advance(800);
    fast.markSettled('fast');
    expect(fast.snapshot().transitions[0]).toMatchObject({
      from: 'ramp',
      to: 'steady',
      reason: 'fast-settlement',
    });

    const midClock = virtualClock();
    const mid = createAdaptiveLinkBudget(CONFIG, midClock);
    mid.markSubmitted('mid');
    mid.markSyncEnd('mid', 8);
    midClock.advance(1_600);
    mid.markSettled('mid');
    expect(mid.snapshot().transitions[0]).toMatchObject({
      from: 'ramp',
      to: 'steady',
      reason: 'mid-settlement',
    });

    const failed = createAdaptiveLinkBudget(CONFIG, virtualClock());
    failed.markSubmitted('failed');
    failed.markSyncEnd('failed', 8);
    failed.markFailed('failed');
    expect(failed.snapshot().transitions[0]).toMatchObject({
      from: 'ramp',
      to: 'backoff',
      reason: 'failed',
    });

    const stalledClock = virtualClock();
    const stalled = createAdaptiveLinkBudget(CONFIG, stalledClock);
    stalled.markSubmitted('stalled');
    stalled.markSyncEnd('stalled', 12);
    await stalled.awaitSlot(() => false);
    expect(stalled.snapshot().transitions[0]).toMatchObject({
      from: 'ramp',
      to: 'stalled',
      reason: 'no-progress',
    });
  });

  it('grows additively on fast settlements up to the hard cap', () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);

    for (let index = 0; index < 8; index++) {
      const id = `scene:${index}`;
      budget.markSubmitted(id);
      budget.markSyncEnd(id, 8);
      clock.advance(800);
      budget.markSettled(id);
    }

    expect(budget.snapshot()).toMatchObject({
      state: 'steady',
      windowLinks: 32,
      maxWindowObserved: 32,
      settledUnits: 8,
      backoffCount: 0,
    });
  });

  it('gives a zero-delta settle no window credit (the cheap-unit discount)', () => {
    // Measured (iGPU, far login, 2026-08-17): a boot sweep that also collects
    // views hidden behind their live compile gates submits units whose
    // programs are ALREADY linked. They settle instantly having created no
    // program, the window read that as headroom, ramped to the cap, and the
    // lane kept submitting until the hard deadline while the whole manifest
    // behind it timed out (tests/reveal_gate_wiring.test.ts).
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);

    for (let index = 0; index < 200; index++) {
      const id = `hidden:${index}`;
      budget.markSubmitted(id);
      budget.markSyncEnd(id, 0);
      budget.markSettled(id);
    }

    expect(budget.snapshot()).toMatchObject({
      windowLinks: CONFIG.initialWindowLinks,
      maxWindowObserved: CONFIG.initialWindowLinks,
      settledUnits: 200,
      backoffCount: 0,
    });
    // A unit that DID link programs still grows the window on the same clock:
    // the discount is about the delta, never about the speed.
    budget.markSubmitted('real:0');
    budget.markSyncEnd('real:0', 8);
    budget.markSettled('real:0');
    expect(budget.snapshot()).toMatchObject({
      windowLinks: CONFIG.initialWindowLinks + CONFIG.increaseLinks,
      maxWindowObserved: CONFIG.initialWindowLinks + CONFIG.increaseLinks,
    });
  });

  it('still backs off on a SLOW settle that linked nothing', () => {
    // The discount withholds credit; it never withholds congestion evidence.
    // A cheap unit that took two seconds to come back says the driver is
    // busy, whatever this unit itself linked.
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    budget.markSubmitted('hidden:0');
    budget.markSyncEnd('hidden:0', 0);
    clock.advance(2_500);
    budget.markSettled('hidden:0');

    expect(budget.snapshot()).toMatchObject({
      state: 'backoff',
      windowLinks: 12,
      backoffCount: 1,
    });
  });

  it('backs off multiplicatively after a slow settlement without cancelling other work', () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 8);
    budget.markSubmitted('scene:1');
    budget.markSyncEnd('scene:1', 8);

    clock.advance(2_500);
    budget.markSettled('scene:0');

    expect(budget.snapshot()).toMatchObject({
      state: 'backoff',
      windowLinks: 12,
      inFlightUnits: 1,
      inFlightLinks: 8,
      backoffCount: 1,
    });
  });

  it('holds the window steady for a settlement between the two thresholds', () => {
    // The mid band is a THIRD arm, not the tail of either threshold. Without a
    // case here, an implementation that halved on anything past
    // fastSettlementMs passed the whole suite while pinning a mid-tier GPU at
    // the window floor for the entire boot, and one that grew on anything
    // under slowSettlementMs passed it too.
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 8);

    // 1_600 ms: past fast (1_200), short of slow (2_000).
    clock.advance(1_600);
    budget.markSettled('scene:0');

    expect(budget.snapshot()).toMatchObject({
      state: 'steady',
      windowLinks: 24,
      backoffCount: 0,
      settledUnits: 1,
      lastSettlementMs: 1_600,
    });

    // The thresholds themselves are inclusive on both ends, so the band is
    // exactly the open interval between them.
    const edge = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    edge.markSubmitted('scene:1');
    edge.markSyncEnd('scene:1', 8);
    clock.advance(1_200);
    edge.markSettled('scene:1');
    expect(edge.snapshot()).toMatchObject({ state: 'ramp', windowLinks: 28 });

    const slowEdge = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    slowEdge.markSubmitted('scene:2');
    slowEdge.markSyncEnd('scene:2', 8);
    clock.advance(2_000);
    slowEdge.markSettled('scene:2');
    expect(slowEdge.snapshot()).toMatchObject({ state: 'backoff', windowLinks: 12 });
  });

  it('never halves the window below the configured floor', () => {
    // The clamp is the only thing keeping repeated backoffs from driving the
    // window to zero links, which would stall entry as surely as the backlog
    // the pacing exists to avoid. Halving alone reaches 6 then 3 then 1 here.
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 24 }, clock);
    const windows: number[] = [];

    for (let index = 0; index < 3; index++) {
      const id = `scene:${index}`;
      budget.markSubmitted(id);
      budget.markSyncEnd(id, 8);
      clock.advance(2_500);
      budget.markSettled(id);
      windows.push(budget.snapshot().windowLinks);
    }

    expect(windows).toEqual([12, 8, 8]);
    expect(budget.snapshot()).toMatchObject({ state: 'backoff', backoffCount: 3 });
  });

  it('stops admission after bounded no-progress waits', async () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);

    expect(await budget.awaitSlot(() => false)).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      state: 'stalled',
      noProgressCount: 1,
      inFlightUnits: 1,
    });
    expect(clock.at()).toBeGreaterThanOrEqual(CONFIG.noProgressMs);
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(CONFIG.maxSleepMs);
  });

  it('stops on an old tail even when the numeric window still has room', async () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget({ ...CONFIG, initialWindowLinks: 32 }, clock);
    budget.markSubmitted('ghost-fade-variants:1');
    budget.markSyncEnd('ghost-fade-variants:1', 2);
    clock.advance(CONFIG.noProgressMs);

    expect(budget.canSubmit()).toBe(false);
    expect(await budget.awaitSlot(() => false)).toBe(false);
    expect(budget.snapshot()).toMatchObject({ state: 'stalled', noProgressCount: 1 });

    clock.advance(1_000);
    budget.markSettled('ghost-fade-variants:1');
    expect(budget.canSubmit()).toBe(false);
    expect(budget.snapshot()).toMatchObject({ state: 'stalled', settledUnits: 1 });
  });

  it('rechecks the caller deadline during a capacity wait', async () => {
    const clock = virtualClock();
    const budget = createAdaptiveLinkBudget(CONFIG, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);

    expect(await budget.awaitSlot(() => clock.at() >= 25)).toBe(false);
    expect(clock.at()).toBeGreaterThanOrEqual(25);
    expect(clock.at()).toBeLessThanOrEqual(32);
    expect(budget.snapshot().state).not.toBe('stalled');
  });

  it('unblocks an admission when an in-flight unit settles during the wait', async () => {
    let budget: ReturnType<typeof createAdaptiveLinkBudget>;
    const clock = virtualClock((nowMs) => {
      if (nowMs >= 800) budget.markSettled('scene:0');
    });
    budget = createAdaptiveLinkBudget(CONFIG, clock);
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);

    expect(await budget.awaitSlot(() => false)).toBe(true);
    expect(budget.snapshot()).toMatchObject({
      state: 'ramp',
      windowLinks: 20,
      settledUnits: 1,
      inFlightUnits: 0,
    });
  });

  it('fails soft, releases failed work, and closes entry admission at reveal', async () => {
    const budget = createAdaptiveLinkBudget(CONFIG, virtualClock());
    budget.markSubmitted('scene:0');
    budget.markSyncEnd('scene:0', 12);
    budget.markFailed('scene:0');

    expect(budget.canSubmit()).toBe(true);
    expect(budget.snapshot()).toMatchObject({
      failedUnits: 1,
      inFlightUnits: 0,
      state: 'backoff',
      windowLinks: 8,
    });

    budget.markReveal();
    expect(budget.canSubmit()).toBe(false);
    expect(await budget.awaitSlot(() => false)).toBe(false);
    expect(budget.snapshot().state).toBe('revealed');
  });
});
