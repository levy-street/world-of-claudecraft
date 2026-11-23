// Pure gates for the action-bar slot edit gestures. Two rules live here so
// hud.ts stays a thin consumer of one boolean decision per call site instead of
// re-deriving them at every listener:
// - the "lock action bars" option (#1361): when locked, the slot drag/drop/clear
//   gestures are rejected outright while casting from a keybind or a click keeps
//   working (those paths never call through here);
// - the Shift-to-move rule: a slot drag only starts while Shift is held. A plain
//   press-and-drag on a slot is a cast gesture (the hold-to-charge abilities such
//   as Dragon's Breath press on pointerdown and fire on release), so it must never
//   pick the action up; a native drag starting mid-hold used to cancel the pointer
//   and fire the charge early.

export type ActionBarEditGesture = 'drag' | 'drop' | 'clear';

/** Whether a slot-editing gesture (drag, drop, or clear) is allowed to proceed. */
export function isActionBarEditAllowed(locked: boolean, _gesture: ActionBarEditGesture): boolean {
  return !locked;
}

/** The modifier that turns a slot press into a move gesture: Shift held on the event. */
export function isSlotMoveModifierHeld(event: Pick<MouseEvent, 'shiftKey'>): boolean {
  return event.shiftKey;
}

/**
 * Whether a dragstart on an occupied slot may pick the action up: the bars are
 * unlocked AND Shift is held. Drops and clears keep their own gates above; the
 * spellbook and bag drags that PLACE an action on a slot never start here.
 */
export function isSlotMoveDragAllowed(
  locked: boolean,
  event: Pick<MouseEvent, 'shiftKey'>,
): boolean {
  return isActionBarEditAllowed(locked, 'drag') && isSlotMoveModifierHeld(event);
}
