// The chase camera's pitch range (camPitch is POSITIVE looking DOWN; see the
// swim bands in input.ts). Moved out of input.ts with its one clamp so the
// range is unit-testable on its own.
//
// The widened look-up is an authored-map (Studio) change. The built-in world
// keeps the classic range exactly: [-0.4, 1.35] on the ground and in water,
// the glider's own wider look-up while flying (glider_pitch_input.ts).

import { isBuiltinWorldActive } from '../sim/data';
import { clampGliderCameraPitch } from './glider_pitch_input';

/** How far the chase camera may swing UNDER the player to look upward on an
 *  authored map (radians). The classic -0.4, about 23 degrees, against 77
 *  degrees of look-down, showed the ground at your feet but barely the wall
 *  above you (SPACEY, 2026-09-21: "make the camera so the player can look up
 *  more ... so the player can see whats above them"). 60 degrees, the WoW-ish
 *  range. The renderer pulls the boom IN as this fills, so the steeper angle
 *  does not just bury the camera in the floor. */
export const CAM_PITCH_UP = -1.05;
/** The look-DOWN end, unchanged. */
export const CAM_PITCH_DOWN = 1.35;

/** The camera pitch clamp. On an authored map: [CAM_PITCH_UP, CAM_PITCH_DOWN]
 *  on the ground and in water. Flying, and everywhere on the built-in world:
 *  the classic glider-aware clamp, so leaving flight eases back into ground
 *  range. `authoredMap` defaults to the live world. */
export function clampCamPitch(
  pitch: number,
  flying: boolean,
  authoredMap: boolean = !isBuiltinWorldActive(),
): number {
  if (flying || !authoredMap) return clampGliderCameraPitch(pitch, flying);
  return Math.min(CAM_PITCH_DOWN, Math.max(CAM_PITCH_UP, pitch));
}
