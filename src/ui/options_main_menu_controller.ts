// The Esc menu's button list: paints the pure buildOptionsMenu entries as the
// row plates and dispatches each press. Extracted from the options window
// painter (at its monolith ceiling, tests/monolith_budget.test.ts) when the
// Unlock Interface entry joined the menu: that row is an ACTION that relabels
// itself in place (the Frames tab's row in options_interface_rows.ts,
// mirrored), so it is the one entry whose paint outlives the click. Every
// routing entry (a sub-view, the wiki hop, unstuck, logout, close) hands its
// action back to the window, which owns the view state the routing mutates.
// Named *_controller so it sits in the painter gate's cold bucket
// (tests/hud_perf_budget.test.ts) as well as in UI_DOM_MODULES.

import { audio } from '../game/audio';
import { t } from './i18n';
import { interfaceUnlockLabelKey } from './interface_unlock_core';
import type { OptionsMenuAction, OptionsMenuEntry } from './options_view';
import { svgIcon } from './ui_icons';

/** A menu action the window routes itself (everything but the unlock toggle). */
export type OptionsMenuRoutedAction = Exclude<OptionsMenuAction, { kind: 'interfaceUnlock' }>;

/** The window-side seam the list dispatches through. OptionsWindowDeps
 *  satisfies the frame-editing member structurally. */
export interface OptionsMainMenuDeps {
  /** Flip every movable HUD frame at once; returns the new unlocked state. */
  toggleInterfaceUnlock(): boolean;
  /** Route a pressed entry: the window changes view, opens the wiki, logs out,
   *  unsticks, or closes. */
  dispatch(action: OptionsMenuRoutedAction): void;
}

/** The `.opt-list` column of row plates, one button per entry, in entry order. */
export function buildOptionsMenuList(
  entries: readonly OptionsMenuEntry[],
  deps: OptionsMainMenuDeps,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'opt-list';
  for (const entry of entries) list.appendChild(menuButton(entry, deps));
  return list;
}

function menuButton(entry: OptionsMenuEntry, deps: OptionsMainMenuDeps): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn ui-btn opt-btn';
  b.textContent = t(entry.labelKey);
  const a = entry.action;
  // A stable, label-free hook for the capture rigs and browser suites (the
  // sub-view id for a routing row, the action kind otherwise): the list's
  // order shifts by host (the unlock row is desktop-only), so an index is not.
  b.dataset.menuAction = a.kind === 'goto' ? a.view : a.kind;
  if (a.kind === 'interfaceUnlock') {
    wireInterfaceUnlock(b, a.unlocked, deps);
    return b;
  }
  if (a.kind === 'close') b.classList.add('ui-btn--red', 'ui-btn--lg');
  if (a.kind === 'logout') b.classList.add('opt-btn-hostile');
  if (a.kind === 'wiki') {
    const chevron = document.createElement('span');
    chevron.className = 'opt-btn-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = svgIcon('next');
    b.appendChild(chevron);
  }
  if (a.kind === 'goto' && a.view === 'bugreport') {
    const status = document.createElement('span');
    status.className = 'opt-btn-status ui-muted';
    status.textContent = t('hudChrome.bugReport.online');
    status.setAttribute('aria-hidden', 'true');
    b.setAttribute('aria-label', `${t(entry.labelKey)}: ${t('hudChrome.bugReport.online')}`);
    b.appendChild(status);
  }
  b.addEventListener('click', () => {
    audio.click();
    deps.dispatch(a);
  });
  return b;
}

// "Unlock interface" as a menu row: the same press-and-repaint contract as the
// Frames tab's row. The establishing paint follows the state the entry was
// built from (one source, the core); a press repaints from the seam's ANSWER
// (the mobile backstop refuses and answers false), never from an assumed flip,
// so the menu can never claim the frames are loose when they are not. The
// on-state is the library's declared .ui-btn--on fill: the label already
// states the NEXT action, so the row carries no aria-pressed (which would
// announce "Lock interface, pressed" for an unlocked interface). The menu stays
// open, exactly as the Frames tab does after its press: the floating Lock
// Interface control is the mode's own exit.
function wireInterfaceUnlock(
  b: HTMLButtonElement,
  unlocked: boolean,
  deps: OptionsMainMenuDeps,
): void {
  const sync = (isUnlocked: boolean) => {
    b.textContent = t(interfaceUnlockLabelKey(isUnlocked));
    b.classList.toggle('ui-btn--on', isUnlocked);
  };
  sync(unlocked);
  b.addEventListener('click', () => {
    audio.click();
    sync(deps.toggleInterfaceUnlock());
  });
}
