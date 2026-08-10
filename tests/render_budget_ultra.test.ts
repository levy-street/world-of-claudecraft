import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, renderBudgetShaderPrewarmLevels } from '../src/render/render_budget';

describe('ultra render budget', () => {
  it('pins draw thresholds looser than high with literal caps', () => {
    const high = new RenderBudgetGovernor({
      tier: 'high',
      budget: GFX_BUDGETS.high,
      enabled: true,
    }).state().caps;
    const ultra = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: true,
    }).state().caps;

    expect(high.targetCalls).toBe(620);
    expect(high.urgentCalls).toBe(860);
    expect(high.targetTriangles).toBe(4_500_000);
    expect(high.urgentTriangles).toBe(6_500_000);
    expect(high.targetGrassTufts).toBe(6_000);
    expect(high.urgentGrassTufts).toBe(8_500);
    expect(ultra.targetCalls).toBe(820);
    expect(ultra.urgentCalls).toBe(1_100);
    expect(ultra.targetTriangles).toBe(6_500_000);
    expect(ultra.urgentTriangles).toBe(9_000_000);
    expect(ultra.targetGrassTufts).toBe(8_000);
    expect(ultra.urgentGrassTufts).toBe(11_000);
  });

  it('enumerates the exact visible quality states an urgent ultra downgrade can reach', () => {
    const state = new RenderBudgetGovernor({
      tier: 'ultra',
      budget: GFX_BUDGETS.ultra,
      enabled: true,
    }).state();

    expect(renderBudgetShaderPrewarmLevels(state)).toEqual([
      { grass: 0.86, foliage: 0.86, vfx: 0.92, lighting: 0.88, resolution: 1 },
      { grass: 0.78, foliage: 0.78, vfx: 0.86, lighting: 0.78, resolution: 1 },
    ]);
  });
});
