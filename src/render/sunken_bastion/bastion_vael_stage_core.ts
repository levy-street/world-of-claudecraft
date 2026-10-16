// Pure plan for Vael's staging on the Beacon Crown (bastion_vael_stage_fx.ts):
// his entrance eruptions (a soul-fire pillar, a floor shockwave and a flash at
// every rise, the last one at his place the biggest, with the camera shake),
// the fog gathering on the crown before each Fog Veil (a vortex closing from
// the rim onto him while a green glow builds on his body), the scythe's impact
// flash at every step of the Shadow Crossing, and which casts are his rises
// out of the roof. Every timing derives from the sim's own encounter
// constants, so the effect lands on the beat the sim resolves.
//
// Three-free, DOM-free, deterministic.

import {
  CROWN as BEACON_CROWN,
  VAEL_HOME,
  VAEL_INTRO_RISE,
  VAEL_TUNING,
  VAEL_VEIL_RISE,
} from '../../sim/encounters/sunken_bastion/ids';

/** His rises out of the roof: the veil's (all four figures) and the entrance's.
 *  Both play Emerge at the veil's pace, so both get the boil and the fog. */
export const VAEL_RISE_CASTS: ReadonlySet<string> = new Set([VAEL_VEIL_RISE, VAEL_INTRO_RISE]);

export function isVaelRiseCast(cast: string | null | undefined): boolean {
  return cast !== null && cast !== undefined && VAEL_RISE_CASTS.has(cast);
}

/** Is an instance-local spot his own place (the entrance's last rise)? */
export function isVaelHome(lx: number, lz: number): boolean {
  return Math.hypot(lx - VAEL_HOME.x, lz - VAEL_HOME.z) < 1.5;
}

/** How long an entrance eruption plays: the rise, then a breath of afterglow. */
export const ERUPTION_SECONDS = VAEL_TUNING.veilRiseSeconds + 0.7;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The soul-fire pillar over a rise `age` seconds in: it bursts up out of the
 *  flags in a fifth of a second, burns through the rise and dies after it.
 *  The last rise (`home`) is taller and wider. */
export function eruptionPillar(
  age: number,
  home: boolean,
): { alpha: number; height: number; radius: number } {
  if (age < 0 || age >= ERUPTION_SECONDS) return { alpha: 0, height: 0, radius: 0 };
  const up = clamp01(age / 0.2);
  const rise = VAEL_TUNING.veilRiseSeconds;
  const fade = age <= rise ? 1 : 1 - clamp01((age - rise) / (ERUPTION_SECONDS - rise));
  const tall = home ? 30 : 18;
  return {
    alpha: up * fade,
    height: tall * (0.35 + 0.65 * (1 - (1 - up) * (1 - up))),
    radius: (home ? 4.4 : 3) * (0.6 + 0.4 * up) * (1 + 0.25 * (1 - fade)),
  };
}

/** The shockwave rolling out over the flags from a rise: a ring that races
 *  out and thins away in 1.1 s (wider at his place). */
export const SHOCKWAVE_SECONDS = 1.1;
export function eruptionShockwave(age: number, home: boolean): { radius: number; alpha: number } {
  if (age < 0 || age >= SHOCKWAVE_SECONDS) return { radius: 0, alpha: 0 };
  const k = age / SHOCKWAVE_SECONDS;
  const out = 1 - (1 - k) * (1 - k);
  return { radius: 1.5 + out * (home ? 20 : 12), alpha: 1 - k * k };
}

/** The flash at a rise's first instant: a white-green bloom, gone in 0.45 s. */
export const FLASH_SECONDS = 0.45;
export function eruptionFlash(age: number, home: boolean): number {
  if (age < 0 || age >= FLASH_SECONDS) return 0;
  const k = age / FLASH_SECONDS;
  return (home ? 1 : 0.7) * (1 - k) * (1 - k * 0.5);
}

/** Camera trauma at a rise (the renderer's shake accumulator): a jolt at each
 *  stop, a real quake when he takes his place. */
export function eruptionShake(home: boolean): number {
  return home ? 0.85 : 0.3;
}

// ---- the fog gathering before the veil ---------------------------------------------------

/** How long the fog takes to clear off the crown once the figures rise. */
export const GATHER_FADE_SECONDS = 0.8;

/** The fog vortex over the crown, `p` (0..1) through the gathering bar plus
 *  its sink (the whole 3.2 s): a wall of fog rolls in from the rim and
 *  tightens onto the crown's heart, darker and faster as it closes. */
export function gatherVortex(p: number): {
  outer: number;
  inner: number;
  alpha: number;
  swirl: number;
} {
  const k = clamp01(p);
  const ease = k * k * (3 - 2 * k);
  const outer = BEACON_CROWN.r + 3 - ease * (BEACON_CROWN.r - 8);
  const inner = Math.max(1.2, BEACON_CROWN.r - 3 - ease * (BEACON_CROWN.r - 3));
  return {
    outer,
    inner: Math.min(inner, outer - 2),
    alpha: clamp01(k / 0.15) * (0.55 + 0.4 * ease),
    swirl: 0.4 + 2.2 * ease,
  };
}

/** The green glow building on Vael while the fog gathers (0..1). */
export function gatherGlow(p: number): number {
  const k = clamp01(p);
  return k * k;
}

/** The share of the gathering run when `elapsed` seconds into it (the bar and
 *  the sink as one clock). */
export function gatherProgress(elapsed: number): number {
  const total = VAEL_TUNING.veilGatherSeconds + VAEL_TUNING.vanishSeconds;
  return total > 0 ? clamp01(elapsed / total) : 1;
}

// ---- the scythe's impact ------------------------------------------------------------------

/** The flash where the blade lands at each step of the chain. */
export const SWEEP_FLASH_SECONDS = 0.35;
export function sweepFlash(age: number): number {
  if (age < 0 || age >= SWEEP_FLASH_SECONDS) return 0;
  const k = age / SWEEP_FLASH_SECONDS;
  return 1 - k * k;
}
