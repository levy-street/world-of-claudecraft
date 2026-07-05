// The window-focus bridge: the {captureFocus, restoreFocus} pair every HUD
// painter window is wired through. It is the thin glue between a window's
// open/close lifecycle and the shared FocusManager (focus_manager.ts):
//   - captureFocus records the current opener AND installs the Tab trap on the
//     window root, returning the opener so the window can hand it back later;
//   - restoreFocus releases the trap and returns focus to the opener, EXCEPT an
//     in-window refocus (the target is still inside the open window, e.g.
//     char_window handing focus back to a rebuilt slot row after a keyboard
//     unequip) which only re-focuses without tearing the trap down.
//
// This lived inline on the Hud monolith and was copied (faithfully) into the
// keyboard-navigation browser E2E so the test could drive the real open -> trap
// -> close -> return path. Lifting it here behind the existing focus_manager
// seam (no new seam) makes it ONE source that both hud.ts and that E2E import,
// so the test can no longer drift from the shipped glue.
//
// WIRING, not a registered pure core: it composes FocusManager (which touches
// document.activeElement). It takes the window root as a lazy `() => HTMLElement`
// so the caller owns the DOM lookup; this module imports no DOM and no `$`.
import type { FocusManager, FocusTrapHandle } from './focus_manager';

export interface WindowFocusBridge {
  captureFocus: () => HTMLElement | null;
  restoreFocus: (target: HTMLElement | null) => void;
}

/**
 * Build the focus bridge for one window. `root` re-resolves the window element
 * lazily (it may be hidden or unpopulated at open() time, exactly like
 * FocusManager's own root callback).
 */
export function makeWindowFocus(fm: FocusManager, root: () => HTMLElement): WindowFocusBridge {
  let handle: FocusTrapHandle | null = null;
  return {
    captureFocus: () => {
      // Defensive: if a prior trap for this window was never released (a re-open
      // without an intervening close), drop it first so a double-capture cannot
      // orphan a trap on the manager's stack (the self-heal would clear it on the
      // next Tab, but releasing here keeps the stack honest).
      handle?.release(false);
      const opener = fm.activeFocusable();
      handle = fm.open({ root, returnFocusTo: opener });
      return opener;
    },
    restoreFocus: (target) => {
      // An in-window refocus (target still inside the open window) must NOT tear
      // down the trap; only a return-to-opener on close (target outside the
      // window, or null) releases it.
      const r = root();
      if (target && r.contains(target)) {
        fm.restore(target);
        return;
      }
      handle?.release(false);
      handle = null;
      fm.restore(target);
    },
  };
}
