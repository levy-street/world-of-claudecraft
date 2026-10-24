// Pure gate for the "lock action bars" option (#1361): when locked, the
// action-bar slot drag/drop/clear gestures are rejected outright while
// casting from a keybind or a click keeps working (those paths never call
// through here). Kept as its own module so hud.ts stays a thin consumer of
// one boolean decision instead of re-deriving it at every call site.

export type ActionBarEditGesture = 'drag' | 'drop' | 'clear';

/** Whether a slot-editing gesture (drag, drop, or clear) is allowed to proceed. */
export function isActionBarEditAllowed(locked: boolean, _gesture: ActionBarEditGesture): boolean {
  return !locked;
}
