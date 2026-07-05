// Pure derivation of the minimap zoom state. Kept UI-framework-free (no DOM) so
// the discrete zoom stepping + label formatting can be snapshot tested directly,
// mirroring xp_bar.ts. The HUD owns persistence (localStorage) and applies the
// returned multiplier to the minimap's pixels-per-yard scale.

// Fixed zoom presets, ascending. 1 = the historical shipped scale (unchanged
// look at default), up to a 3x close-in view. Higher = more zoomed in (more
// pixels per yard, so a smaller world radius fills the minimap circle).
export const MINIMAP_ZOOM_LEVELS = [1, 1.5, 2, 3] as const;

export const MINIMAP_ZOOM_DEFAULT: number = MINIMAP_ZOOM_LEVELS[0];

// Snap an arbitrary value (e.g. a stale/garbage localStorage entry) to the
// nearest valid preset, falling back to the default for non-finite input.
export function clampMinimapZoom(z: number): number {
  if (!Number.isFinite(z)) return MINIMAP_ZOOM_DEFAULT;
  let best: number = MINIMAP_ZOOM_LEVELS[0];
  let bestDist = Math.abs(z - best);
  for (const lvl of MINIMAP_ZOOM_LEVELS) {
    const d = Math.abs(z - lvl);
    if (d < bestDist) { best = lvl; bestDist = d; }
  }
  return best;
}

// Step one preset in the given direction (+1 = zoom in, -1 = zoom out),
// clamped at the ends (no wrap-around). Returns the current level unchanged
// when already at a boundary.
export function nextMinimapZoom(current: number, dir: number): number {
  const idx = MINIMAP_ZOOM_LEVELS.indexOf(clampMinimapZoom(current) as typeof MINIMAP_ZOOM_LEVELS[number]);
  const next = Math.max(0, Math.min(MINIMAP_ZOOM_LEVELS.length - 1, idx + Math.sign(dir)));
  return MINIMAP_ZOOM_LEVELS[next];
}

export function isMinMinimapZoom(z: number): boolean {
  return clampMinimapZoom(z) === MINIMAP_ZOOM_LEVELS[0];
}

export function isMaxMinimapZoom(z: number): boolean {
  return clampMinimapZoom(z) === MINIMAP_ZOOM_LEVELS[MINIMAP_ZOOM_LEVELS.length - 1];
}

// Numeric zoom value (snapped to a valid preset) for the HUD readout. The HUD
// formats it via formatNumber so the digits follow the active locale, then
// appends the literal "×" symbol (U+00D7) — no digits are baked here.
export function minimapZoomValue(z: number): number {
  return clampMinimapZoom(z);
}
