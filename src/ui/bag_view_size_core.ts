// The bag window's view size: how much screen the grid takes and how much each
// cell says without a hover. Pure, DOM-free (registered in UI_PURE_CORES), so a
// Vitest drives the parse and the class mapping directly; bags_window.ts is the
// thin consumer that owns the control, the localStorage key, and the grid class.
//
// - 'compact' is the classic small socket grid, the shipped look and the default,
//   so a player who never touches the control sees nothing change.
// - 'large' is the same grid at a larger socket, for a big screen or tired eyes.
// - 'list' turns every stack into a row with its name beside the icon, so a
//   player can read the bag instead of hovering each square (the "I cannot find
//   what I am looking for" report). Empty squares are not drawn as rows: a list
//   of blanks is noise, and the capacity counter already states free space.
//
// The size is presentation only: it never changes which stacks show, their
// order, or which cell a drop lands in (the grid keeps its real cell indices).

export const BAG_VIEW_SIZES = ['compact', 'large', 'list'] as const;
export type BagViewSize = (typeof BAG_VIEW_SIZES)[number];

export const DEFAULT_BAG_VIEW_SIZE: BagViewSize = 'compact';

/** Tolerant parse of the persisted value: anything unknown (an old build's
 *  value, a hand-edited key, private-mode null) falls back to the default, so a
 *  bad stored value can never break the bag. */
export function parseBagViewSize(raw: string | null | undefined): BagViewSize {
  return (BAG_VIEW_SIZES as readonly string[]).includes(raw ?? '')
    ? (raw as BagViewSize)
    : DEFAULT_BAG_VIEW_SIZE;
}

/** The class the painter stamps on `.bag-grid`; the stylesheet keys every size
 *  rule off it (src/styles/components.css, "Bag view size"). */
export function bagViewSizeClass(size: BagViewSize): string {
  return `bag-size-${size}`;
}
