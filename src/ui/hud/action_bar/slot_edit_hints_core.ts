// The tooltip sub-lines that teach an occupied action-bar slot's two edit
// gestures: Shift-drag moves the action to another slot, Shift-right-click or
// Shift-Delete clears it. One helper so the ability, freed-attack-slot, and item
// arms of the slot tooltip cannot drift apart on which gestures they advertise.
// Pure (esc + the locale table only); registered in tests/architecture.test.ts
// UI_PURE_CORES.

import { esc } from '../../esc';
import { t } from '../../i18n';

/** The move hint followed by the clear hint, each on its own tooltip sub-line. */
export function slotEditHintLines(): string {
  return `<div class="tt-sub">${esc(t('abilityUi.actionBar.moveHint'))}</div><div class="tt-sub">${esc(t('abilityUi.actionBar.clearHint'))}</div>`;
}
