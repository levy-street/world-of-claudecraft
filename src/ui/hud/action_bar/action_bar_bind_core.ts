// On-bar action-bar key-binding mode (issue #1238): pure phase/state helpers for
// the click-a-slot-then-press-a-key rebind flow. DOM-free (no button refs, no key
// capture) so the state transitions are Vitest-testable directly; the thin
// controller in hud.ts owns the banner DOM, the action-bar click intercept, the
// Reset confirm dialog, and the shared key-capture seam (Input.captureNextKey via
// OptionsHooks.captureKey) every other rebind flow already uses.

/**
 * selectedSlot: the bar slot index awaiting a keypress, or null between
 * selections. lastBoundKeyLabel: the on-screen label of the key just bound (or
 * null after a cancelled/rejected capture), shown as transient feedback until
 * the next slot is selected.
 */
export interface ActionBarBindState {
  selectedSlot: number | null;
  lastBoundKeyLabel: string | null;
}

/** The mode's starting state: no slot selected yet. */
export function actionBarBindEnter(): ActionBarBindState {
  return { selectedSlot: null, lastBoundKeyLabel: null };
}

/** Clicking a bar slot selects it (replacing any prior selection, mid-capture
 *  or not) and clears any leftover "bound to X" feedback from an earlier capture. */
export function actionBarBindSelectSlot(slot: number): ActionBarBindState {
  return { selectedSlot: slot, lastBoundKeyLabel: null };
}

/** A capture resolved (a key was pressed and bound, or the capture was
 *  cancelled/rejected): clear the selection and record the outcome. Pass the
 *  bound key's label, or null for a cancelled/rejected capture. */
export function actionBarBindResolveCapture(keyLabel: string | null): ActionBarBindState {
  return { selectedSlot: null, lastBoundKeyLabel: keyLabel };
}

export type ActionBarBindStatus = 'idle' | 'capturing' | 'bound';

/** Which status line the banner should show for the current state. */
export function actionBarBindStatus(state: ActionBarBindState): ActionBarBindStatus {
  if (state.selectedSlot !== null) return 'capturing';
  if (state.lastBoundKeyLabel !== null) return 'bound';
  return 'idle';
}
