// Pure, DOM-free tab-strip model + markup builder: the WAI-ARIA tabs markup
// (role=tablist/tab, aria-selected, roving tabindex) that social_window.ts,
// market_window.ts, talents_window.ts, daily_rewards_window.ts, and
// mailbox_window.ts each hand-rolled independently (market/mailbox use a
// different toggle-button pattern, not real WAI-ARIA tabs, so they are out of
// scope for this core). This is the first migration onto a shared building
// block; the keyboard-navigation half of the duplication already lives in the
// shared roving_index.ts core, which a caller composes with wireTabStrip
// (tab_strip_painter.ts) separately.
//
// Kept deliberately generic so every real WAI-ARIA tab strip in the HUD can
// compose it, not just the social panel's plain-label buttons:
// - `tag` supports a `<div role="tab">` strip (talents_window's pattern) as
//   well as the default `<button>`.
// - `extraHtml` lets a tab carry more than a label (talents_window appends a
//   spent-points badge after the tab name). It is trusted markup the caller
//   already escaped/built, exactly like the rest of this HUD's HTML-string
//   convention: never pass raw player/server text here directly.
// - `buttonId` + an omitted `panelId` support a strip whose panel points back
//   at the tab via `aria-labelledby` instead of the strip driving
//   `aria-controls` (daily_rewards_window's woc-store tabs).
//
// Callers pass already-localized labels: this core stays i18n-free like every
// other UI_PURE_CORES entry, so it never calls t() itself.

import { esc } from './esc';

export type TabStripTag = 'button' | 'div';

export interface TabStripTab<Id extends string = string> {
  id: Id;
  label: string;
  /** Extra markup appended after the escaped label (e.g. a badge). Trusted, pre-built HTML. */
  extraHtml?: string;
  /** Stable element id for this tab, for a panel's aria-labelledby to reference. */
  buttonId?: string;
}

export interface TabStripDescriptor<Id extends string = string> {
  /** aria-label on the role=tablist wrapper. */
  ariaLabel: string;
  /** id of the role=tabpanel this strip's tabs point aria-controls at; omit to skip aria-controls. */
  panelId?: string;
  /** Class on the role=tablist wrapper (e.g. 'soc-tabs'). */
  stripClass: string;
  /** Class on every tab (e.g. 'soc-tab'). */
  tabClass: string;
  /** Class added to the selected tab on top of tabClass (e.g. 'on'). */
  selectedClass: string;
  /** Element tag for each tab: 'button' (default) or 'div' (talents_window's pattern). */
  tag?: TabStripTag;
  tabs: TabStripTab<Id>[];
  selected: Id;
}

export interface TabStripModelTab<Id extends string = string> {
  id: Id;
  label: string;
  extraHtml: string;
  buttonId: string | undefined;
  selected: boolean;
}

export interface TabStripModel<Id extends string = string> {
  ariaLabel: string;
  panelId: string | undefined;
  stripClass: string;
  tabClass: string;
  selectedClass: string;
  tag: TabStripTag;
  tabs: TabStripModelTab<Id>[];
}

export function tabStripModel<Id extends string>(d: TabStripDescriptor<Id>): TabStripModel<Id> {
  return {
    ariaLabel: d.ariaLabel,
    panelId: d.panelId,
    stripClass: d.stripClass,
    tabClass: d.tabClass,
    selectedClass: d.selectedClass,
    tag: d.tag ?? 'button',
    tabs: d.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      extraHtml: tab.extraHtml ?? '',
      buttonId: tab.buttonId,
      selected: tab.id === d.selected,
    })),
  };
}

// The role=tablist markup for a model: one tab per entry with aria-selected +
// a roving tabindex (0 on the selected tab, -1 on the rest), matching the
// hand-rolled markup social_window.ts replaced byte-for-byte.
export function tabStripHtml<Id extends string>(m: TabStripModel<Id>): string {
  const tab = (t: TabStripModelTab<Id>): string => {
    const typeAttr = m.tag === 'button' ? ' type="button"' : '';
    const idAttr = t.buttonId ? ` id="${esc(t.buttonId)}"` : '';
    const controlsAttr = m.panelId ? ` aria-controls="${esc(m.panelId)}"` : '';
    return (
      `<${m.tag}${typeAttr}${idAttr} class="${m.tabClass} ${t.selected ? m.selectedClass : ''}" ` +
      `data-tab="${esc(t.id)}" role="tab" aria-selected="${t.selected ? 'true' : 'false'}" ` +
      `tabindex="${t.selected ? '0' : '-1'}"${controlsAttr}>${esc(t.label)}${t.extraHtml}</${m.tag}>`
    );
  };
  return (
    `<div class="${m.stripClass}" role="tablist" aria-label="${esc(m.ariaLabel)}">` +
    `${m.tabs.map(tab).join('')}</div>`
  );
}
