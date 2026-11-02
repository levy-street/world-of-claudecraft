// The indoor pumpkins' wisps, the pure half (no Three, no DOM): a faint will-o'-wisp
// that hangs over each candle-lit pumpkin inside the event cities' houses, drifting in a
// slow lazy loop and breathing brighter and dimmer, and the ember it sheds now and then.
// seasonal_interior_wisps.ts owns the sprites and reads this. Cosmetic only: no gameplay
// read, so it may thin freely (reduced motion holds it still).

export interface WispPose {
  x: number;
  y: number;
  z: number;
  /** Sprite width (yards). */
  size: number;
  /** 0..1 brightness (additive: the colour is scaled by it). */
  glow: number;
}

/** How high over the pumpkin the wisp hangs (yards, before the pumpkin's scale). */
export const WISP_RISE = 0.75;

/** The wisp over a pumpkin at (x, y, z) of drawn `scale`, at `time`. `phase` keeps
 *  neighbours out of step. Reduced motion holds it still at its brightest rest. */
export function wispPose(
  x: number,
  y: number,
  z: number,
  scale: number,
  time: number,
  phase: number,
  reducedMotion: boolean,
): WispPose {
  const base = y + WISP_RISE * Math.max(0.5, scale);
  if (reducedMotion) return { x, y: base, z, size: 0.42, glow: 0.7 };
  const t = time * 0.6 + phase;
  return {
    x: x + Math.sin(t) * 0.22,
    y: base + Math.sin(t * 1.7) * 0.12,
    z: z + Math.cos(t * 0.8) * 0.22,
    size: 0.36 + 0.08 * Math.sin(time * 2.3 + phase),
    glow: 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(time * 1.9 + phase * 1.3)),
  };
}
