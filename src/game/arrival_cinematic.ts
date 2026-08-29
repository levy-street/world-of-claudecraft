// The first-visit island arrival cinematic: when the ferry (the greeting's
// accept button or the town bell) sets a character down on the Proving Shore
// for the FIRST time, the chase camera starts high and far, the whole strait
// and the town they just left small below, then falls and tightens onto the
// player over a few seconds until it settles at the ordinary chase framing,
// facing what the landing authored (Warden Tam's gate).
//
// Built entirely from the chase camera's own knobs (camDist/camPitch, with
// the yaw already snapped by game/teleport_camera.ts), so there is no free
// camera to desynchronize and nothing here can show a player anything
// gameplay-relevant the ordinary camera could not. The player stays in
// control: any camera drag or zoom input cancels the remainder instantly.
//
// Pure math plus one tiny driver object; the HUD signals the start (it owns
// the ferryIslandArrival event arm) through a host-wired hook, and main.ts
// steps it each frame before the camera snap. Node-tested directly.

/** Where the fall starts: high and wide enough that the strait and the far
 *  town read, without leaving the terrain streaming radius. */
export const ARRIVAL_CINEMATIC_START_DIST = 55;
export const ARRIVAL_CINEMATIC_START_PITCH = 1.15;
/** How long the fall takes, seconds. */
export const ARRIVAL_CINEMATIC_SECONDS = 4.5;

export interface ArrivalCinematicState {
  /** Seconds elapsed; negative means inactive. */
  t: number;
  /** The chase framing to settle back into. */
  endDist: number;
  endPitch: number;
}

export function createArrivalCinematic(): ArrivalCinematicState {
  return { t: -1, endDist: 12, endPitch: 0.32 };
}

/** Arm the fall, remembering the framing to settle into. */
export function startArrivalCinematic(
  state: ArrivalCinematicState,
  currentDist: number,
  currentPitch: number,
): void {
  state.t = 0;
  state.endDist = currentDist;
  state.endPitch = currentPitch;
}

export function arrivalCinematicActive(state: ArrivalCinematicState): boolean {
  return state.t >= 0 && state.t < ARRIVAL_CINEMATIC_SECONDS;
}

/** Cancel the remainder (the player touched the camera). */
export function cancelArrivalCinematic(state: ArrivalCinematicState): void {
  state.t = -1;
}

/** Smoothstep ease: gentle leave from the sky, gentle settle at the end. */
function ease(u: number): number {
  return u * u * (3 - 2 * u);
}

/** Advance one frame; returns the camera distance and pitch to apply, or
 *  null once inactive (the caller leaves the camera alone). */
export function stepArrivalCinematic(
  state: ArrivalCinematicState,
  dt: number,
): { dist: number; pitch: number } | null {
  if (state.t < 0) return null;
  state.t += dt;
  if (state.t >= ARRIVAL_CINEMATIC_SECONDS) {
    state.t = -1;
    return { dist: state.endDist, pitch: state.endPitch };
  }
  const u = ease(Math.min(1, state.t / ARRIVAL_CINEMATIC_SECONDS));
  return {
    dist: ARRIVAL_CINEMATIC_START_DIST + (state.endDist - ARRIVAL_CINEMATIC_START_DIST) * u,
    pitch: ARRIVAL_CINEMATIC_START_PITCH + (state.endPitch - ARRIVAL_CINEMATIC_START_PITCH) * u,
  };
}
