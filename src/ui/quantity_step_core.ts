// Pure stepping rules for a bounded integer quantity control. The material
// source picker's per-row steppers and the bank family's quantity prompt share
// ONE clamp and ONE disabled rule through this core, so the two cannot drift
// (review finding on #3981: the clamp had been written three times with
// different floors and different disable behavior). DOM-free; the thin DOM
// consumer is quantity_stepper.ts. Registered in UI_PURE_CORES.

export interface QuantityStepBounds {
  readonly min: number;
  readonly max: number;
}

/** A value the control can act on: a safe integer inside the bounds. A blank
 *  or out-of-range typed value is not steppable; the caller refuses rather
 *  than guessing what the player meant. */
export function isSteppableQuantity(value: number, bounds: QuantityStepBounds): boolean {
  return Number.isSafeInteger(value) && value >= bounds.min && value <= bounds.max;
}

/** The value after one press of `delta`, clamped to the bounds so the last
 *  press lands ON the bound (a row of 45 stepped by 20 goes 40, 45), or null
 *  when the current value is not steppable. */
export function steppedQuantity(
  value: number,
  delta: number,
  bounds: QuantityStepBounds,
): number | null {
  if (!isSteppableQuantity(value, bounds)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, value + delta));
}

/** Which direction is disabled at `value`: both when it is not steppable,
 *  otherwise the side already sitting on its bound. A [1, 1] range (a
 *  one-unit row's prompt) disables both. */
export function quantityStepDisabled(
  value: number,
  bounds: QuantityStepBounds,
): { readonly down: boolean; readonly up: boolean } {
  if (!isSteppableQuantity(value, bounds)) return { down: true, up: true };
  return { down: value <= bounds.min, up: value >= bounds.max };
}
