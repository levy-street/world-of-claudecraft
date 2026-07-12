// Pure keyboard-navigation logic for the custom in-app dropdown (.ui-dd),
// lifted out of hud.ts so it can be unit-tested without a DOM. The widget
// replaces the native <select>; this restores the keyboard semantics a real
// <select>/listbox is expected to have (WAI-ARIA listbox pattern).

export type DropdownNavAction =
  | { kind: 'open'; index: number } // open the menu, focusing this option index
  | { kind: 'move'; index: number } // move focus to this option index
  | { kind: 'select' } // commit the currently focused option
  | { kind: 'close' } // close without committing, return focus to the trigger
  | { kind: 'tab' } // close but let Tab traverse natively (do not preventDefault)
  | { kind: 'none' }; // key not handled — let the browser have it

// Resolve a keydown into an action. `open` is whether the menu is currently
// shown; `current` is the focused option index (-1 when none); `count` is the
// number of options. Indices always clamp into [0, count-1].
export function dropdownKeyNav(
  key: string,
  open: boolean,
  current: number,
  count: number,
): DropdownNavAction {
  if (count <= 0) return { kind: 'none' };
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));

  if (!open) {
    // Collapsed: Enter/Space/Arrows/Home/End all open the menu.
    switch (key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
      case 'ArrowUp':
        return { kind: 'open', index: current < 0 ? 0 : clamp(current) };
      case 'Home':
        return { kind: 'open', index: 0 };
      case 'End':
        return { kind: 'open', index: count - 1 };
      default:
        return { kind: 'none' };
    }
  }

  // Typeahead is handled by the consumer (it needs the option labels); this core
  // only owns the structural navigation keys.

  // Expanded.
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: current < 0 ? 0 : clamp(current + 1) };
    case 'ArrowUp':
      return { kind: 'move', index: current < 0 ? count - 1 : clamp(current - 1) };
    case 'Home':
      return { kind: 'move', index: 0 };
    case 'End':
      return { kind: 'move', index: count - 1 };
    case 'Enter':
    case ' ':
      return { kind: 'select' };
    case 'Escape':
      return { kind: 'close' };
    case 'Tab':
      // Close and return focus to the trigger button, but signal the consumer to
      // leave the default Tab behavior intact (no preventDefault) so native
      // Tab/Shift+Tab then advances/retreats deterministically from a real
      // tab-order element — rather than dropping focus to <body> when the focused
      // option is display:none-d on close.
      return { kind: 'tab' };
    default:
      return { kind: 'none' };
  }
}

/** Listboxes with this many options or more get first-letter typeahead (WAI-ARIA
 *  listbox convention; research-brief). Below it, arrow navigation is enough. */
export const TYPEAHEAD_MIN_OPTIONS = 7;

/**
 * First-letter typeahead target for an open listbox: the index of the next option
 * (cyclically AFTER `from`) whose label starts with `char` (case-insensitive), or null
 * when none match. `from` is the focused option index (-1 for none); starting the scan
 * after it lets a repeated keypress cycle through same-initial options. Pure and DOM-free.
 */
export function typeaheadTarget(
  labels: readonly string[],
  from: number,
  char: string,
): number | null {
  const c = char.toLowerCase();
  const n = labels.length;
  if (c.length !== 1 || n === 0) return null;
  for (let step = 1; step <= n; step++) {
    const i = (((from + step) % n) + n) % n;
    if ((labels[i] ?? '').trim().toLowerCase().startsWith(c)) return i;
  }
  return null;
}
