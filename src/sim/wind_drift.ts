// Wind drift: a player wearing a wind aura is carried by it every tick, on
// top of whatever their own keys ask for. The shared motion kernel
// (player_motion.ts stepPlayerMotion) adds the drift to the body's step and
// runs it through the same terrain gates and swept collision as a walk, so a
// wall stops it, a lip with no wall lets the body walk off it (and fall), and
// a player can walk against it (their run minus the wind) or keep casting
// while it carries them (the drift is not movement input: no cast breaks).
//
// The aura is the whole signal, like slippery ground (slippery_ground.ts): an
// encounter puts it on whoever stands in its wind (the Smith's Heart's
// Guardian of the Breath, encounters/smith_heart/breath_gale.ts) and takes it
// off again; the wire mirrors it with every aura (value, value2 and value3
// ride it exactly), and both hosts step the same drift, so the online client
// PREDICTS the push instead of standing down: a blow's start and end are the
// only ticks the reconciler ever has to replay.
//
//   WIND_DRIFT_AURA  a steady wind: value = the heading it blows toward
//                    (radians, sim convention: the unit (sin h, cos h)),
//                    value2 = its speed in yards a second.
//   WIND_PULL_AURA   a pull toward a point (an indrawn breath): value, value2
//                    = the world x and z it draws toward, value3 = its speed;
//                    it never draws a body closer than WIND_PULL_STOP.
//
// Both ride a quiet `internal_cd` marker (no stat, no speed: never a slow a
// cleanse would strip). Pure: no SimContext, no rng.

import type { Entity } from './types';

/** A steady wind (value: heading, value2: speed). */
export const WIND_DRIFT_AURA = 'wind_drift';
/** A pull toward a point (value, value2: world x, z; value3: speed). Never
 *  an id ending in `_pull`: that suffix is the Oath Chain's travel aura
 *  (combat/paladin_control.ts), which the aura tick would end at once. */
export const WIND_PULL_AURA = 'wind_draw';
/** A pull never draws a body closer than this to its point (yards). */
export const WIND_PULL_STOP = 3.5;

/**
 * The drift carrying `e` this tick, in yards a second, written into `out`.
 * Returns false (and zeroes `out`) when no wind holds it. A body wearing both
 * is pulled (the indrawn breath outranks the blow it replaces).
 */
export function windDrift(
  e: Pick<Entity, 'auras' | 'pos'>,
  out: { x: number; z: number },
): boolean {
  out.x = 0;
  out.z = 0;
  let drift: (typeof e.auras)[number] | null = null;
  for (const a of e.auras) {
    if (a.id === WIND_PULL_AURA) {
      const speed = a.value3 ?? 0;
      const tx = a.value;
      const tz = a.value2 ?? e.pos.z;
      const dx = tx - e.pos.x;
      const dz = tz - e.pos.z;
      const len = Math.hypot(dx, dz);
      if (!(speed > 0) || len <= WIND_PULL_STOP) return false;
      out.x = (dx / len) * speed;
      out.z = (dz / len) * speed;
      return true;
    }
    if (a.id === WIND_DRIFT_AURA && drift === null) drift = a;
  }
  if (drift === null) return false;
  const speed = drift.value2 ?? 0;
  if (!(speed > 0)) return false;
  out.x = Math.sin(drift.value) * speed;
  out.z = Math.cos(drift.value) * speed;
  return true;
}

/** The speed of the wind carrying `e` (yd/s), 0 when none: the server's
 *  step check allows a walk plus this (server/movement_override_epoch.ts). */
export function windDriftSpeed(e: Pick<Entity, 'auras'>): number {
  let speed = 0;
  for (const a of e.auras) {
    if (a.id === WIND_PULL_AURA) speed = Math.max(speed, a.value3 ?? 0);
    else if (a.id === WIND_DRIFT_AURA) speed = Math.max(speed, a.value2 ?? 0);
  }
  return speed;
}
