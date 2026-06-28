// Shared focus manager (WIRING, not a registered pure core): the ONE owner of the
// HUD's window focus behavior. It unifies the previously ad-hoc per-window focus
// helpers that lived on Hud (currentFocusableElement / restoreFocus /
// focusFirstInteractive) into a single trap + focus-first + return-to-opener system,
// so there is one system, not two. It touches document.activeElement and listens on
// document, so it is intentionally NOT in tests/architecture.test.ts UI_PURE_CORES;
// the DOM-FREE boundary math it leans on lives in ./focus_order and IS registered.
//
// WHAT THIS OWNS:
//   - the ONE canonical FOCUSABLE_SELECTOR (lifted from the old Hud helper, never
//     re-spelled),
//   - Tab / Shift+Tab cycle within the open window (wrapping at both ends),
//   - focus-first-interactive on open,
//   - return-to-opener on close.
//
// WHAT THIS DELIBERATELY DOES NOT OWN:
//   - Escape. The HUD already routes Escape through ONE dispatcher (src/main.ts game
//     input -> hud.closeAll(), plus the gamepad path and the few capture-phase modal
//     handlers that beat game input). Adding a second Escape listener here would
//     duplicate it, so Escape stays with the existing
//     unified dispatcher. The trap still lets a keyboard user leave: Escape closes the
//     window via that dispatcher, which returns focus through release().
//
// WHY THE TRAP ONLY FIRES WHEN FOCUS IS ALREADY INSIDE THE WINDOW: in this game Tab
// is the target-nearest-enemy key (src/main.ts onTab) while no window is focused.
// Intercepting Tab unconditionally would hijack tab-targeting, so the trap only
// cycles Tab when document.activeElement is already within the trapped window; from
// the game world Tab still targets. The 3D world / game canvas is OUT of a11y scope
// (not screen-readable); the trap never reaches it.
import { nextFocusIndex } from './focus_order';

/**
 * The canonical focusable set for the Tab CYCLE: every keyboard-focusable element in a
 * trapped window, INCLUDING the window close (X) button. Before this trap existed, native
 * Tab order reached the X; the cycle must keep it reachable (closing a window
 * from the keyboard must never depend on Escape alone). Lifted to ONE named constant (it
 * was previously spelled inline in Hud.focusFirstInteractive); never re-spelled.
 *
 * Focus-FIRST-on-open is a derivation of this set, not a second selector: focusFirst()
 * skips the [data-close] X so opening a window lands on a meaningful control rather than
 * the dismiss affordance, falling back to the X only when it is the sole focusable.
 *
 * tabindex="-1" is excluded from EVERY clause, not just the bare [tabindex] one: an element
 * with tabindex="-1" is programmatically focusable but deliberately OUT of the Tab sequence
 * (the roving-tabindex idiom, e.g. the inactive social / talents / market tabs), so the Tab
 * cycle must skip it exactly as native Tab does, or a roving widget inside a trapped window
 * would stop on every inactive item instead of behaving as one Tab stop.
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  /**
   * Re-resolve the trapped window root lazily: it may be hidden or unpopulated at
   * open() time, and the focusable set is re-queried on every Tab, so the manager
   * always reads the live DOM.
   */
  root: () => HTMLElement | null;
  /**
   * The element to refocus on release. Captured from the active element at open()
   * when omitted (the old currentFocusableElement idiom).
   */
  returnFocusTo?: HTMLElement | null;
}

export interface FocusTrapHandle {
  /**
   * Move focus to the first interactive element in the trapped window (or the
   * preferredSelector match), matching the old focusFirstInteractive entry point.
   */
  focusFirst(preferredSelector?: string): void;
  /**
   * Remove this trap. When returnFocus is true (the default) focus returns to the
   * recorded opener (the old restoreFocus behavior).
   */
  release(returnFocus?: boolean): void;
}

interface TrapState {
  root: () => HTMLElement | null;
  opener: HTMLElement | null;
}

export class FocusManager {
  private readonly stack: TrapState[] = [];
  private listening = false;

  /**
   * The currently focused element worth returning to later (the old
   * currentFocusableElement idiom): a connected, rendered, non-body element.
   */
  activeFocusable(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && this.canFocus(active)
      ? active
      : null;
  }

  /**
   * Return focus to target (or fallback), matching the old Hud.restoreFocus: deferred
   * a tick so it wins over a close handler that is still settling the DOM.
   */
  restore(target: HTMLElement | null, fallback?: HTMLElement | null): void {
    const resolvedFallback = fallback ?? null;
    const candidate = this.canFocus(target)
      ? target
      : this.canFocus(resolvedFallback)
        ? resolvedFallback
        : null;
    if (!candidate) return;
    window.setTimeout(() => candidate.focus(), 0);
  }

  /**
   * Focus the first interactive element in root (or the preferredSelector match),
   * matching the old Hud.focusFirstInteractive.
   */
  focusFirst(root: HTMLElement, preferredSelector?: string): void {
    window.setTimeout(() => {
      if (preferredSelector) {
        const preferred = root.querySelector<HTMLElement>(preferredSelector);
        if (preferred) {
          preferred.focus();
          return;
        }
      }
      const focusables = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      // Skip the close (X) button on open so focus lands on a meaningful control, not the
      // dismiss affordance; fall back to it only when it is the sole focusable element.
      const target = focusables.find((el) => !el.matches('[data-close]')) ?? focusables[0];
      (target ?? root).focus();
    }, 0);
  }

  /**
   * Open a focus trap for a window: record the opener, push the trap, install the Tab
   * cycle. Returns a handle whose release() removes the trap and returns focus. The
   * most recently opened trap is the active one (a stack), so closing the top window
   * reactivates the one beneath it.
   */
  open(opts: FocusTrapOptions): FocusTrapHandle {
    const state: TrapState = {
      root: opts.root,
      opener: opts.returnFocusTo !== undefined ? opts.returnFocusTo : this.activeFocusable(),
    };
    this.stack.push(state);
    this.ensureListening();
    return {
      focusFirst: (preferredSelector?: string) => {
        const root = state.root();
        if (root) this.focusFirst(root, preferredSelector);
      },
      release: (returnFocus = true) => {
        const i = this.stack.lastIndexOf(state);
        if (i !== -1) this.stack.splice(i, 1);
        if (this.stack.length === 0) this.stopListening();
        if (returnFocus) this.restore(state.opener);
      },
    };
  }

  private canFocus(el: HTMLElement | null): el is HTMLElement {
    return Boolean(el?.isConnected && el.getClientRects().length > 0);
  }

  private ensureListening(): void {
    if (this.listening) return;
    document.addEventListener('keydown', this.onKeyDown, true);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening) return;
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.listening = false;
  }

  // Bound once for stable add/removeEventListener identity.
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    // Self-heal: drop any top traps whose window was closed without releasing, so a
    // leaked trap can never strand the user.
    let top = this.stack[this.stack.length - 1];
    while (top && !this.canFocus(top.root())) {
      this.stack.pop();
      top = this.stack[this.stack.length - 1];
    }
    if (!top) {
      this.stopListening();
      return;
    }
    const root = top.root();
    if (!root) return;
    const active = document.activeElement;
    // Only trap Tab when focus is already inside the window: from the game world Tab
    // is the target-nearest key and must not be hijacked.
    if (!(active instanceof HTMLElement) || !root.contains(active)) return;
    const focusables = this.focusablesIn(root);
    if (focusables.length === 0) return;
    const nextIndex = nextFocusIndex(focusables.length, focusables.indexOf(active), e.shiftKey);
    if (nextIndex < 0) return;
    e.preventDefault();
    focusables[nextIndex].focus();
  };

  private focusablesIn(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      (el) => el.getClientRects().length > 0,
    );
  }
}
