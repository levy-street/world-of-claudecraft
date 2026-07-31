// Shared ground-plane forward/right basis for a yaw-only (no-roll) camera, so
// every consumer (arrow-key nudges, WASD fly, drag-pan) agrees on which way
// is "right". Pure and DOM-free: a Vitest imports it directly.
//
// EditorCamera convention: the camera sits behind its target along
// -(sin yaw, cos yaw), so forward (the way the camera looks) is
// (sin yaw, cos yaw). For a Y-up, right-handed lookAt basis, right is
// cross(forward, up) = (-cos yaw, 0, sin yaw).

export interface CameraAxes {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

export function cameraAxes(yaw: number): CameraAxes {
  return {
    fx: Math.sin(yaw),
    fz: Math.cos(yaw),
    rx: -Math.cos(yaw),
    rz: Math.sin(yaw),
  };
}
