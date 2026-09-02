/**
 * Budget-governed sun-shadow EXTENT, the deeper step below the cadence
 * (shadow_cadence_core.ts). The cadence halves how OFTEN the second scene
 * draw happens; this shrinks how MUCH of the world that draw has to cover.
 *
 * The sun renders one orthographic box centred on the player, 2 * S yards
 * across (S = 105 outdoors). Every caster inside it is submitted, so the box
 * width is the direct input to the shadow pass's draw count: the foliage
 * caster pack (foliage_shadow_core.ts) and the zone-feature shadow range both
 * test against that same live volume. Shrinking S therefore sheds shadow-pass
 * draws proportionally to the area, without touching a single colour-pass
 * draw.
 *
 * The ladder walks one step per sustained-pressure dwell and retreats the
 * same way, so a scene that is briefly over budget never jumps to the floor
 * and a scene that recovers climbs back one step at a time. Both dwells are
 * LONGER than the cadence's, deliberately: the cadence is the cheaper, less
 * visible shed, so it engages first and releases last, and the extent step is
 * only ever engaged while the cadence already is.
 *
 * Cosmetic only, per the graphics-settings fairness rule: a caster whose
 * shadow is shed is still drawn, still nameplated and still clickable at
 * exactly the same range. Nothing a player reacts to moves. The floor is
 * chosen so the shed stops well before the near field: 0.6 * 105 = 63 yd,
 * still past the 62 yd proxy-shadow band in renderer.ts
 * (ENTITY_PROXY_SHADOW_RANGE_SQ), which is where a character stops casting at
 * all, and far past the 25 yd articulated band.
 *
 * Pure core contract: plain numbers only, no import, no three, no DOM, no
 * clocks. Registered in RENDER_PURE_CORES (tests/architecture.test.ts);
 * tested by tests/shadow_extent_core.test.ts.
 */

/** Half-extent multipliers, full quality first and the floor last. */
export const SHADOW_EXTENT_SCALES: readonly number[] = [1, 0.75, 0.6];

/** The base half-extent the floor above was chosen against (renderer.ts's
 *  outdoor `S`), and the proxy-shadow range it has to clear. Stated here so
 *  the fairness claim in the header is a checkable number, not prose. */
export const SHADOW_EXTENT_BASE_YARDS = 105;
/** ENTITY_PROXY_SHADOW_RANGE_SQ in renderer.ts is this squared. */
export const SHADOW_EXTENT_PROXY_RANGE_YARDS = 62;

/** Pressure at or above this accumulates toward the next step down (the
 *  governor's own over-budget line, the same one the cadence reads). */
export const SHADOW_EXTENT_ENTER_PRESSURE = 1;
/** Pressure at or below this accumulates toward the next step back up. */
export const SHADOW_EXTENT_EXIT_PRESSURE = 0.85;
/** Sustained over-pressure needed for ONE step down. Twice the cadence's
 *  dwell, so the cadence always sheds first. */
export const SHADOW_EXTENT_ENTER_SECONDS = 3;
/** Sustained calm needed for ONE step back up. Longer than the step down,
 *  and longer than the cadence's own recovery, so the extent is restored
 *  while the cadence is still engaged and never the other way round. */
export const SHADOW_EXTENT_EXIT_SECONDS = 6;

export interface ShadowExtentState {
  /** Index into SHADOW_EXTENT_SCALES; 0 is full quality. */
  step: number;
  /** SHADOW_EXTENT_SCALES[step], the multiplier the renderer applies. */
  scale: number;
  /** Dwell clock at or above the enter threshold. */
  overSeconds: number;
  /** Dwell clock at or below the exit threshold. */
  calmSeconds: number;
}

export function createShadowExtent(): ShadowExtentState {
  return { step: 0, scale: SHADOW_EXTENT_SCALES[0], overSeconds: 0, calmSeconds: 0 };
}

/** Back to the full extent with cleared dwell clocks (renderer reset paths). */
export function resetShadowExtent(state: ShadowExtentState): void {
  state.step = 0;
  state.scale = SHADOW_EXTENT_SCALES[0];
  state.overSeconds = 0;
  state.calmSeconds = 0;
}

/**
 * Advance the ladder one frame. Mutates and returns the caller-owned state
 * (per-frame path: no allocation). `budgetEnabled` mirrors the governor's
 * enabled flag: a disabled governor never sheds extent.
 */
export function updateShadowExtent(
  state: ShadowExtentState,
  dt: number,
  pressure: number,
  budgetEnabled: boolean,
): ShadowExtentState {
  if (!budgetEnabled) {
    resetShadowExtent(state);
    return state;
  }
  // A degenerate frame time (tab restore, stall) holds the ladder untouched:
  // it must neither accumulate dwell nor wipe an engaged step.
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (pressure >= SHADOW_EXTENT_ENTER_PRESSURE) {
    state.overSeconds += dt;
    state.calmSeconds = 0;
    if (state.overSeconds >= SHADOW_EXTENT_ENTER_SECONDS) {
      // One step per dwell: the clock restarts so the next step costs another
      // full dwell, which is what keeps a spike from reaching the floor.
      state.overSeconds = 0;
      if (state.step < SHADOW_EXTENT_SCALES.length - 1) state.step++;
    }
  } else if (pressure <= SHADOW_EXTENT_EXIT_PRESSURE) {
    state.calmSeconds += dt;
    state.overSeconds = 0;
    if (state.calmSeconds >= SHADOW_EXTENT_EXIT_SECONDS) {
      state.calmSeconds = 0;
      if (state.step > 0) state.step--;
    }
  } else {
    // Dead band: hold the step, restart both dwell clocks.
    state.overSeconds = 0;
    state.calmSeconds = 0;
  }
  state.scale = SHADOW_EXTENT_SCALES[state.step];
  return state;
}
