// Pure content-type filter for the Groups board: which listings the browse
// column shows. DOM-free and i18n-free; the board chrome localizes the labels.
import type { FinderActivityKind } from '../sim/content/dungeon_finder';

export type BoardContentFilter = 'all' | 'dungeon' | 'raid';

export const BOARD_CONTENT_FILTERS: readonly BoardContentFilter[] = ['all', 'dungeon', 'raid'];

export function isBoardContentFilter(value: unknown): value is BoardContentFilter {
  return (BOARD_CONTENT_FILTERS as readonly unknown[]).includes(value);
}

/** 'all' keeps every row (solo social listings included); a kind keeps only that kind. */
export function filterBoardListings<T extends { kind: FinderActivityKind }>(
  rows: readonly T[],
  filter: BoardContentFilter,
): T[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.kind === filter);
}
