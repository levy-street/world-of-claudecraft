export const TOOLTIP_EDGE_MARGIN = 8;
const TOOLTIP_POINTER_GAP_X = 14;
const TOOLTIP_POINTER_GAP_Y = 10;

export interface TooltipPositionInput {
  pointerX: number;
  pointerY: number;
  tooltipWidth: number;
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  uiScale: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
}

/** Place a cursor-anchored tooltip in zoom-immune author space and clamp both
 * axes. An oversized box pins to the top/left margin; CSS supplies scrolling. */
export function tooltipPosition(input: TooltipPositionInput): TooltipPosition {
  const scale = Math.max(0.01, input.uiScale);
  const viewportWidth = input.viewportWidth / scale;
  const viewportHeight = input.viewportHeight / scale;
  const maxLeft = Math.max(
    TOOLTIP_EDGE_MARGIN,
    viewportWidth - input.tooltipWidth - TOOLTIP_EDGE_MARGIN,
  );
  const maxTop = Math.max(
    TOOLTIP_EDGE_MARGIN,
    viewportHeight - input.tooltipHeight - TOOLTIP_EDGE_MARGIN,
  );
  return {
    left: Math.max(
      TOOLTIP_EDGE_MARGIN,
      Math.min(maxLeft, input.pointerX / scale + TOOLTIP_POINTER_GAP_X),
    ),
    top: Math.max(
      TOOLTIP_EDGE_MARGIN,
      Math.min(maxTop, input.pointerY / scale - input.tooltipHeight - TOOLTIP_POINTER_GAP_Y),
    ),
  };
}
