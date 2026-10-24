// Ambient-mote keep-out around the local player (motes.ts): the drifting specks
// (vale pollen, peak snow dust) are 0.3 to 0.46 yd additive white-core discs, so
// one that drifts through the player's own column sits right on the shoulder or
// beside the head in the follow camera and reads as a stray ball of light
// stuck to the character (it was taken for a weapon-skin defect). A mote fades
// out as it nears the player and is fully gone inside the inner ring, so the
// ambience stays everywhere around the player but never on them.
//
// Pure and Three-free: the fade is a function of the mote's horizontal offset
// from the player, pinned by tests/motes_keepout_core.test.ts. Horizontal only,
// because a mote ANY height inside that column (at the feet, the shoulder or
// above the head) lands on the character in the follow camera.

/** Inside this horizontal radius (yd) a mote is fully hidden. */
export const MOTE_KEEPOUT_INNER = 1.3;
/** From this radius (yd) out a mote draws at full strength. */
export const MOTE_KEEPOUT_OUTER = 2.6;

/** The strength (0 hidden .. 1 full) a mote at horizontal offset (dx, dz) from
 *  the player draws at: 0 inside MOTE_KEEPOUT_INNER, a smoothstep ramp up to 1
 *  at MOTE_KEEPOUT_OUTER, 1 beyond. A non-finite offset draws at full strength
 *  (the caller's parked motes never reach this). */
export function moteKeepOutFade(dx: number, dz: number): number {
  const d2 = dx * dx + dz * dz;
  if (!Number.isFinite(d2)) return 1;
  if (d2 >= MOTE_KEEPOUT_OUTER * MOTE_KEEPOUT_OUTER) return 1;
  if (d2 <= MOTE_KEEPOUT_INNER * MOTE_KEEPOUT_INNER) return 0;
  const t = (Math.sqrt(d2) - MOTE_KEEPOUT_INNER) / (MOTE_KEEPOUT_OUTER - MOTE_KEEPOUT_INNER);
  return t * t * (3 - 2 * t);
}
