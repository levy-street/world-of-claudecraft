import { describe, expect, it } from 'vitest';
import {
  runtimeViewCreateBudget,
  VIEW_CREATE_BACKOFF_SECONDS,
  VIEW_CREATE_BUDGET_HIGH,
  VIEW_CREATE_BUDGET_LOW,
  type ViewCreateBudgetInput,
} from '../src/render/view_create_budget_core';

const input = (over: Partial<ViewCreateBudgetInput> = {}): ViewCreateBudgetInput => ({
  lowGfx: false,
  constrainedMemory: false,
  entryElapsedMs: 5000,
  dt: 1 / 60,
  frameMsEma: 16.7,
  dropFrameMs: 22,
  ...over,
});

describe('runtimeViewCreateBudget', () => {
  it('returns the tier base on a healthy frame', () => {
    const state = { backoffSeconds: 0 };
    expect(runtimeViewCreateBudget(input(), state)).toBe(VIEW_CREATE_BUDGET_HIGH);
    expect(runtimeViewCreateBudget(input({ lowGfx: true }), state)).toBe(VIEW_CREATE_BUDGET_LOW);
    expect(state.backoffSeconds).toBe(0);
  });

  it('halves the base on a slow frame or under governor pressure, never below one', () => {
    const state = { backoffSeconds: 0 };
    expect(runtimeViewCreateBudget(input({ dt: 0.034 }), state)).toBe(4);
    expect(runtimeViewCreateBudget(input({ frameMsEma: 22 }), state)).toBe(4);
    expect(runtimeViewCreateBudget(input({ frameMsEma: 21.9 }), state)).toBe(8);
    expect(runtimeViewCreateBudget(input({ lowGfx: true, dt: 0.034 }), state)).toBe(1);
  });

  it('arms the backoff on a hitch frame and holds one view per frame until it drains', () => {
    const state = { backoffSeconds: 0 };
    expect(runtimeViewCreateBudget(input({ dt: 0.05 }), state)).toBe(1);
    expect(state.backoffSeconds).toBeCloseTo(VIEW_CREATE_BACKOFF_SECONDS - 0.05, 6);
    // Healthy 20 ms frames drain the window one view per frame, then the base returns.
    let held = 0;
    while (state.backoffSeconds > 0) {
      expect(runtimeViewCreateBudget(input({ dt: 0.02 }), state)).toBe(1);
      held++;
    }
    expect(held).toBe(35);
    expect(runtimeViewCreateBudget(input(), state)).toBe(VIEW_CREATE_BUDGET_HIGH);
  });

  it('follows the constrained-memory entry ramp and ignores a non-finite dt', () => {
    const state = { backoffSeconds: 0 };
    expect(
      runtimeViewCreateBudget(input({ constrainedMemory: true, entryElapsedMs: 0 }), state),
    ).toBe(0);
    expect(
      runtimeViewCreateBudget(input({ constrainedMemory: true, entryElapsedMs: 100 }), state),
    ).toBe(1);
    expect(runtimeViewCreateBudget(input({ dt: Number.NaN }), state)).toBe(VIEW_CREATE_BUDGET_HIGH);
    expect(runtimeViewCreateBudget(input({ dt: 0 }), state)).toBe(VIEW_CREATE_BUDGET_HIGH);
  });
});
