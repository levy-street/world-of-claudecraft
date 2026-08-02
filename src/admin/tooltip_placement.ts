// Viewport placement for a fixed-position hover tooltip. Pure arithmetic so the
// component that anchors a tooltip stays a thin consumer: it hands over the anchor
// rect and the viewport, and gets back the CSS offsets to write.

export interface TooltipPlacement {
  /** Which side of the anchor the tooltip opens on. */
  side: 'below' | 'above';
  /** `right` offset, in px from the viewport right edge. */
  right: number;
  /** `top` (below) or `bottom` (above) offset, in px from that viewport edge. */
  offset: number;
  /**
   * The arrow's `right` offset, in px from the tooltip's own right edge. It tracks
   * whatever the edge guards did to `right`, so the arrow keeps pointing at the anchor
   * instead of at a fixed spot the clamped tooltip no longer sits under.
   */
  arrowRight: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipAnchor {
  top: number;
  bottom: number;
  right: number;
}

/** Gap between the anchor and the tooltip, matching the arrow size in the CSS. */
const GAP = 7;
/** Keeps the tooltip off the viewport edges. */
const MARGIN = 8;
/** The tooltip's CSS min-width; the widest details list wraps rather than exceeding it. */
const MIN_WIDTH = 210;
/** Room a full details list needs; below this the tooltip flips above the anchor. */
const ESTIMATED_HEIGHT = 150;
/** Where the arrow sits when nothing is clamped: inset from the tooltip's right edge. */
const ARROW_INSET = 14;
/** The arrow's rendered size, and the inset that keeps a shifted one inside the box. */
const ARROW_SIZE = 8;

export function tooltipPlacement(
  anchor: TooltipAnchor,
  viewport: TooltipViewport,
): TooltipPlacement {
  // Right-aligned on the anchor, then pulled back so a cell near the left edge does
  // not push the tooltip off screen, and never closer to the edge than the margin.
  const rightAligned = viewport.width - anchor.right;
  const widest = Math.max(MARGIN, viewport.width - MIN_WIDTH - MARGIN);
  const right = Math.min(Math.max(rightAligned, MARGIN), widest);

  // Whatever those guards took off `right`, the arrow gives back, so it still points
  // at the anchor; the clamp keeps it inside a tooltip at its min-width.
  const arrowRight = Math.min(
    Math.max(ARROW_INSET + rightAligned - right, ARROW_SIZE),
    MIN_WIDTH - ARROW_SIZE - ARROW_SIZE,
  );

  const roomBelow = viewport.height - anchor.bottom;
  if (roomBelow >= ESTIMATED_HEIGHT + GAP) {
    return { side: 'below', right, arrowRight, offset: anchor.bottom + GAP };
  }
  return { side: 'above', right, arrowRight, offset: viewport.height - anchor.top + GAP };
}
