export interface VisualRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MobileMobTooltipLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  uiScale: number;
  tooltipAuthorWidth: number;
  tooltipNaturalAuthorHeight: number;
  minimapRect: VisualRect;
  leftHanded: boolean;
  obstacles: readonly VisualRect[];
}

export interface MobileMobTooltipLayout {
  left: number;
  top: number;
  maxHeight: number;
  clipped: boolean;
}

const VIEWPORT_EDGE_GAP = 8;
const MINIMAP_GAP = 8;
const OBSTACLE_CLEARANCE = 4;

function horizontallyIntersects(left: number, right: number, obstacle: VisualRect): boolean {
  return obstacle.right > left && obstacle.left < right;
}

export function mobileMobTooltipLayout(input: MobileMobTooltipLayoutInput): MobileMobTooltipLayout {
  const zoom = Number.isFinite(input.uiScale) && input.uiScale > 0 ? input.uiScale : 1;
  const tooltipVisualWidth = input.tooltipAuthorWidth * zoom;
  const desiredLeft = input.leftHanded
    ? input.minimapRect.right - tooltipVisualWidth
    : input.minimapRect.left;
  const maximumLeft = Math.max(
    VIEWPORT_EDGE_GAP,
    input.viewportWidth - tooltipVisualWidth - VIEWPORT_EDGE_GAP,
  );
  const leftVisual = Math.max(VIEWPORT_EDGE_GAP, Math.min(maximumLeft, desiredLeft));
  const rightVisual = leftVisual + tooltipVisualWidth;
  const topVisual = input.minimapRect.bottom + MINIMAP_GAP;

  let availableBottom = input.viewportHeight - VIEWPORT_EDGE_GAP;
  for (const obstacle of input.obstacles) {
    if (obstacle.top < topVisual || !horizontallyIntersects(leftVisual, rightVisual, obstacle)) {
      continue;
    }
    availableBottom = Math.min(availableBottom, obstacle.top - OBSTACLE_CLEARANCE);
  }

  const maxHeight = Math.max(0, availableBottom - topVisual) / zoom;
  return {
    left: leftVisual / zoom,
    top: topVisual / zoom,
    maxHeight,
    clipped: input.tooltipNaturalAuthorHeight > maxHeight,
  };
}
