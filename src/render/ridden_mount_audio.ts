// Movement audio for the resolved mount look. The caller owns audibility,
// death and swimming; this module preserves the vehicle ground/air policy.
export const FOOT_RUN_SPEED = 4.5;

import type { SpatialAudioSink, Surface } from './audio_sink';
import { strideHit } from './stride_audio_core';

const MOUNT_STRIDE_RUN = 5.8;
type MountAudio = Pick<
  SpatialAudioSink,
  'mountIdle' | 'mountEngine' | 'mountEngineIdles' | 'mountRun'
>;
export function updateRiddenMountAudio(
  sink: MountAudio,
  state: { stepAccum: number; mountPivot: boolean },
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
