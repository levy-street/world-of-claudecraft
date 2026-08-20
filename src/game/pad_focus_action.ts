// What the pad currently has focused, expressed as something the cross hotbar
// could hold. This is how an action gets ONTO the bar in the first place: open
// the spellbook, step onto an ability, and confirm picks it up to carry.
//
// It reuses the drag-and-drop affordance the spellbook already puts on its rows
// rather than deciding eligibility again: a row is `draggable` exactly when the
// window has already run `isAbilityActionBarEligible` over it, so the pad accepts
// precisely what a mouse drag would and a passive stays informational. Reading
// focus off the DOM (instead of a callback per source) works for the same reason:
// every surface that offers an action to a bar marks its rows the same way.
//
// Keyboard and mouse never reach this; only the pad's arrange mode calls it.

import type { CrossHotbarAction } from './cross_hotbar';
import { CROSS_HOTBAR_ATTACK_ID } from './cross_hotbar';
import { padMouseHovered } from './pad_mouse_cursor';

// Carried by the spellbook's rows and its hotbar-toggle buttons.
const ABILITY_ID_ATTR = 'data-ability-id';
// The Attack row carries no ability id (Attack is not an ability); its own toggle
// is what marks it, the same marker the spellbook uses to find that row again.
const ATTACK_ROW_MARKER = '[data-attack-toggle]';

function actionOn(el: Element | null): CrossHotbarAction {
  // Walk up to the draggable row: focus (and the pointer) often lands on a child
  // of it, the spellbook's own +/- toggle being the one a player hits most, and a
  // strict check on the focused node alone made those presses do nothing.
  const row = (el as HTMLElement | null)?.closest?.('[draggable="true"]') as HTMLElement | null;
  const node = row ?? (el as HTMLElement | null);
  if (!node || node.draggable !== true) return null;
  const id = node.getAttribute?.(ABILITY_ID_ATTR);
  if (id) return { type: 'ability', id };
  return node.querySelector?.(ATTACK_ROW_MARKER)
    ? { type: 'ability', id: CROSS_HOTBAR_ATTACK_ID }
    : null;
}

/**
 * The action the pad is pointing at, or null when it is on something the bar
 * cannot hold.
 *
 * Both pointing devices count. The d-pad moves FOCUS, but the virtual mouse only
 * HOVERS, so reading focus alone left a player steering the cursor onto a spell
 * and finding that picking it up did nothing.
 */
export function focusedPadAction(): CrossHotbarAction {
  if (typeof document === 'undefined') return null;
  return actionOn(document.activeElement) ?? actionOn(padMouseHovered());
}
