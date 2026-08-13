/**
 * Budget-governed sun-shadow cadence. The shadow pass re-renders the visible
 * scene a second time every frame, and in steady state nothing modulates it
 * (shadowMap.autoUpdate is only ever paused inside the bounded prewarm
 * renders and the perf census probe). A static freeze cannot apply here (the
 * frustum tracks the player and the day/night light drifts continuously),
 * but cadence can: under sustained render-budget pressure the map drops to
 * every-other-frame updates, halving the second scene draw; full rate
 * returns once pressure clears. Cosmetic only: a one-frame-stale shadow
 * conveys nothing a player acts on (the graphics-settings fairness rule),
 * and reading the LIVE budget governor is correct here because this is a
 * perf-governor output like the grass/vfx levels, not a HUD tier knob.
 *
 * Hysteresis is dwell-time based on both edges: half rate needs sustained
 * pressure at or above the enter threshold, full rate needs sustained calm
 * at or below the exit threshold, and the dead band in between holds the
 * current plan while resetting both dwell clocks, so a pressure reading that
 * hovers around either boundary cannot flap the cadence.
 */

/** Pressure at or above this accumulates toward half rate (the governor's own
 *  over-budget line: pressure is measured cost over the tier budget). */
export const SHADOW_CADENCE_ENTER_PRESSURE = 1;
/** Pressure at or below this accumulates toward full rate. */
export const SHADOW_CADENCE_EXIT_PRESSURE = 0.85;
/** Sustained over-pressure needed before shedding to half rate. */
export const SHADOW_CADENCE_ENTER_SECONDS = 1.5;
/** Sustained calm needed before restoring full rate: recovery is deliberately
 *  slower than shedding, mirroring the budget governor's own asymmetry. */
export const SHADOW_CADENCE_EXIT_SECONDS = 4;

export interface ShadowCadenceState {
  /** The plan: false = every frame (autoUpdate), true = every other frame. */
  halfRate: boolean;
  /** Under half rate, whether THIS frame renders the shadow pass. Always
   *  true at full rate. */
  renderThisFrame: boolean;
  /** Dwell clock at or above the enter threshold. */
  overSeconds: number;
  /** Dwell clock at or below the exit threshold. */
  calmSeconds: number;
  /** Half-rate frame parity; 0 renders, 1 skips. */
  phase: 0 | 1;
}

export function createShadowCadenceState(): ShadowCadenceState {
  return { halfRate: false, renderThisFrame: true, overSeconds: 0, calmSeconds: 0, phase: 0 };
}

/** Back to full rate with cleared dwell clocks (renderer reset paths). */
export function resetShadowCadence(state: ShadowCadenceState): void {
  state.halfRate = false;
  state.renderThisFrame = true;
  state.overSeconds = 0;
  state.calmSeconds = 0;
  state.phase = 0;
}

/**
 * Advance the cadence one frame. Mutates and returns the caller-owned state
 * (per-frame path: no allocation). `budgetEnabled` mirrors the governor's
 * enabled flag: a disabled governor never sheds shadow cadence.
 */
export function updateShadowCadence(
  state: ShadowCadenceState,
  dt: number,
  pressure: number,
  budgetEnabled: boolean,
): ShadowCadenceState {
  if (!budgetEnabled) {
    resetShadowCadence(state);
    return state;
  }
  // A degenerate frame time (tab restore, stall) holds the plan untouched:
  // it must neither accumulate dwell nor wipe an engaged half-rate plan.
  // (The renderer's budget path already filters these before calling in.)
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (pressure >= SHADOW_CADENCE_ENTER_PRESSURE) {
    state.overSeconds += dt;
    state.calmSeconds = 0;
    if (!state.halfRate && state.overSeconds >= SHADOW_CADENCE_ENTER_SECONDS) {
      state.halfRate = true;
      // Render on the first half-rate frame so the transition never doubles
      // the staleness (the previous frame already drew a fresh map).
      state.phase = 0;
    }
  } else if (pressure <= SHADOW_CADENCE_EXIT_PRESSURE) {
    state.calmSeconds += dt;
    state.overSeconds = 0;
    if (state.halfRate && state.calmSeconds >= SHADOW_CADENCE_EXIT_SECONDS) {
      state.halfRate = false;
    }
  } else {
    // Dead band: hold the plan, restart both dwell clocks.
    state.overSeconds = 0;
    state.calmSeconds = 0;
  }
  if (state.halfRate) {
    state.renderThisFrame = state.phase === 0;
    state.phase = state.phase === 0 ? 1 : 0;
  } else {
    state.renderThisFrame = true;
    state.phase = 0;
  }
  return state;
}
