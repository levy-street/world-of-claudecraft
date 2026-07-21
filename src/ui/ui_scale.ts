// Single source of truth for the global UI Scale factor (the `uiScale` setting,
// applied as `zoom: var(--ui-scale)` on #ui — see index.html and main.ts).
//
// Why this exists: under CSS `zoom`, getBoundingClientRect() and pointer
// clientX/clientY report coordinates in *zoomed visual space*, but anything
// written to `style.left`/`top` is an author length that the browser then
// multiplies by the same zoom. So every JS site that places a #ui child from a
// viewport/pointer coordinate must first divide that coordinate by the live
// scale, or it misplaces whenever uiScale !== 1. Routing every such write site
// through one helper keeps that correction from silently regressing.

const STORE_KEY = 'woc_settings';

// Mirrors SETTING_RANGES.uiScale in src/game/settings.ts. Kept local so this
// module stays a tiny, dependency-free, host-agnostic reader.
export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.4;
export const UI_SCALE_DEFAULT = 1;

/** Clamp + sanitize a raw scale value to the supported range. NaN/∞ → default. */
export function clampUiScale(raw: unknown): number {
  // Only numbers and non-empty numeric strings count; null/''/objects (which
  // Number() would coerce to 0 or NaN) fall back to the default, not the min.
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw);
  else return UI_SCALE_DEFAULT;
  if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n));
}

/**
 * Pure resolver: pick the scale from the live CSS custom property if present,
 * else the persisted setting, else the default. Both inputs are raw strings /
 * unknowns as they come from the DOM / localStorage, so callers can unit-test
 * the precedence without a browser.
 */
export function resolveUiScale(cssVar: string | null | undefined, persistedJson: string | null | undefined): number {
  const fromCss = cssVar != null && cssVar.trim() !== '' ? Number(cssVar) : NaN;
  if (Number.isFinite(fromCss)) return clampUiScale(fromCss);
  if (persistedJson) {
    try {
      const parsed = JSON.parse(persistedJson) as unknown;
      if (parsed && typeof parsed === 'object') {
        const v = (parsed as Record<string, unknown>).uiScale;
        if (typeof v === 'number') return clampUiScale(v);
      }
    } catch {
      /* corrupt store — fall through to default */
    }
  }
  return UI_SCALE_DEFAULT;
}

/**
 * The live UI scale factor to divide viewport/pointer coordinates by before
 * writing them into a #ui child's style.left/top. Reads the applied
 * `--ui-scale` custom property first (exactly what `zoom` uses), falling back
 * to the persisted setting. Returns UI_SCALE_DEFAULT (1) outside the browser.
 */
export function getUiScale(): number {
  if (typeof document === 'undefined') return UI_SCALE_DEFAULT;
  let cssVar: string | null = null;
  try {
    cssVar = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
  } catch {
    cssVar = null;
  }
  let persisted: string | null = null;
  try {
    persisted = localStorage.getItem(STORE_KEY);
  } catch {
    persisted = null;
  }
  return resolveUiScale(cssVar, persisted);
}
