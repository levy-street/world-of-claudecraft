// The storybook meadow grass, shared by every zone's looks.
//
// Eastbrook's storybook-meadow look carries the painterly blades (comb,
// clumps, finer blades, flowers, rounded lighting, a one-hue colour ramp).
// Every other zone takes the same blades here, but keeps its own colours: the
// ramp's shadow and light ends are derived from that look's own grass tones
// (hue kept; lightness and saturation moved by the factors below, which match
// Eastbrook's authored ramp in lightness and saturation but not its teal hue
// turn), so a pink, gold or grey-sage field stays pink, gold or
// grey-sage. Pure data and maths: no Three, no DOM.

import type { BiomeId } from '../../sim/types';
import type { LookRender } from './zone_look_core';

/** Fields that grow no blades (ice, cinders, mown lawn): their looks keep the ground as is. */
export const BLADELESS_BIOMES: ReadonlySet<BiomeId> = new Set<BiomeId>([
  'frost',
  'ember',
  'garden',
]);
/** Fields that never bloom: their blades show no flowers. */
export const FLOWERLESS_BIOMES: ReadonlySet<BiomeId> = new Set<BiomeId>(['frost', 'haunt']);

/** The grass half of the storybook-meadow render block (no rim, ink or canopy). */
export const STORYBOOK_GRASS_RENDER = {
  meadowCoverage: 1,
  meadowHeight: 0.38,
  meadowWidth: 1.35,
  bladeWidth: 0.6,
  rampSoft: 0.8,
  bladeBase: 0.72,
  bladeNear: 0.62,
  carpetGround: 1,
  combX: 0.9,
  combZ: -0.1,
  combLean: 0.62,
  combDroop: 0.22,
  paintPatch: 0.1,
  paintTip: 0.55,
  bladeHeight: 1.15,
  bladeSpread: 1.35,
  bladeExtra: 1,
  flowerShare: 0.4,
  bladeClump: 0.6,
  bladeWiden: 0.3,
  rampStrength: 0.75,
  bladeSide: 0.7,
  cloudShadow: 0.24,
  bladeFar: 3,
  bladeRound: 0.8,
  bandFade: 0.85,
} as const satisfies Partial<LookRender>;

// Eastbrook's authored ramp against its grass tones, in lightness and
// saturation: the shadow end sits at 0.81 of the dark grass lightness, the
// light end at 1.2 of the grass lightness, both 1.14 times as saturated.
const SHADOW_LIGHTNESS = 0.81;
const LIGHT_LIGHTNESS = 1.2;
const RAMP_SATURATION = 1.14;

type Hsl = [number, number, number];

function hexToHsl(hex: number): Hsl {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex([h, s, l]: Hsl): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (to(ch(h + 1 / 3)) << 16) | (to(ch(h)) << 8) | to(ch(h - 1 / 3));
}

function shift(hex: number, lightness: number): number {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex([h, Math.min(1, s * RAMP_SATURATION), Math.min(1, l * lightness)]);
}

/** The storybook ramp ends for a field whose grass tones are `grass` and `grassDark`. */
export function storybookRampFor(
  grass: number,
  grassDark: number,
): {
  rampShadow: number;
  rampLight: number;
} {
  return {
    rampShadow: shift(grassDark, SHADOW_LIGHTNESS),
    rampLight: shift(grass, LIGHT_LIGHTNESS),
  };
}

/**
 * The storybook grass for one look: the shared blades, the ramp recoloured
 * from the look's own grass tones, and no flowers where the field never
 * blooms.
 */
export function storybookGrassFor(
  grass: number,
  grassDark: number,
  flowerless: boolean,
): Partial<LookRender> {
  return {
    ...STORYBOOK_GRASS_RENDER,
    ...storybookRampFor(grass, grassDark),
    ...(flowerless ? { flowerShare: 0 } : {}),
  };
}

/**
 * The storybook grass for a look in a `biome` field whose grass tones are
 * `grass` and `grassDark`: nothing for a bladeless field, otherwise the shared
 * blades in those tones.
 */
export function storybookGrassForBiome(
  biome: BiomeId,
  grass: number,
  grassDark: number,
): Partial<LookRender> {
  if (BLADELESS_BIOMES.has(biome)) return {};
  return storybookGrassFor(grass, grassDark, FLOWERLESS_BIOMES.has(biome));
}
