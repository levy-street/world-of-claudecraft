// Pure plan of the Quench guardian's effects (quench_fx.ts paints them;
// docs/design/raid/smith_heart.md, section 7.3): what Tempering Strike and
// Quenching Breath look like. Presentation only: the sim's numbers (the
// strike's arc and reach, the breath's cone, its range and its bar) are read
// here, never changed. Quenching Breath's footprint is drawn through the
// shared floor telegraph on every graphics tier (the cone at its exact
// angle and range, aimed where the bar locked it, filling with the bar);
// Tempering Strike has no bar (a swing cleave, like the Hammer's
// Hammerfall), so it carries no telegraph, only its blow. The frost, the
// mist and the ice are the cosmetic layers.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  SMITH_HEART_CASTS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../../sim/content/smith_heart';
import { fxHash } from './hammer_fx_core';

/** The guardian whose kit these effects dress. */
export const QUENCH_GUARDIAN = SMITH_HEART_GUARDIANS.quench;
/** Its cast: the freezing breath down a cone. */
export const QUENCHING_BREATH = SMITH_HEART_CASTS.quenchBreath;

/** The sim's own numbers (read, never tuned here). */
export function quenchGuardianKit(): {
  strikeArcDeg: number;
  strikeRange: number;
  breathArcDeg: number;
  breathRange: number;
  breathCast: number;
} {
  const m = SMITH_HEART_MOBS[QUENCH_GUARDIAN];
  const cone = m?.trashKit?.cone;
  return {
    strikeArcDeg: m?.arcCleave?.arcDeg ?? 100,
    strikeRange: m?.arcCleave?.range ?? 8,
    breathArcDeg: cone?.arcDeg ?? 70,
    breathRange: cone?.range ?? 22,
    breathCast: cone?.castTime ?? 2.5,
  };
}

/** The palette (linear 0..1): the cold's white mist, the ice's blues, the
 *  frost left on the floor. A threat colour is the telegraph's, never these. */
export const QUENCH_FX_COLORS = {
  mist: [0.64, 0.76, 0.9] as const,
  mistShade: [0.5, 0.6, 0.7] as const,
  ice: [0.6, 0.82, 0.96] as const,
  iceDeep: [0.22, 0.46, 0.66] as const,
  glint: [0.82, 0.95, 1.0] as const,
  frost: [0.78, 0.88, 0.96] as const,
  /** Shock rings (hex for the shared ring pool). */
  ring: 0xe0f4ff,
  ringCold: 0x8fd2f4,
  /** The telegraph's element accent (the threat colour is the kit's). */
  accent: 0xbfeaff,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** Quenching Breath over its bar (`progress` 0..1): the cold drawn in to the
 *  guardian's maw (how hard), the frost creeping out over the cone's floor
 *  (how far, a share of its range), the glints winking in the cone. */
export function breathChargeLook(progress: number): {
  draw: number;
  creep: number;
  glints: number;
} {
  return {
    draw: breathDraw(progress),
    creep: breathCreep(progress),
    glints: breathGlints(progress),
  };
}

/** The look's three terms as scalars (the per-frame painter allocates nothing). */
export function breathDraw(progress: number): number {
  return 0.25 + 0.75 * smooth(clamp01(progress) / 0.8);
}
export function breathCreep(progress: number): number {
  return smooth((clamp01(progress) - 0.15) / 0.85);
}
export function breathGlints(progress: number): number {
  return smooth((clamp01(progress) - 0.4) / 0.6);
}

/** Seconds the breath's freezing gust takes to sweep out to the cone's end,
 *  and the frost it leaves lies on the floor. */
export const BREATH_SWEEP_SECONDS = 0.6;
export const BREATH_FROST_SECONDS = 3.2;

/** The breath `elapsed` seconds after it landed: how far out its front has
 *  run (a share of the range), the mist's alpha, the frost's on the floor. */
export function breathBlastLook(elapsed: number): { front: number; mist: number; frost: number } {
  if (elapsed < 0) return { front: 0, mist: 0, frost: 0 };
  const t = clamp01(elapsed / BREATH_SWEEP_SECONDS);
  const front = 1 - (1 - t) ** 2.2;
  const after = Math.max(0, elapsed - BREATH_SWEEP_SECONDS);
  return {
    front,
    mist: elapsed < BREATH_SWEEP_SECONDS ? 0.9 : Math.max(0, 0.9 - after / 0.7),
    frost: breathFrost(elapsed),
  };
}

/** The frost the breath leaves on the floor `elapsed` seconds in (0..1). */
export function breathFrost(elapsed: number): number {
  if (elapsed < 0) return 0;
  return Math.max(0, Math.min(1, elapsed / 0.4)) * Math.max(0, 1 - elapsed / BREATH_FROST_SECONDS);
}

/** Seconds Tempering Strike's ice stands in its arc before it shatters, and
 *  the shards' fall after. */
export const STRIKE_RISE_SECONDS = 0.18;
export const STRIKE_HOLD_SECONDS = 0.55;
export const STRIKE_FROST_SECONDS = 2.2;

/** Tempering Strike `elapsed` seconds after its blow: how far its spikes of
 *  ice have thrust up (0..1, then they shatter), the frost on the floor. */
export function strikeLook(elapsed: number): { rise: number; shatter: boolean; frost: number } {
  if (elapsed < 0) return { rise: 0, shatter: false, frost: 0 };
  return {
    rise: strikeRise(elapsed),
    shatter: elapsed >= STRIKE_RISE_SECONDS + STRIKE_HOLD_SECONDS,
    frost: strikeFrost(elapsed),
  };
}

/** How far the strike's ice has thrust up `elapsed` seconds in (0..1). */
export function strikeRise(elapsed: number): number {
  if (elapsed < 0) return 0;
  return elapsed < STRIKE_RISE_SECONDS
    ? smooth(elapsed / STRIKE_RISE_SECONDS)
    : elapsed < STRIKE_RISE_SECONDS + STRIKE_HOLD_SECONDS
      ? 1
      : 0;
}

/** The frost the strike leaves on the floor `elapsed` seconds in (0..1). */
export function strikeFrost(elapsed: number): number {
  return elapsed < 0 ? 0 : Math.max(0, 1 - elapsed / STRIKE_FROST_SECONDS);
}

/** One spike of ice in Tempering Strike's arc (the guardian's frame: +z its
 *  facing, x across), its height and lean. */
export interface StrikeSpike {
  x: number;
  z: number;
  height: number;
  lean: number;
  yaw: number;
}

/** Tempering Strike's spikes: rows thrusting up in its arc, taller toward
 *  the middle of the reach, every one inside the arc and the reach (the
 *  effect never strays past what it hits). Deterministic per `seed`. */
export function strikeSpikes(
  seed: number,
  arcDeg: number,
  range: number,
  count = 18,
): StrikeSpike[] {
  const half = (arcDeg * Math.PI) / 360;
  const out: StrikeSpike[] = [];
  for (let i = 0; i < count; i++) {
    const a = (fxHash(seed, i * 3) * 2 - 1) * half * 0.9;
    const r = range * (0.3 + 0.62 * fxHash(seed, i * 3 + 1));
    const mid = 1 - Math.abs(r / range - 0.6) * 1.4;
    out.push({
      x: Math.sin(a) * r,
      z: Math.cos(a) * r,
      height: 1.6 + 3.0 * Math.max(0.2, mid) * (0.7 + 0.3 * fxHash(seed, i * 3 + 2)),
      lean: 0.25 + 0.3 * fxHash(seed, i + 50),
      yaw: a,
    });
  }
  return out;
}

/** Pool sizes at full density (the low tier thins the emitted counts). */
export const QUENCH_FX_POOLS = {
  /** Strike sets: the guardian's two in flight and the four blades' echoes. */
  spikes: 6,
  spikesPerStrike: 18,
  /** Breath sets: the guardian's and the four blades' echoes. */
  breaths: 5,
  /** The frost fans: every breath and strike set's, one creeping. */
  frosts: 12,
  telegraphs: 2,
} as const;
