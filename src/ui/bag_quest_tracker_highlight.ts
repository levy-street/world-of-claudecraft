// Thin bag <-> quest-tracker highlight controller.
// Owns the single active highlight class on #quest-tracker .qt-title rows so
// bags_window stays a short consumer: set(questId) on hover, clear() on leave /
// tooltip hide / rebuild. Host-agnostic: the caller injects a query root (live
// document in production, a fixture node in tests). No browser globals here.
//
// Pure targeting decisions live in bag_quest_tracker_highlight_view.ts.

import { QUEST_TRACKER_BAG_HOVER_CLASS } from './bag_quest_tracker_highlight_view';

/** Minimal root surface: document, a fixture div, or any ParentNode-like. */
export interface BagQuestTrackerHighlightRoot {
  querySelector(selectors: string): {
    classList: { add(token: string): void; remove(token: string): void };
  } | null;
}

/**
 * Applies / clears QUEST_TRACKER_BAG_HOVER_CLASS on the matching tracker title.
 * At most one row is highlighted at a time.
 */
export class BagQuestTrackerHighlight {
  private active: {
    classList: { add(token: string): void; remove(token: string): void };
  } | null = null;

  constructor(private readonly root: BagQuestTrackerHighlightRoot) {}

  /** Highlight the tracker title for questId, or clear when id is absent. */
  set(questId: string | null | undefined): void {
    this.clear();
    if (!questId) return;
    const el = this.root.querySelector(trackerTitleSelector(questId));
    if (!el) return;
    el.classList.add(QUEST_TRACKER_BAG_HOVER_CLASS);
    this.active = el;
  }

  /** Drop the active highlight, if any. Safe to call when none is set. */
  clear(): void {
    if (!this.active) return;
    this.active.classList.remove(QUEST_TRACKER_BAG_HOVER_CLASS);
    this.active = null;
  }
}

/** CSS attribute selector for a tracker title row. Quest ids are [A-Za-z0-9_]+. */
export function trackerTitleSelector(questId: string): string {
  return `#quest-tracker .qt-title[data-quest="${escapeAttrSelector(questId)}"]`;
}

function escapeAttrSelector(value: string): string {
  // Keep the double-quoted attribute selector well-formed if a bad id slips in.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
