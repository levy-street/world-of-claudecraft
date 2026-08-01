import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, type RenderBudgetSample } from '../src/render/render_budget';
import { assertAllocationStable } from './util/alloc_probe';

const SAMPLE: RenderBudgetSample = {
  dt: 1 / 60,
  frameMs: 12,
  totalMs: 9,
  submitMs: 2,
  calls: 240,
  triangles: 600_000,
  grassVisibleTufts: 2_000,
  grassVisibleChunks: 6,
  activeViews: 12,
  createdViews: 0,
  minRenderScale: 0.7,
  maxRenderScale: 1,
};

describe('render budget allocation contract', () => {
  it('fills caller-owned state and nested records across frames', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    const out = governor.state();

    expect(() =>
      assertAllocationStable(() => governor.update(SAMPLE, out), 64, 'render budget state'),
    ).not.toThrow();
  });
<<<<<<< HEAD
=======

  it('returns the caller-owned state from every update exit path', () => {
    const fastRecoveryBudget = {
      ...GFX_BUDGETS.low,
      recoverStableSeconds: 0,
      cooldownSeconds: 0,
    };
    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: fastRecoveryBudget,
      enabled: true,
    });
    const out = governor.state();
    const update = (sample: RenderBudgetSample): void => {
      expect(governor.update(sample, out)).toBe(out);
    };

    update({ ...SAMPLE, dt: 0 });
    update(SAMPLE);
    update({
      ...SAMPLE,
      frameMs: 1,
      totalMs: 1,
      submitMs: 1,
      calls: 1_000_000,
      triangles: 1_000_000_000,
      grassVisibleTufts: 1_000_000,
    });
    expect(out.mode).toBe('degrading');
    update({
      ...SAMPLE,
      dt: 1,
      frameMs: 1,
      totalMs: 1,
      submitMs: 1,
      calls: 0,
      triangles: 0,
      grassVisibleTufts: 0,
    });
    expect(out.mode).toBe('recovering');

    const disabled = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: false,
    });
    const disabledOut = disabled.state();
    expect(disabled.update(SAMPLE, disabledOut)).toBe(disabledOut);
    expect(disabledOut.mode).toBe('disabled');

    const stalled = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    const stalledOut = stalled.state();
    const stallSample = { ...SAMPLE, submitMs: 130 };
    for (let i = 0; i < 32; i++) {
      expect(stalled.update(stallSample, stalledOut)).toBe(stalledOut);
    }
    expect(stalledOut.reason).toBe('submit-stall');
    expect(stalledOut.stallHoldSeconds).toBeGreaterThan(0);
  });
>>>>>>> b5f0d1f09de234121ffab1fdcf021f66e199a9b8
});
