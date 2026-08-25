// Whether the camera currently owns the player's heading this frame: Action
// Camera capture, classic right-mouse mouselook, or Mouse Camera mode while a
// movement key is driving the character (forward/back/strafe). All three hand the
// camera direct control of facing, and all have a falling edge where that control
// lets go. Action Camera has priority when both optional camera modes are enabled.
// This is the single source of truth for "is a camera driving facing right now",
// used both to pick the frame's facing override and to detect the edge so
// mouselookReleaseFacing (mouselook_release.ts) can commit the final camera yaw
// exactly once, instead of dropping the last camera slice before the next sim tick.
export function isCameraDrivenFacingActive(
  mouseCameraMode: boolean,
  cameraMoveActive: boolean,
  mouselookActive: boolean,
  dead: boolean,
  actionCameraLocked = false,
): boolean {
  if (dead) return false;
  if (actionCameraLocked) return true;
  return mouseCameraMode ? cameraMoveActive : mouselookActive;
}
