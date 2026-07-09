// Pure decision core for Phase 3 of the mobile combat HUD rework: resolves a
// responsive HUD "tier" (compact / standard / tablet) plus the body classes and
// CSS vars a touch layout should apply, from plain viewport + mode inputs. No
// DOM: the thin applier (src/game/mobile_hud_layout_applier.ts) reads real
// viewport/insets/mode state and calls this core, then writes the result to
// document.body. Kept host-agnostic so it is Vitest-driven directly and passes
// the tests/architecture.test.ts purity scans (no DOM globals, no
// Math.random/Date.now/performance.now).
//
// TIERING RATIONALE (thresholds are named constants, not magic numbers):
// - compact: a small or short viewport where the full desktop-scaled HUD
//   (chat, quest tracker, minimap, action ring) would overlap. Two independent
//   triggers land in "compact": a short LANDSCAPE viewport (viewport height at
//   or below COMPACT_MAX_HEIGHT_PX, covering the whole hand-held phone class:
//   a notched phone at 844x390, an Android phone at 915x412, and a Pro-Max /
//   tall-Android class phone at 932x430; they are all held the same way and
//   all have very little vertical room for the top HUD + bottom combat arc, so
//   the floor sits at 480 to catch every one of them, while true small-laptop
//   viewports like 1280x720 stay standard) OR a narrow viewport (width at
//   or below COMPACT_MAX_WIDTH_PX, which also covers a portrait phone like
//   390x844: portrait keeps the existing hud.mobile.css portrait media blocks,
//   this tier class layers on top of them, it does not replace them).
// - tablet: a large viewport in both dimensions: the smaller of width/height is
//   at least TABLET_MIN_DIMENSION_PX AND the width is at least
//   TABLET_MIN_WIDTH_PX (both gates matter, so a merely-tall narrow window
//   cannot qualify). Covers 1920x1080 and 1024x768 (a 4:3 tablet landscape:
//   1024 width clears TABLET_MIN_WIDTH_PX and the 768 height exactly clears
//   TABLET_MIN_DIMENSION_PX).
// - standard: everything else. 1280x720 lands here rather than tablet: its
//   720px height sits just below the 768px tablet floor (a common small-laptop
//   viewport, not a large hand-held tablet), and it is far above the compact
//   thresholds, so the baseline HUD (no tier overrides) is the right call.
export const COMPACT_MAX_HEIGHT_PX = 480;
export const COMPACT_MAX_WIDTH_PX = 700;
export const TABLET_MIN_DIMENSION_PX = 768;
export const TABLET_MIN_WIDTH_PX = 1000;

export type MobileHudTier = 'compact' | 'standard' | 'tablet';

export interface MobileHudLayoutInput {
  /** CSS viewport width in pixels. */
  width: number;
  /** CSS viewport height in pixels. */
  height: number;
  /** Safe-area inset (env(safe-area-inset-top)) in pixels; 0 on a device with none. */
  safeAreaTop: number;
  /** Safe-area inset (env(safe-area-inset-right)) in pixels. */
  safeAreaRight: number;
  /** Safe-area inset (env(safe-area-inset-bottom)) in pixels. */
  safeAreaBottom: number;
  /** Safe-area inset (env(safe-area-inset-left)) in pixels. */
  safeAreaLeft: number;
  /** Whether the touch UI is active at all (InterfaceMode-resolved). Desktop
   *  (false) always yields the empty, no-op layout below. */
  touchMode: boolean;
  /** Any HUD window/sheet currently open (feeds body.mobile-window-open today). */
  menuOpen: boolean;
  /** The chat panel is open/expanded. */
  chatOpen: boolean;
}

export interface MobileHudLayout {
  tier: MobileHudTier;
  /** Exactly one of hud-mobile-compact / hud-mobile-standard / hud-mobile-tablet,
   *  plus hud-menu-open iff menuOpen and hud-chat-open iff chatOpen. Empty when
   *  touchMode is false (desktop stays untouched). */
  classes: string[];
  /** CSS custom properties this layout wants set on body (currently the safe-area
   *  echo used by the tier CSS; the raw insets are also directly available via
   *  env() in CSS, this is only for values a rule needs to combine in JS-free
   *  math that env() itself cannot express across the tier boundary). */
  cssVars: Record<string, string>;
}

function resolveTier(width: number, height: number): MobileHudTier {
  const minDimension = Math.min(width, height);
  if (height <= COMPACT_MAX_HEIGHT_PX || width <= COMPACT_MAX_WIDTH_PX) return 'compact';
  if (minDimension >= TABLET_MIN_DIMENSION_PX && width >= TABLET_MIN_WIDTH_PX) return 'tablet';
  return 'standard';
}

const TIER_CLASS: Record<MobileHudTier, string> = {
  compact: 'hud-mobile-compact',
  standard: 'hud-mobile-standard',
  tablet: 'hud-mobile-tablet',
};

/** Resolve the responsive mobile HUD layout for the given viewport/mode inputs.
 *  Deterministic and side-effect-free: same input always yields a deeply equal
 *  output (no DOM reads, no Date/performance/random). Returns an empty classes
 *  list when touchMode is false so desktop is never tier-classed. */
export function resolveMobileHudLayout(input: MobileHudLayoutInput): MobileHudLayout {
  if (!input.touchMode) {
    return { tier: 'standard', classes: [], cssVars: {} };
  }
  const tier = resolveTier(input.width, input.height);
  const classes: string[] = [TIER_CLASS[tier]];
  if (input.menuOpen) classes.push('hud-menu-open');
  if (input.chatOpen) classes.push('hud-chat-open');
  const cssVars: Record<string, string> = {
    '--mobile-hud-safe-top': `${input.safeAreaTop}px`,
    '--mobile-hud-safe-right': `${input.safeAreaRight}px`,
    '--mobile-hud-safe-bottom': `${input.safeAreaBottom}px`,
    '--mobile-hud-safe-left': `${input.safeAreaLeft}px`,
  };
  return { tier, classes, cssVars };
}
