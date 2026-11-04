// The Professions hub's DOM half (menu consolidation step 1): the tab group
// over the four professions windows. Every decision (which tab, what a
// launcher press does, which position fields carry) lives in the pure
// professions_hub_view.ts; this controller applies them to the members.
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

import { focusActiveTab, wireTabStrip } from '../../tab_strip_painter';
import {
  isProfessionsHubTab,
  PROFESSIONS_HUB_SELECTED_CLASS,
  PROFESSIONS_HUB_TAB_CLASS,
  PROFESSIONS_HUB_TAB_KEY,
  PROFESSIONS_HUB_TABS,
  type ProfessionsHubTab,
  parseProfessionsHubTab,
  professionsHubPositionCarry,
  professionsHubStripHtml,
  professionsHubToggle,
  resolveProfessionsHubTab,
} from './professions_hub_view';

/** A member window as the hub sees it: the existing window class's own
 *  surface (isOpen/open/close) plus the root the tab position carries onto
 *  (minted on first reach where the window mints its own). */
export interface ProfessionsHubMember {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  rootElement(): HTMLElement | null;
}

export interface ProfessionsHubDeps {
  /** The four members, read FRESH on every use (a thunk, so the coordinator
   *  can build the hub before the windows it groups, and so a member whose
   *  isOpen is a computed field is never read stale). */
  members(): Readonly<Record<ProfessionsHubTab, ProfessionsHubMember>>;
  /** True on the touch HUD, where every member is a full-screen sheet and no
   *  inline position may carry between them. */
  touch(): boolean;
}

/** What a member painter takes to show the shared strip: the markup to place
 *  under its title bar, and the wiring to run after each rebuild. */
export interface ProfessionsHubStrip {
  html(): string;
  wire(root: HTMLElement): void;
}

export class ProfessionsHubController {
  constructor(private readonly deps: ProfessionsHubDeps) {}

  /** The shown member's tab, or null when the hub is closed. */
  activeTab(): ProfessionsHubTab | null {
    for (const tab of PROFESSIONS_HUB_TABS) {
      if (this.deps.members()[tab.id].isOpen) return tab.id;
    }
    return null;
  }

  get isOpen(): boolean {
    return this.activeTab() !== null;
  }

  /** Show the hub on `tab` (default: the remembered tab, else Overview). An
   *  already-shown target is re-opened in place, which repaints it (the
   *  gossip route to a different craft relies on that). */
  open(tab?: ProfessionsHubTab, focusTabs = false): void {
    const target = resolveProfessionsHubTab(tab, this.savedTab());
    const current = this.activeTab();
    if (current !== null && current !== target) {
      const from = this.deps.members()[current].rootElement();
      const carry = from ? professionsHubPositionCarry(from.dataset, this.deps.touch()) : null;
      this.deps.members()[current].close();
      const to = this.deps.members()[target].rootElement();
      if (carry && to) Object.assign(to.dataset, carry);
    }
    this.deps.members()[target].open();
    this.saveTab(target);
    if (focusTabs) {
      const root = this.deps.members()[target].rootElement();
      if (root) focusActiveTab(root, PROFESSIONS_HUB_TAB_CLASS, PROFESSIONS_HUB_SELECTED_CLASS);
    }
  }

  /** A launcher press: see professionsHubToggle for the rule. */
  toggle(tab?: ProfessionsHubTab): void {
    const action = professionsHubToggle(this.activeTab(), tab, this.savedTab());
    if (action.kind === 'close') this.close();
    else this.open(action.tab);
  }

  close(): void {
    const current = this.activeTab();
    if (current !== null) this.deps.members()[current].close();
  }

  /** The strip seam a member painter is handed for its own tab. */
  stripFor(tab: ProfessionsHubTab): ProfessionsHubStrip {
    return {
      html: () => professionsHubStripHtml(tab),
      wire: (root) =>
        wireTabStrip(root, PROFESSIONS_HUB_TAB_CLASS, (id, focusFollow) => {
          if (!isProfessionsHubTab(id) || id === tab) return;
          this.open(id, focusFollow);
        }),
    };
  }

  private savedTab(): ProfessionsHubTab | null {
    try {
      return parseProfessionsHubTab(localStorage.getItem(PROFESSIONS_HUB_TAB_KEY));
    } catch {
      return null;
    }
  }

  private saveTab(tab: ProfessionsHubTab): void {
    try {
      localStorage.setItem(PROFESSIONS_HUB_TAB_KEY, tab);
    } catch {
      /* storage unavailable (private mode): the hub still works this session */
    }
  }
}
