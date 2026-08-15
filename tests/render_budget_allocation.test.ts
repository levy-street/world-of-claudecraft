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
});
