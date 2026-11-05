// Pure tab model for a window hub (menu consolidation, 2026-11-04): several
// existing windows read as ONE tabbed window behind one launcher. Instances:
// the Professions hub, the Book of the Realm and Activities.
//
// The member windows keep their ids, painters, focus traps, close routing and
// cold drivers. A hub is a tab GROUP over them: exactly one member is shown at
// a time, every member paints one shared tab strip under its title bar, and a
// tab switch hides the current member and shows the next one at the same
// requested position. This module owns every decision in that flow so a
// Vitest pins it without a DOM: the tab set and labels, the last-tab memory
// (per device, the crafting_tab_pref.ts precedent), which tab an open lands
// on, what a toggle does, and which position fields carry across a switch.

import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import { type TabStripModel, tabStripHtml, tabStripModel } from '../../tab_strip_view';

export interface WindowHubTabDef<T extends string> {
  readonly id: T;
  readonly labelKey: TranslationKey;
}

/** Everything that tells one hub from another. */
export interface WindowHubSpec<T extends string> {
  /** Strip order. */
  readonly tabs: readonly WindowHubTabDef<T>[];
  readonly defaultTab: T;
  /** localStorage key for the last tab this device opened. */
  readonly storageKey: string;
  /** The hub's title: the tablist's accessible name, and the title every
   *  member shows while it is a tab of the hub. */
  readonly ariaLabelKey: TranslationKey;
  /** Every member's close button names the whole hub. */
  readonly closeKey: TranslationKey;
  /** Hub-specific strip class (spacing hooks); `ui-tabs` is always added. */
  readonly stripClass: string;
  /** Hub-specific tab class, the one the wiring and focus queries select on;
   *  `ui-tab` is always added. */
  readonly tabClass: string;
  /** Prefix of the focus-carry key stamped on every tab. */
  readonly focusPrefix: string;
}

export const WINDOW_HUB_SELECTED_CLASS = 'is-on';

export function isWindowHubTab<T extends string>(
  spec: WindowHubSpec<T>,
  value: unknown,
): value is T {
  return typeof value === 'string' && spec.tabs.some((tab) => tab.id === value);
}

/** A stored value is trusted only when it names a live tab; anything else
 *  (absent, a renamed tab, junk) reads as no preference. */
export function parseWindowHubTab<T extends string>(
  spec: WindowHubSpec<T>,
  raw: string | null | undefined,
): T | null {
  return isWindowHubTab(spec, raw) ? raw : null;
}

/** The tab a plain open lands on: the caller's explicit tab, else the
 *  remembered one, else the hub's default. */
export function resolveWindowHubTab<T extends string>(
  spec: WindowHubSpec<T>,
  requested: T | undefined,
  saved: T | null,
): T {
  return requested ?? saved ?? spec.defaultTab;
}

export type WindowHubToggle<T extends string> =
  | { readonly kind: 'close' }
  | { readonly kind: 'open'; readonly tab: T };

/**
 * What a launcher press does. `active` is the shown member (null when the hub
 * is closed). A plain press (no tab: the rail button, the hub's key) closes an
 * open hub whatever its tab. A tab-specific press (T for Crafting, G for PvP)
 * closes only when that tab is already the shown one and otherwise switches
 * to it, so T over an open Overview lands on Crafting instead of closing.
 */
export function windowHubToggle<T extends string>(
  spec: WindowHubSpec<T>,
  active: T | null,
  requested: T | undefined,
  saved: T | null,
): WindowHubToggle<T> {
  if (active !== null && (requested === undefined || requested === active)) {
    return { kind: 'close' };
  }
  return { kind: 'open', tab: resolveWindowHubTab(spec, requested, saved) };
}

/** The focus-carry identity of a hub tab (focus_restore.ts): a member that
 *  rebuilds while a hub tab holds keyboard focus finds the same tab again by
 *  this key instead of dropping focus to the body. */
export function windowHubTabFocusKey<T extends string>(
  spec: WindowHubSpec<T>,
  tab: string,
): string {
  return `${spec.focusPrefix}:${tab}`;
}

/** The shared strip model, labels resolved at paint time (a language switch
 *  repaints every member through its own relocalize arm). */
export function windowHubStripModel<T extends string>(
  spec: WindowHubSpec<T>,
  active: T,
): TabStripModel<T> {
  return tabStripModel<T>({
    ariaLabel: t(spec.ariaLabelKey),
    stripClass: `${spec.stripClass} window-hub-tabs ui-tabs`,
    tabClass: `${spec.tabClass} window-hub-tab ui-tab`,
    selectedClass: WINDOW_HUB_SELECTED_CLASS,
    tabs: spec.tabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) })),
    selected: active,
  });
}

export function windowHubStripHtml<T extends string>(spec: WindowHubSpec<T>, active: T): string {
  return tabStripHtml(windowHubStripModel(spec, active));
}

/** The dataset fields that make a window reopen where it was
 *  (window_reflow.ts rememberWindowPos plus the moved flag the open cascade
 *  honours). */
export const WINDOW_HUB_POSITION_FIELDS = [
  'reqLeft',
  'reqTop',
  'reqVw',
  'reqVh',
  'windowMoved',
] as const;

export type WindowHubPositionCarry =
  | { readonly kind: 'set'; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'reset' };

/**
 * The position a tab switch hands from the member being hidden to the one
 * being shown, so the hub reads as one window that changed its page rather
 * than a new window appearing elsewhere.
 * - A placed member (dragged, or placed by the open cascade) hands over its
 *   remembered position fields.
 * - An unplaced member sits at the default spot, so the next member is RESET
 *   to the default too: otherwise a tab the player once dragged would jump
 *   back to that old spot on a switch.
 * - Null on touch: every member is a full-screen sheet there and an inline
 *   position would break that layout.
 */
export function windowHubPositionCarry(
  from: Readonly<Record<string, string | undefined>>,
  touch: boolean,
): WindowHubPositionCarry | null {
  if (touch) return null;
  if (from.windowMoved !== '1') return { kind: 'reset' };
  const fields: Record<string, string> = {};
  for (const field of WINDOW_HUB_POSITION_FIELDS) {
    const value = from[field];
    if (value === undefined) return { kind: 'reset' };
    fields[field] = value;
  }
  return { kind: 'set', fields };
}
