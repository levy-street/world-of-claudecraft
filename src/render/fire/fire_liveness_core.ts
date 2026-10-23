// Liveness for the 3D fluid fire simulation, modelled on
// ocean/water_liveness_core.ts. Every visible volumetric fire mesh marks the
// frame in its onBeforeRender hook; the simulation steps only while a fire drew
// in the last FIRE_WORK_HOLD_SECONDS, and holds the opaque-scene capture
// binding for FIRE_CAPTURE_HOLD_SECONDS so brief camera turns do not thrash it.
// Pure and Three-free, registered in RENDER_PURE_CORES.

/** Seconds simulation work continues after the last frame that drew a volumetric fire. */
export const FIRE_WORK_HOLD_SECONDS = 0.25;
/** Seconds the opaque-scene capture stays bound after the last volumetric fire draw. */
export const FIRE_CAPTURE_HOLD_SECONDS = 1.0;

export interface FireLivenessState {
  drawnSinceUpdate: boolean;
  lastDrawnAt: number;
  idle: boolean;
}

export interface FireLivenessStep {
  /** Advance the 3D fluid simulation this frame. */
  work: boolean;
  /** Keep visible volumetric fire hulls registered with OpaqueSceneCapture. */
  capture: boolean;
  /** True on the first active frame after an idle spell. */
  resumed: boolean;
}

export function createFireLiveness(): FireLivenessState {
  return {
    drawnSinceUpdate: false,
    lastDrawnAt: Number.NEGATIVE_INFINITY,
    idle: true,
  };
}

export function advanceFireLiveness(
  state: FireLivenessState,
  time: number,
  enabled: boolean,
): FireLivenessStep {
  if (!enabled) {
    state.drawnSinceUpdate = false;
    state.idle = true;
    return { work: false, capture: false, resumed: false };
  }
  if (state.drawnSinceUpdate) {
    state.lastDrawnAt = time;
    state.drawnSinceUpdate = false;
  } else if (time < state.lastDrawnAt) {
    state.lastDrawnAt = Number.NEGATIVE_INFINITY;
  }
  const since = time - state.lastDrawnAt;
  const work = since <= FIRE_WORK_HOLD_SECONDS;
  const capture = since <= FIRE_CAPTURE_HOLD_SECONDS;
  const resumed = work && state.idle;
  state.idle = !work;
  return { work, capture, resumed };
}
