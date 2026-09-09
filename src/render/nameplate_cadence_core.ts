// When a nameplate pass re-resolves plate CONTENT, lifted out of renderer.ts so
// the decision has a home of its own and a plain Vitest.
//
// Static-preset tiered cadence: the nameplate refresh interval follows the
// player's chosen graphics tier (the data-fx-level the preset applier stamps),
// NEVER the FPS governor (the two-controller rule). The LOW tier runs 1/15s,
// richer tiers 1/24s (ui_tier_knobs.nameplateIntervalSec, which the renderer
// resolves and hands in here). The axis is the PRESET, not the device: the
// weak-GPU cost ceiling (the PR901 lesson) is restored through the device-aware
// first-run default (resolveDefaultGraphicsPreset in gfx.ts), which lands a
// recognized-weak or software GPU on the LOW preset (its 1/15s ceiling) while a
// mid/unknown device defaults to medium (1/24s). An explicit player preset wins.
//
// The interval is in SECONDS and the accumulator is fed the frame's dt, so this
// takes no clock of its own and stays deterministic under test.

export interface NameplateCadenceState {
  /** Seconds accumulated since the last full pass. */
  timer: number;
}

export function createNameplateCadenceState(): NameplateCadenceState {
  return { timer: 0 };
}

/**
 * Advance the accumulator by `dtSec` and report whether this frame is a FULL
 * nameplate pass (content re-resolve). A non-positive interval means every
 * frame is full; the accumulator resets on the frame it fires, so the cadence
 * is "at least intervalSec apart", never a drifting multiple of the frame time.
 */
export function nameplateFullPassDue(
  state: NameplateCadenceState,
  dtSec: number,
  intervalSec: number,
): boolean {
  state.timer += dtSec;
  if (state.timer < intervalSec) return false;
  state.timer = 0;
  return true;
}
