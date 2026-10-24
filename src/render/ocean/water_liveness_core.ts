// When the water's per-frame extras are worth paying for. The simulation step,
// the sky probe face and the opaque-scene copy all cost GPU work every frame,
// and none of it shows while no water is drawn (inside an interior, behind a
// mountain, down a dungeon). Every water draw marks the frame; the work keeps
// running for a hold past the last mark, so a camera sweeping across a
// coastline never toggles it frame by frame.
//
// Two holds, because the two kinds of work cost differently on the way back:
// the simulation and probe resume within a frame (a step, six probe faces), so
// they idle quickly; the capture binding decides which shading ARM the first
// returning frame takes, and dropping it early is what popped the high tier to
// its blended look for one frame, so it holds longer. Pure and Three-free.

/** Seconds the simulation and the sky probe keep running past the last draw. */
export const WATER_WORK_HOLD_SECONDS = 2;
/** Seconds the opaque-scene capture stays bound past the last draw. */
export const WATER_CAPTURE_HOLD_SECONDS = 15;

export interface WaterLivenessState {
  /** Clock time of the most recent frame with a water draw. */
  lastDrawn: number;
  /** A draw landed since the last update. */
  drawnSinceUpdate: boolean;
  /** The work was idle on the previous update. */
  idle: boolean;
}

export function createWaterLiveness(): WaterLivenessState {
  // Starts live: the first frames under the curtain draw the finished look.
  return { lastDrawn: Number.NaN, drawnSinceUpdate: false, idle: false };
}

export interface WaterLivenessFrame {
  /** Run the simulation and the probe this frame. */
  work: boolean;
  /** Keep the opaque-scene capture bound. */
  capture: boolean;
  /** The work is starting again after an idle spell: refresh what went stale. */
  resumed: boolean;
}

/** Advance one frame. `visible` is the water group's own visibility. */
export function advanceWaterLiveness(
  state: WaterLivenessState,
  time: number,
  visible: boolean,
): WaterLivenessFrame {
  if (state.drawnSinceUpdate || Number.isNaN(state.lastDrawn)) state.lastDrawn = time;
  state.drawnSinceUpdate = false;
  const since = time - state.lastDrawn;
  const work = visible && since < WATER_WORK_HOLD_SECONDS;
  const capture = visible && since < WATER_CAPTURE_HOLD_SECONDS;
  const resumed = work && state.idle;
  state.idle = !work;
  return { work, capture, resumed };
}
