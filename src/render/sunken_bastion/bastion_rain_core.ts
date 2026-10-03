// Pure plan of the Sunken Bastion's storm rain (painter: bastion_rain.ts): how
// many streaks, splashes and distant sheets each graphics tier draws, the wind
// and its gusts over time (one function, mirrored into the shaders as GLSL so
// the streaks' slant, the sheets' drift and this plan never disagree), the
// motion-blur length of a streak, and the floor-height grid the splashes land
// on (the authored field's own height, so a splash rings on the stones, in a
// puddle or on the swell, never in the air over a drop).
//
// Cosmetic only: every count sheds with the effects tier; nothing here is
// actionable. Three-free, DOM-free, deterministic.

import {
  SUNKEN_BASTION_FIELD,
  SUNKEN_BASTION_SEA_LEVEL,
} from '../../sim/content/sunken_bastion_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

export interface BastionRainTier {
  /** Falling streaks in the camera box. */
  streaks: number;
  /** Splash-and-ripple instances cycling round the camera. */
  splashes: number;
  /** Distant rain sheets standing round the horizon. */
  sheets: number;
}

/** Counts per tier: the low tier keeps a lighter rain, never none. */
export function bastionRainTier(lowGfx: boolean, density: number): BastionRainTier {
  const d = Math.min(1, Math.max(0, density));
  return {
    streaks: Math.round((lowGfx ? 1400 : 4200) * d),
    splashes: lowGfx ? 0 : Math.round(560 * d),
    sheets: lowGfx ? 6 : 14,
  };
}

/** The box of falling rain that follows the camera (yards). */
export const RAIN_BOX = { x: 60, y: 34, z: 60 } as const;
/** Base wind (yards per second, x and z): off the sea, from the south-west. */
export const RAIN_WIND: readonly [number, number] = [7.2, 4.6];
/** Fall speed range of a streak (yards per second). */
export const RAIN_SPEED = { min: 24, max: 38 } as const;
/** Exposure of the streak's motion blur (seconds of travel drawn per streak). */
export const RAIN_SHUTTER = { min: 0.035, max: 0.065 } as const;
/** Radius round the camera the splashes land in (yards). */
export const SPLASH_RADIUS = 26;

/** Gust strength in [0, 1] at `t` seconds: slow swells with quick flurries. */
export function rainGust(t: number): number {
  const slow = Math.sin(t * 0.13) * 0.5 + Math.sin(t * 0.071 + 1.7) * 0.3;
  const quick = Math.sin(t * 0.61 + 0.4) * 0.2;
  const g = 0.5 + 0.5 * (slow + quick);
  return Math.min(1, Math.max(0, g));
}

/** The GLSL twin of rainGust (keep the constants in step). */
export const RAIN_GUST_GLSL = /* glsl */ `
float rainGust(float t) {
  float slow = sin(t * 0.13) * 0.5 + sin(t * 0.071 + 1.7) * 0.3;
  float quick = sin(t * 0.61 + 0.4) * 0.2;
  return clamp(0.5 + 0.5 * (slow + quick), 0.0, 1.0);
}
`;

/** The wind at `t`: the base wind leaning harder in a gust. */
export function rainWind(t: number): [number, number] {
  const k = 0.55 + 0.9 * rainGust(t);
  return [RAIN_WIND[0] * k, RAIN_WIND[1] * k];
}

/** How far a streak leans from the vertical at fall `speed` in wind (radians). */
export function rainSlant(speed: number, wind: readonly [number, number]): number {
  return Math.atan2(Math.hypot(wind[0], wind[1]), speed);
}

/** The drawn length of a streak falling at `speed` with shutter share `s` in [0, 1]. */
export function rainStreakLength(speed: number, s: number): number {
  const shutter = RAIN_SHUTTER.min + (RAIN_SHUTTER.max - RAIN_SHUTTER.min) * s;
  return speed * shutter;
}

export interface SplashHeightGrid {
  minX: number;
  minZ: number;
  step: number;
  cols: number;
  rows: number;
  /** Landing height per cell (the sea's surface over the void). */
  heights: Float32Array;
  /** 1 where the cell is flat enough to land a splash on (not a lip). */
  flat: Uint8Array;
}

/**
 * The splash landing grid over the whole field at `step` yards: the floor's
 * own height on a terrace, the sea's surface over the void, and a flag that
 * keeps splashes off every cliff lip (a cell whose neighbours step by more
 * than a hand), so a splash never hangs in the air over a drop.
 */
export function planSplashHeights(step = 1): SplashHeightGrid {
  const f = SUNKEN_BASTION_FIELD;
  const minX = f.bounds.minX - 40;
  const minZ = f.bounds.minZ - 40;
  const cols = Math.ceil((f.bounds.maxX + 40 - minX) / step) + 1;
  const rows = Math.ceil((f.bounds.maxZ + 40 - minZ) / step) + 1;
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = authoredFieldHeight(f, minX + i * step, minZ + j * step);
      heights[j * cols + i] = h <= f.voidHeight + 0.5 ? SUNKEN_BASTION_SEA_LEVEL : h;
    }
  }
  const flat = new Uint8Array(cols * rows);
  for (let j = 1; j + 1 < rows; j++) {
    for (let i = 1; i + 1 < cols; i++) {
      const k = j * cols + i;
      const h = heights[k];
      const ok =
        Math.abs(heights[k - 1] - h) < 0.6 &&
        Math.abs(heights[k + 1] - h) < 0.6 &&
        Math.abs(heights[k - cols] - h) < 0.6 &&
        Math.abs(heights[k + cols] - h) < 0.6;
      flat[k] = ok ? 1 : 0;
    }
  }
  return { minX, minZ, step, cols, rows, heights, flat };
}

/** Height range the splash texture encodes (16 bits over it). */
export const SPLASH_HEIGHT_RANGE = { min: -40, max: 60 } as const;

/** Pack the grid as RGBA8 texels: R and G the 16-bit height, B the flat flag. */
export function packSplashHeights(grid: SplashHeightGrid): Uint8Array {
  const out = new Uint8Array(grid.cols * grid.rows * 4);
  const span = SPLASH_HEIGHT_RANGE.max - SPLASH_HEIGHT_RANGE.min;
  for (let k = 0; k < grid.heights.length; k++) {
    const t = Math.min(1, Math.max(0, (grid.heights[k] - SPLASH_HEIGHT_RANGE.min) / span));
    const v = Math.round(t * 65535);
    out[k * 4] = v >> 8;
    out[k * 4 + 1] = v & 255;
    out[k * 4 + 2] = grid.flat[k] ? 255 : 0;
    out[k * 4 + 3] = 255;
  }
  return out;
}

/** Decode one packed texel back to its height (the shader's own arithmetic). */
export function unpackSplashHeight(r: number, g: number): number {
  const span = SPLASH_HEIGHT_RANGE.max - SPLASH_HEIGHT_RANGE.min;
  return SPLASH_HEIGHT_RANGE.min + ((r * 256 + g) / 65535) * span;
}
