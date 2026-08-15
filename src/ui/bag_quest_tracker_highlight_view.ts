// Pure, host-agnostic core for bag-hover -> quest-tracker highlight targeting.
// Hovering a quest stack should gently light the matching tracker title row
// (#quest-tracker .qt-title[data-quest="..."]). This module only decides WHETHER
// a stack has a highlight target and which CSS class the thin DOM helper applies;
// it never touches the document.
//
// The highlight is information-ADD and always-on (no --fx / graphics-tier gate).
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

/** Class toggled on the matching tracker title while a bag quest stack is hovered. */
export const QUEST_TRACKER_BAG_HOVER_CLASS = 'qt-bag-hover';

/**
 * The quest id to highlight on the tracker for this bag item, or null when the
 * stack is not a quest kind or has no questId. Empty strings do not highlight.
 */
export function bagQuestTrackerHighlightId(item: {
  kind: string;
  questId?: string | null;
}): string | null {
  if (item.kind !== 'quest') return null;
  const id = item.questId;
  if (typeof id !== 'string' || id.length === 0) return null;
  return id;
}
