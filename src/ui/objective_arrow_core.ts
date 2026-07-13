// Where the on-screen "your objective is that way" pointer goes, and which way it
// points. Pure: no DOM, no Three. The caller projects the world target to screen
// space (Renderer.worldToScreen) and hands the result here.
//
// Shared by both onboardings (the in-world coachmark and the starter tutorial's
// isle), which is the whole reason it is its own module: the arrow was written
// once and copied once, and the copy is exactly where a subtle behind-the-camera
// bug would have diverged.

export interface ProjectedPoint {
  x: number;
  y: number;
  /** The target is behind the camera, so the projection came out inverted. */
  behind: boolean;
}

export interface ArrowPlacement {
  /** Clamped screen position, in px. */
  x: number;
  y: number;
  /** Rotation, in radians, pointing away from screen centre toward the target. */
  angle: number;
}

/** How close to the screen edge the arrow is allowed to sit. */
export const ARROW_MARGIN = 56;

export function objectiveArrowPlacement(
  p: ProjectedPoint,
  viewportWidth: number,
  viewportHeight: number,
  margin: number = ARROW_MARGIN,
): ArrowPlacement {
  // A point behind the camera projects inverted, so mirror it through the screen
  // centre first: otherwise the arrow points at the exact opposite of the target,
  // which is worse than no arrow at all.
  const sx = p.behind ? viewportWidth - p.x : p.x;
  const sy = p.behind ? viewportHeight - p.y : p.y;

  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  // The angle is taken BEFORE clamping: clamping first would flatten the direction
  // of anything already off-screen against the edge it was clamped to.
  const angle = Math.atan2(sy - cy, sx - cx);

  return {
    x: Math.max(margin, Math.min(viewportWidth - margin, sx)),
    y: Math.max(margin, Math.min(viewportHeight - margin, sy)),
    angle,
  };
}
