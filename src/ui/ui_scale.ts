// Single source of truth for the global UI Scale factor (the `uiScale` setting,
// applied as `zoom: var(--ui-scale)` on #ui — see index.html and main.ts).
//
// Why this exists: under CSS `zoom`, getBoundingClientRect() and pointer
// clientX/clientY report coordinates in *zoomed visual space*, but anything
// written to `style.left`/`top` is an author length that the browser then
// multiplies by the same zoom. So every JS site that places a #ui child from a
// viewport/pointer coordinate must first divide that coordinate by the live
// scale, or it misplaces whenever uiScale !== 1. Routing every such write site
// through one helper keeps that correction from silently regressing, and lets
// the one host read behind it be cached once for everybody (see getUiScale).

import { SETTINGS_CHANGE_EVENT } from '../game/settings';

const STORE_KEY = 'woc_settings';

// Mirrors SETTING_RANGES.uiScale in src/game/settings.ts. Kept local (rather
// than imported alongside SETTINGS_CHANGE_EVENT) so the RANGE stays readable
// without pulling the settings store in: the pure resolvers below take their
// inputs as raw strings and can be unit-tested with no browser at all.
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
export function resolveUiScale(
  cssVar: string | null | undefined,
  persistedJson: string | null | undefined,
): number {
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

/** The cached scale, or null while it has to be resolved from the hosts again. */
let cached: number | null = null;
/** The inline `--ui-scale` the cached value was resolved under. */
let cachedKey = '';
/** Whether the invalidation listener is armed (once per document, not per read). */
let watching = false;

/** Drop the cached scale, so the next getUiScale() resolves from the hosts.
 *  Exported for the tests that drive the invalidation; the live invalidations
 *  are the settings-change listener armed inside getUiScale and the custom
 *  property key it checks per call. */
export function invalidateUiScaleCache(): void {
  cached = null;
  cachedKey = '';
}

/**
 * The live UI scale factor to divide viewport/pointer coordinates by before
 * writing them into a #ui child's style.left/top. Reads the applied
 * `--ui-scale` custom property first (exactly what `zoom` uses), falling back
 * to the persisted setting. Returns UI_SCALE_DEFAULT (1) outside the browser.
 *
 * CACHED, because this is a hot read: the tooltip mousemove handler calls it on
 * EVERY pointer move (through Hud.tooltipViewport), and it is a
 * getComputedStyle on the document element plus a localStorage read plus a
 * JSON.parse to answer one number. getComputedStyle in particular forces the
 * style recalc the whole per-frame HUD contract exists to avoid.
 *
 * TWO invalidations, because the scale has two sources and the cheap check
 * cannot see both:
 *  - the CUSTOM PROPERTY, checked per call against the INLINE `--ui-scale` on
 *    the document element. That read is off the style attribute, so unlike
 *    getComputedStyle it forces nothing, and main.ts's applySetting is the only
 *    thing in the product that ever writes the property (no stylesheet declares
 *    it, they only `var()` it), so the inline value moving is exactly the event
 *    "the scale changed". Checking it per call is what keeps the value LIVE:
 *    the frame-geometry reapply runs off that write and must not see a stale
 *    number for even one frame (tests/movable_frame.test.ts pins that).
 *  - the PERSISTED blob, which the property check cannot see at all when no
 *    property is set. That arm rides SETTINGS_CHANGE_EVENT (Settings.save
 *    broadcasts it on every persisted write) and drops the cache LAZILY, so
 *    the next read resolves rather than the listener resolving early against a
 *    property main.ts has not written yet.
 * With no window to listen on (a Node test), nothing is cached and every call
 * resolves fresh, which keeps the old semantics exactly where they were relied
 * on.
 *
 * ONE cache for every consumer, deliberately: the whole point of routing every
 * coordinate write through this helper is that the frames, tooltips, talent
 * grid and FCT all divide by the SAME number, and a per-module cache is how
 * they would stop agreeing.
 */
export function getUiScale(): number {
  if (typeof document === 'undefined') return UI_SCALE_DEFAULT;
  if (typeof window === 'undefined') return resolveLiveUiScale();
  if (!watching) {
    watching = true;
    window.addEventListener(SETTINGS_CHANGE_EVENT, invalidateUiScaleCache);
  }
  const key = inlineUiScaleKey();
  if (cached === null || key !== cachedKey) {
    cachedKey = key;
    cached = resolveLiveUiScale();
  }
  return cached;
}

/** The INLINE `--ui-scale` on the document element, as a raw string: the cache
 *  key, never the resolved value (resolveLiveUiScale keeps the documented
 *  computed-property precedence). Read off the style attribute, so it forces no
 *  style recalc; an unusable value is still a fine key, since a key only has to
 *  CHANGE when the property does. */
function inlineUiScaleKey(): string {
  try {
    return document.documentElement.style.getPropertyValue('--ui-scale');
  } catch {
    return '';
  }
}

/** The uncached resolve: the applied custom property, else the persisted blob.
 *  Both hosts are read defensively (a thumbnail capture or a browser with site
 *  data blocked can throw on either). */
function resolveLiveUiScale(): number {
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
