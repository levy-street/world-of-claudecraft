// Host-agnostic decisions for the embers a lantern-bearing mount sheds (mount_embers.ts):
// how hard each source emits for the gait, and how much a hoof's strike counts for how close
// it is to the ground. No Three, no DOM, no clock: the caller feeds heights and the gait, and
// a Vitest pins the numbers (tests/mount_embers.test.ts).
//
// Cosmetic only. The rates are a ceiling the particle cloud then scales by its own quality
// level (vfx.ts emitChance), so a low graphics tier sheds them first; nothing a player acts on
// rides on an ember.

/** Particles per second per source, before the cloud's quality scaling. */
export interface MountEmberRates {
  /** Sparks off each hoof as it strikes. */
  hoof: number;
  /** Cinders shaken out of each lantern. */
  lantern: number;
}

/** A gallop strikes sparks and throws the lanterns about; a walk lets a few cinders fall;
 *  standing, the lanterns only breathe the odd cinder up. Hooves spark only at a run: a walk
 *  is quiet footing, and sparks at every step read as a bug, not a war horse. */
export function mountEmberRates(moving: boolean, running: boolean): MountEmberRates {
  if (moving && running) return { hoof: 44, lantern: 26 };
  if (moving) return { hoof: 0, lantern: 8 };
  return { hoof: 0, lantern: 3 };
}

/**
 * How much a hoof's spark chance counts this frame, from its height over the ground in world
 * units and the mount's world scale (model unit to world unit). A hoof in contact (within a
 * tenth of a model unit, the hoof's own height) counts fully, one lifted past a quarter of a
 * model unit not at all, so the sparks come off the strike and the push-off rather than
 * trailing from a hoof in the air.
 */
export function hoofStrikeWeight(heightAboveGround: number, scale: number): number {
  const s = scale > 0 ? scale : 1;
  const h = heightAboveGround / s;
  if (h <= 0.1) return 1;
  if (h >= 0.25) return 0;
  return (0.25 - h) / 0.15;
}
