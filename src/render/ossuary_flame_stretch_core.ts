// How long Wraith the Deadstrier's flames burn for a given ground speed: short
// and upright standing still, streaming to their full built length at a
// gallop. Pure math (no three.js), read once per frame by ossuary_flames.ts,
// which eases toward it and feeds it to the flame shader as `uStretch`.

/** Ground speed, in world units per second, at which the flames reach their
 *  full galloping length. Below a walk they stay at their standing length. */
export const STRETCH_FULL_SPEED = 12;
export const STRETCH_START_SPEED = 1.5;

/** 0 standing (or slower than a walk) to 1 at a full gallop, eased in so a
 *  walk only lengthens the flames a little and the gallop does most of it. */
export function stretchForSpeed(speed: number): number {
  if (!(speed > STRETCH_START_SPEED)) return 0;
  const u = Math.min(1, (speed - STRETCH_START_SPEED) / (STRETCH_FULL_SPEED - STRETCH_START_SPEED));
  return u * u * (3 - 2 * u);
}
