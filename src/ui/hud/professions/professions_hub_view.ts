// The Professions hub (menu consolidation step 1, 2026-11-04): the four
// professions windows (Overview, Crafting, Perfecting, Harvest Journal) read
// as ONE tabbed Professions window behind one launcher. The tab-group rules
// are the shared window hub's (../hub/window_hub_view.ts); this module is the
// hub's spec plus the professions-named entry points its callers and tests
// use.

import type { TabStripModel } from '../../tab_strip_view';
import {
  isWindowHubTab,
  parseWindowHubTab,
  resolveWindowHubTab,
  WINDOW_HUB_POSITION_FIELDS,
  WINDOW_HUB_SELECTED_CLASS,
  type WindowHubPositionCarry,
  type WindowHubSpec,
  type WindowHubTabDef,
  type WindowHubToggle,
  windowHubPositionCarry,
  windowHubStripHtml,
  windowHubStripModel,
  windowHubTabFocusKey,
  windowHubToggle,
} from '../hub/window_hub_view';

export type ProfessionsHubTab = 'overview' | 'crafting' | 'perfecting' | 'harvest';
export type ProfessionsHubTabDef = WindowHubTabDef<ProfessionsHubTab>;

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
export const PROFESSIONS_HUB_TAB_KEY = 'woc.professionsHub.tab';
export const PROFESSIONS_HUB_TAB_CLASS = 'prof-hub-tab';
export const PROFESSIONS_HUB_SELECTED_CLASS = WINDOW_HUB_SELECTED_CLASS;
export const PROFESSIONS_HUB_POSITION_FIELDS = WINDOW_HUB_POSITION_FIELDS;

export const PROFESSIONS_HUB: WindowHubSpec<ProfessionsHubTab> = {
  tabs: PROFESSIONS_HUB_TABS,
  defaultTab: PROFESSIONS_HUB_DEFAULT_TAB,
  storageKey: PROFESSIONS_HUB_TAB_KEY,
  ariaLabelKey: 'hudChrome.professions.title',
  closeKey: 'hudChrome.professions.close',
  stripClass: 'prof-hub-tabs',
  tabClass: PROFESSIONS_HUB_TAB_CLASS,
  focusPrefix: 'profHub',
};

export type ProfessionsHubToggle = WindowHubToggle<ProfessionsHubTab>;
export type ProfessionsHubPositionCarry = WindowHubPositionCarry;

export function isProfessionsHubTab(value: unknown): value is ProfessionsHubTab {
  return isWindowHubTab(PROFESSIONS_HUB, value);
}

export function parseProfessionsHubTab(raw: string | null | undefined): ProfessionsHubTab | null {
  return parseWindowHubTab(PROFESSIONS_HUB, raw);
}

export function resolveProfessionsHubTab(
  requested: ProfessionsHubTab | undefined,
  saved: ProfessionsHubTab | null,
): ProfessionsHubTab {
  return resolveWindowHubTab(PROFESSIONS_HUB, requested, saved);
}

export function professionsHubToggle(
  active: ProfessionsHubTab | null,
  requested: ProfessionsHubTab | undefined,
  saved: ProfessionsHubTab | null,
): ProfessionsHubToggle {
  return windowHubToggle(PROFESSIONS_HUB, active, requested, saved);
}

export function professionsHubTabFocusKey(tab: string): string {
  return windowHubTabFocusKey(PROFESSIONS_HUB, tab);
}

export function professionsHubStripModel(
  active: ProfessionsHubTab,
): TabStripModel<ProfessionsHubTab> {
  return windowHubStripModel(PROFESSIONS_HUB, active);
}

export function professionsHubStripHtml(active: ProfessionsHubTab): string {
  return windowHubStripHtml(PROFESSIONS_HUB, active);
}

export const professionsHubPositionCarry = windowHubPositionCarry;
