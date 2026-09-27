// The standalone weekly sheet traps Tab; the bank keeps its bags companion reachable.
import type { FocusManager } from './focus_manager';
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
