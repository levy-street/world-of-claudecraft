// The boot-time DEFAULT of the Render Quality slider (settings.renderScale), a
// pure decision table with no imports (a registered UI_PURE_CORE, see
// tests/architecture.test.ts): the thin applier in boot_graphics_defaults.ts
// feeds it the static device class and the stored settings once per boot.
//
// Why a default and not a runtime lever (measured on an Intel HD 530 laptop,
// low preset, governor off, 1920x897 drawing buffer): every render-scale
// reallocation is a 20 to 160 ms stall on the main thread, priced per
// reallocation rather than per pixel, so a governor that steps the resolution
// at runtime pays one hitch per rung and hitches forever if it oscillates.
// Deciding the pixel count ONCE, from the static adapter class, costs nothing
// at runtime; the slider stays the way up and down. Fill on that class is 4 to
// 6 ms of GPU per megapixel, 26 to 40 percent of the low-preset GPU frame at
// scale 1.0, so the whole default is worth roughly one vsync rung. On low the
// governor's own resolution rung is already closed (low renders direct to the
// drawing buffer, dynamicResolutionGovernorRange collapses it), so the default
// spends no lever the governor could have used.
//
// Fairness: pixel count is cosmetic sharpness only (docs/design/
// graphics-settings-fairness.md); nothing a player acts on is hidden or delayed,
// and the value is read from the STATIC preset, never the FPS governor.

/**
 * The render scale a weak integrated GPU on the LOW preset boots at when the
 * player has never moved the slider. Equal to the low preset's own desktop
 * governor floor (GFX_BUDGETS.low.minRenderScaleDesktop), the value the
 * preset already declares acceptable to render at, so this ships one number
 * rather than two. The deep rungs of the ladder buy most of the slow-frame
 * gain; going from here to the slider's 0.5 minimum is worth about another
 * millisecond of GPU on a 30 to 40 ms frame while dropping a 1366x768 laptop
 * panel to a 683x384 buffer, so the floor is the stop.
 */
export const WEAK_GPU_LOW_RENDER_SCALE = 0.65;

export interface BootRenderScaleHints {
  /** The one shared adapter classifier said 'weak' (classifyGpuRenderer). */
  readonly weakGpu: boolean;
  /** The FINAL stored graphics preset for this boot is LOW. */
  readonly lowPreset: boolean;
  /** The player has committed the Render Quality slider at least once. */
  readonly renderScaleTouched: boolean;
  /** settings.renderScale as loaded. */
  readonly storedRenderScale: number;
  /** SETTING_RANGES.renderScale.def, the stock value every other machine boots at. */
  readonly stockRenderScale: number;
}

/**
 * The render scale to persist at boot, or null to leave the stored value
 * alone. A touched slider is never overridden. An untouched slider is owned by
 * the game, so it follows the static device class on every boot: the weak
 * value on a weak GPU at LOW, the stock value everywhere else (a player who
 * later raises the preset by hand gets the stock default back at the next
 * boot). Null when the stored value already matches, so the settings store is
 * not rewritten on an ordinary boot.
 */
export function bootRenderScaleDefault(hints: BootRenderScaleHints): number | null {
  if (hints.renderScaleTouched) return null;
  const target =
    hints.weakGpu && hints.lowPreset ? WEAK_GPU_LOW_RENDER_SCALE : hints.stockRenderScale;
  return target === hints.storedRenderScale ? null : target;
}

/**
 * The one-time migration for installs that predate the touched flag: a stored
 * value that differs from the stock default can only have come from the slider
 * (nothing else ever wrote the key), so it counts as touched; a stored stock
 * value, or no value at all, counts as untouched. A player who deliberately
 * set 1.0 before the flag existed is indistinguishable from one who never
 * moved the slider, and is treated as untouched exactly once (the flag is
 * persisted from then on); the slider shows the new value and one commit
 * restores their choice for good.
 */
export function inferRenderScaleTouched(
  storedRenderScale: unknown,
  stockRenderScale: number,
): boolean {
  return typeof storedRenderScale === 'number' && storedRenderScale !== stockRenderScale;
}
