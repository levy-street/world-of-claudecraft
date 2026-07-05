// Whether the camera currently owns the player's heading this frame: classic
// right-mouse mouselook, or Mouse Camera mode while a movement key is driving the
// character (forward/back/strafe). Both hand the camera direct control of facing,
// and both have a falling edge where that control lets go. This is the single
// source of truth for "is a camera driving facing right now", used both to pick
// the frame's facing override and to detect the edge so mouselookReleaseFacing
// (mouselook_release.ts) can commit the final camera yaw exactly once, instead of
// dropping the last slice of camera motion since the previous sim tick.
export function isCameraDrivenFacingActive(
  mouseCameraMode: boolean,
  cameraMoveActive: boolean,
  mouselookActive: boolean,
  dead: boolean,
): boolean {
  if (dead) return false;
  return mouseCameraMode ? cameraMoveActive : mouselookActive;
}
