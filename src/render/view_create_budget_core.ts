import { constrainedEntryViewCreateBudget } from './prewarm_policy';

export const VIEW_CREATE_BUDGET_LOW = 2;
export const VIEW_CREATE_BUDGET_HIGH = 8;
export const VIEW_CREATE_SLOW_FRAME_MS = 33;
export const VIEW_CREATE_HITCH_FRAME_MS = 50;
export const VIEW_CREATE_BACKOFF_SECONDS = 0.75;

export interface ViewCreateBudgetInput {
  lowGfx: boolean;
  constrainedMemory: boolean;
  /** Wall-clock ms since the runtime entry (the constrained-memory ramp). */
  entryElapsedMs: number;
  /** The frame's delta in seconds. */
  dt: number;
  /** The governor's smoothed frame ms. */
  frameMsEma: number;
  /** The tier's drop-frame threshold (GFX.budget.dropFrameMs). */
  dropFrameMs: number;
}

/** Caller-owned so the per-frame call allocates nothing. */
export interface ViewCreateBudgetState {
  backoffSeconds: number;
}

/** How many optional entity views this frame may create: the tier's base
 *  count, throttled by the constrained-memory entry ramp, halved on a slow
 *  frame or under governor pressure, and held at one view per frame for a
 *  backoff window after a hitch frame. */
export function runtimeViewCreateBudget(
  input: ViewCreateBudgetInput,
  state: ViewCreateBudgetState,
): number {
  const normalBase = input.lowGfx ? VIEW_CREATE_BUDGET_LOW : VIEW_CREATE_BUDGET_HIGH;
  const base = constrainedEntryViewCreateBudget(
    input.constrainedMemory,
    input.entryElapsedMs,
    normalBase,
  );
  if (base === 0) return 0;
  const dt = input.dt;
  if (!Number.isFinite(dt) || dt <= 0) return base;
  const frameMs = Math.min(250, dt * 1000);
  if (frameMs >= VIEW_CREATE_HITCH_FRAME_MS) state.backoffSeconds = VIEW_CREATE_BACKOFF_SECONDS;
  if (state.backoffSeconds > 0) {
    state.backoffSeconds = Math.max(0, state.backoffSeconds - dt);
    return 1;
  }
  if (frameMs >= VIEW_CREATE_SLOW_FRAME_MS || input.frameMsEma >= input.dropFrameMs) {
    return Math.max(1, Math.ceil(base / 2));
  }
  return base;
}
