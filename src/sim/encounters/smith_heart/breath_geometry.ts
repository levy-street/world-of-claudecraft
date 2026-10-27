// The Storm Cornice's geometry for the Guardian of the Breath (design doc
// section 7.2), pure over the layout and the authored field: who stands in
// the fight, where the wind pins a body to the rim's wall, where the gaps
// open, where Captain Thessaly's circle lands, the loose gales' paths and the
// strikes' spots. Instance-local yards throughout. No SimContext, no rng (the
// picks are hashed), so the raid bots' tactics (scripts/lib) can reuse it.

import { BREATH, CORNICE_GAPS, SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import { BREATH_TUNING as T } from './breath_ids';

const F = SMITH_HEART_FIELD;
const C = BREATH.cornice;

/** The Cornice's floor id, and its climb's (whose top lies inside the
 *  fight: the gate seals it a little west, `cornice_mouth`). */
const CORNICE_FLOOR = 'storm_cornice';
const CORNICE_CLIMB = 'cornice_climb';
/** The climb counts as the arena east of this (inside the Cornice Mouth). */
const CLIMB_ARENA_X = -66;

/** Captain Thessaly's post: at the head of the climb, inside the gate, just
 *  off the Cornice's floor (the wind never reaches an NPC). */
export const THESSALY_POST = { x: -56, z: 194.4 } as const;

/** Is instance-local (x, z) on the Cornice's fighting floor (its plateau, or
 *  the climb's top inside the gate)? */
export function inBreathArena(x: number, z: number): boolean {
  const s = authoredFieldSurfaceAt(F, x, z);
  if (!s) return false;
  if (s.id === CORNICE_FLOOR) return true;
  return s.id === CORNICE_CLIMB && x > CLIMB_ARENA_X;
}

/** Is (x, z) near the Cornice at all (its floor, its gaps, the void past
 *  its rim as far as a fall's momentum carries a body): where a body that
 *  fell is the fight's to count. */
export function nearCornice(x: number, z: number): boolean {
  return Math.hypot((x - C.x) / (C.rx + 30), (z - C.z) / (C.rz + 30)) <= 1;
}

/** The gap whose throat (x, z) lies in, or null. */
export function gapAt(x: number, z: number): (typeof CORNICE_GAPS)[number] | null {
  for (const g of CORNICE_GAPS) if (Math.hypot(x - g.x, z - g.z) <= g.r) return g;
  return null;
}

/** Is a body at (x, z), the wind blowing toward `heading` (radians), pressed
 *  against the rim's wall? The floor ends within `pinReach` downwind of it,
 *  and that lip is walled (no gap there: a gap is a fall, not a pin). */
export function pinnedAgainstRim(x: number, z: number, heading: number): boolean {
  if (!inBreathArena(x, z)) return false;
  const px = x + Math.sin(heading) * T.pinReach;
  const pz = z + Math.cos(heading) * T.pinReach;
  if (authoredFieldSurfaceAt(F, px, pz)) return false;
  return gapAt(px, pz) === null && gapAt(x, z) === null;
}

/** Has a body at (x, z, local height y) gone over the Cornice's lip and come
 *  to rest in the void (a fall lands on the void's floor; a throw over a gap
 *  can seat a body there outright)? Either way it is dead. */
export function fellFromCornice(x: number, z: number, y: number, onGround: boolean): boolean {
  if (!nearCornice(x, z)) return false;
  return (onGround && y < C.h - T.voidDepth) || y < F.voidHeight + 3;
}

/** Where Thessaly's circle lands: `reach` yards upwind of the guardian (the
 *  wind blowing toward `bearingDeg`), drawn in toward it until the whole
 *  circle stands on the Cornice's floor clear of every gap. */
export function calmCircleSpot(
  guardian: { x: number; z: number },
  bearingDeg: number,
  reach: number = T.circleReach,
): { x: number; z: number } {
  const up = ((bearingDeg + 180) * Math.PI) / 180;
  for (let d = reach; d >= 0; d -= 1) {
    const x = guardian.x + Math.sin(up) * d;
    const z = guardian.z + Math.cos(up) * d;
    if (circleClear(x, z, T.circleR)) return { x, z };
  }
  return { x: guardian.x, z: guardian.z };
}

/** Does a disc of radius `r` at (x, z) stand wholly on the Cornice's floor,
 *  clear of the gaps? */
export function circleClear(x: number, z: number, r: number): boolean {
  if (!inBreathArena(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const px = x + Math.sin(a) * r;
    const pz = z + Math.cos(a) * r;
    if (!inBreathArena(px, pz)) return false;
  }
  for (const g of CORNICE_GAPS) if (Math.hypot(x - g.x, z - g.z) < g.r + r + 2) return false;
  return true;
}

/** Loose gale `k`'s place `t` seconds into its run (heroic): a slow, wide,
 *  deterministic wander over the Cornice (an ellipse on two incommensurate
 *  beats), never out to the rim. */
export function looseGalePos(k: number, t: number): { x: number; z: number } {
  const rx = [26, 18, 32][k % 3];
  const rz = [16, 22, 12][k % 3];
  const wa = [0.23, -0.31, 0.19][k % 3];
  const wb = [0.37, 0.29, -0.41][k % 3];
  const pa = (k * 2.1) % (Math.PI * 2);
  const pb = (k * 1.3 + 0.7) % (Math.PI * 2);
  return { x: C.x + Math.sin(wa * t + pa) * rx, z: C.z + 2 + Math.sin(wb * t + pb) * rz };
}

/** A small integer hash (no rng in a pick). */
export function breathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A barrage strike's spot (the storm breaking): the `n`-th spot of a pull
 *  salted by `salt`, hashed over the Cornice's floor (clear of the gaps, so
 *  every strike is dodged by stepping, never by a fall). */
export function barrageSpot(salt: number, n: number): { x: number; z: number } {
  for (let tries = 0; tries < 24; tries++) {
    const h = breathHash(salt, n * 31 + tries);
    const a = ((h & 0xffff) / 0x10000) * Math.PI * 2;
    const r = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * 0.82;
    const x = C.x + Math.sin(a) * C.rx * r;
    const z = C.z + Math.cos(a) * C.rz * r;
    if (circleClear(x, z, T.strikeR * 0.5)) return { x, z };
  }
  return { x: C.x, z: C.z };
}
