// Pure, host-agnostic core for the bag grid's corner-mark and rim-class
// decisions. Three sibling cores each answer one question about a stack
// (bag_instance_glyph_view: which per-copy glyph; bag_quest_mark_view: quest
// purpose; bag_fine_mark_view: fine grade), and the priority that composes
// them used to live as interlocking booleans inside the bags_window painter,
// where the ordering was only reachable through a jsdom DOM test. This module
// owns that composition so the priority table is unit-testable directly and a
// future mark edits one place.
//
// Corner priority (exactly one corner treatment ever renders):
//   masterwork > quest seal > fine seal > enchanted / signed / bound > generic.
//
// Rim priority: purpose outranks grade. A quest stack wears the quest-gold
// rim/wash and NEVER .bag-fine, so the two rim rules can never compete in the
// cascade (their CSS source order is not load-bearing). No fine id is
// quest-kind in shipped content; the guard keeps the hierarchy stated in code
// rather than leaning on stylesheet order if that ever changes.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { BagInstanceGlyphKind } from './bag_instance_glyph_view';
import type { BagQuestMarkKind } from './bag_quest_mark_view';

/** The single corner treatment one bag cell renders, or null for none. */
export type BagCornerMark =
  | 'masterwork'
  | 'quest'
  | 'fine'
  | 'enchanted'
  | 'signed'
  | 'bound'
  | 'generic'
  | null;

/** Which corner treatment wins the cell's top-left corner. Masterwork keeps
 *  its authored seal over everything; quest purpose outranks the fine grade;
 *  the fine seal outranks every remaining per-copy glyph and the generic
 *  wedge. Rim/wash classes are decided separately (bagRimClasses): a fine
 *  stack keeps its rim even when the masterwork seal wins the corner. */
export function bagCornerMark(
  glyphKind: BagInstanceGlyphKind,
  questMark: BagQuestMarkKind,
  fineMark: boolean,
): BagCornerMark {
  if (glyphKind === 'masterwork') return 'masterwork';
  if (questMark !== null) return 'quest';
  if (fineMark) return 'fine';
  return glyphKind;
}

/** The rim/wash classes for one bag cell, leading-space-prefixed for direct
 *  className concatenation, or '' for none. Purpose outranks grade: a quest
 *  stack never also wears .bag-fine, so the quest and fine rim rules can
 *  never meet in the cascade. */
export function bagRimClasses(questMark: BagQuestMarkKind, fineMark: boolean): string {
  if (questMark !== null) {
    return questMark === 'questReady' ? ' bag-quest bag-quest-ready' : ' bag-quest';
  }
  return fineMark ? ' bag-fine' : '';
}
