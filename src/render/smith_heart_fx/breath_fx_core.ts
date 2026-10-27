// Pure plan of the Breath guardian's effects (breath_fx.ts paints them;
// docs/design/raid/smith_heart.md, section 7.2): what Bellows Gust and Storm
// Lance look like over their bars and when they land. Presentation only: the
// sim's numbers (the gust's radius and shove, the lance's length and width,
// both bars) are read here, never changed. Both casts' footprints are drawn
// through the shared floor telegraph on every graphics tier (the gust's ring
// at its exact radius, the lance's lane at its exact length and width, both
// filling with the bar); the wind, the lightning and the debris are the
// cosmetic layers over them.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  SMITH_HEART_CASTS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../../sim/content/smith_heart';
import { fxHash } from './hammer_fx_core';

/** The guardian whose kit these effects dress. */
export const BREATH_GUARDIAN = SMITH_HEART_GUARDIANS.breath;
/** Its casts: the gust that throws the raid back, the lance down a lane. */
export const BELLOWS_GUST = SMITH_HEART_CASTS.breathGust;
export const STORM_LANCE = SMITH_HEART_CASTS.breathLance;

/** The sim's own numbers (read, never tuned here). */
export function breathGuardianKit(): {
  gustRadius: number;
  gustShove: number;
  gustCast: number;
  lanceLength: number;
  lanceHalfWidth: number;
  lanceCast: number;
} {
  const k = SMITH_HEART_MOBS[BREATH_GUARDIAN]?.trashKit;
  return {
    gustRadius: k?.wingGust?.radius ?? 12,
    gustShove: k?.wingGust?.knockback ?? 10,
    gustCast: k?.wingGust?.castTime ?? 2,
    lanceLength: k?.line?.length ?? 34,
    lanceHalfWidth: k?.line?.halfWidth ?? 2.5,
    lanceCast: k?.line?.castTime ?? 2,
  };
}

/** The palette (linear 0..1): the gale's white, the storm's teal-white
 *  lightning. A threat colour is the telegraph's, never these. */
export const BREATH_FX_COLORS = {
  wind: [0.86, 0.93, 0.98] as const,
  windShade: [0.5, 0.58, 0.66] as const,
  spark: [0.62, 0.9, 1.0] as const,
  boltCore: [0.92, 0.98, 1.0] as const,
  boltEdge: [0.36, 0.78, 1.0] as const,
  scorch: [0.08, 0.1, 0.13] as const,
  grit: [0.36, 0.38, 0.42] as const,
  /** Shock rings (hex for the shared ring pool). */
  ring: 0xd8f2ff,
  ringStorm: 0x6fd0f4,
  /** The telegraphs' element accent (the threat colour is the kit's). */
  accent: 0x9fe4ff,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** Bellows Gust over its bar (`progress` 0..1): the breath drawn in toward
 *  the guardian (how hard), the loose stones lifted into its whirl (how
 *  high, how fast they turn), the whirl's tightening radius. */
export function gustChargeLook(progress: number): {
  inhale: number;
  lift: number;
  spin: number;
  radius: number;
} {
  const p = clamp01(progress);
  return {
    inhale: smooth(p / 0.7),
    lift: smooth((p - 0.05) / 0.75),
    spin: 0.6 + 2.6 * smooth(p),
    radius: 1 - 0.45 * smooth((p - 0.3) / 0.7),
  };
}

/** Seconds the gust's wall of wind takes to ride out to the shove's end. */
export const GUST_WAVE_SECONDS = 0.55;

/** The gust `elapsed` seconds after it landed: its wall's radius (past the
 *  gust's own radius out to where the shove ends), height and alpha. */
export function gustBlastLook(
  elapsed: number,
  radius: number,
  shove: number,
): { front: number; height: number; alpha: number } {
  const t = clamp01(elapsed / GUST_WAVE_SECONDS);
  const ease = 1 - (1 - t) ** 2.2;
  const after = Math.max(0, elapsed - GUST_WAVE_SECONDS);
  return {
    front: (radius + shove * 0.8) * ease,
    height: 2 + 4.5 * (1 - t) + 1.5 * t,
    alpha: elapsed < 0 ? 0 : elapsed < GUST_WAVE_SECONDS ? 0.9 : Math.max(0, 0.9 - after / 0.5),
  };
}

/** Seconds a Storm Lance's bolt burns down its lane, and its scorch smoulders. */
export const LANCE_BOLT_SECONDS = 0.5;
export const LANCE_SCORCH_SECONDS = 3;

/** The lance `elapsed` seconds after it landed: the bolt's brightness and
 *  width share (a hard flash, a flicker, gone), the scorch's heat. */
export function lanceLook(elapsed: number): { bolt: number; width: number; scorch: number } {
  if (elapsed < 0) return { bolt: 0, width: 0, scorch: 0 };
  const flick = elapsed < 0.08 ? 1 : elapsed < 0.16 ? 0.45 : elapsed < 0.24 ? 0.9 : 0.4;
  const bolt = elapsed < LANCE_BOLT_SECONDS ? flick * (1 - elapsed / LANCE_BOLT_SECONDS) ** 0.5 : 0;
  return {
    bolt,
    width: 1 - 0.5 * clamp01(elapsed / LANCE_BOLT_SECONDS),
    scorch: Math.max(0, 1.4 * (1 - elapsed / LANCE_SCORCH_SECONDS)),
  };
}

/** Storm Lance over its bar (`progress` 0..1): the charge's crackle at the
 *  guardian and the sparks it throws along the lane. */
export function lanceChargeLook(progress: number): { crackle: number; sparks: number } {
  const p = clamp01(progress);
  return { crackle: 0.3 + 0.9 * smooth(p), sparks: smooth((p - 0.35) / 0.65) };
}

/**
 * The lance's bolt: a jagged path down its lane from the guardian (local +z,
 * x across), `segments` long, every point inside the lane's half width (the
 * effect never strays past what it hits). Deterministic per `seed`.
 */
export function lanceBoltPath(
  seed: number,
  length: number,
  halfWidth: number,
  segments = 18,
): { x: number; z: number; t: number }[] {
  const pts: { x: number; z: number; t: number }[] = [];
  const amp = Math.min(halfWidth * 0.7, 1.4);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const taper = i === 0 || i === segments ? 0.15 : 1;
    const x = (fxHash(seed, i) - 0.5) * 2 * amp * taper;
    pts.push({ x, z: length * t, t });
  }
  return pts;
}

/** Pool sizes at full density (the low tier thins the emitted counts). */
export const BREATH_FX_POOLS = {
  stones: 48,
  telegraphs: 2,
  bolts: 2,
} as const;
