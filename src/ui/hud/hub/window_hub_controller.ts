// A window hub's DOM half (menu consolidation, 2026-11-04): the tab group
// over a set of existing windows. Every decision (which tab, what a launcher
// press does, which position fields carry) lives in the pure
// window_hub_view.ts; this controller applies them to the members.
//
// A member is an existing window seen through four calls (shown?, show,
// hide, root). The controller never paints a member's body and never owns a
// member's focus: each member's own open() records the opener and installs
// its trap, and its close() releases and restores it. Switching tabs closes
// the shown member FIRST (focus returns to the hub's original opener), then
// opens the next one, which records that same opener, so Escape from any tab
// lands focus back where the player started.
//
// Cold: no driver, no layout read. The one browser global it reaches is
// localStorage for the per-device last-tab memory (UI_DOM_MODULES).

import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { focusActiveTab, wireTabStrip } from '../../tab_strip_painter';
import {
  isWindowHubTab,
  parseWindowHubTab,
  resolveWindowHubTab,
  WINDOW_HUB_POSITION_FIELDS,
  WINDOW_HUB_SELECTED_CLASS,
  type WindowHubPositionCarry,
  type WindowHubSpec,
  windowHubPositionCarry,
  windowHubStripHtml,
  windowHubTabFocusKey,
  windowHubToggle,
} from './window_hub_view';

/** A member window as the hub sees it: the existing window's own surface
 *  (isOpen/open/close) plus the root the tab position carries onto (minted on
 *  first reach where the window mints its own). */
export interface WindowHubMember {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  rootElement(): HTMLElement | null;
}

export interface WindowHubDeps<T extends string> {
  /** The members, read FRESH on every use (a thunk, so the coordinator can
   *  build the hub before the windows it groups, and so a member whose isOpen
   *  is a computed field is never read stale). */
  members(): Readonly<Record<T, WindowHubMember>>;
  /** True on the touch HUD, where every member is a full-screen sheet and no
   *  inline position may carry between them. */
  touch(): boolean;
}

/** What a member painter takes to show the shared strip: the markup to place
 *  under its title bar, and the wiring to run after each rebuild. */
export interface WindowHubStrip {
  html(): string;
  wire(root: HTMLElement): void;
}

/** Write a carry onto the member about to be shown, BEFORE it opens, so Hud's
 *  window observer places it from these fields on show. A reset also clears
 *  the inline placement a past drag left, handing the root back to its CSS
 *  default spot. Cold: runs once per tab switch. */
function applyPositionCarry(to: HTMLElement, carry: WindowHubPositionCarry): void {
  if (carry.kind === 'set') {
    Object.assign(to.dataset, carry.fields);
    return;
  }
  for (const field of WINDOW_HUB_POSITION_FIELDS) delete to.dataset[field];
  for (const prop of ['left', 'top', 'right', 'bottom', 'transform'] as const) {
    to.style[prop] = '';
  }
}

export class WindowHubController<T extends string> {
  constructor(
    readonly spec: WindowHubSpec<T>,
    private readonly deps: WindowHubDeps<T>,
  ) {}

  /** The shown member's tab, or null when the hub is closed. */
  activeTab(): T | null {
    const members = this.deps.members();
    for (const tab of this.spec.tabs) {
      if (members[tab.id].isOpen) return tab.id;
    }
    return null;
  }

  get isOpen(): boolean {
    return this.activeTab() !== null;
  }

  /** Show the hub on `tab` (default: the remembered tab, else the hub's
   *  default). An already-shown target is re-opened in place, which repaints
   *  it (the gossip route to a different craft relies on that). */
  open(tab?: T, focusTabs = false): void {
    const target = resolveWindowHubTab(this.spec, tab, this.savedTab());
    const current = this.activeTab();
    if (current !== null && current !== target) {
      const from = this.deps.members()[current].rootElement();
      const carry = from ? windowHubPositionCarry(from.dataset, this.deps.touch()) : null;
      this.deps.members()[current].close();
      const to = this.deps.members()[target].rootElement();
      if (carry && to) applyPositionCarry(to, carry);
    }
    this.deps.members()[target].open();
    this.saveTab(target);
    if (focusTabs) {
      const root = this.deps.members()[target].rootElement();
      if (root) focusActiveTab(root, this.spec.tabClass, WINDOW_HUB_SELECTED_CLASS);
    }
  }

  /** A launcher press: see windowHubToggle for the rule. */
  toggle(tab?: T): void {
    const action = windowHubToggle(this.spec, this.activeTab(), tab, this.savedTab());
    if (action.kind === 'close') this.close();
    else this.open(action.tab);
  }

  close(): void {
    const current = this.activeTab();
    if (current !== null) this.deps.members()[current].close();
  }

  /** The strip seam a member painter is handed for its own tab. */
  stripFor(tab: T): WindowHubStrip {
    return {
      html: () => windowHubStripHtml(this.spec, tab),
      wire: (root) => {
        // Stamp the focus-carry key BEFORE the member's restore ladder runs
        // (every member wires the strip ahead of it), so a rebuild with a hub
        // tab focused lands back on that tab.
        for (const node of root.querySelectorAll<HTMLElement>(`.${this.spec.tabClass}`)) {
          node.setAttribute(
            FOCUS_KEY_ATTR,
            windowHubTabFocusKey(this.spec, node.dataset.tab ?? ''),
          );
        }
        wireTabStrip(root, this.spec.tabClass, (id, focusFollow) => {
          if (!isWindowHubTab(this.spec, id) || id === tab) return;
          this.open(id, focusFollow);
        });
      },
    };
  }

  private savedTab(): T | null {
    try {
      return parseWindowHubTab(this.spec, localStorage.getItem(this.spec.storageKey));
    } catch {
      return null;
    }
  }

  private saveTab(tab: T): void {
    try {
      localStorage.setItem(this.spec.storageKey, tab);
    } catch {
      /* storage unavailable (private mode): the hub still works this session */
    }
  }
}
