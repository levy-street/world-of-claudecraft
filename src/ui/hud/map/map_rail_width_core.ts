// The world map atlas rail's width (the side panel with the zone summary,
// tracked quests and the world-quest board), set by dragging the divider
// between the rail and the map or with the divider's keys. DOM-free, so a
// Vitest drives it with plain numbers; map_rail_resize_controller.ts applies
// the result as the --map-rail-width custom property the map CSS reads.
//
// Widths are author px (the #ui zoom scales them like every other length).
// The range mirrors SETTING_RANGES.mapAtlasRailWidth in src/game/settings.ts
// (a UI pure core may not import src/game; tests/map_rail_width_core.test.ts
// pins the two equal).

/** The shipped rail width (the 300px rail of the original atlas layout). */
export const MAP_RAIL_DEFAULT_WIDTH = 300;
/** Narrowest rail: the filter chips and action buttons still fit on a row. */
export const MAP_RAIL_MIN_WIDTH = 240;
/** Widest rail: leaves the map its own share of an ordinary window. */
export const MAP_RAIL_MAX_WIDTH = 560;
/** Arrow-key step, and the Shift fine step. */
export const MAP_RAIL_KEY_STEP = 16;
export const MAP_RAIL_KEY_FINE_STEP = 4;

/** Clamp and round a width; anything not a finite number is the default. */
export function clampMapRailWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return MAP_RAIL_DEFAULT_WIDTH;
  return Math.round(Math.min(MAP_RAIL_MAX_WIDTH, Math.max(MAP_RAIL_MIN_WIDTH, width)));
}

/**
 * The width after a divider drag of `dxVisual` visual px from a drag that
 * began at `startWidth`, under a UI zoom of `scale` (pointer coordinates are
 * zoomed, the width is an author length).
 */
export function mapRailWidthAfterDrag(startWidth: number, dxVisual: number, scale: number): number {
  const z = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return clampMapRailWidth(startWidth + dxVisual / z);
}

/**
 * The width after a key press on the focused divider, or null when the key
 * is not one of the divider's (the press is then left alone). The keys follow
 * the ARIA window splitter pattern: the arrows step, Home and End jump to the
 * ends, and Shift makes an arrow the fine step.
 */
export function mapRailWidthAfterKey(current: number, key: string, shift: boolean): number | null {
  const step = shift ? MAP_RAIL_KEY_FINE_STEP : MAP_RAIL_KEY_STEP;
  switch (key) {
    case 'ArrowRight':
      return clampMapRailWidth(current + step);
    case 'ArrowLeft':
      return clampMapRailWidth(current - step);
    case 'Home':
      return MAP_RAIL_MIN_WIDTH;
    case 'End':
      return MAP_RAIL_MAX_WIDTH;
    default:
      return null;
  }
}
