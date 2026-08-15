// Pure decision logic for WHEN a camera drag actually needs the pointer lock.
// DOM-free so it unit-tests in isolation, the same pattern as pointer_lock.ts.
//
// Why this exists: every requestPointerLock() call makes the BROWSER paint its
// own capture notice over the game ("Press Esc to show your cursor" on
// Chromium, "... has control of your pointer" on Firefox). Taking the lock on
// every camera drag meant that notice appeared on essentially every right-drag
// look, which is the single most common gesture in the game.
//
// The lock only ever earns its keep at the viewport edge: that is where the OS
// cursor stops moving, movementX/movementY clamp to 0 and the camera freezes,
// or the cursor slips onto a second display. A drag that stays in the middle of
// the window integrates its deltas perfectly well unlocked. So the lock is
// deferred until the pointer enters a margin band around the viewport edge,
// which for ordinary short looks never happens: no lock, no browser notice, and
// the anti-freeze guarantee is preserved exactly where it matters.

/**
 * Width of the band along each viewport edge inside which a camera drag takes
 * the pointer lock. Wide enough that the lock is granted (the request is async)
 * before a fast drag can actually reach the edge, narrow enough that ordinary
 * looks around the middle of the window never trigger it.
 */
export const POINTER_LOCK_EDGE_MARGIN_PX = 72;

export interface PointerLockEdgeInput {
  /** Pointer position in client (viewport) coordinates. */
  clientX: number;
  clientY: number;
  /** Viewport size in CSS pixels (`window.innerWidth`/`innerHeight`). */
  viewportWidth: number;
  viewportHeight: number;
  /** Override for {@link POINTER_LOCK_EDGE_MARGIN_PX}; tests only. */
  marginPx?: number;
}

/**
 * True when the pointer sits close enough to a viewport edge that a camera drag
 * needs the pointer lock to keep receiving movement deltas.
 *
 * A non-finite or non-positive viewport (no `window`, a detached/headless host)
 * reports true: without a usable viewport we cannot tell where the edge is, so
 * this falls back to the old always-lock behaviour rather than risking a frozen
 * camera. A viewport smaller than two margins is entirely edge band, which is
 * the correct answer for a window that small.
 */
export function pointerNearViewportEdge(input: PointerLockEdgeInput): boolean {
  const { clientX, clientY, viewportWidth, viewportHeight } = input;
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return true;
  if (viewportWidth <= 0 || viewportHeight <= 0) return true;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return true;
  const margin = Math.max(0, input.marginPx ?? POINTER_LOCK_EDGE_MARGIN_PX);
  return (
    clientX <= margin ||
    clientY <= margin ||
    clientX >= viewportWidth - margin ||
    clientY >= viewportHeight - margin
  );
}
