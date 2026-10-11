// Pure plans for the Buried Hoard encounter accents
// (src/render/hoard_encounter_accents.ts): the ground that ruptures when one of
// Warlord Grask's frontals lands, and the closing reticle under a hoard mob
// that is casting an interruptible control. DOM-free and Three-free, so the
// numbers the look is built on are pinned by a Node test.
//
// Accents are COSMETIC. The frontal's actionable warning is the floor telegraph
// in hoard_boss_fx.ts and the control cast's actionable warning is the overhead
// cast bar; both exist without anything here, so the low tier sheds it all.

import { hoardHash } from './hoard_boss_dressing_core';

/** Rock spikes thrown up by one landed frontal. */
export const HOARD_SLAM_SHARD_COUNT = 18;
/** Seconds a rupture lives: a fast heave, a short hold, a slow sink. */
export const HOARD_SLAM_SEC = 1.1;
/** A frontal cue that vanishes with more than this left was cancelled (the boss
 *  died or reset), not landed, so nothing ruptures. */
export const HOARD_SLAM_LANDED_WITHIN_SEC = 0.3;

export interface HoardSlamShardPlan {
  /** Bearing inside the cone, as a fraction of its half angle (-1 to 1). */
  angleFraction: number;
  /** Distance from the boss, as a fraction of the cone's reach. */
  radiusFraction: number;
  height: number;
  girth: number;
  /** Lean away from the boss, in radians. */
  lean: number;
  /** Seconds after the hit this spike starts to rise: the rupture travels
   *  outward from the boss like a shockwave, never all at once. */
  delay: number;
}

export function hoardSlamShards(cueId: number): HoardSlamShardPlan[] {
  const out: HoardSlamShardPlan[] = [];
  for (let index = 0; index < HOARD_SLAM_SHARD_COUNT; index++) {
    // Square-root spread fills the cone evenly by area instead of crowding the tip.
    const radiusFraction = 0.22 + Math.sqrt(hoardHash(cueId, index, 11)) * 0.76;
    const big = hoardHash(cueId, index, 12) > 0.7;
    out.push({
      angleFraction: (hoardHash(cueId, index, 13) * 2 - 1) * 0.92,
      radiusFraction,
      height: (big ? 3.2 : 1.6) + hoardHash(cueId, index, 14) * (big ? 1.6 : 1.0),
      girth: (big ? 1.0 : 0.6) + hoardHash(cueId, index, 15) * 0.4,
      lean: 0.25 + hoardHash(cueId, index, 16) * 0.35,
      delay: radiusFraction * 0.16,
    });
  }
  return out;
}

/** How far out of the ground a spike is at `age` seconds (0 to 1): it punches
 *  up in under a tenth of a second, overshoots, holds, then sinks. */
export function hoardSlamRise(age: number, delay: number): number {
  const local = age - delay;
  if (local <= 0) return 0;
  const punch = Math.min(1, local / 0.09);
  const overshoot = 1 + 0.18 * Math.sin(Math.min(1, local / 0.22) * Math.PI);
  const sinkStart = HOARD_SLAM_SEC * 0.5;
  const sink =
    local <= sinkStart ? 1 : Math.max(0, 1 - (local - sinkStart) / (HOARD_SLAM_SEC * 0.45));
  return punch * overshoot * sink * sink;
}

export interface HoardSlamShockPlan {
  /** Shock arc radius as a fraction of the cone's reach. */
  scale: number;
  opacity: number;
  /** Ground scorch under the cone. */
  scorchOpacity: number;
}

/** The shock arc races from the boss to the edge of the cone and burns out. */
export function hoardSlamShock(age: number): HoardSlamShockPlan {
  const t = Math.max(0, Math.min(1, age / 0.32));
  const eased = 1 - (1 - t) * (1 - t) * (1 - t);
  const life = Math.max(0, 1 - age / HOARD_SLAM_SEC);
  return {
    scale: 0.12 + eased * 0.93,
    opacity: (1 - t * t) * 0.95,
    scorchOpacity: life * life * 0.32,
  };
}

export type HoardControlSigilSchool = 'shadow' | 'nature';

export interface HoardControlSigilPlan {
  /** Outer ring scale (yards). */
  outer: number;
  /** Inner ring scale: it closes on the caster as the cast completes, so the
   *  moment the rings meet is the moment the control lands. */
  inner: number;
  opacity: number;
  /** Column height multiplier and opacity: it swells as the cast nears its end. */
  spin: number;
}

/** `progress` is 0 at the start of the cast and 1 when it lands. */
export function hoardControlSigil(
  progress: number,
  elapsed: number,
  casterScale: number,
  calm = false,
): HoardControlSigilPlan {
  const p = Math.max(0, Math.min(1, progress));
  const outer = 1.5 + Math.max(0.6, casterScale) * 0.7;
  // The last third pulses faster: an audible-feeling urgency without sound.
  const rate = 6 + p * 16;
  const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * rate);
  return {
    outer,
    inner: outer * (1 - p * 0.82),
    opacity: 0.55 + 0.4 * pulse * (0.4 + 0.6 * p),
    spin: calm ? 0 : 1.4 + p * 3.2,
  };
}
