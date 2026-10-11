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
  type TooltipAnchorRect,
  type TooltipViewport,
  tooltipMaxHeight,
  tooltipPlacementAt,
  unitTooltipAnchorPlacement,
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

// `readAnchor` reads the movable Tooltip frame's seat (desktop only): when it
// yields a rect the card grows from it (unitTooltipAnchorPlacement); the touch
// minimap slot always wins, and no seat at all falls back to the fixed corner.
// It is a READER, called only after the one box measure below, so the seat's
// rect comes off the layout that measure already settled instead of forcing a
// second one ahead of the content write.
export function paintMobTooltipBottomRight(
  tooltipEl: TooltipPaintTarget,
  html: string,
  viewport: TooltipViewport,
  minimapRect: { left: number; top: number } | null,
  readAnchor: (() => TooltipAnchorRect | null) | null = null,
): void {
  tooltipEl.classList.add('mob-tooltip');
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = 'block';
  tooltipEl.style.maxHeight = `${tooltipMaxHeight(viewport)}px`;
  const box = { w: tooltipEl.offsetWidth, h: tooltipEl.offsetHeight };
  const anchorRect = minimapRect === null && readAnchor !== null ? readAnchor() : null;
  const at =
    anchorRect !== null
      ? unitTooltipAnchorPlacement(box, viewport, anchorRect)
      : mobTooltipCornerPlacement(box, viewport, minimapRect);
  tooltipEl.style.left = `${at.left}px`;
  tooltipEl.style.top = `${at.top}px`;
}
