// The seasonal props' glow level (the carved pumpkins, the paper lanterns, the
// worn pumpkin head): dim by day, bright after dark, with a candle's flicker.
// Pure (no Three, no clock: the frame's time and night amount come in), so a
// Vitest pins the curve directly. The painter is seasonal_glow.ts.

/** Glow by full day: a candle in daylight is a faint warm spot, never dark. */
export const SEASONAL_GLOW_DAY = 0.35;
/** Glow at full night: above the bloom threshold on composer tiers. */
export const SEASONAL_GLOW_NIGHT = 2.6;
/** Candle flicker depth (fraction of the level, peak to centre). */
export const SEASONAL_FLICKER_DEPTH = 0.14;

/** A candle's flicker: three incommensurate sines, so it never visibly loops.
 *  `phase` desynchronises one family of props from another. Range 1 +- depth. */
export function seasonalFlicker(time: number, phase: number): number {
  const s =
    0.5 * Math.sin(time * 9.3 + phase) +
    0.3 * Math.sin(time * 23.1 + phase * 2.7) +
    0.2 * Math.sin(time * 4.1 + phase * 0.6);
  return 1 + SEASONAL_FLICKER_DEPTH * s;
}

/** The emissive intensity for a glow material: `night` is the renderer's lamp
 *  glow amount (0 by day, 1 at night), `base` the material's own strength. */
export function seasonalGlowIntensity(
  night: number,
  time: number,
  phase: number,
  base = 1,
): number {
  const n = night < 0 ? 0 : night > 1 ? 1 : night;
  const level = SEASONAL_GLOW_DAY + (SEASONAL_GLOW_NIGHT - SEASONAL_GLOW_DAY) * n;
  return level * base * seasonalFlicker(time, phase);
}
