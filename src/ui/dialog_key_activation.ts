// Keyboard activation for the #confirm-dialog family.
//
// The game input layer listens for keydown on window (bubble): Enter is the
// chat-open edge action, which focuses the chat composer mid-keydown and (in
// Chromium) suppresses the focused button's native Enter activation, and Space
// is preventDefault-ed outright as the jump key. With a confirm dialog open
// that meant Enter pulled focus out of the aria-modal dialog into chat and
// activated nothing, Space did nothing, and only a mouse click could confirm;
// Escape-cancel was the lone keyboard path.
//
// This is the dialog-scoped repair (the inputDialog Enter-submit precedent,
// generalized): Enter or Space on a focused button inside the dialog activates
// that button and stops the event there, so the game layer never sees the
// press. Everything else (movement keys, Escape, plain typing) still bubbles.

/** Install the activation handler on a dialog root. Bubble phase on the root:
 *  the target's own handlers (e.g. inputDialog's Enter-submit on its input)
 *  run first, and non-button focus targets pass through untouched. */
export function bindDialogKeyActivation(root: HTMLElement): void {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
    const active = root.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) return;
    if (!active.matches('button, [role="button"]')) return;
    e.preventDefault();
    e.stopPropagation();
    active.click();
  });
}
