// The shared #tooltip box's DOM paint step for the two entry paths (cursor-anchored
// and mob corner-anchored): extracted from Hud.paintTooltipAt / paintMobTooltipBottomRight
// so the coordinator holds only the thin per-path wrapper. Takes the live tooltip
// element plus the already-resolved viewport/minimap geometry rather than reading
// any browser global itself, so it stays a painter-side helper: the caller (Hud)
// still owns tooltipOwner claim/release and resolving the minimap rect.
//
// Both paths write the height cap BEFORE the one offsetWidth/Height measure (the
// cap changes layout), then place through tooltip_clamp_core off the same measured
// box; see that module's header for why one cap serves both paths.
import {
  mobTooltipCornerPlacement,
  type TooltipViewport,
  tooltipMaxHeight,
  tooltipPlacementAt,
} from './tooltip_clamp_core';

// Narrowed to what this module actually touches (mirrors touch_tap.ts's
// TapTarget), so a test can drive it with a plain fake element instead of a
// full HTMLElement.
interface TooltipPaintTarget {
  readonly classList: { add(...values: string[]): void; remove(...values: string[]): void };
  innerHTML: string;
  replaceChildren(...nodes: Node[]): void;
  readonly style: { display: string; maxHeight: string; left: string; top: string };
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

export function paintTooltipAt(
  tooltipEl: TooltipPaintTarget,
  content: string | Node,
  x: number,
  y: number,
  viewport: TooltipViewport,
): { w: number; h: number } {
  tooltipEl.classList.remove('mob-tooltip');
  if (typeof content === 'string') {
    tooltipEl.innerHTML = content;
  } else {
    tooltipEl.replaceChildren(content);
  }
  tooltipEl.style.display = 'block';
  tooltipEl.style.maxHeight = `${tooltipMaxHeight(viewport)}px`;
  const box = { w: tooltipEl.offsetWidth, h: tooltipEl.offsetHeight };
  const at = tooltipPlacementAt(x, y, box, viewport);
  tooltipEl.style.left = `${at.left}px`;
  tooltipEl.style.top = `${at.top}px`;
  return box;
}

export function paintMobTooltipBottomRight(
  tooltipEl: TooltipPaintTarget,
  html: string,
  viewport: TooltipViewport,
  minimapRect: { left: number; top: number } | null,
): void {
  tooltipEl.classList.add('mob-tooltip');
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = 'block';
  tooltipEl.style.maxHeight = `${tooltipMaxHeight(viewport)}px`;
  const box = { w: tooltipEl.offsetWidth, h: tooltipEl.offsetHeight };
  const at = mobTooltipCornerPlacement(box, viewport, minimapRect);
  tooltipEl.style.left = `${at.left}px`;
  tooltipEl.style.top = `${at.top}px`;
}
