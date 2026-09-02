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
 * and a scene that recovers climbs back one step at a time.
 *
 * ORDERING against the cadence, stated exactly, because it is easy to get
 * backwards: BOTH dwells here are longer than the cadence's, so the cadence
 * both ENGAGES first (1.5 s against 3 s) and RELEASES first (4 s against 6 s).
 * The extent is the deeper shed going down and the LAST thing given back
 * coming up: a recovering scene returns to full-rate shadow updates while the
 * box is still narrow, and only then widens the box one step at a time. That
 * is the intended order (hand back the cheap, invisible thing first), not the
 * other way round. The relation between the two exported dwell constants is
 * pinned in tests/shadow_extent_core.test.ts.
 *
 * Cosmetic only, per docs/design/graphics-settings-fairness.md: a caster whose
 * shadow is shed is still drawn, still nameplated and still clickable at
 * exactly the same range. Nothing a player reacts to moves. The floor is a
 * WORLD-SPACE clamp rather than a scale, so it cannot depend on which base the
 * tier happens to use (the lean arm's base is 85 yd, where 0.6 would have
 * floored at 51 yd, inside the proxy band): shadowExtentHalf never returns
 * less than SHADOW_EXTENT_FLOOR_YARDS, the 62 yd proxy-shadow band in
 * renderer.ts (ENTITY_PROXY_SHADOW_RANGE_SQ, where a character stops casting
 * at all) plus the caster margin the other shadow culls use plus a rig radius.
 *
 * Pure core contract: plain numbers only, no import, no three, no DOM, no
 * clocks. Registered in RENDER_PURE_CORES (tests/architecture.test.ts);
 * tested by tests/shadow_extent_core.test.ts, and listed as a sanctioned shed
 * in docs/design/graphics-settings-fairness.md.
 */

/** Half-extent multipliers, full quality first and the floor last. */
export const SHADOW_EXTENT_SCALES: readonly number[] = [1, 0.75, 0.6];

/** The outdoor base half-extent (renderer.ts's `shadowBaseExtent`), restated
 *  here so the fairness claim in the header is a checkable number rather than
 *  prose. Cross-pinned against renderer.ts by tests/shadow_render_wiring.test.ts. */
export const SHADOW_EXTENT_BASE_YARDS = 105;
/** ENTITY_PROXY_SHADOW_RANGE_SQ in renderer.ts is this squared: past it a
 *  character stops casting a shadow at all. Same cross-pin. */
export const SHADOW_EXTENT_PROXY_RANGE_YARDS = 62;
/** SHADOW_CASTER_MARGIN in foliage_shadow_core.ts, restated because this core
 *  imports nothing; cross-pinned in tests/shadow_extent_core.test.ts. */
export const SHADOW_EXTENT_CASTER_MARGIN_YARDS = 4;
/** A humanoid rig's own half-width, so a character standing exactly at the
 *  proxy range is inside the box whole, not clipped at its edge. */
export const SHADOW_EXTENT_RIG_RADIUS_YARDS = 1;
/** The world-space floor the shed may never go below, whatever the base. */
export const SHADOW_EXTENT_FLOOR_YARDS =
  SHADOW_EXTENT_PROXY_RANGE_YARDS +
  SHADOW_EXTENT_CASTER_MARGIN_YARDS +
  SHADOW_EXTENT_RIG_RADIUS_YARDS;

/**
 * The half-extent to write onto the shadow camera: the base scaled by the
 * ladder's current step, floored in WORLD SPACE. A base already at or under
 * the floor is passed through unshed rather than widened, so the clamp can
 * only ever keep the box bigger than the scale alone would, never bigger than
 * the tier asked for.
 */
export function shadowExtentHalf(baseExtent: number, scale: number): number {
  if (!(baseExtent > 0)) return 0;
  return Math.max(baseExtent * scale, Math.min(baseExtent, SHADOW_EXTENT_FLOOR_YARDS));
}

/** Pressure at or above this accumulates toward the next step down (the
 *  governor's own over-budget line, the same one the cadence reads). */
export const SHADOW_EXTENT_ENTER_PRESSURE = 1;
/** Pressure at or below this accumulates toward the next step back up. */
export const SHADOW_EXTENT_EXIT_PRESSURE = 0.85;
/** Sustained over-pressure needed for ONE step down. Twice the cadence's
 *  dwell, so the cadence always sheds first. */
export const SHADOW_EXTENT_ENTER_SECONDS = 3;
/** Sustained calm needed for ONE step back up. Longer than the step down, and
 *  longer than the cadence's own recovery, so the cadence is restored first
 *  and the extent is the last shed given back. */
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
