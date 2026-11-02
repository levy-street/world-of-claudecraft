// The standalone weekly sheet traps Tab; the bank keeps its bags companion reachable.
import type { FocusManager } from './focus_manager';
import { findFocusKey, restoreFirstEnabled } from './focus_restore';
import { makeWindowFocus, type WindowFocusBridge } from './window_focus';
export function makeBankWindowFocus(fm: FocusManager, root: () => HTMLElement): WindowFocusBridge {
  const weekly = makeWindowFocus(fm, root);
  return {
    captureFocus: () =>
      document.body.classList.contains('weekly-vault-open')
        ? weekly.captureFocus()
        : fm.activeFocusable(),
    restoreFocus: weekly.restoreFocus,
  };
}

/** Re-land focus after a full bank rebuild: the control the user was on
 *  (resolved by its data-focus-key in the fresh tree, skipped when it came back
 *  disabled), else the always-present close button. Never <body> (WCAG 2.4.3). */
export function restoreBankControlFocus(el: HTMLElement, focusKey: string | null): void {
  restoreFirstEnabled([
    focusKey ? findFocusKey(el, focusKey) : null,
    el.querySelector('[data-close]') as HTMLElement | null,
  ]);
}
