/**
 * The render budget's resolution lever on the composer tiers (high, ultra,
 * insane), where the post chain carries full-frame passes (N8AO, bloom, the
 * screen-fx pass, SMAA) and so cannot vary a fixed target's render REGION the
 * way the grade-only chain does (post_plan_core.ts, `supportsDynamicResolution`).
 * There the lever moves the ALLOCATION scale instead: the drawing buffer and
 * every composer target are reallocated at the reduced size, and the canvas is
 * upscaled by the compositor onto its unchanged CSS box.
 *
 * A reallocation is an allocation storm (eighteen to nineteen targets on the
 * composer chains), so it must never follow the governor's fine steps frame by
 * frame. This core maps the governor's continuous `levels.resolution` onto a
 * coarse ladder of RUNGS, `RESOLUTION_RUNG_STEP` apart between the manual
 * ceiling and the tier floor, and moves the allocated scale only when the level
 * crosses a whole rung: the hysteresis is the rung spacing itself, on top of the
 * governor's own asymmetric drop and recover steps and its cooldowns
 * (render_budget.ts). No timer of its own: a rung changes only when the
 * governor's level does.
 *
 * Fairness (docs/design/graphics-settings-fairness.md): the lever sheds pixels
 * of the 3D image only. Text, nameplates and the HUD are painted in CSS space
 * on their own surfaces and stay crisp at every rung, and the FLOOR of the
 * ladder is a pure function of the static preset (`GFX_BUDGETS[tier]`,
 * `minRenderScaleDesktop` / `minRenderScaleMobile`), the same floor the medium
 * region path already honours. This core imports nothing and reads no tier,
 * preset, device profile or governor state. The per-frame entry is
 * `resolutionAllocationScale` (allocation-free arithmetic); `resolutionRungLadder`
 * builds the whole ladder as an array and exists for readouts and the guard
 * tests, never for a frame path.
 */

/** Nominal spacing between two rungs of the allocation ladder. */
export const RESOLUTION_RUNG_STEP = 0.1;

/** Tolerance on a rung crossing, the governor rounds its levels to 2 decimals. */
export const RESOLUTION_RUNG_EPSILON = 0.001;

/**
 * How the session's resolution lever reaches the frame:
 * `region` varies the render region of fixed targets (the grade-only chain),
 * `allocation` reallocates the drawing buffer and the post targets at a rung,
 * `locked` holds the scale where it is (no post chain, or the `?dynres=off`
 * dev kill switch).
 */
export type DynamicResolutionMode = 'region' | 'allocation' | 'locked';

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Rungs below the ceiling: the count that spaces them nearest to the step. A
 *  band narrower than half a step has none: a reallocation storm that buys a
 *  few percent of the fragments cannot pay for itself, so the lever holds. */
export function resolutionRungCount(ceiling: number, floor: number): number {
  const top = finite(ceiling, 1);
  const bottom = finite(floor, top);
  if (bottom >= top - RESOLUTION_RUNG_STEP / 2) return 0;
  return Math.max(1, Math.round((top - bottom) / RESOLUTION_RUNG_STEP));
}

/** The rung `index` steps below the ceiling; the last index is the floor exactly. */
export function resolutionRungAt(index: number, ceiling: number, floor: number): number {
  const top = finite(ceiling, 1);
  const count = resolutionRungCount(top, floor);
  if (count === 0 || index <= 0) return top;
  if (index >= count) return finite(floor, top);
  return round3(top - (index * (top - finite(floor, top))) / count);
}

/** The whole ladder, ceiling first and floor last (a readout, allocates). */
export function resolutionRungLadder(ceiling: number, floor: number): number[] {
  const count = resolutionRungCount(ceiling, floor);
  const rungs: number[] = [];
  for (let i = 0; i <= count; i++) rungs.push(resolutionRungAt(i, ceiling, floor));
  return rungs;
}

/** Index of the highest rung at or below `level` (the floor index below every rung). */
export function resolutionRungIndex(level: number, ceiling: number, floor: number): number {
  const top = finite(ceiling, 1);
  const count = resolutionRungCount(top, floor);
  if (count === 0) return 0;
  const value = finite(level, top);
  const stride = (top - finite(floor, top)) / count;
  const index = Math.ceil((top - value - RESOLUTION_RUNG_EPSILON) / stride);
  return Math.min(count, Math.max(0, index));
}

/** The highest rung at or below `level` (the floor when the level sits below every rung). */
export function resolutionRungFor(level: number, ceiling: number, floor: number): number {
  return resolutionRungAt(resolutionRungIndex(level, ceiling, floor), ceiling, floor);
}

/**
 * The allocated scale after one governor step, given the scale allocated
 * before it. The level must reach the first rung strictly below the held
 * scale to shed, and the first rung strictly above it to climb; between the
 * two the previous allocation stands, so a scale that does not sit on the
 * ladder (the mobile opening scale, a manual ceiling changed under the
 * governor) is kept until the level leaves its band. One rung per step in
 * either direction, whatever the level did: the ladder is walked rung by
 * rung (a tier whose drop step is not a divisor of the stride would
 * otherwise skip its middle rung), so the allocation may lag the level by
 * up to one rung for one governor step.
 */
export function resolutionRungTransition(
  previous: number,
  level: number,
  ceiling: number,
  floor: number,
): number {
  const top = finite(ceiling, 1);
  const bottom = Math.min(top, finite(floor, top));
  const held = Math.min(top, Math.max(bottom, finite(previous, top)));
  const value = finite(level, held);
  const count = resolutionRungCount(top, bottom);
  if (count === 0) return top;
  const heldIndex = resolutionRungIndex(held, top, bottom);
  const onRung =
    Math.abs(resolutionRungAt(heldIndex, top, bottom) - held) <= RESOLUTION_RUNG_EPSILON;
  const belowIndex = onRung ? heldIndex + 1 : heldIndex;
  if (
    belowIndex <= count &&
    value <= resolutionRungAt(belowIndex, top, bottom) + RESOLUTION_RUNG_EPSILON
  ) {
    return resolutionRungAt(belowIndex, top, bottom);
  }
  const aboveIndex = Math.max(0, heldIndex - 1);
  if (value >= resolutionRungAt(aboveIndex, top, bottom) - RESOLUTION_RUNG_EPSILON) {
    return resolutionRungAt(aboveIndex, top, bottom);
  }
  return held;
}

export interface ResolutionAllocationInput {
  readonly mode: DynamicResolutionMode;
  /** The `?dynres=<0..1>` dev pin (render_dev_flags.ts), or null. */
  readonly pin: number | null;
  /** The scale in force before this governor step. */
  readonly previous: number;
  /** The governor's `levels.resolution` after this step. */
  readonly level: number;
  /** The manual ceiling (the Render Quality slider, capped by the tier). */
  readonly ceiling: number;
  /** The tier floor, a pure function of the static preset. */
  readonly floor: number;
}

/**
 * The effective render scale one governor step leaves in force. On the region
 * path it is the level itself (clamped to the governor's range); on the
 * allocation path it walks the rung ladder; under a pin it is the pin,
 * allowed below the tier floor (a bench lowering its own scale) but never
 * above the ceiling (the Render Quality slider and the tier's own cap, which a
 * memory-constrained profile relies on). A locked lever never moves (its
 * governor range is collapsed), so the clamp is exact there.
 */
export function resolutionAllocationScale(input: ResolutionAllocationInput): number {
  const top = finite(input.ceiling, 1);
  if (input.pin != null && Number.isFinite(input.pin)) {
    return Math.min(top, Math.max(0.5, input.pin));
  }
  const bottom = Math.min(top, finite(input.floor, top));
  if (input.mode === 'allocation') {
    return resolutionRungTransition(input.previous, input.level, top, bottom);
  }
  return Math.min(top, Math.max(bottom, finite(input.level, top)));
}
