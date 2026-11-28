// The Guardian of the Heat's thrown Hearthseeds as numbers (pass 4; the
// painter is heat_meteor_fx.ts). The sim throws the seeds (the seedThrow cue,
// each seed's object and footprint at once) and lands each one seedFlight
// later on its own spot (the seed cue): the meteors ARE the seeds. The body
// plays its Throw clip on the throw cue: both hands plunge into the lava and
// scoop (a molten mass gathers between them), heave it high over its head,
// and fling it on the clip's release beat; from there each meteor arcs high
// to its seed's spot and strikes it on the sim's landing time, leaving a
// crater whose molten cracks cool.
//
// The meteors carry no gameplay of their own: the seed's footprint (the
// shared floor field, every tier) shows from the throw on and is what a
// player reads; a meteor lands exactly on it, exactly when the sim lands it.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import { HEAT_BODY_CLIP, HEAT_FX_GROW } from './heat_body_core';

export const HEAT_METEOR = {
  /** The molten mass starts gathering between the hands (the scoop). */
  gather: HEAT_BODY_CLIP.throwScoop,
  /** The meteors leave the hands (the clip's release beat). */
  release: HEAT_BODY_CLIP.throwRelease,
  /** They strike the floor (the sim's landing: seedFlight after the throw). */
  land: T.seedFlight,
  /** How high over the line between the hands and the spot an arc peaks,
   *  plus its share of the distance (yards). */
  apex: 5 * HEAT_FX_GROW,
  apexPerYard: 0.14,
  /** A meteor's rock radius and its glow (yards). */
  size: 1.05 * HEAT_FX_GROW,
  glow: 4.2 * HEAT_FX_GROW,
  /** The crater left where it struck (yards) and how long it cools. */
  craterR: 3.4,
  craterSeconds: 6,
} as const;

/** How long a meteor flies (the release to the landing). */
export function meteorFlightSeconds(): number {
  return Math.max(0.2, HEAT_METEOR.land - HEAT_METEOR.release);
}

export interface MeteorPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A meteor `k` (0..1) of the way along its arc from `from` (the hands at the
 * release) to `to` (its spot on the floor): a ballistic arc, even ground
 * speed, peaking `apex + apexPerYard * distance` over the chord. Lands
 * exactly on `to` at k = 1.
 */
export function meteorArc(
  from: MeteorPoint,
  to: MeteorPoint,
  k: number,
  out: MeteorPoint = { x: 0, y: 0, z: 0 },
): MeteorPoint {
  const c = Math.max(0, Math.min(1, k));
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const h = HEAT_METEOR.apex + HEAT_METEOR.apexPerYard * d;
  out.x = from.x + (to.x - from.x) * c;
  out.z = from.z + (to.z - from.z) * c;
  out.y = from.y + (to.y - from.y) * c + 4 * h * c * (1 - c);
  return out;
}

export interface MeteorLook {
  /** The mass gathering in the hands (0..1; 0 once thrown). */
  gather: number;
  /** In the air: its share of the flight (0..1), or -1 before or after. */
  flight: number;
  /** Struck (the landing beat passed). */
  landed: boolean;
}

/** A throw `age` seconds after its cue. */
export function meteorLook(
  age: number,
  out: MeteorLook = { gather: 0, flight: -1, landed: false },
): MeteorLook {
  const M = HEAT_METEOR;
  out.landed = age >= M.land;
  if (age < M.release) {
    const g = Math.max(0, Math.min(1, (age - M.gather) / Math.max(0.05, M.release - M.gather)));
    out.gather = g * g * (3 - 2 * g);
    out.flight = -1;
    return out;
  }
  out.gather = 0;
  out.flight = out.landed ? -1 : (age - M.release) / meteorFlightSeconds();
  return out;
}

/** The crater `since` seconds after the strike: its flash (0..1) and the
 *  molten cracks' glow (cooling to nothing). */
export function meteorCraterLook(
  since: number,
  out: { flash: number; glow: number } = { flash: 0, glow: 0 },
): { flash: number; glow: number } {
  if (since < 0) {
    out.flash = 0;
    out.glow = 0;
    return out;
  }
  const f = Math.max(0, 1 - since / 0.3);
  out.flash = f * f;
  out.glow = (1 - Math.max(0, Math.min(1, since / HEAT_METEOR.craterSeconds))) ** 1.5;
  return out;
}

/** A small integer hash in [0, 1). */
export function meteorHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c9277b5) ^ Math.imul(b | 0, 0x6b43a9b5)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
