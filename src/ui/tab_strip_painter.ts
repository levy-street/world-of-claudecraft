// Thin DOM wiring for a tab_strip_view.ts strip: click + roving Arrow/Home/End
// keyboard navigation (via the shared roving_index.ts core), matching the
// WAI-ARIA tabs pattern (selection-follows-focus on keyboard, explicit click
// activation). This is a cold-path chrome wiring helper, not a per-frame
// painter, so it is not registered in HOT_PAINTERS: it fires once per full
// window render, same as the hand-rolled listeners it replaces.
//
// The caller re-renders the whole strip on selection (the pattern every
// migrated window already used), so this owns no state of its own: it just
// resolves the current tabs under `container` and dispatches
// `onSelect(id, focusFollow)`. `focusFollow` is true only for a keyboard move
// (roving Arrow/Home/End or Enter/Space), byte-matching the prior per-window
// code where a click never programmatically moved focus but a keyboard
// selection always refocused the newly active tab after the rebuild.
//
// `orientation` defaults to 'horizontal' (Left/Right roving, the plain tab
// row every current window uses); pass 'both' for a strip a future window
// also wants Up/Down roving on (the same knob roving_index.ts already
// exposes for a 2D grid or vertical stack).

import { type RovingOrientation, rovingTarget } from './roving_index';

export function wireTabStrip(
  container: HTMLElement,
  tabClass: string,
  onSelect: (id: string, focusFollow: boolean) => void,
  orientation: RovingOrientation = 'horizontal',
): void {
  const tabs = Array.from(container.querySelectorAll<HTMLElement>(`.${tabClass}`));
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => onSelect(tab.dataset.tab ?? '', false));
    tab.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      const next = rovingTarget(ke.key, i, tabs.length, orientation);
      if (next !== null) {
        ke.preventDefault();
        const target = tabs[next];
        if (target && target !== tab) onSelect(target.dataset.tab ?? '', true);
        return;
      }
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        onSelect(tab.dataset.tab ?? '', true);
      }
    });
  });
}

// Focus the currently selected tab under `container` (matched by both the
// tab class and the selected class), the refocus-after-rebuild step every
// caller needs after a keyboard-driven selection (see wireTabStrip's
// `focusFollow`). Shared so a migrated window does not hand-roll its own
// `.tabClass.selectedClass` query.
export function focusActiveTab(
  container: HTMLElement,
  tabClass: string,
  selectedClass: string,
): void {
  (container.querySelector(`.${tabClass}.${selectedClass}`) as HTMLElement | null)?.focus();
}
