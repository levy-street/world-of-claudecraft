// Tiny shared numeric helper. Clamps a value to the 0..1 range, used by every
// HUD bar/vignette that derives a fill or opacity fraction from raw game state
// (low_health, absorb_bar, low_resource, swing_timer, xp_bar). Pulled out of
// those five modules, which each redefined the identical private helper.

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
