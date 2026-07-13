// Pure fit-to-view math for the talents tree on a mobile landscape phone
// (issue 1577 char/talents redo): the tree's node/arrow layout is a fixed
// pixel grid (talents_window.ts sets .tal-tree's width/height from the view
// model), so the only way to show a whole tree without scrolling on a short
// landscape viewport is to scale it down to fit the space actually available.
// DOM-free so a Vitest can pin the floor/ceiling behavior directly.

/** The smallest scale we'll go to before the nodes become unreadable/untappable;
 *  below this, an internal scroll is the lesser evil. */
const MIN_READABLE_SCALE = 0.42;

export function talentTreeFitScale(
  treeWidth: number,
  treeHeight: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (treeWidth <= 0 || treeHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) return 1;
  const scale = Math.min(availableWidth / treeWidth, availableHeight / treeHeight, 1);
  return Math.max(scale, MIN_READABLE_SCALE);
}
