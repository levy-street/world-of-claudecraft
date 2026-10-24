// Pure plan for Olen the fallen paladin's visuals (bastion_olen_fx.ts): the
// Hallowed Brine pool's swell and fade, the Rebounding Bulwark's flight arc
// between two bodies, the Sentence of the Tide's descending column and its
// floor ring, the Unbroken Oath's bubble, and the strike flashes. Every
// answer derives from the sim's own encounter constants and the auras and
// objects every client mirrors, so the ring a player steps out of is the
// ring the sim strikes.
//
// Three-free, DOM-free, deterministic.

import { OLEN_KIT } from '../../sim/encounters/sunken_bastion/ids';

/** The gesture his rig plays as the shield flies home (VISUALS: ShieldCatch). */
export const OLEN_SHIELD_CATCH_GESTURE = 'bastion_bulwark_catch';
/** His held shield hides while it flies and shows again on the catch
 *  (VISUALS meshToggles on the rig's Shield bone). */
export const OLEN_SHIELD_AWAY_GESTURE = 'bastion_bulwark_away';
export const OLEN_SHIELD_HOME_GESTURE = 'bastion_bulwark_home';
/** The bone the shield board rides (scripts/assets/sunken_bastion_drowned/olen). */
export const OLEN_SHIELD_BONE = 'Shield';

/** The shield's flight between two bodies (the sim's hop). */
export const BULWARK_HOP_SECONDS = OLEN_KIT.bulwarkHop;
/** How high the shield's arc lifts over the straight line (yards). */
export const BULWARK_ARC = 1.6;
/** The shield flies at chest height over the floor (yards). */
export const BULWARK_HEIGHT = 1.5;
/** The shield's spin while it flies (turns a second). */
export const BULWARK_SPIN = 3.5;

/** Where the shield is `k` (0 to 1) along a leg from a to b: the straight line
 *  lifted by a parabola, written into `out` (no allocation). */
export function bulwarkFlight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  k: number,
  out: { x: number; y: number; z: number },
): void {
  const t = Math.min(1, Math.max(0, k));
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.y = ay + (by - ay) * t + BULWARK_HEIGHT + BULWARK_ARC * 4 * t * (1 - t);
}

/** The Hallowed Brine's swell: it wells up over its first second and stays;
 *  its fade when the pool dries is the painter's (the object simply goes). */
export const BRINE_WELL_SECONDS = 1;
export function brineSwell(age: number): number {
  const k = Math.min(1, Math.max(0, age / BRINE_WELL_SECONDS));
  return 1 - (1 - k) * (1 - k);
}

/** The radius the brine's water and runes were first drawn at (yd): a wider
 *  pool scales its grain by its radius over this, so it keeps its look. */
export const BRINE_DRAWN_RADIUS = 6;

/** Sprays the swell's front throws this frame round a pool of radius `radius`
 *  (about 14 a second per 6 yd of rim, so a wider pool's front is as dense):
 *  the whole part, plus one more when `roll` (0 to 1) falls under the rest. */
export function brineFrontSprays(radius: number, dt: number, roll: number): number {
  const want = 14 * (radius / BRINE_DRAWN_RADIUS) * dt;
  const whole = Math.floor(want);
  return whole + (roll < want - whole ? 1 : 0);
}

/** The Sentence's fill from its mark: 0 when it lands on the player, 1 when
 *  the column falls (the mark's time used up). */
export function sentenceFill(remaining: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remaining / duration));
}

/** The descending head of the column (yards over the mark): high in the sky
 *  at the mark, closing down toward the player as the Sentence nears (the
 *  shaft itself always stands on them). */
export const SENTENCE_SKY = 26;
export function sentenceColumnBase(fill: number): number {
  const k = Math.min(1, Math.max(0, fill));
  return SENTENCE_SKY * (1 - k * k) + 2.5 * k * k;
}

/** The column's brightness: a thin pale shaft that thickens and burns white
 *  over the last second (the warning grows loud before the strike). */
export function sentenceColumnGlow(fill: number): number {
  const k = Math.min(1, Math.max(0, fill));
  return 0.35 + 0.65 * k * k * k;
}

/** The Sentence's strike: the column slams, then fades over this. */
export const SENTENCE_STRIKE_SECONDS = 0.9;
export function sentenceStrike(age: number): { alpha: number; scale: number } {
  const k = Math.min(1, Math.max(0, age / SENTENCE_STRIKE_SECONDS));
  return { alpha: (1 - k) * (1 - k), scale: 1 + k * 0.6 };
}

/** The Unbroken Oath's bubble round the kneeling Olen (model units, before
 *  his scale): it swells in over the kneel, wobbles while it holds, and the
 *  burst blows it out. */
export const OATH_BUBBLE_RADIUS = 3.6;
export const OATH_SWELL_SECONDS = 1.5;
export function oathBubbleScale(age: number, clock: number): number {
  const k = Math.min(1, Math.max(0, age / OATH_SWELL_SECONDS));
  const ease = 1 - (1 - k) ** 3;
  return ease * (1 + 0.025 * Math.sin(clock * 2.3) + 0.015 * Math.sin(clock * 5.1));
}

/** The burst: the shell blows out and thins to nothing over this. */
export const OATH_BURST_SECONDS = 0.8;
export function oathBurst(age: number): { alpha: number; scale: number } {
  const k = Math.min(1, Math.max(0, age / OATH_BURST_SECONDS));
  return { alpha: 1 - k, scale: 1 + k * 0.9 };
}

/** A strike flash (the brine's welling, a shield impact, a soldier rising):
 *  a hot bloom that dies fast. */
export function flashAlpha(age: number, life: number): number {
  if (life <= 0) return 0;
  const k = Math.min(1, Math.max(0, age / life));
  return (1 - k) * (1 - k);
}

/** Camera jolts (amounts for the renderer's shake accumulator): the column's
 *  strike near the local player, the brine's welling, the bubble's burst. */
export const SHAKE_SENTENCE = 0.45;
export const SHAKE_BRINE = 0.18;
export const SHAKE_OATH_BURST = 0.35;
/** Jolt only a player this near the strike (yards). */
export const SHAKE_REACH = 22;
