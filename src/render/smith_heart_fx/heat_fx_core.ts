// Pure plan of the Heat guardian's effects (heat_fx.ts paints them;
// docs/design/raid/smith_heart.md, section 7.4): what Molten Pour and Searing
// Knell look like over their bars and when they land. Presentation only: the
// sim's numbers (the pour's lane, its length and width, the knell's radius,
// both bars) are read here, never changed. Both casts' footprints are drawn
// through the shared floor telegraph on every graphics tier (the pour's lane
// at its exact length and width, aimed where the bar locked it; the knell's
// ring at its exact radius; both filling with the bar). The first flame's
// fire, its sparks and its smoke are the cosmetic layers over them.
//
// The Heat is the Hearth (phase 2I): white-gold fire, never volcanic red;
// the threat colour is the telegraph's, never these.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  SMITH_HEART_CASTS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../../sim/content/smith_heart';
import { fxHash } from './hammer_fx_core';

/** The guardian whose kit these effects dress. */
export const HEAT_GUARDIAN = SMITH_HEART_GUARDIANS.heat;
/** Its casts: the fire poured down a lane, the knell that stuns all close
 *  (its id keeps its old name, `heart_anvil_clang`). */
export const MOLTEN_POUR = SMITH_HEART_CASTS.heatPour;
export const SEARING_KNELL = SMITH_HEART_CASTS.heatClang;

/** The sim's own numbers (read, never tuned here). */
export function heatGuardianKit(): {
  pourLength: number;
  pourHalfWidth: number;
  pourCast: number;
  knellRadius: number;
  knellCast: number;
} {
  const k = SMITH_HEART_MOBS[HEAT_GUARDIAN]?.trashKit;
  return {
    pourLength: k?.line?.length ?? 30,
    pourHalfWidth: k?.line?.halfWidth ?? 3,
    pourCast: k?.line?.castTime ?? 2,
    knellRadius: k?.screech?.radius ?? 10,
    knellCast: k?.screech?.castTime ?? 2.5,
  };
}

/** The palette (linear 0..1): the first flame's white-gold, its gold body,
 *  the dark of the cooled crust, the smoke. */
export const HEAT_FX_COLORS = {
  core: [1.0, 0.94, 0.76] as const,
  fire: [1.0, 0.72, 0.3] as const,
  deep: [0.78, 0.4, 0.1] as const,
  crust: [0.09, 0.075, 0.065] as const,
  spark: [1.0, 0.82, 0.48] as const,
  smoke: [0.3, 0.27, 0.25] as const,
  ash: [0.48, 0.45, 0.41] as const,
  /** Shock rings (hex for the shared ring pool). */
  ring: 0xffe6b0,
  ringGold: 0xffb848,
  /** The telegraphs' element accent (the threat colour is the kit's). */
  accent: 0xffe6a0,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

// ---- Molten Pour ---------------------------------------------------------------------

/** Molten Pour over its bar (`progress` 0..1): the fire gathering at the
 *  guardian (how hard), how far down the lane the floor's seams have lit (a
 *  share of its length), the sparks thrown along it. As scalars: the
 *  per-frame painter allocates nothing. */
export function pourGather(progress: number): number {
  return 0.25 + 0.75 * smooth(clamp01(progress) / 0.85);
}
export function pourSeams(progress: number): number {
  return smooth((clamp01(progress) - 0.1) / 0.9);
}
export function pourSparks(progress: number): number {
  return smooth((clamp01(progress) - 0.45) / 0.55);
}

/** Seconds the poured fire takes to run to the lane's end, and the lane
 *  stays molten after (cooling to a dark crust, smoking). */
export const POUR_RUN_SECONDS = 0.38;
export const POUR_MOLTEN_SECONDS = 3.4;

/** The pour `elapsed` seconds after it landed: how far its front has run (a
 *  share of the length), how hot the lane burns (1 white-gold, 0 cold), how
 *  far it has crusted over, the front's wave of fire. */
export function pourFlowLook(elapsed: number): {
  front: number;
  heat: number;
  crust: number;
  wave: number;
} {
  if (elapsed < 0 || elapsed > POUR_MOLTEN_SECONDS) return { front: 0, heat: 0, crust: 0, wave: 0 };
  const t = clamp01(elapsed / POUR_RUN_SECONDS);
  const front = 1 - (1 - t) ** 2.4;
  const after = Math.max(0, elapsed - POUR_RUN_SECONDS);
  const span = POUR_MOLTEN_SECONDS - POUR_RUN_SECONDS;
  return {
    front,
    heat: 1 - smooth(after / span),
    crust: smooth((after / span - 0.15) / 0.6),
    wave: elapsed < POUR_RUN_SECONDS + 0.2 ? 1 - smooth((elapsed - POUR_RUN_SECONDS) / 0.2) : 0,
  };
}

/** The seams of fire lighting down the pour's lane over its bar: wandering
 *  lines from the guardian (local +z, x across), every point inside the
 *  lane's half width (the effect never strays past what it hits). */
export function pourSeamPaths(
  seed: number,
  length: number,
  halfWidth: number,
  count = 4,
  steps = 16,
): { x: number; z: number; t: number }[][] {
  const out: { x: number; z: number; t: number }[][] = [];
  const amp = halfWidth * 0.8;
  for (let k = 0; k < count; k++) {
    const pts: { x: number; z: number; t: number }[] = [];
    let x = (fxHash(seed, k * 31) - 0.5) * halfWidth * 0.6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      x += (fxHash(seed + k, i * 7 + 3) - 0.5) * halfWidth * 0.45;
      x = Math.max(-amp, Math.min(amp, x));
      pts.push({ x, z: length * t, t });
    }
    out.push(pts);
  }
  return out;
}

// ---- Searing Knell -------------------------------------------------------------------

/** Searing Knell over its bar (`progress` 0..1): the fire gathered into a
 *  sphere at the guardian (its size), the cracks of fire running out over
 *  the floor toward the ring's edge (a share of its radius), the heat's
 *  shimmer round it. */
export function knellGather(progress: number): number {
  return smooth(clamp01(progress) / 0.9);
}
export function knellCracks(progress: number): number {
  return smooth((clamp01(progress) - 0.05) / 0.85);
}

/** Seconds the knell's wave takes to ring out to its radius. */
export const KNELL_WAVE_SECONDS = 0.42;

/** The knell `elapsed` seconds after it landed: its wave's radius (out to
 *  the stun's edge, never past it), its wall's height and alpha, the flash
 *  at the guardian, the cracks' afterglow. */
export function knellBlastLook(
  elapsed: number,
  radius: number,
): { front: number; height: number; alpha: number; flash: number; glow: number } {
  if (elapsed < 0) return { front: 0, height: 0, alpha: 0, flash: 0, glow: 0 };
  const t = clamp01(elapsed / KNELL_WAVE_SECONDS);
  const ease = 1 - (1 - t) ** 2.6;
  const after = Math.max(0, elapsed - KNELL_WAVE_SECONDS);
  return {
    front: radius * ease,
    height: 1.2 + 3.4 * (1 - t),
    alpha: elapsed < KNELL_WAVE_SECONDS ? 0.95 : Math.max(0, 0.95 - after / 0.35),
    flash: Math.max(0, 1 - elapsed / 0.3),
    glow: Math.max(0, 1 - elapsed / 1.6),
  };
}

/** The knell's cracks: radial lines of fire from the guardian out to the
 *  ring's edge, branching once, every point inside the radius. */
export function knellCrackPaths(
  seed: number,
  radius: number,
  count = 9,
  steps = 10,
): { x: number; z: number; t: number }[][] {
  const out: { x: number; z: number; t: number }[][] = [];
  for (let k = 0; k < count; k++) {
    let a = ((k + fxHash(seed, k) * 0.6) / count) * Math.PI * 2;
    const reach = radius * (0.72 + 0.26 * fxHash(seed, k + 40));
    const pts: { x: number; z: number; t: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      a += (fxHash(seed + k, i + 90) - 0.5) * 0.32;
      const r = 1.2 + (reach - 1.2) * t;
      pts.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, t });
    }
    out.push(pts);
  }
  return out;
}

/** Pool sizes at full density (the low tier thins the emitted counts). */
export const HEAT_FX_POOLS = {
  telegraphs: 2,
  flows: 2,
} as const;
