import { describe, expect, it } from 'vitest';
import { viewCreateBudget } from '../src/render/view_create_budget_core';

describe('viewCreateBudget', () => {
  it('gives healthy desktop frames bounded count and time budgets', () => {
    expect(
      viewCreateBudget({
        dtSeconds: 1 / 60,
        constrained: false,
        budgetPressure: 0,
        entryElapsedMs: 20_000,
      }),
    ).toEqual({ maxViews: 8, maxStartWorkMs: 3 });
  });

  it('backs off under entry, frame, memory, and governor pressure', () => {
    const pressured = viewCreateBudget({
      dtSeconds: 0.04,
      constrained: true,
      budgetPressure: 1,
      entryElapsedMs: 3_000,
    });
    expect(pressured.maxViews).toBe(1);
    expect(pressured.maxStartWorkMs).toBeLessThanOrEqual(1);
  });
});
