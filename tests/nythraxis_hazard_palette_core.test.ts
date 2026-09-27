// Colorblind Mode's hazard palette (src/render/nythraxis_hazard_palette_core.ts).
//
// The decisive claim is not "the hex changed" but "the hazards stay tellable
// apart for a colour-vision-deficient player where the classic set is not".
// So this suite simulates deuteranopia, protanopia and tritanopia (the Vienot,
// Brettel and Mollon 1999 linear-RGB projections, the standard simulation) and
// asserts a minimum pairwise separation between every hazard rim under each,
// plus a lightness spread so the pairs survive greyscale too. The classic
// purple family is run through the same gate and shown to FAIL it, which is
// what makes the colourblind gate load-bearing rather than self-fulfilling.

import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_GRAVE_ERUPTION_PALETTE } from '../src/render/nythraxis_grave_core';
import { NYTHRAXIS_GRAVEFIRE_PALETTE } from '../src/render/nythraxis_gravefire_core';
import {
  HAZARD_PALETTE_MODES,
  type HazardPaletteMode,
  hazardPaletteMaterialSuffix,
  hazardPaletteModeOf,
  NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND,
  NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND,
  NYTHRAXIS_SOFT_FIRE_RAMPS_COLORBLIND,
  NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND,
  NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND,
  nythraxisFlamePaletteFor,
  nythraxisGraveEruptionPalette,
  nythraxisGravefirePalette,
  nythraxisSoftFireRamp,
  nythraxisSoulRendPaletteFor,
} from '../src/render/nythraxis_hazard_palette_core';
import { NYTHRAXIS_SOFT_FIRE_RAMPS } from '../src/render/nythraxis_soft_fire_core';
import {
  NYTHRAXIS_SOUL_REND_ALONE_PALETTE,
  NYTHRAXIS_SOUL_REND_STACKED_PALETTE,
} from '../src/render/nythraxis_soul_rend_marker_core';

type Rgb = [number, number, number];

function srgbToLinear(hex: number): Rgb {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((hex >> 16) & 0xff), channel((hex >> 8) & 0xff), channel(hex & 0xff)];
}

// Vienot, Brettel and Mollon (1999) dichromat projections in linear RGB, the
// matrices every mainstream colourblindness simulator (Chrome DevTools, Sim
// Daltonism) ships.
const CVD: Record<string, number[][]> = {
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  protanopia: [
    [0.56667, 0.43333, 0],
    [0.55833, 0.44167, 0],
    [0, 0.24167, 0.75833],
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.43333, 0.56667],
    [0, 0.475, 0.525],
  ],
};

function project(rgb: Rgb, m: number[][]): Rgb {
  return [0, 1, 2].map((r) => m[r][0] * rgb[0] + m[r][1] * rgb[1] + m[r][2] * rgb[2]) as Rgb;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Euclidean distance in linear RGB, 0 (identical) to sqrt(3) (black vs white). */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The actionable rims per mode: the lines a player reads the hazard edge off. */
function hazardRims(mode: HazardPaletteMode): Record<string, number> {
  return {
    eruption: nythraxisGraveEruptionPalette(mode).boundary,
    graveFlame: nythraxisFlamePaletteFor('grave', mode).rim,
    soulfire: nythraxisFlamePaletteFor('soul', mode).rim,
    gravefire: nythraxisGravefirePalette(mode).edge,
  };
}

/** Smallest separation over every rim pair under one projection. */
function minPairSeparation(rims: Record<string, number>, m: number[][]): number {
  const entries = Object.values(rims).map((hex) => project(srgbToLinear(hex), m));
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      min = Math.min(min, distance(entries[i], entries[j]));
    }
  }
  return min;
}

// A separation floor of 0.25 in linear RGB is roughly the gap between two
// clearly different mid-tones on a monitor; the purple family sits well under it.
const SEPARATION_FLOOR = 0.25;

describe('Colorblind Mode hazard palette', () => {
  it('maps the settings boolean onto the two modes and the pool suffix', () => {
    expect(HAZARD_PALETTE_MODES).toEqual(['classic', 'colorblind']);
    expect(hazardPaletteModeOf(false)).toBe('classic');
    expect(hazardPaletteModeOf(true)).toBe('colorblind');
    // The classic bucket keeps its historical bare key; the colourblind
    // materials get their own so a pooled tint never crosses modes.
    expect(hazardPaletteMaterialSuffix('classic')).toBe('');
    expect(hazardPaletteMaterialSuffix('colorblind')).toBe(':colorblind');
  });

  it('classic mode returns the owner-called purple palettes untouched', () => {
    expect(nythraxisGraveEruptionPalette('classic')).toBe(NYTHRAXIS_GRAVE_ERUPTION_PALETTE);
    expect(nythraxisGravefirePalette('classic')).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE);
    expect(nythraxisSoftFireRamp('soul', 'classic')).toBe(NYTHRAXIS_SOFT_FIRE_RAMPS.soul);
    expect(nythraxisSoulRendPaletteFor(0, 'classic')).toBe(NYTHRAXIS_SOUL_REND_ALONE_PALETTE);
    expect(nythraxisSoulRendPaletteFor(2, 'classic')).toBe(NYTHRAXIS_SOUL_REND_STACKED_PALETTE);
  });

  it('colorblind mode selects the Okabe-Ito family per hazard kind', () => {
    expect(nythraxisGraveEruptionPalette('colorblind')).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND,
    );
    expect(nythraxisGravefirePalette('colorblind')).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND);
    expect(nythraxisSoftFireRamp('grave', 'colorblind')).toBe(
      NYTHRAXIS_SOFT_FIRE_RAMPS_COLORBLIND.grave,
    );
    expect(nythraxisSoulRendPaletteFor(0, 'colorblind')).toBe(
      NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND,
    );
    expect(nythraxisSoulRendPaletteFor(1, 'colorblind')).toBe(
      NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND,
    );
    // Independent literal pins (the Okabe-Ito hues), so a drift off the
    // colourblind-safe set is caught even if every wiring test still passes.
    expect(NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND.boundary).toBe(0xf0e442);
    expect(NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND.countdown).toBe(0xffffff);
    expect(nythraxisFlamePaletteFor('grave', 'colorblind').rim).toBe(0x007a5a);
    expect(nythraxisFlamePaletteFor('soul', 'colorblind').rim).toBe(0xcc79a7);
    expect(NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND.edge).toBe(0xd55e00);
    expect(NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND.ring).toBe(0xd55e00);
    expect(NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND.ring).toBe(0x56b4e9);
  });

  it.each(Object.keys(CVD))('keeps every hazard rim apart under simulated %s', (kind) => {
    const m = CVD[kind];
    expect(minPairSeparation(hazardRims('colorblind'), m)).toBeGreaterThan(SEPARATION_FLOOR);
    // The load-bearing half: the classic purple family fails the same gate,
    // which is the report ("a giant blob of identical colors") in numbers.
    expect(minPairSeparation(hazardRims('classic'), m)).toBeLessThan(SEPARATION_FLOOR);
  });

  it('keeps the Soul Rend alone/stacked pair apart under every simulation', () => {
    for (const m of Object.values(CVD)) {
      const alone = project(srgbToLinear(NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND.ring), m);
      const stacked = project(srgbToLinear(NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND.ring), m);
      expect(distance(alone, stacked)).toBeGreaterThan(SEPARATION_FLOOR);
    }
    // The classic pair is a red/green hue pair, the textbook deuteranope
    // confusion; the swap keeps them apart by hue AND stays apart in lightness.
    expect(
      Math.abs(
        luminance(srgbToLinear(NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND.ring)) -
          luminance(srgbToLinear(NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND.ring)),
      ),
    ).toBeGreaterThan(0.1);
  });

  it('spreads the hazards across lightness so they separate in greyscale too', () => {
    const rims = hazardRims('colorblind');
    const lum = Object.fromEntries(
      Object.entries(rims).map(([name, hex]) => [name, luminance(srgbToLinear(hex))]),
    );
    // The incoming strike is the brightest read on the floor: it must never
    // hide under the pools it leaves behind.
    expect(lum.eruption).toBeGreaterThan(lum.soulfire);
    expect(lum.eruption).toBeGreaterThan(lum.gravefire);
    expect(lum.eruption).toBeGreaterThan(lum.graveFlame);
    // And the two pools that can overlap are not the same lightness either.
    expect(Math.abs(lum.soulfire - lum.graveFlame)).toBeGreaterThan(0.1);
  });

  it('never changes the classic set (the existing literal pins still hold)', () => {
    expect(NYTHRAXIS_GRAVE_ERUPTION_PALETTE.boundary).toBe(0x9a5df0);
    expect(NYTHRAXIS_GRAVEFIRE_PALETTE.edge).toBe(0xa06cff);
  });
});
