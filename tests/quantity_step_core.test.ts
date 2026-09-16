// The one stepping rule the source picker's row steppers and the bank
// quantity prompt share (src/ui/quantity_step_core.ts): a press clamps to the
// bounds so the last press lands ON the bound, an unsteppable typed value
// refuses (null) rather than guessing, and the disabled rule mirrors the
// clamp, with a one-unit range disabling both directions.
import { describe, expect, it } from 'vitest';
import {
  isSteppableQuantity,
  quantityStepDisabled,
  steppedQuantity,
} from '../src/ui/quantity_step_core';

const row = { min: 0, max: 45 };
const prompt = { min: 1, max: 45 };

describe('steppedQuantity', () => {
  it('moves by the delta and clamps at either bound', () => {
    expect(steppedQuantity(0, 20, row)).toBe(20);
    expect(steppedQuantity(20, 1, row)).toBe(21);
    expect(steppedQuantity(41, 20, row)).toBe(45);
    expect(steppedQuantity(45, 20, row)).toBe(45);
    expect(steppedQuantity(5, -20, row)).toBe(0);
    expect(steppedQuantity(1, -20, prompt)).toBe(1);
    expect(steppedQuantity(21, -20, prompt)).toBe(1);
  });

  it('refuses a value it cannot act on', () => {
    expect(steppedQuantity(Number.NaN, 1, row)).toBeNull();
    expect(steppedQuantity(2.5, 1, row)).toBeNull();
    expect(steppedQuantity(46, -1, row)).toBeNull();
    expect(steppedQuantity(0, 1, prompt)).toBeNull();
    expect(isSteppableQuantity(0, prompt)).toBe(false);
    expect(isSteppableQuantity(1, prompt)).toBe(true);
  });
});

describe('quantityStepDisabled', () => {
  it('disables the side on its bound and both for an unsteppable value', () => {
    expect(quantityStepDisabled(0, row)).toEqual({ down: true, up: false });
    expect(quantityStepDisabled(7, row)).toEqual({ down: false, up: false });
    expect(quantityStepDisabled(45, row)).toEqual({ down: false, up: true });
    expect(quantityStepDisabled(Number.NaN, row)).toEqual({ down: true, up: true });
  });

  it('disables both directions on a one-unit range', () => {
    expect(quantityStepDisabled(1, { min: 1, max: 1 })).toEqual({ down: true, up: true });
  });
});
