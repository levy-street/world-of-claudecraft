// Pure math for the right tracker stack's dynamic seat (#right-tracker-stack).
// The stack's stylesheet `top` is a per-tier constant, but the minimap column
// above it has a content-driven height (a wrapping zone label, the mobile
// chrome scale, the compact-tier transform), so a constant seat either wastes
// space or slides the trackers under the minimap (the compact tier really did
// paint the Reliquary chip over the compass and clock). The DOM half
// (tracker_stack_anchor.ts) measures the live column and asks this core where
// the stack belongs; keeping the decision here makes the seat unit-testable
// without a layout engine. Registered in UI_PURE_CORES; tested in
// tests/tracker_stack_anchor.test.ts.

/** Breathing room between the minimap column's lowest edge and the stack, in
 *  UI-space px (the same coordinate space the stack's `top` style uses). */
export const TRACKER_STACK_ANCHOR_GAP_PX = 8;

export interface TrackerStackAnchorMeasure {
  /**
   * The minimap column's bottom edge in visual px (getBoundingClientRect
   * space, which folds the mobile transform scale), or null when the column is
   * not visible and the stylesheet seat should stand.
   */
  minimapBottomPx: number | null;
  /**
   * Bottom edges of chrome that hangs BELOW the wrap's own box (the desktop
   * zoom pill and clock sit at negative `bottom` offsets, so the wrap's rect
   * does not contain them). Entries for hidden elements are simply lower than
   * the wrap bottom and fall out of the max.
   */
  overhangBottomsPx: readonly number[];
  /**
   * The live CSS zoom on #ui (the uiScale setting). Rect measurements arrive
   * multiplied by it, while the `top` the caller writes is applied INSIDE the
   * zoomed layer, so the measurement divides back down. Guarded against 0/NaN
   * by falling back to 1.
   */
  uiScale: number;
}

/**
 * Where the tracker stack's top belongs, in UI-space px, or null when the
 * stylesheet's own per-tier seat should stand (minimap hidden). The answer is
 * rounded so the applier's write-elision compares stable integers.
 */
export function trackerStackAnchorTopPx(measure: TrackerStackAnchorMeasure): number | null {
  if (measure.minimapBottomPx === null) return null;
  const scale = Number.isFinite(measure.uiScale) && measure.uiScale > 0 ? measure.uiScale : 1;
  let bottom = measure.minimapBottomPx;
  for (const overhang of measure.overhangBottomsPx) {
    if (overhang > bottom) bottom = overhang;
  }
  return Math.round(bottom / scale) + TRACKER_STACK_ANCHOR_GAP_PX;
}
