// Pure tab model for the Professions hub (menu consolidation step 1,
// 2026-11-04): the four professions windows (Overview, Crafting, Perfecting,
// Harvest Journal) read as ONE tabbed Professions window behind one launcher.
//
// The four windows keep their ids, painters, focus traps, close routing and
// cold drivers (the Perfecting and Harvest Journal 1 Hz clocks run only while
// their own root is shown). The hub is a tab GROUP over them: exactly one
// member is shown at a time, every member paints this one shared tab strip
// under its title bar, and a tab switch hides the current member and shows
// the next one at the same requested position. This module owns every
// decision in that flow so a Vitest pins it without a DOM: the tab set and
// labels, the last-tab memory (per device, the crafting_tab_pref.ts
// precedent), which tab an open lands on, what a toggle does, and which
// position fields carry across a switch.

import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import { type TabStripModel, tabStripHtml, tabStripModel } from '../../tab_strip_view';

export type ProfessionsHubTab = 'overview' | 'crafting' | 'perfecting' | 'harvest';

export interface ProfessionsHubTabDef {
  readonly id: ProfessionsHubTab;
  readonly labelKey: TranslationKey;
}

/** Strip order is the reading order of the system: who you are, what you
 *  make, the endgame track, then the farm beds. The three absorbed windows
 *  label their tabs with their own former window titles (already localized
 *  everywhere); only Overview is a new label. */
export const PROFESSIONS_HUB_TABS: readonly ProfessionsHubTabDef[] = [
  { id: 'overview', labelKey: 'hudChrome.professionsHub.tabOverview' },
  { id: 'crafting', labelKey: 'hudChrome.crafting.title' },
  { id: 'perfecting', labelKey: 'hudChrome.perfecting.title' },
  { id: 'harvest', labelKey: 'hudChrome.harvestJournal.title' },
];

export const PROFESSIONS_HUB_DEFAULT_TAB: ProfessionsHubTab = 'overview';

/** localStorage key for the last tab this device opened. */
export const PROFESSIONS_HUB_TAB_KEY = 'woc.professionsHub.tab';

export function isProfessionsHubTab(value: unknown): value is ProfessionsHubTab {
  return typeof value === 'string' && PROFESSIONS_HUB_TABS.some((tab) => tab.id === value);
}

/** A stored value is trusted only when it names a live tab; anything else
 *  (absent, a renamed tab, junk) reads as no preference. */
export function parseProfessionsHubTab(raw: string | null | undefined): ProfessionsHubTab | null {
  return isProfessionsHubTab(raw) ? raw : null;
}

/** The tab a plain open lands on: the caller's explicit tab, else the
 *  remembered one, else Overview. */
export function resolveProfessionsHubTab(
  requested: ProfessionsHubTab | undefined,
  saved: ProfessionsHubTab | null,
): ProfessionsHubTab {
  return requested ?? saved ?? PROFESSIONS_HUB_DEFAULT_TAB;
}

export type ProfessionsHubToggle =
  | { readonly kind: 'close' }
  | { readonly kind: 'open'; readonly tab: ProfessionsHubTab };

/**
 * What a launcher press does. `active` is the shown member (null when the hub
 * is closed). A plain press (no tab: the rail button, Shift+P) closes an open
 * hub whatever its tab. A tab-specific press (T for Crafting, a rebound
 * Perfecting or Harvest Journal key) closes only when that tab is already the
 * shown one and otherwise switches to it, so T over an open Overview lands
 * on Crafting instead of closing the window.
 */
export function professionsHubToggle(
  active: ProfessionsHubTab | null,
  requested: ProfessionsHubTab | undefined,
  saved: ProfessionsHubTab | null,
): ProfessionsHubToggle {
  if (active !== null && (requested === undefined || requested === active)) {
    return { kind: 'close' };
  }
  return { kind: 'open', tab: resolveProfessionsHubTab(requested, saved) };
}

export const PROFESSIONS_HUB_TAB_CLASS = 'prof-hub-tab';
export const PROFESSIONS_HUB_SELECTED_CLASS = 'is-on';

/** The shared strip model, labels resolved at paint time (a language switch
 *  repaints every member through its own relocalize arm). */
export function professionsHubStripModel(
  active: ProfessionsHubTab,
): TabStripModel<ProfessionsHubTab> {
  return tabStripModel<ProfessionsHubTab>({
    ariaLabel: t('hudChrome.professions.title'),
    stripClass: 'prof-hub-tabs ui-tabs',
    tabClass: `${PROFESSIONS_HUB_TAB_CLASS} ui-tab`,
    selectedClass: PROFESSIONS_HUB_SELECTED_CLASS,
    tabs: PROFESSIONS_HUB_TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey) })),
    selected: active,
  });
}

export function professionsHubStripHtml(active: ProfessionsHubTab): string {
  return tabStripHtml(professionsHubStripModel(active));
}

/** The dataset fields that make a window reopen where it was
 *  (window_reflow.ts rememberWindowPos plus the moved flag the open cascade
 *  honours). */
export const PROFESSIONS_HUB_POSITION_FIELDS = [
  'reqLeft',
  'reqTop',
  'reqVw',
  'reqVh',
  'windowMoved',
] as const;

/**
 * The position a tab switch hands from the member being hidden to the one
 * being shown, so the hub reads as one window that changed its page rather
 * than a new window cascading elsewhere. Null when there is nothing to carry:
 * on touch every member is a full-screen sheet (an inline position would
 * break that layout), and a member that was never placed leaves the next one
 * to the normal open cascade.
 */
export function professionsHubPositionCarry(
  from: Readonly<Record<string, string | undefined>>,
  touch: boolean,
): Record<string, string> | null {
  if (touch || from.windowMoved !== '1') return null;
  const carry: Record<string, string> = {};
  for (const field of PROFESSIONS_HUB_POSITION_FIELDS) {
    const value = from[field];
    if (value === undefined) return null;
    carry[field] = value;
  }
  return carry;
}
