// The shared #tooltip box's placement math: where the box goes for a pointer
// (or an element anchor), where it goes when it is corner-anchored instead, and
// how tall it may be in either case. Extracted from Hud.paintTooltipAt and
// attachTooltip's mousemove path (the Masterwrought Phase 18 sweep), which each
// clamped the left edge and the top edge and neither clamped the bottom: a tall
// tooltip near the top of the screen (a long item card on a 720px laptop) ran
// off the bottom, and the mousemove path additionally let the box's left edge go
// negative on a narrow viewport because it lacked the paint path's left floor.
//
// Hud.paintMobTooltipBottomRight joined at that phase's review round
// (mobTooltipCornerPlacement below). ONE box serves all three paths, so the
// height cap belongs to the module rather than to a path: the mob path never
// wrote one, which left it painting under whatever cap the last cursor tooltip
// computed, stale the moment the viewport resized.
//
// Coordinates: the pointer arrives in VISUAL (zoomed) space; the box is laid
// out in AUTHOR space (offsetWidth/Height are zoom-immune), so the pointer is
// mapped into author space (divided by the UI scale) before the clamp, and the
// result is author-space `left`/`top` for the box's own style. Both clamps
// resolve floor-last: when the box is taller or wider than the viewport allows,
// the top-left corner stays on screen and the overflow falls off the far edge,
// where tooltipMaxHeight (applied before the measure) caps the height so the
// far edge is the only place a cap can ever land.
//
// DOM-free and deterministic (registered in tests/architecture.test.ts
// UI_PURE_CORES): pure arithmetic over the numbers the caller measured.

/** Author-space px kept clear of every viewport edge. */
export const TOOLTIP_EDGE_GAP = 8;
/** The box's left edge sits this far right of the pointer. */
export const TOOLTIP_POINTER_DX = 14;
/** The box's bottom edge sits this far above the pointer. */
export const TOOLTIP_POINTER_DY = 10;
// The mob-hover tooltip's fixed desktop bottom-right slot (the WoW default
// GameTooltip corner), in author-space px: the right margin clears the sidebar
// icon rail, the bottom margin the community-links row, both fixed right-edge
// chrome. Touch uses the slot immediately left of the minimap instead so it does
// not cover the bottom action controls.
export const MOB_TOOLTIP_MARGIN_RIGHT = 56;
export const MOB_TOOLTIP_MARGIN_BOTTOM = 60;
export const MOB_TOOLTIP_MOBILE_MINIMAP_GAP = 8;
export const MOB_TOOLTIP_MOBILE_EDGE_GAP = 8;

export interface TooltipBox {
  /** Author-space width, the measured offsetWidth. */
  w: number;
  /** Author-space height, the measured offsetHeight. */
  h: number;
}

export interface TooltipViewport {
  /** Visual-space viewport width (window.innerWidth). */
  w: number;
  /** Visual-space viewport height (window.innerHeight). */
  h: number;
  /** The UI scale (getUiScale()): author px times scale is visual px. */
  scale: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
}

/** The tallest the box may be (author px) and still fit between the top and
 *  bottom edge gaps; applied as max-height BEFORE the box is measured so the
 *  measured height already reflects the cap. Never negative. */
export function tooltipMaxHeight(viewport: TooltipViewport): number {
  return Math.max(0, viewport.h / viewport.scale - 2 * TOOLTIP_EDGE_GAP);
}

/** The minimap's visual-space top-left, the anchor the touch tier parks the
 *  mob tooltip beside. Only the two edges the placement reads. */
export interface MobTooltipAnchorRect {
  left: number;
  top: number;
}

/** Author-space top-left for the mob-hover tooltip, which is anchored to a
 *  fixed viewport CORNER instead of the cursor: the desktop bottom-right slot,
 *  or (on touch, where `minimap` is the live minimap rect) the slot immediately
 *  left of the minimap. Every arm floors at the edge gap, so a box too large
 *  for its slot starts on screen and overflows the far edge, exactly as the
 *  cursor path does; tooltipMaxHeight caps that overflow on both paths. */
export function mobTooltipCornerPlacement(
  box: TooltipBox,
  viewport: TooltipViewport,
  minimap: MobTooltipAnchorRect | null,
): TooltipPlacement {
  const z = viewport.scale;
  if (minimap !== null)
    return {
      left: Math.max(
        MOB_TOOLTIP_MOBILE_EDGE_GAP,
        minimap.left / z - box.w - MOB_TOOLTIP_MOBILE_MINIMAP_GAP,
      ),
      top: Math.max(MOB_TOOLTIP_MOBILE_EDGE_GAP, minimap.top / z),
    };
  return {
    left: Math.max(TOOLTIP_EDGE_GAP, viewport.w / z - box.w - MOB_TOOLTIP_MARGIN_RIGHT),
    top: Math.max(TOOLTIP_EDGE_GAP, viewport.h / z - box.h - MOB_TOOLTIP_MARGIN_BOTTOM),
  };
}

/** Author-space top-left for a box shown at visual-space pointer (x, y): to
 *  the right of and above the pointer, pulled back inside the viewport on the
 *  right and bottom, and never past the top-left gap (the floor wins). */
export function tooltipPlacementAt(
  x: number,
  y: number,
  box: TooltipBox,
  viewport: TooltipViewport,
): TooltipPlacement {
  const z = viewport.scale;
  const rightMost = viewport.w / z - box.w - TOOLTIP_EDGE_GAP;
  const bottomMost = viewport.h / z - box.h - TOOLTIP_EDGE_GAP;
  return {
    left: Math.max(TOOLTIP_EDGE_GAP, Math.min(rightMost, x / z + TOOLTIP_POINTER_DX)),
    top: Math.max(TOOLTIP_EDGE_GAP, Math.min(bottomMost, y / z - box.h - TOOLTIP_POINTER_DY)),
  };
}
