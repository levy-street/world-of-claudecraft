// On-bar action-bar key-binding mode (issue #1238): pure phase/state helpers for
// the click-a-slot-then-press-a-key rebind flow. DOM-free (no button refs, no key
// capture) so the state transitions are Vitest-testable directly. The controller
// (action_bar_bind_controller.ts) owns the slot clicks, the key capture and the
// confirm dialogs, the banner DOM lives in action_bar_bind_banner.ts, and hud.ts
// keeps only the action-bar click intercept.

/**
 * selectedSlot: the bar slot index awaiting a keypress, or null between
 * selections. lastBoundKeyLabel: the on-screen label of the key just bound (or
 * null after a cancelled/rejected capture), shown as transient feedback until
 * the next slot is selected.
 */
import {
  type KeybindConflictPrompt,
  keybindConflictPrompt,
} from '../../keybind_conflict_prompt_core';

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

/** The are-you-sure prompt the on-bar mode raises before a capture commits:
 *  the shared keybind conflict prompt, with the slot as the gaining action. */
export type ActionBarBindPrompt = KeybindConflictPrompt;

/**
 * Decide whether binding `key` to the selected slot needs a warning first.
 * `other` is the name of the action that would LOSE `key` (null when the key
 * is free); `slot` names the slot being bound. Only a key already in use
 * elsewhere warns: replacing the slot's own previous key is the point of the
 * mode and asks nothing.
 */
export function actionBarBindPrompt(input: {
  key: string;
  other: string | null;
  slot: string;
}): ActionBarBindPrompt | null {
  return keybindConflictPrompt({ key: input.key, other: input.other, action: input.slot });
}
