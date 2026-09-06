// The shared header delegation for the always-on trackers in
// #right-tracker-stack (#quest-tracker, #deed-tracker, #reliquary-tracker,
// #recipe-tracker): a click on the header toggles the persisted collapse, and
// Enter/Space on it does the same, stopped before the window-level game
// keybinds (Enter is bound to Open Chat, Space is preventDefault'd for jump)
// hijack the focused header button's native activation. The tracker is a non-modal overlay, so
// canUseGameKeys() stays true and those binds fire while it has focus;
// stopping propagation here keeps the toggle reachable by keyboard.
//
// On the compact touch tier the rows are folded away (hud.mobile.css) and the
// header is a count chip: when the caller supplies `openCompact`, activation
// while `isCompact()` opens the owning window instead of toggling a collapse
// the player cannot see. Trackers hidden on touch pass no `openCompact`.
//
// A tracker whose rows are themselves controls (the quest tracker's titles
// jump to the quest log) passes `rows`: the same click and keydown arms
// activate a matching row, so its keyboard path gets the same bind guard.
//
// The delegation binds on the stable container, never the header button
// itself, because a painter may rebuild its header. This was the fourth copy
// of the same block in hud.ts (the rule of three), extracted so the recipe
// tracker could reuse it rather than growing the coordinator.

export interface TrackerHeaderWiring {
  /** The header control's selector; the shared tracker chrome's by default. */
  header?: string;
  /** Flip the tracker's persisted collapse (the desktop header action). */
  toggle(): void;
  /** Optional row controls inside the strip and what activating one does.
   *  Returns whether the row really acted: a row the callback declines (the
   *  quest tracker's title with no quest id) leaves the key to the game binds,
   *  the hud.ts arm's exact fall-through. */
  rows?: { selector: string; activate(row: HTMLElement): boolean };
  /** True when the body carries the compact-touch chip classes. */
  isCompact?(): boolean;
  /** Open the owning window (the compact-touch chip action). */
  openCompact?(): void;
}

/** The single activation path both arms share: header first, then a row.
 *  Returns false when the target was neither (the event is left alone). */
function activate(target: HTMLElement, wiring: TrackerHeaderWiring): boolean {
  if (target.closest(wiring.header ?? '.dt-header')) {
    if (wiring.openCompact && wiring.isCompact?.() === true) wiring.openCompact();
    else wiring.toggle();
    return true;
  }
  const row = wiring.rows ? target.closest<HTMLElement>(wiring.rows.selector) : null;
  if (!row || !wiring.rows) return false;
  return wiring.rows.activate(row);
}

/** Bind the click and Enter/Space arms on a tracker's container. */
export function wireTrackerHeader(root: HTMLElement, wiring: TrackerHeaderWiring): void {
  root.addEventListener('click', (e) => {
    activate(e.target as HTMLElement, wiring);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
    // Only a real control consumes the key: preventDefault on a stray key
    // inside the strip would eat a jump.
    if (!activate(e.target as HTMLElement, wiring)) return;
    e.preventDefault();
    e.stopPropagation();
  });
}
