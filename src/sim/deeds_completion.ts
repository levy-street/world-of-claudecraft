// The one completion-count predicate: which deeds count toward the
// player-facing "{earned}/{total} deeds" completion pair. Every surface that
// displays a completion count consumes THIS module (the Book of Deeds header
// via src/ui/deeds_view.ts and the character-sheet API via
// server/character_sheet.ts), so exactly one definition of "deeds completed"
// exists in the game.
//
// The rules (the Book's display contract, docs/design/deeds.md):
// - Feats never count, in either the numerator or the denominator: they are a
//   trophy shelf outside completion.
// - A hidden deed is masked until earned: it joins the pair only once earned,
//   so the visible total never reveals how many secrets remain.
// - Every other deed counts, INCLUDING zero-Renown deeds (the luck and
//   collection ones). Completion and the Renown leaderboard's SCORING set are
//   different concepts by design: the board scores renown-bearing deeds only
//   and displays no completion count (server/deeds_board.ts).
// - Set nesting: every renown-bearing deed is in the completion set, because
//   every feat carries renown 0 (pinned by tests/deeds_content.test.ts), so a
//   Renown total is always earned inside the counted completion set.
//
// Pure and host-agnostic (a types-only sim import): runs unchanged in the
// browser client, the server bundle, and Node tests.

import type { DeedDef } from './types';

/** Any earned-id container with set semantics (the facet's ReadonlyMap, a
 *  plain Set in tests and on the server). */
export interface EarnedIdLookup {
  has(id: string): boolean;
}

/** True when `def` belongs in the player-facing completion pair. `earned` is
 *  whether the SELF player has earned it: an unearned hidden deed stays
 *  masked out of both sides of the pair. */
export function countsTowardCompletion(def: DeedDef, earned: boolean): boolean {
  if (def.feat === true) return false;
  if (def.hidden === true && !earned) return false;
  return true;
}

/** The completion pair over a catalog: iterates `order` (the append-only
 *  DEED_ORDER) and skips ids with no live definition, so an earned id whose
 *  content was removed never counts on any surface. */
export function completionCounts(
  earnedIds: EarnedIdLookup,
  deeds: Readonly<Record<string, DeedDef>>,
  order: readonly string[],
): { earned: number; total: number } {
  let earned = 0;
  let total = 0;
  for (const id of order) {
    const def = deeds[id];
    if (!def) continue;
    const has = earnedIds.has(id);
    if (!countsTowardCompletion(def, has)) continue;
    total++;
    if (has) earned++;
  }
  return { earned, total };
}
