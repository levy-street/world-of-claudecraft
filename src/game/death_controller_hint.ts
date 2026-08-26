// The death controls are ordinary localized buttons; this tiny resolver supplies
// only the live physical Confirm cap rendered before their text. Keeping the label
// in the gamepad layer preserves remaps and the detected Xbox/PS/Nintendo family.

import { type GamepadBindingEntry, labelForGamepadAction } from './gamepad_bindings';
import { GAMEPAD_CONFIRM, type GamepadKind } from './gamepad_map';

export interface DeathControllerGamepad {
  entries(): GamepadBindingEntry[];
  kind(): GamepadKind;
}

const DEATH_BUTTON_IDS = ['release-btn', 'resurrect-corpse-btn', 'resurrect-healer-btn'] as const;
let paintedDocument: Document | null = null;
let paintedLabel: string | null | undefined;

export function deathControllerConfirmLabel(
  entries: readonly GamepadBindingEntry[],
  kind: GamepadKind,
): string | null {
  return labelForGamepadAction(entries, GAMEPAD_CONFIRM, kind);
}

/** Paint the cap without rewriting the buttons' localized text. CSS exposes the
 *  attribute only while the gamepad is the active input family. */
export function syncDeathControllerHints(gamepad: DeathControllerGamepad | null): void {
  if (typeof document === 'undefined') return;
  const label = gamepad ? deathControllerConfirmLabel(gamepad.entries(), gamepad.kind()) : null;
  if (document === paintedDocument && label === paintedLabel) return;
  paintedDocument = document;
  paintedLabel = label;
  for (const id of DEATH_BUTTON_IDS) {
    const button = document.getElementById(id);
    if (!button) continue;
    if (label) button.setAttribute('data-gamepad-confirm-label', label);
    else button.removeAttribute('data-gamepad-confirm-label');
  }
}
