// Each realm's fire character and the physical blackbody emission curve,
// modelled on ocean/water_character_core.ts. Pure and Three-free, registered
// in RENDER_PURE_CORES and tested in tests/fire_character_core.test.ts.
//
// A fire's look comes from its temperature ramp (white-hot core -> amber-gold
// body -> crimson tip) plus a light, self-shadowed wisp of smoke at the top.
// Keeping smokeDensity low by default preserves third-person camera clarity
// while still giving outdoor campfires a realistic thermal plume.

import type { BiomeId } from '../../sim/types';
import { hexToLinear } from '../ocean/water_character_core';

export interface FireCharacter {
  /** White-hot combustion heart (sRGB hex). */
  core: number;
  /** Saturated mid-plume flame body (sRGB hex). */
  mid: number;
  /** Cooling outer/upper tongue tips (sRGB hex). */
  tip: number;
  /** Warm soot/ash tint for the light upper smoke wisps (sRGB hex). */
  smoke: number;
  /** Smoke wisp opacity scale (kept light so the camera stays clear). */
  smokeDensity: number;
  /** Helical vorticity/curl strength in the rising column. */
  swirl: number;
  /** Vertical draft speed multiplier. */
  draft: number;
}

/** Standard seasoned-wood campfire: saturated golden-yellow heart, vivid tangerine body, deep red-orange rim and folds. */
export const HEARTH_FIRE: FireCharacter = {
  core: 0xffd838,
  mid: 0xff5206,
  tip: 0xb81402,
  smoke: 0x261e1a,
  smokeDensity: 0.26,
  swirl: 1.25,
  draft: 1.35,
};

/** Pitch-heavy coastal and gale fires: livelier draft and slightly warmer amber tips. */
const PITCH_FIRE: FireCharacter = {
  core: 0xfff4cc,
  mid: 0xff6e14,
  tip: 0xb81d04,
  smoke: 0x322a25,
  smokeDensity: 0.26,
  swirl: 1.2,
  draft: 1.15,
};

export const FIRE_CHARACTERS: Readonly<Record<BiomeId, FireCharacter>> = {
  vale: HEARTH_FIRE,
  beach: { ...HEARTH_FIRE, draft: 1.08, smokeDensity: 0.18 },
  desert: {
    core: 0xfff9e6,
    mid: 0xff8824,
    tip: 0xd42c08,
    smoke: 0x42362c,
    smokeDensity: 0.16,
    swirl: 1.05,
    draft: 1.1,
  },
  marsh: {
    core: 0xfff2c8,
    mid: 0xff7018,
    tip: 0xb52006,
    smoke: 0x2e2b27,
    smokeDensity: 0.25,
    swirl: 0.95,
    draft: 0.95,
  },
  fen: {
    core: 0xffefbe,
    mid: 0xf56816,
    tip: 0xa81b05,
    smoke: 0x2b2924,
    smokeDensity: 0.26,
    swirl: 0.92,
    draft: 0.92,
  },
  peaks: { ...PITCH_FIRE, draft: 1.12 },
  frost: {
    core: 0xfff8e2,
    mid: 0xff8220,
    tip: 0xd12808,
    smoke: 0x3a332e,
    smokeDensity: 0.24,
    swirl: 1.1,
    draft: 1.08,
  },
  gale: PITCH_FIRE,
  jungle: { ...HEARTH_FIRE, smokeDensity: 0.2 },
  garden: { ...HEARTH_FIRE, smokeDensity: 0.16, swirl: 0.9 },
  amber: HEARTH_FIRE,
  dusk: {
    core: 0xfff3cf,
    mid: 0xff741c,
    tip: 0xc21e08,
    smoke: 0x302826,
    smokeDensity: 0.22,
    swirl: 1.0,
    draft: 0.98,
  },
  night: {
    core: 0xfff4d4,
    mid: 0xff7620,
    tip: 0xc4200a,
    smoke: 0x2c2524,
    smokeDensity: 0.2,
    swirl: 0.96,
    draft: 0.96,
  },
  haunt: {
    core: 0xffecc2,
    mid: 0xf26418,
    tip: 0xa61808,
    smoke: 0x282322,
    smokeDensity: 0.26,
    swirl: 1.08,
    draft: 0.94,
  },
  ember: {
    core: 0xfffbe8,
    mid: 0xff861c,
    tip: 0xd92604,
    smoke: 0x362a24,
    smokeDensity: 0.28,
    swirl: 1.25,
    draft: 1.18,
  },
  volcano: {
    core: 0xfffbe8,
    mid: 0xff861c,
    tip: 0xd92604,
    smoke: 0x362a24,
    smokeDensity: 0.28,
    swirl: 1.25,
    draft: 1.18,
  },
  cave: { ...HEARTH_FIRE, smokeDensity: 0.18, draft: 0.92 },
};

export function fireCharacterFor(biome: BiomeId): FireCharacter {
  return FIRE_CHARACTERS[biome] ?? HEARTH_FIRE;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the linear HDR blackbody emission colour for a normalized flame
 * temperature `temp` (>= 0). Mirrors the GLSL `fireBlackbody` function using
 * domain-safe polynomial ramps with zero `pow()` calls.
 */
export function fireBlackbodyLinearRgb(
  temp: number,
  character: FireCharacter = HEARTH_FIRE,
): [number, number, number] {
  const t = Math.max(0, temp);
  if (t <= 1e-4) return [0, 0, 0];

  const tip = hexToLinear(character.tip);
  const mid = hexToLinear(character.mid);
  const core = hexToLinear(character.core);

  const wTip = smoothstep(0.04, 0.36, t);
  const wMid = smoothstep(0.28, 0.72, t);
  const wCore = smoothstep(0.64, 1.12, t);

  // Interpolate chromaticity from crimson char -> orange-gold body -> white-hot core.
  let r = tip[0] * wTip;
  let g = tip[1] * wTip;
  let b = tip[2] * wTip;

  r += (mid[0] - r) * wMid;
  g += (mid[1] - g) * wMid;
  b += (mid[2] - b) * wMid;

  r += (core[0] - r) * wCore;
  g += (core[1] - g) * wCore;
  b += (core[2] - b) * wCore;

  // Physical radiance rises steeply with temperature (clamped polynomial so
  // hot cores exceed the 1.32 HDR bloom threshold while outer tips stay rich).
  const clamped = Math.min(t, 1.6);
  const gain = clamped * (0.85 + clamped * 1.45);
  return [r * gain, g * gain, b * gain];
}
