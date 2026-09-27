// Movement audio for the resolved mount look. The caller owns audibility,
// death and swimming; this module preserves the vehicle ground/air policy.
export const FOOT_RUN_SPEED = 4.5;

import type { SpatialAudioSink, Surface } from './audio_sink';
import { strideHit } from './stride_audio_core';

const MOUNT_STRIDE_RUN = 5.8;
type MountAudio = Pick<
  SpatialAudioSink,
  'mountIdle' | 'mountEngine' | 'mountEngineIdles' | 'mountRun' | 'mountApex'
>;

/** The airborne bookkeeping this pass owns: whether the mount was off the
 *  ground last frame, whether this jump's apex is still to come, and the
 *  height it was at last frame. Kept here rather than in the caller because
 *  nothing else reads them, and tracking the height here rather than taking a
 *  delta argument keeps the renderer out of it entirely. */
export interface MountAirborneState {
  mountAirborne?: boolean;
  mountApexArmed?: boolean;
  mountPrevY?: number;
}
export function updateRiddenMountAudio(
  sink: MountAudio,
  state: { stepAccum: number; mountPivot: boolean } & MountAirborneState,
  look: string,
  id: number,
  x: number,
  y: number,
  z: number,
  moving: boolean,
  airborne: boolean,
  backwards: boolean,
  speed: number,
  dt: number,
  self: boolean,
  surfaceAt: (x: number, z: number, y: number) => Surface,
): void {
  // The top of a jump, once per jump. Armed on the takeoff edge and spent the
  // first frame the climb stops, so a mount with a voice calls out at the peak
  // rather than on the way up. A mount with no takes is silent and pays only
  // this bookkeeping.
  //
  // The rise is measured from the height this pass saw last frame rather than
  // taken as an argument: the caller already hands us y every frame, and the
  // apex is the only thing in the game that wants the sign of its delta.
  // `undefined` on the takeoff frame reads as no rise yet, which is right: the
  // apex cannot be the frame the body leaves the ground.
  const rose = state.mountPrevY === undefined ? 0 : y - state.mountPrevY;
  if (airborne && !state.mountAirborne) state.mountApexArmed = true;
  if (airborne && state.mountApexArmed && state.mountAirborne && rose <= 0) {
    state.mountApexArmed = false;
    sink.mountApex(x, y, z, look);
  }
  if (!airborne) state.mountApexArmed = false;
  state.mountAirborne = airborne;
  state.mountPrevY = y;
  if (airborne) {
    sink.mountIdle(x, y, z, look, false, id);
    // Hold an ordinary engine phase across hops. Vehicles with an airborne
    // take or continuous idle loop still need their position and load updated.
    if (look === 'goblin_rocket_sled' || sink.mountEngineIdles(look)) {
      sink.mountEngine(x, y, z, look, moving, id, backwards, true, state.mountPivot);
    }
  } else if (moving) {
    sink.mountIdle(x, y, z, look, false, id);
    if (sink.mountEngine(x, y, z, look, true, id, backwards, false)) return;
    if (speed >= FOOT_RUN_SPEED) {
      if (strideHit(state, speed, dt, MOUNT_STRIDE_RUN)) {
        sink.mountRun(x, y, z, look, surfaceAt(x, z, y), self);
      }
    } else {
      state.stepAccum = MOUNT_STRIDE_RUN * 0.6;
    }
  } else {
    sink.mountEngine(x, y, z, look, false, id, false, false, state.mountPivot);
    sink.mountIdle(x, y, z, look, true, id);
  }
}
