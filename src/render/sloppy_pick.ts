// The renderer's forgiving "sloppy pick": when a click misses every clickable
// capsule, snap to the nearest targetable character within a small screen radius.
// Extracted as pure screen-space math so it can be reasoned about and unit-tested
// without a WebGL context.
//
// Each character contributes a vertical screen-space COLUMN, not a single point:
// from the body midpoint (bottom anchor) up to the overhead nameplate (top
// anchor). The original code measured distance to the body midpoint alone, so
// clicking the floating name above the head, exactly what a healer does to target
// a party member, fell outside the radius and selected nobody (or the wrong
// unit). Measuring to the whole column makes a name click register on its owner.

/**
 * Shortest pixel distance from a click (px,py) to the segment (ax,ay)-(bx,by),
 * clamped at the endpoints (so it is a finite segment, not an infinite line).
 */
export function distanceToSegmentPx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment (both anchors coincide): plain point distance.
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export interface SloppyPickCandidate {
  id: number;
  // Body midpoint, screen space (the original sloppy-pick anchor).
  midX: number;
  midY: number;
  // Overhead nameplate anchor, screen space.
  topX: number;
  topY: number;
}

/**
 * Return the id of the nearest candidate whose body-to-nameplate column passes
 * within `maxPx` of the click, or null if none qualify. The radius is strict
 * (a click exactly at `maxPx` does not count), matching the prior behaviour.
 */
export function nearestSloppyPickId(
  clickX: number,
  clickY: number,
  candidates: readonly SloppyPickCandidate[],
  maxPx: number,
): number | null {
  let bestId: number | null = null;
  let bestD = maxPx;
  for (const c of candidates) {
    const d = distanceToSegmentPx(clickX, clickY, c.midX, c.midY, c.topX, c.topY);
    if (d < bestD) {
      bestD = d;
      bestId = c.id;
    }
  }
  return bestId;
}
