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
//                    it never draws a body closer than WIND_PULL_STOP, and
//                    eases off over the last WIND_PULL_EASE yards before it
//                    (a body drawn in settles there, never stopped dead: Jose's
//                    playtest of 2026-11-07). A function of the position
//                    alone, so both hosts still step it bit for bit.
//   WIND_BLAST_AURA  a blast away from a point (the Summit Roar, the owner's
//                    call of 2026-11-17): value, value2 = the world x and z
//                    it blows from, value3 = its speed at that point. It
//                    eases off with the distance (BLAST_FALLOFF yd/s less per
//                    yard) to a floor of BLAST_FLOOR of that speed, so a body
//                    that runs straight back against it holds where the blast
//                    falls to a run, and one left standing is carried on and
//                    on. A function of the position alone, like the pull.
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
/** Over this many yards before WIND_PULL_STOP the pull eases off, in
 *  proportion to the distance still left (a settle, not a wall). */
export const WIND_PULL_EASE = 1.5;
/** A blast away from a point (value, value2: world x, z; value3: its speed
 *  at the point). */
export const WIND_BLAST_AURA = 'wind_blast';
/** The blast loses this much speed (yd/s) per yard from its point... */
export const BLAST_FALLOFF = 0.4;
/** ...down to this share of its full speed, never less. */
export const BLAST_FLOOR = 0.44;

/** The blast's speed `d` yards from its point (yd/s). */
export function blastSpeedAt(speed: number, d: number): number {
  return Math.max(speed * BLAST_FLOOR, Math.min(speed, speed - BLAST_FALLOFF * d));
}

/** How far from its point a body standing still ends, `d` yards out when the
 *  blast takes it, after `seconds` of it (yards; the same 20 Hz steps the
 *  kernel takes, walls and lips aside). */
export function blastStandingReach(speed: number, seconds: number, d: number): number {
  let r = d;
  const n = Math.round(seconds * 20);
  for (let i = 0; i < n; i++) r += blastSpeedAt(speed, r) / 20;
  return r;
}

/**
 * The drift carrying `e` this tick, in yards a second, written into `out`.
 * Returns false (and zeroes `out`) when no wind holds it. A body wearing more
 * than one is pulled first, then blasted (the indrawn breath and its Roar
 * outrank the blow they pause).
 */
export function windDrift(
  e: Pick<Entity, 'auras' | 'pos'>,
  out: { x: number; z: number },
): boolean {
  out.x = 0;
  out.z = 0;
  let drift: (typeof e.auras)[number] | null = null;
  let blast: (typeof e.auras)[number] | null = null;
  for (const a of e.auras) {
    if (a.id === WIND_PULL_AURA) {
      const speed = a.value3 ?? 0;
      const tx = a.value;
      const tz = a.value2 ?? e.pos.z;
      const dx = tx - e.pos.x;
      const dz = tz - e.pos.z;
      const len = Math.hypot(dx, dz);
      if (!(speed > 0) || len <= WIND_PULL_STOP) return false;
      const ease = Math.min(1, (len - WIND_PULL_STOP) / WIND_PULL_EASE);
      out.x = (dx / len) * speed * ease;
      out.z = (dz / len) * speed * ease;
      return true;
    }
    if (a.id === WIND_BLAST_AURA) blast = a;
    else if (a.id === WIND_DRIFT_AURA && drift === null) drift = a;
  }
  // The blast outranks the blow (it is the gust the blow pauses for).
  if (blast !== null) {
    const full = blast.value3 ?? 0;
    if (!(full > 0)) return false;
    const dx = e.pos.x - blast.value;
    const dz = e.pos.z - (blast.value2 ?? e.pos.z);
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const speed = blastSpeedAt(full, len);
    out.x = (dx / len) * speed;
    out.z = (dz / len) * speed;
    return true;
  }
  if (drift === null) return false;
  const speed = drift.value2 ?? 0;
  if (!(speed > 0)) return false;
  out.x = Math.sin(drift.value) * speed;
  out.z = Math.cos(drift.value) * speed;
  return true;
}

/** While a body walks on the ground, the steady wind's push ACROSS its walk
 *  is held to this share (its push along the walk stays whole: a headwind
 *  slows the walk, a tailwind speeds it). The owner's playtest of
 *  2026-11-25: walking in the wind felt like sliding on ice, the body
 *  crabbing sideways off the line the keys asked for; now the walk goes
 *  where it is pointed and the wind reads as a steady push on it. A body
 *  that stands is still carried whole. The pull and the blast are never
 *  steered (their whole point is the body carried). */
export const WIND_CROSS_GRIP = 0.35;

/** Is the wind carrying `e` the steady blow (not a pull or a blast, which
 *  outrank it in windDrift)? */
export function windIsSteady(e: Pick<Entity, 'auras'>): boolean {
  let steady = false;
  for (const a of e.auras) {
    if (a.id === WIND_PULL_AURA || a.id === WIND_BLAST_AURA) return false;
    if (a.id === WIND_DRIFT_AURA) steady = true;
  }
  return steady;
}

/**
 * Steer a steady drift `d` (yd/s) to a walk along the unit wish (wx, wz):
 * its component along the walk kept whole, the one across it held to
 * WIND_CROSS_GRIP. Written into `out` (may alias `d`). Pure arithmetic, the
 * same on both hosts.
 */
export function steerDriftToWalk(
  d: { x: number; z: number },
  wx: number,
  wz: number,
  out: { x: number; z: number },
): void {
  const along = d.x * wx + d.z * wz;
  const cx = d.x - along * wx;
  const cz = d.z - along * wz;
  out.x = along * wx + cx * WIND_CROSS_GRIP;
  out.z = along * wz + cz * WIND_CROSS_GRIP;
}

/** The speed of the wind carrying `e` (yd/s), 0 when none: the server's
 *  step check allows a walk plus this (server/movement_override_epoch.ts). */
export function windDriftSpeed(e: Pick<Entity, 'auras'>): number {
  let speed = 0;
  for (const a of e.auras) {
    if (a.id === WIND_PULL_AURA || a.id === WIND_BLAST_AURA) speed = Math.max(speed, a.value3 ?? 0);
    else if (a.id === WIND_DRIFT_AURA) speed = Math.max(speed, a.value2 ?? 0);
  }
  return speed;
}
