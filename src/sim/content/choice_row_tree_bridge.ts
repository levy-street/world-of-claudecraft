// ---------------------------------------------------------------------------
// Bridge: pre-overhaul choice-row content -> reworked row-tree model.
//
// The warrior overhaul introduced the RowTree model (talent_rows.ts) but only
// authored a tree for the warrior, so every other class lost its Choices tab
// (the window renders rows only when rowTreeFor(cls) returns a tree). The full
// per-class row content still lives, authored and translated, in the OLD model
// (CHOICE_ROWS, choice_rows.ts). This module converts each ClassChoiceRows into
// a RowTree so all ten classes render (and pick from) the new Choices tab.
//
// Pure, lossless where it matters: rows map in level order (5/8/11/14/17/20),
// options 1:1 keeping id, name, description, and the effect OBJECT REFERENCE
// (same TalentEffect the old fold reads, so behavior is identical either way).
// Strings pass through unchanged so the name-keyed talent i18n matchers keep
// matching. The old model's `theme` and `icon` fields have no RowTree
// counterpart and are dropped: the Choices tab derives its icons from the
// effect (talent_icons.ts talentEffectIconRef).
//
// A malformed source (a class missing one of the six levels) converts to a
// short row that validateRowTree flags, so the registry's import-time
// validation loop in talent_rows.ts still fails loudly rather than silently.
// ---------------------------------------------------------------------------

import type { PlayerClass } from '../types';
import { CHOICE_ROW_LEVELS, CHOICE_ROWS, type ClassChoiceRows } from './choice_rows';
import type { ChoiceRow, RowTree } from './talent_rows';

/** Convert one class's old-model rows into a new-model RowTree. */
export function bridgeClassChoiceRows(classRows: ClassChoiceRows): RowTree {
  return CHOICE_ROW_LEVELS.map((level): ChoiceRow => {
    const row = classRows.rows.find((r) => r.level === level);
    return {
      level,
      options: (row?.options ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        effect: o.effect,
      })),
    };
  });
}

/** Every old-model class converted; the ROW_TREES registry spreads this under
 *  its authored entries (authored trees win, e.g. the warrior's). */
export function bridgedRowTrees(): Partial<Record<PlayerClass, RowTree>> {
  const out: Partial<Record<PlayerClass, RowTree>> = {};
  for (const [cls, classRows] of Object.entries(CHOICE_ROWS)) {
    out[cls as PlayerClass] = bridgeClassChoiceRows(classRows);
  }
  return out;
}
