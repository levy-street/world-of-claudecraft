// The target's subcommand menu, opened from the pad.
//
// It does not build a menu: the HUD already opens one on right-click. This
// synthesises that same right-click at the frame's own position, so the pad and
// the mouse can never drift into offering different options for the same target.
//
// Keyboard and mouse never reach this; only the pad's subcommand button calls it.

// The frames the pad opens a menu on, in preference order: the current target
// first, since that is what the button is asking about. Party ROWS bind their own
// context menu too, but a pad reaches a party member by targeting them, at which
// point the target frame is the same menu; adding the rows would only offer a
// second route to it, and the pad has no way to say which row it means.
const MENU_FRAMES = ['#target-frame', '#player-frame'] as const;

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Open the subcommands for whatever the pad is pointing at. Answers false when no
 * frame is up, so the caller can fall back (the map, as a console MMO does with
 * this button) instead of a press that does nothing.
 */
export function openTargetSubcommands(): boolean {
  if (typeof document === 'undefined') return false;
  for (const selector of MENU_FRAMES) {
    const frame = document.querySelector<HTMLElement>(selector);
    if (!frame || !isVisible(frame)) continue;
    const rect = frame.getBoundingClientRect();
    frame.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        // Anchored to the frame so the menu opens over it rather than at 0,0.
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 2,
      }),
    );
    return true;
  }
  return false;
}
