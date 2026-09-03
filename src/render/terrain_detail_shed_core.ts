/**
 * Budget-governed terrain-detail shed. The three terrain-fragment knobs the
 * static tier ladder alone cannot touch once a session already sits at its
 * tier's own request (terrainRelief, surfaceDetailTaps, surfaceDetailClampK;
 * worn_stone.ts's parallax taps and clamp answer to the same live level) are
 * the one ultra-only slice of the frame the render budget could not shed: on
 * the reference Windows RTX 3060 (ANGLE D3D11, 2005x1440, ultra, vsync off)
 * the TERRAIN category is 4.7 to 6.6 ms of a 9.3 to 11.3 ms GPU frame while
 * every other category sits under 0.5 ms, and ultra sessions in the fleet
 * already rest at the governor's grass/foliage/vfx/lighting floor.
 *
 * This module maps ONE governed 0..1 level (1 = the tier's own static request,
 * 0 = high's own profile, the floor every tier at or above high already
 * ships) onto the three live uniforms (`terrainDetailKnobs`), and steps that
 * level with the dwell-hysteresis shape of shadow_cadence_core.ts: sustained
 * over-pressure before EACH shed step, sustained calm before EACH restore
 * step, a dead band that holds the plan, so a transient spike or a reading
 * hovering at a threshold cannot flap the level. The stepped plan is the
 * `target`; the applied `level` slews toward it at a fixed rate, so a step
 * is a short crossfade of the relief instead of a one-frame pop at a chunk
 * edge (the consumers scale their existing distance fades by the level, and
 * worn-stone weighs its marginal refinement tap by the fractional tap count).
 * The ladder is not even across the three knobs: at ultra the first step
 * (0.66) mostly thins the worn-stone walk (taps 3 -> 1.98) and dims the micro
 * sun-shadow to a third, while the terrain parallax only starts fading at the
 * second step (0.32, relief 1.64); read a capture with that in mind.
 *
 * The shared uniform refs are one page-wide singleton (gfx.ts
 * `sharedUniforms`), so a secondary GL context that compiles a worn-stone
 * parallax material (the editor viewport composes the real renderer; the
 * armory/portrait previews draw object-space weapons, which compile no walk)
 * follows the world governor's live level; a context that never applies a
 * budget state keeps the ladder maxima the refs default to.
 *
 * Cosmetic only, by the graphics-settings fairness rule
 * (docs/design/graphics-settings-fairness.md): the knobs this sheds are
 * parallax depth cues and micro sun-shadow shading on the ground, never
 * anything a player reacts to, and the application writes uniform VALUES
 * only: never a mesh's visibility or shadow casting, never a program relink.
 */

export interface TerrainDetailRequest {
  relief: number;
  taps: number;
  clampK: number;
}

/** High's own static profile (`gfx.ts`: terrainRelief 1, surfaceDetailTaps 0,
 *  surfaceDetailClampK 0). A tier whose own request already sits at or below
 *  it (high, medium, low) never moves, see `terrainDetailKnobs`. */
export const TERRAIN_DETAIL_FLOOR: Readonly<TerrainDetailRequest> = {
  relief: 1,
  taps: 0,
  clampK: 0,
};

/**
 * Maps the live 0..1 level onto the three terrain-detail knobs, per knob:
 * `request - max(0, request - floor) * (1 - level)`.
 *
 * At level 1 every knob equals the tier's own request (the static preset is
 * unchanged). At level 0 every knob ABOVE the floor is pulled down to it; a
 * knob already at or below the floor is untouched at every level because
 * `max(0, request - floor)` is zero there. Shedding therefore only ever
 * pulls a knob DOWN toward the floor, never past a tier's own request in
 * either direction, and a high session (whose request equals the floor on
 * every knob) is a no-op at every level.
 */
export function terrainDetailKnobs(
  request: Readonly<TerrainDetailRequest>,
  level: number,
): TerrainDetailRequest {
  return {
    relief: shedTerrainDetailKnob(request.relief, TERRAIN_DETAIL_FLOOR.relief, level),
    taps: shedTerrainDetailKnob(request.taps, TERRAIN_DETAIL_FLOOR.taps, level),
    clampK: shedTerrainDetailKnob(request.clampK, TERRAIN_DETAIL_FLOOR.clampK, level),
  };
}

/** One knob of `terrainDetailKnobs`: `value - max(0, value - floor) * (1 - level)`
 *  with the level clamped to 0..1. Allocation-free, for the per-frame path. */
export function shedTerrainDetailKnob(value: number, floor: number, level: number): number {
  const l = Math.min(1, Math.max(0, level));
  return value - Math.max(0, value - floor) * (1 - l);
}

/** True when the session's own static request has ANY knob above the floor,
 *  i.e. when the level can change something. The governor admits the shed on
 *  this (an Advanced session resolves to tier high yet may dial relief 3 and
 *  4 taps) beside the tier band's own governable flag; the high/medium/low
 *  TABLE profiles sit at or below the floor and are never admitted by it. */
export function terrainDetailShedApplies(request: Readonly<TerrainDetailGfxRequest>): boolean {
  return (
    request.terrainRelief > TERRAIN_DETAIL_FLOOR.relief ||
    request.surfaceDetailTaps > TERRAIN_DETAIL_FLOOR.taps ||
    request.surfaceDetailClampK > TERRAIN_DETAIL_FLOOR.clampK
  );
}

/** The three shared `{ value }` uniform refs terrain.ts and worn_stone.ts
 *  attach by reference (gfx.ts `sharedUniforms`); structural so this policy
 *  core imports nothing. */
export interface TerrainDetailUniformRefs {
  /** Live relief level (1..3): the terrain parallax walk weighs by
   *  `clamp(uReliefSteps - 1, 0, 1)`, the micro sun-shadow by
   *  `clamp(uReliefSteps - 2, 0, 1)`. */
  uReliefSteps: { value: number };
  /** Live worn-stone parallax tap count; tap n runs while the value is at
   *  least n, and the whole walk weighs by `min(value, 1)`. */
  uWornDetailTaps: { value: number };
  /** Live share (0..1) of the tier's OWN parallax offset clamp: 1 is the
   *  tier's request, so an un-updated reference is exact on every tier. */
  uWornDetailClampK: { value: number };
}

/** The session's own static request, read off `GFX` (so an Advanced Terrain
 *  Detail / Surface Detail dial override is honoured, never a per-tier
 *  table). */
export interface TerrainDetailGfxRequest {
  terrainRelief: number;
  surfaceDetailTaps: number;
  surfaceDetailClampK: number;
}

/** One-call renderer wiring, run on every budget-state application (once per
 *  presented frame): maps `level` through the knob mapping from the session's
 *  static request and writes the three live uniform refs in place (never
 *  replaces them, so every material sharing the reference sees the new value
 *  on its next draw with no program relink). Allocates nothing. */
export function applyTerrainDetailShed(
  gfx: Readonly<TerrainDetailGfxRequest>,
  level: number,
  uniforms: TerrainDetailUniformRefs,
): void {
  uniforms.uReliefSteps.value = shedTerrainDetailKnob(
    gfx.terrainRelief,
    TERRAIN_DETAIL_FLOOR.relief,
    level,
  );
  uniforms.uWornDetailTaps.value = shedTerrainDetailKnob(
    gfx.surfaceDetailTaps,
    TERRAIN_DETAIL_FLOOR.taps,
    level,
  );
  uniforms.uWornDetailClampK.value =
    gfx.surfaceDetailClampK > 0
      ? shedTerrainDetailKnob(gfx.surfaceDetailClampK, TERRAIN_DETAIL_FLOOR.clampK, level) /
        gfx.surfaceDetailClampK
      : 1;
}

/** Pressure at or above this accumulates toward the next shed step (the
 *  governor's own over-budget line, the shadow cadence's enter line). */
export const TERRAIN_DETAIL_ENTER_PRESSURE = 1;
/** Pressure at or below this accumulates toward the next restore step. */
export const TERRAIN_DETAIL_EXIT_PRESSURE = 0.85;
/** Sustained over-pressure needed before EACH shed step. Longer than the
 *  shadow cadence's 1.5 s: a relief change in the near field is more
 *  noticeable than one frame of shadow staleness, so it must be earned. */
export const TERRAIN_DETAIL_ENTER_SECONDS = 2.5;
/** Sustained calm needed before EACH restore step, the governor's own
 *  shed-fast/restore-slow asymmetry. */
export const TERRAIN_DETAIL_EXIT_SECONDS = 6;
/** One shed/restore step of the plan: 1.0 -> 0.66 -> 0.32 -> 0 (floor
 *  clamped), a coarse ladder so a session dwells at a stable level rather
 *  than drifting continuously. */
export const TERRAIN_DETAIL_STEP = 0.34;
/** Slew rate of the applied level toward the plan, in level units per
 *  second: one step crossfades over about 0.7 s, the whole ladder over 2 s. */
export const TERRAIN_DETAIL_SLEW_PER_SECOND = 0.5;

export interface TerrainDetailShedState {
  /** The applied level the uniforms take: 1 = the tier's own static
   *  request, 0 = the floor. Slews toward `target`. */
  level: number;
  /** The stepped plan the dwell hysteresis moves. */
  target: number;
  /** Dwell clock at or above the enter threshold. */
  overSeconds: number;
  /** Dwell clock at or below the exit threshold. */
  calmSeconds: number;
}

export function createTerrainDetailShedState(): TerrainDetailShedState {
  return { level: 1, target: 1, overSeconds: 0, calmSeconds: 0 };
}

/** Back to the tier's own request with cleared dwell clocks (renderer reset
 *  paths, and a disabled governor). */
export function resetTerrainDetailShed(state: TerrainDetailShedState): void {
  state.level = 1;
  state.target = 1;
  state.overSeconds = 0;
  state.calmSeconds = 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Advance the shed one frame. Mutates and returns the caller-owned state (no
 * per-frame allocation). A non-null `pinnedLevel` (the `?terraindetail=`
 * dev flag, render_dev_flags.ts) skips the hysteresis and the slew entirely
 * and holds the level exactly there, with
 * or without an enabled governor, so an A/B run compares known, stable
 * levels; a disabled governor without a pin holds the tier's own request.
 */
export function updateTerrainDetailShed(
  state: TerrainDetailShedState,
  dt: number,
  pressure: number,
  enabled: boolean,
  pinnedLevel: number | null = null,
): TerrainDetailShedState {
  if (pinnedLevel != null) {
    state.level = Math.min(1, Math.max(0, pinnedLevel));
    state.target = state.level;
    state.overSeconds = 0;
    state.calmSeconds = 0;
    return state;
  }
  if (!enabled) {
    resetTerrainDetailShed(state);
    return state;
  }
  // A degenerate frame time (tab restore, stall) holds the plan untouched:
  // it must neither accumulate dwell nor move the applied level.
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (pressure >= TERRAIN_DETAIL_ENTER_PRESSURE) {
    state.overSeconds += dt;
    state.calmSeconds = 0;
    if (state.target > 0 && state.overSeconds >= TERRAIN_DETAIL_ENTER_SECONDS) {
      state.target = Math.max(0, round2(state.target - TERRAIN_DETAIL_STEP));
      state.overSeconds = 0;
    }
  } else if (pressure <= TERRAIN_DETAIL_EXIT_PRESSURE) {
    state.calmSeconds += dt;
    state.overSeconds = 0;
    if (state.target < 1 && state.calmSeconds >= TERRAIN_DETAIL_EXIT_SECONDS) {
      state.target = Math.min(1, round2(state.target + TERRAIN_DETAIL_STEP));
      state.calmSeconds = 0;
    }
  } else {
    // Dead band: hold the plan, restart both dwell clocks.
    state.overSeconds = 0;
    state.calmSeconds = 0;
  }
  const slew = TERRAIN_DETAIL_SLEW_PER_SECOND * dt;
  if (state.level > state.target) state.level = Math.max(state.target, state.level - slew);
  else if (state.level < state.target) state.level = Math.min(state.target, state.level + slew);
  return state;
}
