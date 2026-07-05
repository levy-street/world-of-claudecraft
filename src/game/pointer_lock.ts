// Pure decision logic for engaging/releasing the pointer lock used by mouse
// camera rotation. Kept DOM-free so it unit-tests in isolation (the same
// pattern as click_move.ts / pointer_pick.ts).
//
// Why this exists: camera rotation integrates relative mouse deltas
// (movementX/movementY). Without pointer lock the OS cursor is free to leave
// the window, so it hits the monitor edge (movementX clamps to 0, the camera
// freezes) or slips onto a second display. Locking the pointer while a drag is
// active keeps every delta flowing and the cursor pinned to the canvas.

export interface PointerLockEngageInput {
  /** The "Lock cursor while rotating" setting (default on). */
  lockOnRotate: boolean;
  /**
   * Browser fullscreen. In fullscreen Chrome shows an unavoidable
   * "press and hold Esc" prompt for pointer lock, so we leave fullscreen
   * camera drags as ordinary mouse drags.
   */
  isFullscreen: boolean;
  /** Whether the canvas already holds the pointer lock. */
  alreadyLocked: boolean;
}

/**
 * True when a newly-active camera drag should request pointer lock. Applies to
 * both camera modes (classic right-drag and OSRS-style Mouse Camera): the only
 * reason to skip is the setting being off, fullscreen, or an existing lock.
 */
export function shouldEngagePointerLock(input: PointerLockEngageInput): boolean {
  return input.lockOnRotate && !input.isFullscreen && !input.alreadyLocked;
}

export interface PointerLockReleaseInput {
  /** Any camera-rotation mouse button still held. */
  anyButtonDown: boolean;
  /** Whether the canvas currently holds the pointer lock. */
  hasLock: boolean;
}

/**
 * True when the pointer lock should be released: the drag has ended (no button
 * held) and we still hold the lock. Releasing here returns the OS cursor
 * between drags so target/loot/UI clicking is unaffected.
 */
export function shouldReleasePointerLock(input: PointerLockReleaseInput): boolean {
  return !input.anyButtonDown && input.hasLock;
}
