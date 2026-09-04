import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import {
  CONTEXT_RESTORE_STALL_GRACE_SECONDS,
  RenderBudgetGovernor,
  type RenderBudgetSample,
} from '../src/render/render_budget';

// Per-sample cap the grace decrement respects: a single very long frame (the restore
// frame itself can report a multi-second dt) must not burn the whole grace by itself.
// Kept as a literal here (mirroring the private GRACE_TICK_CAP_SECONDS in
// render_budget.ts) since the constant is intentionally not exported.
const GRACE_TICK_CAP_SECONDS = 0.25;

function sample(overrides: Partial<RenderBudgetSample> = {}): RenderBudgetSample {
  return {
    dt: 1,
    frameMs: 16,
    totalMs: 16,
    submitMs: 5,
    calls: 150,
    triangles: 250000,
    grassVisibleTufts: 900,
    grassVisibleChunks: 8,
    activeViews: 25,
    createdViews: 0,
    minRenderScale: 0.65,
    maxRenderScale: 1,
    ...overrides,
  };
}

function lowGovernor(): RenderBudgetGovernor {
  const governor = new RenderBudgetGovernor({
    tier: 'low',
    budget: GFX_BUDGETS.low,
    enabled: true,
  });
  governor.reset(1, 0.65, 1);
  return governor;
}

describe('render budget governor context restore grace', () => {
  it('forgives a provoked submit stall and clears its hold', () => {
    const governor = lowGovernor();
    governor.update(sample({ dt: 0.6 }));

    const stalled = governor.update(
      sample({ frameMs: 400, totalMs: 400, submitMs: 400, calls: 120, triangles: 180_000 }),
    );
    expect(stalled.mode).toBe('degrading');
    expect(stalled.reason).toBe('submit-stall');
    expect(stalled.stallHoldSeconds).toBeGreaterThan(0);
    expect(stalled.recentSubmitStalls).toBeGreaterThan(0);

    governor.forgiveExternalStall();
    const forgiven = governor.update(sample());

    expect(forgiven.stallHoldSeconds).toBe(0);
    expect(forgiven.recentSubmitStalls).toBe(0);
    expect(forgiven.lastSubmitStallMs).toBe(0);
    expect(forgiven.stallPressure).toBe(0);
    expect(forgiven.reason).not.toBe('submit-stall');
  });

  it('judges nothing from a stall sample fed during the restore grace', () => {
    const governor = lowGovernor();
    governor.update(sample({ dt: 0.6 }));

    governor.forgiveExternalStall();
    const before = governor.state();

    const after = governor.update(sample({ dt: 1, submitMs: 2000, frameMs: 2000, totalMs: 2000 }));

    // The window announces itself instead of masquerading as stable.
    expect(after.mode).toBe('stable');
    expect(after.reason).toBe('context-restore');
    expect(after.levels).toEqual(before.levels);
    expect(after.submitMsEma).toBe(before.submitMsEma);
    expect(after.frameMsEma).toBe(before.frameMsEma);
    expect(after.stallPressure).toBe(before.stallPressure);
    expect(after.lastSubmitStallMs).toBe(0);
  });

  it('drains the grace by at most the per-sample cap even on a huge dt', () => {
    const governor = lowGovernor();

    governor.forgiveExternalStall(3);
    governor.update(sample({ dt: 10 }));

    expect(governor.externalStallGraceRemaining()).toBe(3 - GRACE_TICK_CAP_SECONDS);
    expect(governor.externalStallGraceRemaining()).toBe(2.75);
  });

  it('degrades again on a stall once the grace has fully drained', () => {
    const governor = lowGovernor();

    governor.forgiveExternalStall(CONTEXT_RESTORE_STALL_GRACE_SECONDS);
    const drainCalls = Math.ceil(CONTEXT_RESTORE_STALL_GRACE_SECONDS / GRACE_TICK_CAP_SECONDS);
    let state = governor.state();
    for (let i = 0; i < drainCalls; i++) {
      state = governor.update(sample({ dt: GRACE_TICK_CAP_SECONDS }));
    }
    expect(governor.externalStallGraceRemaining()).toBe(0);

    state = governor.update(
      sample({ frameMs: 400, totalMs: 400, submitMs: 400, calls: 120, triangles: 180_000 }),
    );

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('submit-stall');
    expect(state.stallHoldSeconds).toBeGreaterThan(0);
  });

  it('leaves a disabled governor disabled after forgiveExternalStall', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: false,
    });
    governor.reset(1, 0.65, 1);

    governor.forgiveExternalStall();
    const state = governor.update(sample());

    expect(state.mode).toBe('disabled');
    expect(state.reason).toBe('disabled');
  });
});
