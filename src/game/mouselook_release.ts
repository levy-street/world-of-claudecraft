// Classic right-mouse mouselook drives the player's heading: while it is active
// the per-tick facing intent is set to the camera yaw (camYaw), so the sim facing
// tracks the camera. Input is sampled at frame rate but facing only commits on a
// sim tick, so the slice of mouse motion between the last tick and the release is
// never written: the instant mouselook turns off the facing intent goes null and
// that final fraction of the turn is dropped. The character then settles back to a
// facing slightly behind the camera, and moving forward makes the follow camera
// backtrack to sit behind it, which reads as a snap.
//
// This is a single, DOM-free decision: on the FALLING edge of mouselook, commit
// the current camera yaw one last time so the sim facing ends exactly where the
// camera ended. It is deliberately scoped to the classic right-mouse mouselook
// edge; the always-on Mouse Camera mode has its own facing path and is not in play.
export function mouselookReleaseFacing(
  prevMouselook: boolean,
  mouselook: boolean,
  camYaw: number,
): number | null {
  return prevMouselook && !mouselook ? camYaw : null;
}
